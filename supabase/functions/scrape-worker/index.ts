// Background worker: picks pending scrape_jobs, scrapes Yandex Maps via proxies, writes checks.
// Triggered by pg_cron every minute. Auth: SCRAPE_WORKER_TOKEN header.

import { makeServiceClient, searchYandexMaps } from "../_shared/yandex-scrape.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-worker-token",
};

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [0.5, 2, 10, 30, 60]; // minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const token = req.headers.get("x-worker-token");
  if (token !== Deno.env.get("SCRAPE_WORKER_TOKEN")) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const svc = makeServiceClient();
  const nowIso = new Date().toISOString();

  // Claim a batch atomically: select then mark running
  const { data: jobs } = await svc
    .from("scrape_jobs")
    .select("id, user_id, org_id, keyword_id, geopoint_id, attempts")
    .eq("status", "pending")
    .lte("next_run_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ids = jobs.map((j) => j.id);
  await svc
    .from("scrape_jobs")
    .update({ status: "running", started_at: nowIso })
    .in("id", ids);

  let success = 0;
  let failed = 0;

  await Promise.all(jobs.map(async (job) => {
    try {
      const [{ data: org }, { data: kw }, { data: gp }] = await Promise.all([
        svc.from("organizations").select("id, yandex_id, user_id").eq("id", job.org_id).maybeSingle(),
        svc.from("keywords").select("id, keyword").eq("id", job.keyword_id).maybeSingle(),
        svc.from("geopoints").select("id, label, lat, lon").eq("id", job.geopoint_id).maybeSingle(),
      ]);
      if (!org || !kw || !gp) {
        await failJob(svc, job.id, "not_found");
        failed++;
        return;
      }

      const res = await searchYandexMaps(svc, "check", kw.keyword, { lat: gp.lat, lon: gp.lon });
      if (!res.ok) {
        await retryOrFail(svc, job, res.error);
        failed++;
        return;
      }

      const idx = res.results.findIndex((r) => r.yandex_id === String(org.yandex_id));
      const position = idx >= 0 ? idx + 1 : null;

      const { data: check, error: insErr } = await svc.from("checks").insert({
        org_id: job.org_id,
        keyword_id: job.keyword_id,
        geopoint_id: job.geopoint_id,
        user_id: job.user_id,
        position,
        total_results: res.results.length,
        raw_response: { results: res.results },
      }).select("id").single();

      if (insErr) {
        await retryOrFail(svc, job, "db_insert: " + insErr.message);
        failed++;
        return;
      }

      await svc.from("scrape_jobs").update({
        status: "done",
        finished_at: new Date().toISOString(),
        result_check_id: check.id,
        error: null,
      }).eq("id", job.id);
      success++;
    } catch (e) {
      await retryOrFail(svc, job, String(e));
      failed++;
    }
  }));

  // Adaptive alert
  if (success === 0 && jobs.length >= 3) {
    await svc.from("system_alerts").insert({
      kind: "worker_zero_success",
      message: `Batch of ${jobs.length} jobs all failed`,
    });
  }

  return new Response(JSON.stringify({ processed: jobs.length, success, failed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function retryOrFail(svc: any, job: any, error: string) {
  const attempts = (job.attempts ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await failJob(svc, job.id, error);
    return;
  }
  const delayMin = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
  await svc.from("scrape_jobs").update({
    status: "pending",
    attempts,
    error,
    next_run_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
    started_at: null,
  }).eq("id", job.id);
}

async function failJob(svc: any, id: string, error: string) {
  await svc.from("scrape_jobs").update({
    status: "failed",
    error,
    finished_at: new Date().toISOString(),
  }).eq("id", id);
}
