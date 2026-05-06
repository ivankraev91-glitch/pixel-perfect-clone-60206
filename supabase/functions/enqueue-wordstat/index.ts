// Enqueues Wordstat frequency-recalculation jobs.
// Modes:
//  - { keyword_ids: string[] } — for current user (auth required)
//  - { all: true }             — for all stale keywords (service_role / cron)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- mode: all (cron / service) ----
    if (body?.all === true) {
      const cutoff = new Date(Date.now() - 25 * 24 * 3600_000).toISOString();
      const { data: kws, error } = await admin
        .from("keywords")
        .select("id, user_id, org_id, frequency_at")
        .or(`frequency_at.is.null,frequency_at.lt.${cutoff}`);
      if (error) return json({ error: error.message }, 500);
      const queued = await enqueueMany(admin, kws ?? []);
      return json({ queued });
    }

    // ---- mode: by keyword_ids (user auth) ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: authErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const ids: string[] = Array.isArray(body?.keyword_ids) ? body.keyword_ids : [];
    if (ids.length === 0) return json({ error: "keyword_ids required" }, 400);

    const { data: kws, error: kErr } = await admin
      .from("keywords")
      .select("id, user_id, org_id")
      .in("id", ids)
      .eq("user_id", userId);
    if (kErr) return json({ error: kErr.message }, 500);

    const queued = await enqueueMany(admin, kws ?? []);
    return json({ queued });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function enqueueMany(
  admin: ReturnType<typeof createClient>,
  kws: Array<{ id: string; user_id: string; org_id: string }>,
) {
  if (kws.length === 0) return 0;
  // load region per org once
  const orgIds = [...new Set(kws.map((k) => k.org_id))];
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, yandex_region_id")
    .in("id", orgIds);
  const regionByOrg = new Map<string, number>();
  (orgs ?? []).forEach((o: any) => regionByOrg.set(o.id, o.yandex_region_id ?? 213));

  // de-dup: skip keywords with active jobs
  const { data: active } = await admin
    .from("wordstat_jobs")
    .select("keyword_id")
    .in("keyword_id", kws.map((k) => k.id))
    .in("status", ["pending", "running"]);
  const skip = new Set((active ?? []).map((a: any) => a.keyword_id));

  const rows = kws
    .filter((k) => !skip.has(k.id))
    .map((k) => ({
      user_id: k.user_id,
      keyword_id: k.id,
      region_id: regionByOrg.get(k.org_id) ?? 213,
    }));
  if (rows.length === 0) return 0;

  // mark keywords as pending
  await admin
    .from("keywords")
    .update({ frequency_status: "pending" })
    .in("id", rows.map((r) => r.keyword_id));

  const { error: insErr } = await admin.from("wordstat_jobs").insert(rows);
  if (insErr) throw new Error(insErr.message);
  return rows.length;
}
