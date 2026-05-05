// Enqueues a position check job for the user. Replaces the old synchronous check-position.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_LIMIT = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
    if (authErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const { org_id, keyword_id, geopoint_id } = body ?? {};
    if (!org_id || !keyword_id || !geopoint_id) {
      return new Response(JSON.stringify({ error: "org_id, keyword_id, geopoint_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Daily limit
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await supabase
      .from("scrape_jobs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if ((count ?? 0) >= DAILY_LIMIT) {
      return new Response(JSON.stringify({ error: "daily_limit_reached", limit: DAILY_LIMIT }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // De-dup: existing pending/running for same triple
    const { data: existing } = await supabase
      .from("scrape_jobs")
      .select("id, status")
      .eq("org_id", org_id)
      .eq("keyword_id", keyword_id)
      .eq("geopoint_id", geopoint_id)
      .in("status", ["pending", "running"])
      .limit(1);
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ job_id: existing[0].id, deduplicated: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: ins, error: insErr } = await supabase
      .from("scrape_jobs")
      .insert({ user_id: userId, org_id, keyword_id, geopoint_id })
      .select("id")
      .single();
    if (insErr) {
      return new Response(JSON.stringify({ error: "db_insert_failed", details: insErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ job_id: ins.id, queued: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
