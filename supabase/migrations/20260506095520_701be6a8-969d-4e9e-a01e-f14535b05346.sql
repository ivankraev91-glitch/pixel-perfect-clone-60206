
-- Allow service role to update scrape_jobs (worker on VPS uses service role key)
DO $$ BEGIN
  CREATE POLICY "sj_service_update" ON public.scrape_jobs
    FOR UPDATE TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "sj_service_select" ON public.scrape_jobs
    FOR SELECT TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index for queue picking
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_pending
  ON public.scrape_jobs (status, next_run_at)
  WHERE status = 'pending';

-- Remove old cron job if exists
DO $$ BEGIN
  PERFORM cron.unschedule('scrape-worker-tick');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
