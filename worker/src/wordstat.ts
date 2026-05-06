// Wordstat scraper: monthly impressions for a keyword in a given Yandex region.
// Strategy: hit https://wordstat.yandex.ru/?region=<id>&words=<kw> via RU proxy,
// solve SmartCaptcha if shown, parse the "shows per month" number from HTML.
import { fetch } from "undici";
import { agentFor, pickSession, banSession, recordHealth } from "./proxy.js";
import { detectCaptcha, solveYandexCaptcha } from "./captcha.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type WordstatResult =
  | { ok: true; frequency: number }
  | { ok: false; error: string };

function parseFrequency(html: string): number | null {
  // Look for the "Показов в месяц" block. Wordstat renders like:
  //  <span ...>1 234</span> ... показов в месяц
  // Try several patterns.
  const patterns = [
    /(?:Показ(?:ов|и|ано)[^<]{0,40}месяц[^<]*<[^>]+>\s*([\d\s\u00a0]+))/i,
    /<b[^>]*class="[^"]*b-word-statistics__number[^"]*"[^>]*>([\d\s\u00a0]+)<\/b>/i,
    /"shows"\s*:\s*"?([\d\s\u00a0]+)"?/i,
    /class="[^"]*wordstat__report-table-cell[^"]*"[^>]*>\s*([\d\s\u00a0]+)\s*</i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/[\s\u00a0]/g, ""), 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return null;
}

async function fetchWordstat(
  keyword: string,
  regionId: number,
  proxy: string,
  cookies: Record<string, string>,
): Promise<{ html: string; status: number }> {
  const url = `https://wordstat.yandex.ru/?region=${regionId}&view=table&words=${encodeURIComponent(keyword)}`;
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const r = await fetch(url, {
    method: "GET",
    dispatcher: agentFor(proxy),
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "ru-RU,ru;q=0.9",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });
  return { html: await r.text(), status: r.status };
}

export async function wordstatLookup(
  keyword: string,
  regionId: number,
): Promise<WordstatResult> {
  const session = await pickSession("search");
  if (!session) return { ok: false, error: "no_proxy" };

  try {
    let { html, status } = await fetchWordstat(keyword, regionId, session.proxy, session.cookies);

    // Captcha?
    const cap = detectCaptcha(html);
    if (cap) {
      const url = `https://wordstat.yandex.ru/?region=${regionId}&words=${encodeURIComponent(keyword)}`;
      const token = await solveYandexCaptcha(cap.sitekey, url);
      if (!token) {
        await banSession(session.id, 30);
        await recordHealth(session.proxy, false);
        return { ok: false, error: "captcha_unsolved" };
      }
      // Re-fetch with token (Yandex accepts via cookie or query). Try query first.
      const url2 = `${url}&smart-token=${encodeURIComponent(token)}`;
      const r2 = await fetch(url2, {
        method: "GET",
        dispatcher: agentFor(session.proxy),
        headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" },
      });
      html = await r2.text();
      status = r2.status;
    }

    if (status >= 400) {
      await recordHealth(session.proxy, false);
      return { ok: false, error: `http_${status}` };
    }

    const freq = parseFrequency(html);
    if (freq == null) {
      await recordHealth(session.proxy, false);
      return { ok: false, error: "parse_failed" };
    }
    await recordHealth(session.proxy, true);
    return { ok: true, frequency: freq };
  } catch (e: any) {
    await recordHealth(session.proxy, false);
    return { ok: false, error: String(e?.message ?? e) };
  }
}
