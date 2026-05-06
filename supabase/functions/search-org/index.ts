// Resolve a Yandex organization from a Maps URL.
// No external Yandex API is used: we extract the org ID and a human-readable
// slug from the URL itself. Coordinates/address are filled in later by the user
// on the map (MapPicker) during onboarding.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { regionIdFromCoords } from "../_shared/region.ts";

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

function extractSlugName(url: string): string | null {
  const m = url.match(/\/org\/([^/]+)\/\d{6,}/);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).replace(/[-_]+/g, " ").trim();
  if (!slug) return null;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function extractLL(url: string): { lat: number; lon: number } | null {
  const ll = url.match(/[?&]ll=([\-0-9.]+)%2C([\-0-9.]+)/) || url.match(/[?&]ll=([\-0-9.]+),([\-0-9.]+)/);
  if (ll) return { lon: Number(ll[1]), lat: Number(ll[2]) };
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
    const url: string = (body.url ?? "").toString().trim();

    if (!url) {
      return new Response(JSON.stringify({ error: "Вставьте ссылку на карточку Яндекс Карт" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const yid = extractYandexId(url);
    if (!yid) {
      return new Response(JSON.stringify({
        error: "Не удалось распознать ID в ссылке. Используйте ссылку вида yandex.ru/maps/org/.../1234567890/",
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ll = extractLL(url);
    const name = extractSlugName(url) ?? `Организация #${yid}`;
    const region_id = regionIdFromCoords(ll?.lat ?? null, ll?.lon ?? null);

    return new Response(JSON.stringify({
      results: [{
        name,
        address: "",
        yandex_id: yid,
        lat: ll?.lat ?? null,
        lon: ll?.lon ?? null,
        region_id,
      }],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
