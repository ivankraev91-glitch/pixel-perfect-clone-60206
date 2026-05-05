// Shared helpers for scraping Yandex Maps via residential proxies + captcha solving.
// Used by: scrape-worker, search-org (rewritten).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

export type ProxySession = {
  id: string;
  proxy: string;
  cookies: Record<string, string>;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---------- Proxy pool ----------

export function getProxyList(): string[] {
  const raw = Deno.env.get("RU_PROXY_LIST") ?? "";
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export async function ensureProxiesSeeded(svc: SupabaseClient, pool: "check" | "search") {
  const list = getProxyList();
  if (list.length === 0) return;
  const rows = list.map((proxy) => ({ proxy, pool }));
  // upsert ignoring conflicts
  await svc.from("scrape_sessions").upsert(rows, { onConflict: "proxy", ignoreDuplicates: true });
}

export async function pickSession(
  svc: SupabaseClient,
  pool: "check" | "search",
): Promise<ProxySession | null> {
  await ensureProxiesSeeded(svc, pool);
  const nowIso = new Date().toISOString();
  const { data } = await svc
    .from("scrape_sessions")
    .select("id, proxy, cookies, last_used_at, banned_until")
    .eq("pool", pool)
    .or(`banned_until.is.null,banned_until.lt.${nowIso}`)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1);
  const row = data?.[0];
  if (!row) return null;
  await svc
    .from("scrape_sessions")
    .update({ last_used_at: nowIso })
    .eq("id", row.id);
  return { id: row.id, proxy: row.proxy, cookies: (row.cookies as any) ?? {} };
}

export async function banSession(svc: SupabaseClient, sessionId: string, minutes: number) {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await svc.from("scrape_sessions").update({ banned_until: until }).eq("id", sessionId);
}

export async function saveCookies(
  svc: SupabaseClient,
  sessionId: string,
  cookies: Record<string, string>,
) {
  await svc.from("scrape_sessions").update({ cookies }).eq("id", sessionId);
}

export async function recordHealth(svc: SupabaseClient, proxy: string, ok: boolean) {
  const nowIso = new Date().toISOString();
  // upsert + increment
  const { data: existing } = await svc
    .from("proxy_health")
    .select("success_count, fail_count")
    .eq("proxy", proxy)
    .maybeSingle();
  const sc = (existing?.success_count ?? 0) + (ok ? 1 : 0);
  const fc = (existing?.fail_count ?? 0) + (ok ? 0 : 1);
  await svc.from("proxy_health").upsert({
    proxy,
    success_count: sc,
    fail_count: fc,
    last_success_at: ok ? nowIso : existing ? undefined : null,
    last_fail_at: ok ? (existing ? undefined : null) : nowIso,
    updated_at: nowIso,
  });
}

// ---------- Cookie jar helpers ----------

function mergeSetCookie(jar: Record<string, string>, headers: Headers): Record<string, string> {
  const next = { ...jar };
  // Deno's Headers.getSetCookie() returns each cookie line
  const lines = (headers as any).getSetCookie?.() ?? [];
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const valueAndAttrs = line.slice(eq + 1);
    const value = valueAndAttrs.split(";")[0];
    next[name] = value;
  }
  return next;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ---------- HTTP via proxy ----------
// Note: Deno's stdlib fetch does not support HTTP proxies directly.
// We use Deno.createHttpClient when available, else fall back to a proxy
// gateway by sending requests to the proxy via raw connection.
// Most residential providers offer a HTTP gateway like
// http://user:pass@gw.provider:port — we use it via Deno.createHttpClient (unstable).

let httpClientCache = new Map<string, any>();
function getClientForProxy(proxyUrl: string): any | null {
  if (httpClientCache.has(proxyUrl)) return httpClientCache.get(proxyUrl);
  try {
    // @ts-ignore unstable API
    const client = (Deno as any).createHttpClient?.({ proxy: { url: proxyUrl } });
    if (client) {
      httpClientCache.set(proxyUrl, client);
      return client;
    }
  } catch (_e) {
    // ignore
  }
  return null;
}

export async function fetchViaProxy(
  url: string,
  session: ProxySession,
  init: RequestInit = {},
): Promise<{ resp: Response; bodyText: string }> {
  const headers = new Headers(init.headers ?? {});
  headers.set("User-Agent", UA);
  headers.set("Accept-Language", "ru,en;q=0.8");
  headers.set("Accept", "text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8");
  if (Object.keys(session.cookies).length > 0) {
    headers.set("Cookie", cookieHeader(session.cookies));
  }
  const client = getClientForProxy(session.proxy);
  // @ts-ignore - client option is Deno-specific
  const resp = await fetch(url, { ...init, headers, client });
  const bodyText = await resp.text();
  return { resp, bodyText };
}

// ---------- Captcha solving ----------

export async function solveYandexCaptcha(sitekey: string, pageUrl: string): Promise<string | null> {
  const provider = (Deno.env.get("CAPTCHA_PROVIDER") ?? "2captcha").toLowerCase();
  const key = Deno.env.get("CAPTCHA_API_KEY");
  if (!key) return null;

  if (provider === "capmonster") {
    const create = await fetch("https://api.capmonster.cloud/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: key,
        task: {
          type: "YandexSmartCaptchaTaskProxyless",
          websiteURL: pageUrl,
          websiteKey: sitekey,
        },
      }),
    });
    const created = await create.json();
    const taskId = created?.taskId;
    if (!taskId) return null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await fetch("https://api.capmonster.cloud/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: key, taskId }),
      });
      const j = await r.json();
      if (j?.status === "ready") return j?.solution?.token ?? j?.solution?.gRecaptchaResponse ?? null;
      if (j?.errorId && j.errorId !== 0) return null;
    }
    return null;
  }

  // 2captcha / rucaptcha (compatible)
  const base = provider === "rucaptcha" ? "https://rucaptcha.com" : "https://2captcha.com";
  const inResp = await fetch(
    `${base}/in.php?key=${key}&method=yandex&sitekey=${encodeURIComponent(sitekey)}&pageurl=${encodeURIComponent(pageUrl)}&json=1`,
  );
  const inJson = await inResp.json();
  if (inJson?.status !== 1) return null;
  const id = inJson.request;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${base}/res.php?key=${key}&action=get&id=${id}&json=1`);
    const j = await res.json();
    if (j?.status === 1) return j.request as string;
    if (j?.request && j.request !== "CAPCHA_NOT_READY") return null;
  }
  return null;
}

export function detectCaptcha(html: string): { sitekey: string } | null {
  // SmartCaptcha embeds data-sitekey in the page
  const m = html.match(/data-sitekey="([A-Za-z0-9_-]+)"/);
  if (m) return { sitekey: m[1] };
  if (/showcaptcha|smartcaptcha/i.test(html)) {
    // sometimes sitekey is nested in JSON
    const j = html.match(/"sitekey"\s*:\s*"([A-Za-z0-9_-]+)"/);
    if (j) return { sitekey: j[1] };
  }
  return null;
}

// ---------- Yandex Maps result parsing ----------

export type YandexOrg = {
  yandex_id: string;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
};

/**
 * Parses the inline JSON Yandex Maps embeds in its SSR HTML.
 * It hides under <script class="config-view"> as a stringified JSON.
 */
export function parseYandexMapsHtml(html: string): YandexOrg[] {
  // Strategy 1: extract the config view JSON
  const out: YandexOrg[] = [];
  const cfg = html.match(/<script[^>]*class=["']?config-view["']?[^>]*>([\s\S]*?)<\/script>/);
  let blob = cfg?.[1];
  if (!blob) {
    // Strategy 2: window.__INITIAL_STATE__
    const init = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    blob = init?.[1];
  }
  if (!blob) return out;
  let parsed: any;
  try {
    parsed = JSON.parse(blob);
  } catch {
    return out;
  }
  // Walk the object looking for items with `seoname` / `coordinates` / `id`
  const stack = [parsed];
  const seen = new Set<string>();
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
      continue;
    }
    // Look for org-like shape
    const id = v.id ?? v.businessId ?? v.permalink;
    const title = v.title ?? v.name;
    const address = v.fullAddress ?? v.address ?? v.formattedAddress;
    const coords = v.coordinates ?? v.point ?? v.geo;
    if (id && title && /^\d{6,}$/.test(String(id)) && !seen.has(String(id))) {
      seen.add(String(id));
      let lat: number | null = null;
      let lon: number | null = null;
      if (Array.isArray(coords) && coords.length === 2) {
        lon = Number(coords[0]);
        lat = Number(coords[1]);
      } else if (coords && typeof coords === "object") {
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

// ---------- High-level: search Yandex Maps ----------

export async function searchYandexMaps(
  svc: SupabaseClient,
  pool: "check" | "search",
  text: string,
  ll?: { lat: number; lon: number },
  maxAttempts = 4,
): Promise<{ ok: true; results: YandexOrg[] } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const session = await pickSession(svc, pool);
    if (!session) return { ok: false, error: "no_proxies_available" };

    const params = new URLSearchParams({
      text,
      mode: "search",
      lang: "ru_RU",
    });
    if (ll) {
      params.set("ll", `${ll.lon},${ll.lat}`);
      params.set("z", "15");
    }
    const url = `https://yandex.ru/maps/?${params.toString()}`;

    let resp: Response;
    let bodyText: string;
    try {
      const r = await fetchViaProxy(url, session);
      resp = r.resp;
      bodyText = r.bodyText;
    } catch (e) {
      await recordHealth(svc, session.proxy, false);
      await banSession(svc, session.id, 5);
      continue;
    }

    // persist any new cookies
    const newJar = mergeSetCookie(session.cookies, resp.headers);
    if (Object.keys(newJar).length !== Object.keys(session.cookies).length) {
      await saveCookies(svc, session.id, newJar);
      session.cookies = newJar;
    }

    if (resp.status === 429 || resp.status === 403) {
      await recordHealth(svc, session.proxy, false);
      await banSession(svc, session.id, 60);
      continue;
    }

    // captcha?
    const cap = detectCaptcha(bodyText);
    if (cap) {
      const token = await solveYandexCaptcha(cap.sitekey, url);
      if (!token) {
        await recordHealth(svc, session.proxy, false);
        await banSession(svc, session.id, 30);
        continue;
      }
      // Submit captcha token
      const submitUrl = `https://yandex.ru/checkcaptcha?key=${cap.sitekey}&rep=${encodeURIComponent(token)}&retpath=${encodeURIComponent(url)}`;
      try {
        const r2 = await fetchViaProxy(submitUrl, session);
        const jar2 = mergeSetCookie(session.cookies, r2.resp.headers);
        await saveCookies(svc, session.id, jar2);
        session.cookies = jar2;
        // Retry the search
        const r3 = await fetchViaProxy(url, session);
        bodyText = r3.bodyText;
        const stillCap = detectCaptcha(bodyText);
        if (stillCap) {
          await recordHealth(svc, session.proxy, false);
          await banSession(svc, session.id, 30);
          continue;
        }
      } catch {
        await recordHealth(svc, session.proxy, false);
        continue;
      }
    }

    const results = parseYandexMapsHtml(bodyText);
    if (results.length === 0) {
      await recordHealth(svc, session.proxy, false);
      // Maybe the page returned a non-search layout; try another proxy
      continue;
    }
    await recordHealth(svc, session.proxy, true);
    return { ok: true, results };
  }
  return { ok: false, error: "all_attempts_failed" };
}

export function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
