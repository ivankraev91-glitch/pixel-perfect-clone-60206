import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractYandexId(url: string): string | null {
  try {
    // Match patterns like /org/<slug>/<digits>/ or /org/<digits>
    const m = url.match(/\/org\/(?:[^/]+\/)?(\d{6,})/);
    if (m) return m[1];
    // Match ?oid=12345
    const oid = url.match(/[?&]oid=(\d{6,})/);
    if (oid) return oid[1];
    return null;
  } catch {
    return null;
  }
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
    const { data: userData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !userData?.user) {
      console.log("auth failed", authErr);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const query: string = (body.query ?? "").toString().trim();
    const city: string = (body.city ?? "").toString().trim();
    const url: string = (body.url ?? "").toString().trim();

    const apikey = Deno.env.get("YANDEX_GEOSEARCH_API_KEY");
    if (!apikey) {
      return new Response(JSON.stringify({ error: "Не настроен YANDEX_GEOSEARCH_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Mode: direct URL -> lookup by yandex id ---
    if (url) {
      const yid = extractYandexId(url);
      if (!yid) {
        return new Response(JSON.stringify({ error: "Не удалось распознать ID в ссылке. Используйте ссылку вида yandex.ru/maps/org/.../1234567890/" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Try lookup by id using geosearch
      const lookup = `https://search-maps.yandex.ru/v1/?text=${yid}&type=biz&results=1&lang=ru_RU&apikey=${apikey}`;
      const r = await fetch(lookup);
      if (r.ok) {
        const d = await r.json();
        const f = (d.features ?? [])[0];
        if (f) {
          const meta = f.properties?.CompanyMetaData ?? {};
          const [lon, lat] = f.geometry?.coordinates ?? [null, null];
          if (String(meta.id) === yid) {
            return new Response(JSON.stringify({
              results: [{
                name: meta.name ?? "",
                address: meta.address ?? "",
                yandex_id: yid,
                lat, lon,
              }],
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
      }
      // Fallback: return id only, user fills name later
      return new Response(JSON.stringify({
        results: [{ name: `Организация #${yid}`, address: "", yandex_id: yid, lat: null, lon: null }],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Mode: text search ---
    if (!query) {
      return new Response(JSON.stringify({ error: "Введите название или ссылку" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = city ? `${query}, ${city}` : query;
    const yurl = `https://search-maps.yandex.ru/v1/?text=${encodeURIComponent(text)}&type=biz&results=10&lang=ru_RU&apikey=${apikey}`;

    const resp = await fetch(yurl);
    if (!resp.ok) {
      const t = await resp.text();
      console.log("Yandex error", resp.status, t);
      return new Response(JSON.stringify({ error: `Яндекс вернул ${resp.status}`, details: t }), {
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
    console.log("search-org exception", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
