// Search Yandex organizations via the official Geosearch API (no proxy/captcha needed).
// Two modes:
// - URL: extract Yandex org ID directly from a maps URL, then enrich via Geosearch by id text.
// - text: search via Geosearch API.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { regionIdFromCoords } from "../_shared/region.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GEOSEARCH_URL = "https://search-maps.yandex.ru/v1/";

function extractYandexId(url: string): string | null {
  const m = url.match(/\/org\/(?:[^/]+\/)?(\d{6,})/);
  if (m) return m[1];
  const oid = url.match(/[?&]oid=(\d{6,})/);
  if (oid) return oid[1];
  return null;
}

type GeoResult = {
  name: string;
  address: string;
  yandex_id: string;
  lat: number | null;
  lon: number | null;
};

async function geosearch(text: string, opts?: { ll?: string; spn?: string; results?: number }): Promise<GeoResult[]> {
  const apiKey = Deno.env.get("YANDEX_GEOSEARCH_API_KEY");
  if (!apiKey) throw new Error("YANDEX_GEOSEARCH_API_KEY is not configured");
  const params = new URLSearchParams({
    apikey: apiKey,
    text,
    type: "biz",
    lang: "ru_RU",
    results: String(opts?.results ?? 20),
  });
  if (opts?.ll) params.set("ll", opts.ll);
  if (opts?.spn) params.set("spn", opts.spn);
  const r = await fetch(`${GEOSEARCH_URL}?${params.toString()}`);
  if (!r.ok) throw new Error(`Geosearch HTTP ${r.status}`);
  const j: any = await r.json();
  const features: any[] = j?.features ?? [];
  return features.map((f) => {
    const props = f?.properties ?? {};
    const meta = props?.CompanyMetaData ?? {};
    const coords: number[] | undefined = f?.geometry?.coordinates;
    return {
      name: meta.name ?? props.name ?? "",
      address: meta.address ?? props.description ?? "",
      yandex_id: String(meta.id ?? ""),
      lon: Array.isArray(coords) ? Number(coords[0]) : null,
      lat: Array.isArray(coords) ? Number(coords[1]) : null,
    } as GeoResult;
  }).filter((r) => r.yandex_id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u, error: authErr } = await userClient.auth.getUser();
    if (authErr || !u?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const query: string = (body.query ?? "").toString().trim();
    const city: string = (body.city ?? "").toString().trim();
    const url: string = (body.url ?? "").toString().trim();

    // URL mode
    if (url) {
      const yid = extractYandexId(url);
      if (!yid) {
        return new Response(JSON.stringify({ error: "Не удалось распознать ID в ссылке. Используйте ссылку вида yandex.ru/maps/org/.../1234567890/" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const list = await geosearch(yid);
        const found = list.find((r) => r.yandex_id === yid) ?? list[0];
        if (found) {
          const region_id = regionIdFromCoords(found.lat, found.lon);
          return new Response(JSON.stringify({ results: [{ ...found, region_id }] }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (_) { /* fall through */ }
      return new Response(JSON.stringify({
        results: [{ name: `Организация #${yid}`, address: "", yandex_id: yid, lat: null, lon: null, region_id: 213 }],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!query) {
      return new Response(JSON.stringify({ error: "Введите название или ссылку" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = city ? `${query}, ${city}` : query;
    const list = await geosearch(text, { results: 10 });
    const enriched = list.map((r) => ({ ...r, region_id: regionIdFromCoords(r.lat, r.lon) }));
    return new Response(JSON.stringify({ results: enriched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
