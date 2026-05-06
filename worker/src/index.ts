import "dotenv/config";
import { db } from "./db.js";
import { geosearchPosition } from "./geosearch.js";
import { wizardCheck } from "./wizard.js";

const POLL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE ?? 5);
const MAX_ATTEMPTS = Number(process.env.WORKER_MAX_ATTEMPTS ?? 5);
const BACKOFF_MIN = [0.5, 2, 10, 30, 60];

let running = true;
process.on("SIGINT", () => { console.log("[worker] SIGINT"); running = false; });
process.on("SIGTERM", () => { console.log("[worker] SIGTERM"); running = false; });

function log(...a: any[]) { console.log(new Date().toISOString(), ...a); }

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function tick(): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: jobs, error } = await db
    .from("scrape_jobs")
    .select("id, user_id, org_id, keyword_id, geopoint_id, attempts")
    .eq("status", "pending")
    .lte("next_run_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) { log("[poll] error", error.message); return 0; }
  if (!jobs || jobs.length === 0) return 0;

  const ids = jobs.map((j) => j.id);
  await db.from("scrape_jobs").update({ status: "running", started_at: nowIso }).in("id", ids);
  log(`[poll] picked ${jobs.length} job(s)`);

  let success = 0, failed = 0;
  await Promise.all(jobs.map(async (job) => {
    try {
      const [{ data: org }, { data: kw }, { data: gp }] = await Promise.all([
        db.from("organizations").select("id, yandex_id, name, yandex_region_id").eq("id", job.org_id).maybeSingle(),
        db.from("keywords").select("id, keyword").eq("id", job.keyword_id).maybeSingle(),
        db.from("geopoints").select("id, label, lat, lon").eq("id", job.geopoint_id).maybeSingle(),
      ]);
      if (!org || !kw || !gp) { await failJob(job.id, "not_found"); failed++; return; }

      const orgYid = String(org.yandex_id);
      const regionId = Number(org.yandex_region_id ?? 213);

      // Run both checks in parallel
      const [mapsRes, wizRes] = await Promise.allSettled([
        withTimeout(geosearchPosition(kw.keyword, { lat: gp.lat, lon: gp.lon }, orgYid), 15000, "geosearch"),
        withTimeout(wizardCheck(kw.keyword, regionId, orgYid, org.name ?? ""), 25000, "wizard"),
      ]);

      let maps_indexed: boolean | null = null;
      let maps_position: number | null = null;
      let maps_total: number | null = null;
      let error_type: string | null = null;
      if (mapsRes.status === "fulfilled" && mapsRes.value.ok) {
        maps_indexed = mapsRes.value.indexed;
        maps_position = mapsRes.value.position;
        maps_total = mapsRes.value.total;
      } else {
        error_type = "maps_" + (mapsRes.status === "rejected" ? String(mapsRes.reason?.message ?? mapsRes.reason) : (mapsRes as any).value?.error);
      }

      let wizard_exists: boolean | null = null;
      let wizard_position: number | null = null;
      let wizard_total: number | null = null;
      if (wizRes.status === "fulfilled" && wizRes.value.ok) {
        wizard_exists = wizRes.value.exists;
        wizard_position = wizRes.value.position;
        wizard_total = wizRes.value.total;
      } else {
        // wizard failure does not invalidate the entire check; just record null + error_type if maps OK
        const w_err = wizRes.status === "rejected" ? String(wizRes.reason?.message ?? wizRes.reason) : (wizRes as any).value?.error;
        error_type = (error_type ? error_type + ";" : "") + "wizard_" + w_err;
      }

      // Treat job as failed only when both branches errored AND we have nothing to insert
      if (maps_indexed === null && wizard_exists === null) {
        await retryOrFail(job, error_type ?? "unknown");
        failed++;
        return;
      }

      const { data: check, error: insErr } = await db.from("checks").insert({
        org_id: job.org_id,
        keyword_id: job.keyword_id,
        geopoint_id: job.geopoint_id,
        user_id: job.user_id,
        position: maps_position,           // legacy mirror
        total_results: maps_total,         // legacy mirror
        maps_indexed,
        maps_position,
        wizard_exists,
        wizard_position,
        wizard_total,
        check_type: "full",
        error_type,
        raw_response: null,
      }).select("id").single();

      if (insErr) { await retryOrFail(job, "db_insert: " + insErr.message); failed++; return; }

      await db.from("scrape_jobs").update({
        status: "done",
        finished_at: new Date().toISOString(),
        result_check_id: check.id,
        error: null,
      }).eq("id", job.id);
      success++;
    } catch (e: any) {
      await retryOrFail(job, String(e?.message ?? e));
      failed++;
    }
  }));

  log(`[poll] done: success=${success} failed=${failed}`);
  if (success === 0 && jobs.length >= 3) {
    await db.from("system_alerts").insert({
      kind: "worker_zero_success",
      message: `Batch of ${jobs.length} jobs all failed`,
    });
  }
  return jobs.length;
}

async function retryOrFail(job: any, error: string) {
  const attempts = (job.attempts ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) { await failJob(job.id, error); return; }
  const delayMin = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
  await db.from("scrape_jobs").update({
    status: "pending",
    attempts,
    error,
    next_run_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
    started_at: null,
  }).eq("id", job.id);
}

async function failJob(id: string, error: string) {
  await db.from("scrape_jobs").update({
    status: "failed",
    error,
    finished_at: new Date().toISOString(),
  }).eq("id", id);
}

async function main() {
  log("[worker] started, poll interval", POLL_MS, "ms, batch", BATCH_SIZE);
  while (running) {
    try { await tick(); } catch (e: any) { log("[tick] crash", e?.message ?? e); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  log("[worker] stopped");
}

main();
