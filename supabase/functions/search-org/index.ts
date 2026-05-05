// Search Yandex Maps for an organization. Two modes:
// - URL: extract Yandex org ID directly from a maps URL
// - text: search via the scraping pipeline (proxies + captcha)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { makeServiceClient, searchYandexMaps } from "../_shared/yandex-scrape.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractYandexId(url: string): string | null {
  const m = url.match(/\/org\/(?:[^/]+\/)?(\d{6,})/);
  if (m) return m[1];
  const oid = url.match(/[?&]oid=(\d{6,})/);
  if (oid) return oid[1];
  return null;
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

    // URL mode — try to enrich via search; if fails, return ID-only stub.
    if (url) {
      const yid = extractYandexId(url);
      if (!yid) {
        return new Response(JSON.stringify({ error: "Не удалось распознать ID в ссылке. Используйте ссылку вида yandex.ru/maps/org/.../1234567890/" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const svc = makeServiceClient();
      const res = await searchYandexMaps(svc, "search", yid);
      if (res.ok) {
        const found = res.results.find((r) => r.yandex_id === yid) ?? res.results[0];
        if (found) {
          return new Response(JSON.stringify({ results: [found] }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      return new Response(JSON.stringify({
        results: [{ name: `Организация #${yid}`, address: "", yandex_id: yid, lat: null, lon: null }],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!query) {
      return new Response(JSON.stringify({ error: "Введите название или ссылку" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = makeServiceClient();
    const text = city ? `${query}, ${city}` : query;
    const res = await searchYandexMaps(svc, "search", text);
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Поиск не удался: ${res.error}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ results: res.results.slice(0, 10) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
