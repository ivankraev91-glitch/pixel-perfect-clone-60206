import { ProxyAgent } from "undici";
import { db } from "./db.js";

export type ProxySession = {
  id: string;
  proxy: string;
  cookies: Record<string, string>;
};

function normalizeProxy(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  const parts = s.split(":");
  if (parts.length === 4) {
    const [ip, port, user, pass] = parts;
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:${port}`;
  }
  if (/@/.test(s) && !/^\w+:\/\//.test(s)) return `http://${s}`;
  if (parts.length === 2) return `http://${s}`;
  return s;
}

export function getProxyList(): string[] {
  const raw = process.env.RU_PROXY_LIST ?? "";
  return raw.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean).map(normalizeProxy);
}

const agentCache = new Map<string, ProxyAgent>();
export function agentFor(proxyUrl: string): ProxyAgent {
  let a = agentCache.get(proxyUrl);
  if (!a) {
    a = new ProxyAgent(proxyUrl);
    agentCache.set(proxyUrl, a);
  }
  return a;
}

export async function ensureProxiesSeeded(pool: "check" | "search") {
  const list = getProxyList();
  if (list.length === 0) return;
  const rows = list.map((proxy) => ({ proxy, pool }));
  await db.from("scrape_sessions").upsert(rows, { onConflict: "proxy", ignoreDuplicates: true });
}

export async function pickSession(pool: "check" | "search"): Promise<ProxySession | null> {
  await ensureProxiesSeeded(pool);
  const nowIso = new Date().toISOString();
  const { data } = await db
    .from("scrape_sessions")
    .select("id, proxy, cookies, last_used_at, banned_until")
    .eq("pool", pool)
    .or(`banned_until.is.null,banned_until.lt.${nowIso}`)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1);
  const row = data?.[0];
  if (!row) return null;
  await db.from("scrape_sessions").update({ last_used_at: nowIso }).eq("id", row.id);
  return { id: row.id, proxy: row.proxy, cookies: (row.cookies as any) ?? {} };
}

export async function banSession(sessionId: string, minutes: number) {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await db.from("scrape_sessions").update({ banned_until: until }).eq("id", sessionId);
}

export async function saveCookies(sessionId: string, cookies: Record<string, string>) {
  await db.from("scrape_sessions").update({ cookies }).eq("id", sessionId);
}

export async function recordHealth(proxy: string, ok: boolean) {
  const nowIso = new Date().toISOString();
  const { data: existing } = await db
    .from("proxy_health")
    .select("success_count, fail_count")
    .eq("proxy", proxy)
    .maybeSingle();
  const sc = (existing?.success_count ?? 0) + (ok ? 1 : 0);
  const fc = (existing?.fail_count ?? 0) + (ok ? 0 : 1);
  await db.from("proxy_health").upsert({
    proxy,
    success_count: sc,
    fail_count: fc,
    last_success_at: ok ? nowIso : (existing ? undefined : null),
    last_fail_at: ok ? (existing ? undefined : null) : nowIso,
    updated_at: nowIso,
  });
}
