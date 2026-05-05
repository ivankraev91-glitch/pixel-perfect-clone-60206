import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_MS = 5 * 60 * 1000;
const MAX_HISTORY = 100;

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 429 && i < attempts - 1) {
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
      return r;
    } catch (e) {
      clearTimeout(t);
      if (i === attempts - 1) throw e;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  throw new Error("unreachable");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const { org_id, keyword_id, geopoint_id } = body ?? {};
    if (!org_id || !keyword_id || !geopoint_id) {
      return new Response(JSON.stringify({ error: "org_id, keyword_id, geopoint_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 1 / 5 min per user
    const since = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { data: recent } = await supabase
      .from("checks")
      .select("id, checked_at")
      .gte("checked_at", since)
      .order("checked_at", { ascending: false })
      .limit(1);
    if (recent && recent.length > 0) {
      const waitSec = Math.ceil(
        (RATE_LIMIT_MS - (Date.now() - new Date(recent[0].checked_at).getTime())) / 1000,
      );
      return new Response(
        JSON.stringify({ error: "rate_limited", retry_after_seconds: waitSec }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load org / keyword / geopoint (RLS scopes to user)
    const [{ data: org }, { data: kw }, { data: gp }] = await Promise.all([
      supabase.from("organizations").select("id, yandex_id").eq("id", org_id).maybeSingle(),
      supabase.from("keywords").select("id, keyword").eq("id", keyword_id).maybeSingle(),
      supabase.from("geopoints").select("id, label, lat, lon").eq("id", geopoint_id).maybeSingle(),
    ]);
    if (!org || !kw || !gp) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apikey = Deno.env.get("YANDEX_GEOSEARCH_API_KEY");
    if (!apikey) {
      return new Response(JSON.stringify({ error: "Missing YANDEX_GEOSEARCH_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://search-maps.yandex.ru/v1/?text=${encodeURIComponent(kw.keyword)}&ll=${gp.lon},${gp.lat}&spn=0.02,0.02&type=biz&results=40&lang=ru_RU&apikey=${apikey}`;

    let resp: Response;
    try {
      resp = await fetchWithRetry(url, 3);
    } catch (e) {
      return new Response(JSON.stringify({ error: "timeout", details: String(e) }), {
        status: 504,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: `yandex_error_${resp.status}`, details: t }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const features: any[] = data.features ?? [];
    const idx = features.findIndex(
      (f) => String(f.properties?.CompanyMetaData?.id ?? "") === String(org.yandex_id),
    );
    const position = idx >= 0 ? idx + 1 : null;
    const total_results = features.length;

    const { data: insertedRow, error: insErr } = await supabase
      .from("checks")
      .insert({
        org_id,
        keyword_id,
        geopoint_id,
        user_id: userId,
        position,
        total_results,
        raw_response: data,
      })
      .select("id, checked_at, position, total_results")
      .single();

    if (insErr) {
      return new Response(JSON.stringify({ error: "db_insert_failed", details: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Trim history beyond MAX_HISTORY
    const { data: ids } = await supabase
      .from("checks")
      .select("id")
      .order("checked_at", { ascending: false })
      .range(MAX_HISTORY, MAX_HISTORY + 200);
    if (ids && ids.length > 0) {
      await supabase.from("checks").delete().in("id", ids.map((r) => r.id));
    }

    return new Response(
      JSON.stringify({
        position,
        total_results,
        checked_at: insertedRow.checked_at,
        keyword: kw.keyword,
        geopoint_label: gp.label,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
