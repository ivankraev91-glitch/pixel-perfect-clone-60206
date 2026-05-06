ALTER TABLE public.checks
  ADD COLUMN IF NOT EXISTS maps_indexed boolean,
  ADD COLUMN IF NOT EXISTS maps_position integer,
  ADD COLUMN IF NOT EXISTS wizard_exists boolean,
  ADD COLUMN IF NOT EXISTS wizard_position integer,
  ADD COLUMN IF NOT EXISTS wizard_total integer,
  ADD COLUMN IF NOT EXISTS check_type text DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS error_type text;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS yandex_region_id integer;