import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const body = await req.json().catch(() => ({}));
    const query: string = (body.query ?? "").toString().trim();
    const city: string = (body.city ?? "").toString().trim();
    if (!query) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400,
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

    const text = city ? `${query}, ${city}` : query;
    const url = `https://search-maps.yandex.ru/v1/?text=${encodeURIComponent(text)}&type=biz&results=10&lang=ru_RU&apikey=${apikey}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: `Yandex error ${resp.status}`, details: t }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const results = (data.features ?? []).map((f: any) => {
      const meta = f.properties?.CompanyMetaData ?? {};
      const [lon, lat] = f.geometry?.coordinates ?? [null, null];
      return {
        name: meta.name ?? f.properties?.name ?? "",
        address: meta.address ?? "",
        yandex_id: String(meta.id ?? ""),
        lat,
        lon,
      };
    }).filter((r: any) => r.yandex_id);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
