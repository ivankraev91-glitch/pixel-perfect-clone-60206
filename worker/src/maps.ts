// Scrape Yandex Maps search SERP via RU proxy + RuCaptcha.
// Replaces the previous Geosearch API integration: we render the same page a
// real user would see at yandex.ru/maps/?text=...&ll=...&z=14 and look at the
// order of organization cards. Position = index of our org's yandex_id (1..N).
import { fetch as undiciFetch } from "undici";
import { agentFor, banSession, pickSession, recordHealth, saveCookies, ProxySession } from "./proxy.js";
import { detectCaptcha, solveYandexCaptcha } from "./captcha.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type MapsResult =
  | { ok: true; indexed: boolean; position: number | null; total: number }
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

/**
 * Extract ordered list of unique org IDs from the Maps SERP HTML.
 * Yandex Maps SSR contains links like /maps/org/<slug>/<id>/ for each card.
 */
export function parseMapsSerp(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /\/maps\/org\/(?:[^/]+\/)?(\d{6,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

export async function mapsScrapePosition(
  keyword: string,
  ll: { lat: number; lon: number },
  ourOrgId: string,
  maxAttempts = 3,
): Promise<MapsResult> {
  const url =
    `https://yandex.ru/maps/?mode=search&text=${encodeURIComponent(keyword)}` +
    `&ll=${ll.lon}%2C${ll.lat}&z=14`;

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
    const ids = parseMapsSerp(body);
    if (ids.length === 0) {
      // SERP returned, but we couldn't find any org cards — treat as not indexed.
      return { ok: true, indexed: false, position: null, total: 0 };
    }
    const idx = ids.indexOf(String(ourOrgId));
    return {
      ok: true,
      indexed: idx >= 0,
      position: idx >= 0 ? idx + 1 : null,
      total: ids.length,
    };
  }
  return { ok: false, error: "all_attempts_failed" };
}
