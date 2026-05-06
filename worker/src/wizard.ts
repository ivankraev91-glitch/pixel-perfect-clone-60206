// Parse Yandex search results page (yandex.ru/search/) for the "companies" wizard block.
// Routes through RU proxy + RuCaptcha when needed.
import { fetch as undiciFetch } from "undici";
import { agentFor, banSession, pickSession, recordHealth, saveCookies, ProxySession } from "./proxy.js";
import { detectCaptcha, solveYandexCaptcha } from "./captcha.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type WizardResult =
  | { ok: true; exists: boolean; position: number | null; total: number }
  | { ok: false; error: string };

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}
function mergeSetCookie(jar: Record<string, string>, setCookies: string[]) {
  const next = { ...jar };
  for (const line of setCookies) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).split(";")[0];
    next[name] = value;
  }
  return next;
}

async function fetchViaProxy(url: string, session: ProxySession) {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept-Language": "ru,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (Object.keys(session.cookies).length > 0) headers.Cookie = cookieHeader(session.cookies);
  const resp = await undiciFetch(url, { dispatcher: agentFor(session.proxy), headers });
  const setCookies = (resp.headers as any).getSetCookie?.() ?? [];
  const body = await resp.text();
  return { status: resp.status, body, setCookies };
}

const NORM = (s: string) => s.toLowerCase().replace(/[ё]/g, "е").replace(/[^a-zа-я0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Heuristic parser for the wizard companies block.
 * Looks for org links in the form /maps/org/.../<id>/ and counts unique cards.
 * Detects the wizard block by presence of `data-fast-name="companies"` or `companies-slider`
 * or `data-wizard-name="*maps*"`.
 */
export function parseWizard(html: string, ourOrgId: string, ourOrgName: string): { exists: boolean; position: number | null; total: number } {
  const blockRegexes = [
    /<div[^>]+data-fast-name=["']companies["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i,
    /<div[^>]+class=["'][^"']*companies-slider[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    /<div[^>]+data-wizard-name=["'][^"']*maps[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
  ];
  let block: string | null = null;
  for (const re of blockRegexes) {
    const m = html.match(re);
    if (m) { block = m[1]; break; }
  }
  if (!block) return { exists: false, position: null, total: 0 };

  // Extract candidate orgs by /maps/org/<...>/<id>/
  const idRe = /\/maps\/org\/(?:[^/]+\/)?(\d{6,})/g;
  const ids: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(block)) !== null) {
    const id = m[1];
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }

  // Fallback: extract by visible names if no IDs (weaker, name-based match)
  if (ids.length === 0) {
    const nameRe = /<a[^>]*class=["'][^"']*(?:OrganizationItem|companies-item|MiniCard)[^"']*["'][^>]*>([\s\S]{1,200}?)<\/a>/gi;
    const names: string[] = [];
    while ((m = nameRe.exec(block)) !== null) {
      const txt = m[1].replace(/<[^>]+>/g, "").trim();
      if (txt) names.push(txt);
    }
    if (names.length === 0) return { exists: true, position: null, total: 0 };
    const target = NORM(ourOrgName);
    const idx = names.findIndex((n) => NORM(n).includes(target) || target.includes(NORM(n)));
    return { exists: true, position: idx >= 0 ? idx + 1 : null, total: names.length };
  }

  const idx = ids.indexOf(String(ourOrgId));
  return { exists: true, position: idx >= 0 ? idx + 1 : null, total: ids.length };
}

export async function wizardCheck(
  keyword: string,
  regionId: number,
  ourOrgId: string,
  ourOrgName: string,
  maxAttempts = 3,
): Promise<WizardResult> {
  const url = `https://yandex.ru/search/?text=${encodeURIComponent(keyword)}&lr=${regionId}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const session = await pickSession("check");
    if (!session) return { ok: false, error: "no_proxies_available" };

    let r;
    try {
      r = await fetchViaProxy(url, session);
    } catch (_e) {
      await recordHealth(session.proxy, false);
      await banSession(session.id, 5);
      continue;
    }

    const newJar = mergeSetCookie(session.cookies, r.setCookies);
    if (Object.keys(newJar).length !== Object.keys(session.cookies).length) {
      await saveCookies(session.id, newJar);
      session.cookies = newJar;
    }

    if (r.status === 429 || r.status === 403) {
      await recordHealth(session.proxy, false);
      await banSession(session.id, 60);
      continue;
    }

    let body = r.body;
    const cap = detectCaptcha(body);
    if (cap) {
      const token = await solveYandexCaptcha(cap.sitekey, url);
      if (!token) {
        await recordHealth(session.proxy, false);
        await banSession(session.id, 30);
        continue;
      }
      const submit = `https://yandex.ru/checkcaptcha?key=${cap.sitekey}&rep=${encodeURIComponent(token)}&retpath=${encodeURIComponent(url)}`;
      try {
        const r2 = await fetchViaProxy(submit, session);
        const jar2 = mergeSetCookie(session.cookies, r2.setCookies);
        await saveCookies(session.id, jar2);
        session.cookies = jar2;
        const r3 = await fetchViaProxy(url, session);
        body = r3.body;
        if (detectCaptcha(body)) {
          await recordHealth(session.proxy, false);
          await banSession(session.id, 30);
          continue;
        }
      } catch {
        await recordHealth(session.proxy, false);
        continue;
      }
    }

    await recordHealth(session.proxy, true);
    const parsed = parseWizard(body, ourOrgId, ourOrgName);
    return { ok: true, ...parsed };
  }
  return { ok: false, error: "all_attempts_failed" };
}
