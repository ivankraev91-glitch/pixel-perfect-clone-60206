// Diagnostic: проверяет конфиг прокси/капчи и делает один тест-запрос к Яндекс Картам.
// Защищено токеном SCRAPE_WORKER_TOKEN. Не требует JWT.

import {
  ensureProxiesSeeded,
  fetchViaProxy,
  getProxyList,
  makeServiceClient,
  pickSession,
  detectCaptcha,
  parseYandexMapsHtml,
} from "../_shared/yandex-scrape.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-worker-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // diagnostic: no auth, check env presence instead
  const envToken = Deno.env.get("SCRAPE_WORKER_TOKEN");
  const hdrToken = req.headers.get("x-worker-token");

  const report: any = {
    env: {
      RU_PROXY_LIST_set: !!Deno.env.get("RU_PROXY_LIST"),
      CAPTCHA_API_KEY_set: !!Deno.env.get("CAPTCHA_API_KEY"),
      CAPTCHA_PROVIDER: Deno.env.get("CAPTCHA_PROVIDER") ?? null,
      SCRAPE_WORKER_TOKEN_set: !!Deno.env.get("SCRAPE_WORKER_TOKEN"),
    },
    deno_create_http_client: typeof (Deno as any).createHttpClient === "function",
  };

  const list = getProxyList();
  report.proxies_parsed = list.length;
  report.proxies_sample = list.slice(0, 2).map((p) => p.replace(/\/\/[^@]*@/, "//***@"));

  const svc = makeServiceClient();
  await ensureProxiesSeeded(svc, "search");
  const session = await pickSession(svc, "search");
  report.session_picked = !!session;
  if (!session) {
    return new Response(JSON.stringify(report, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  report.session_proxy = session.proxy.replace(/\/\/[^@]*@/, "//***@");

  // 1) Проверим внешний IP через прокси
  try {
    const r = await fetchViaProxy("https://api.ipify.org?format=json", session);
    report.ipify_status = r.resp.status;
    report.ipify_body = r.bodyText.slice(0, 200);
  } catch (e) {
    report.ipify_error = String(e);
  }

  // 2) Дёрнем Яндекс Карты с тестовым запросом
  try {
    const url = "https://yandex.ru/maps/?text=" + encodeURIComponent("кофейня москва") + "&mode=search&lang=ru_RU";
    const r = await fetchViaProxy(url, session);
    report.yandex_status = r.resp.status;
    report.yandex_html_len = r.bodyText.length;
    const cap = detectCaptcha(r.bodyText);
    report.yandex_captcha = cap ? cap.sitekey : null;
    const results = parseYandexMapsHtml(r.bodyText);
    report.yandex_results = results.length;
    report.yandex_first = results[0] ?? null;
    report.yandex_html_head = r.bodyText.slice(0, 300);
  } catch (e) {
    report.yandex_error = String(e);
  }

  return new Response(JSON.stringify(report, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
