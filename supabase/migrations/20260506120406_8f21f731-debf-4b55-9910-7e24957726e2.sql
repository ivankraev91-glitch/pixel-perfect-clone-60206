ALTER TABLE public.keywords
  ADD COLUMN IF NOT EXISTS frequency        integer,
  ADD COLUMN IF NOT EXISTS frequency_region integer,
  ADD COLUMN IF NOT EXISTS frequency_at     timestamptz,
  ADD COLUMN IF NOT EXISTS frequency_status text DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS public.wordstat_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  keyword_id uuid NOT NULL,
  region_id integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  error text,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE public.wordstat_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wj_select_own" ON public.wordstat_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "wj_insert_own" ON public.wordstat_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wj_service_select" ON public.wordstat_jobs
  FOR SELECT TO service_role USING (true);

CREATE POLICY "wj_service_update" ON public.wordstat_jobs
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "wj_service_insert" ON public.wordstat_jobs
  FOR INSERT TO service_role WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_wordstat_jobs_pending
  ON public.wordstat_jobs(status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_wordstat_jobs_keyword
  ON public.wordstat_jobs(keyword_id);