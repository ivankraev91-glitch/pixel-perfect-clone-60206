import { fetch as undiciFetch } from "undici";
import {
  agentFor,
  banSession,
  pickSession,
  ProxySession,
  recordHealth,
  saveCookies,
} from "./proxy.js";
import { detectCaptcha, solveYandexCaptcha } from "./captcha.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type YandexOrg = {
  yandex_id: string;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
};

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function mergeSetCookie(jar: Record<string, string>, setCookies: string[]): Record<string, string> {
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

async function fetchViaProxy(url: string, session: ProxySession): Promise<{ status: number; body: string; setCookies: string[] }> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept-Language": "ru,en;q=0.8",
    "Accept": "text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8",
  };
  if (Object.keys(session.cookies).length > 0) headers.Cookie = cookieHeader(session.cookies);
  const resp = await undiciFetch(url, { dispatcher: agentFor(session.proxy), headers });
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  const body = await resp.text();
  return { status: resp.status, body, setCookies };
}

export function parseYandexMapsHtml(html: string): YandexOrg[] {
  const out: YandexOrg[] = [];
  const cfg = html.match(/<script[^>]*class=["']?config-view["']?[^>]*>([\s\S]*?)<\/script>/);
  let blob = cfg?.[1];
  if (!blob) {
    const init = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    blob = init?.[1];
  }
  if (!blob) return out;
  let parsed: any;
  try { parsed = JSON.parse(blob); } catch { return out; }
  const stack: any[] = [parsed];
  const seen = new Set<string>();
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) { for (const x of v) stack.push(x); continue; }
    const id = v.id ?? v.businessId ?? v.permalink;
    const title = v.title ?? v.name;
    const address = v.fullAddress ?? v.address ?? v.formattedAddress;
    const coords = v.coordinates ?? v.point ?? v.geo;
    if (id && title && /^\d{6,}$/.test(String(id)) && !seen.has(String(id))) {
      seen.add(String(id));
      let lat: number | null = null, lon: number | null = null;
      if (Array.isArray(coords) && coords.length === 2) { lon = Number(coords[0]); lat = Number(coords[1]); }
      else if (coords && typeof coords === "object") {
        lat = Number(coords.lat ?? coords.latitude ?? null);
        lon = Number(coords.lon ?? coords.lng ?? coords.longitude ?? null);
      }
      out.push({
        yandex_id: String(id),
        name: String(title),
        address: address ? String(address) : "",
        lat: Number.isFinite(lat as number) ? lat : null,
        lon: Number.isFinite(lon as number) ? lon : null,
      });
    }
    for (const k of Object.keys(v)) stack.push(v[k]);
  }
  return out;
}

export async function searchYandexMaps(
  pool: "check" | "search",
  text: string,
  ll?: { lat: number; lon: number },
  maxAttempts = 4,
): Promise<{ ok: true; results: YandexOrg[] } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const session = await pickSession(pool);
    if (!session) return { ok: false, error: "no_proxies_available" };

    const params = new URLSearchParams({ text, mode: "search", lang: "ru_RU" });
    if (ll) { params.set("ll", `${ll.lon},${ll.lat}`); params.set("z", "15"); }
    const url = `https://yandex.ru/maps/?${params.toString()}`;

    let r: { status: number; body: string; setCookies: string[] };
    try {
      r = await fetchViaProxy(url, session);
    } catch (e) {
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
      const submitUrl = `https://yandex.ru/checkcaptcha?key=${cap.sitekey}&rep=${encodeURIComponent(token)}&retpath=${encodeURIComponent(url)}`;
      try {
        const r2 = await fetchViaProxy(submitUrl, session);
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

    const results = parseYandexMapsHtml(body);
    if (results.length === 0) {
      await recordHealth(session.proxy, false);
      continue;
    }
    await recordHealth(session.proxy, true);
    return { ok: true, results };
  }
  return { ok: false, error: "all_attempts_failed" };
}
