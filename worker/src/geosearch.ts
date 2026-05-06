// Yandex Geosearch API client. No proxy / captcha needed.
// Returns position of our org in search results (1..80) or null if not found.
import { fetch as undiciFetch } from "undici";

const URL_BASE = "https://search-maps.yandex.ru/v1/";

export type GeosearchResult = {
  ok: true;
  indexed: boolean;
  position: number | null;
  total: number;
} | { ok: false; error: string };

async function pageRequest(text: string, ll: { lat: number; lon: number }, results: number, skip: number) {
  const apiKey = process.env.YANDEX_GEOSEARCH_API_KEY;
  if (!apiKey) throw new Error("YANDEX_GEOSEARCH_API_KEY missing");
  const params = new URLSearchParams({
    apikey: apiKey,
    text,
    type: "biz",
    lang: "ru_RU",
    ll: `${ll.lon},${ll.lat}`,
    spn: "0.05,0.05",
    results: String(results),
    skip: String(skip),
  });
  const r = await undiciFetch(`${URL_BASE}?${params.toString()}`, { headersTimeout: 15000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j: any = await r.json();
  const features: any[] = j?.features ?? [];
  return features.map((f) => String(f?.properties?.CompanyMetaData?.id ?? ""));
}

export async function geosearchPosition(
  text: string,
  ll: { lat: number; lon: number },
  yandexOrgId: string,
): Promise<GeosearchResult> {
  try {
    const page1 = await pageRequest(text, ll, 40, 0);
    let idx = page1.indexOf(yandexOrgId);
    if (idx >= 0) return { ok: true, indexed: true, position: idx + 1, total: page1.length };
    const page2 = await pageRequest(text, ll, 40, 40);
    idx = page2.indexOf(yandexOrgId);
    if (idx >= 0) return { ok: true, indexed: true, position: 40 + idx + 1, total: page1.length + page2.length };
    return { ok: true, indexed: false, position: null, total: page1.length + page2.length };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
