// Headless-browser fallback for Yandex Maps SERP scraping.
// Used ONLY when the cheap fetch+regex path (`mapsScrapePosition`) returns 0
// org cards — Yandex Maps is a SPA and SSR-HTML occasionally arrives empty.
// Playwright lets the SPA hydrate, so we read the final DOM.
//
// Stays inside our existing infra:
//   - reuses the same RU proxy pool (`pickSession("check")`)
//   - reuses the same cookie jar in `scrape_sessions`
//   - reuses RuCaptcha via `solveYandexCaptcha` if SmartCaptcha pops up
//   - matches our org by `yandex_id` (not by name)
import type { Browser, BrowserContext } from "playwright";
import { agentFor as _unused } from "./proxy.js"; // keep import graph stable
import { banSession, pickSession, recordHealth, saveCookies } from "./proxy.js";
import { solveYandexCaptcha } from "./captcha.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type MapsBrowserResult =
  | { ok: true; indexed: boolean; position: number | null; total: number; via: "browser" }
  | { ok: false; error: string };

let _browser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  // Lazy-import so the worker still boots if playwright isn't installed yet.
  const { chromium } = await import("playwright");
  _browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
  });
  return _browser;
}

/** Convert our internal proxy URL (`http://user:pass@ip:port`) into Playwright's proxy config. */
function proxyToPlaywright(proxyUrl: string): { server: string; username?: string; password?: string } {
  try {
    const u = new URL(proxyUrl);
    return {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return { server: proxyUrl };
  }
}

function jarToCookies(jar: Record<string, string>) {
  return Object.entries(jar).map(([name, value]) => ({
    name,
    value,
    domain: ".yandex.ru",
    path: "/",
  }));
}

async function dumpCookies(ctx: BrowserContext): Promise<Record<string, string>> {
  const cookies = await ctx.cookies();
  const out: Record<string, string> = {};
  for (const c of cookies) if (c.domain.includes("yandex")) out[c.name] = c.value;
  return out;
}

export async function mapsBrowserPosition(
  keyword: string,
  ll: { lat: number; lon: number },
  ourOrgId: string,
  maxAttempts = 2,
): Promise<MapsBrowserResult> {
  const url =
    `https://yandex.ru/maps/?mode=search&text=${encodeURIComponent(keyword)}` +
    `&ll=${ll.lon}%2C${ll.lat}&z=14`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const session = await pickSession("check");
    if (!session) return { ok: false, error: "no_proxies_available" };

    let context: BrowserContext | null = null;
    try {
      const browser = await getBrowser();
      context = await browser.newContext({
        userAgent: UA,
        locale: "ru-RU",
        timezoneId: "Europe/Moscow",
        viewport: { width: 1366, height: 900 },
        proxy: proxyToPlaywright(session.proxy),
      });
      // Block heavy assets to cut RAM/time (we only need DOM links).
      await context.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (t === "image" || t === "font" || t === "media") return route.abort();
        return route.continue();
      });
      if (Object.keys(session.cookies).length) {
        await context.addCookies(jarToCookies(session.cookies));
      }
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });

      // SmartCaptcha?
      const captchaFrame = await page.$('iframe[src*="captcha"], div[class*="SmartCaptcha"]');
      if (captchaFrame) {
        const sitekey = await page.evaluate(() => {
          const el = document.querySelector("[data-sitekey]");
          return el?.getAttribute("data-sitekey") ?? null;
        });
        if (!sitekey) {
          await recordHealth(session.proxy, false);
          await banSession(session.id, 30);
          continue;
        }
        const token = await solveYandexCaptcha(sitekey, url);
        if (!token) {
          await recordHealth(session.proxy, false);
          await banSession(session.id, 30);
          continue;
        }
        await page.evaluate((tok) => {
          (window as any).smartCaptcha?.execute?.();
          const inp = document.querySelector('input[name="smart-token"]') as HTMLInputElement | null;
          if (inp) inp.value = tok;
        }, token);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      }

      // Wait for either org cards or "nothing found" message.
      try {
        await page.waitForSelector('a[href*="/maps/org/"], .search-snippet-view, .nothing-found-view', { timeout: 12000 });
      } catch { /* fall through and read whatever rendered */ }

      const ids = await page.evaluate(() => {
        const out: string[] = [];
        const seen = new Set<string>();
        document.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/org/"]').forEach((a) => {
          const m = a.getAttribute("href")?.match(/\/maps\/org\/(?:[^/]+\/)?(\d{6,})/);
          if (m && !seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
        });
        return out;
      });

      const newJar = await dumpCookies(context);
      if (Object.keys(newJar).length) {
        await saveCookies(session.id, newJar);
      }
      await recordHealth(session.proxy, true);

      if (ids.length === 0) {
        return { ok: true, indexed: false, position: null, total: 0, via: "browser" };
      }
      const idx = ids.indexOf(String(ourOrgId));
      return {
        ok: true,
        indexed: idx >= 0,
        position: idx >= 0 ? idx + 1 : null,
        total: ids.length,
        via: "browser",
      };
    } catch (e: any) {
      await recordHealth(session.proxy, false);
      await banSession(session.id, 5);
      if (attempt === maxAttempts - 1) {
        return { ok: false, error: "browser_" + String(e?.message ?? e).slice(0, 80) };
      }
    } finally {
      if (context) { try { await context.close(); } catch { /* noop */ } }
    }
  }
  return { ok: false, error: "browser_all_attempts_failed" };
}

export async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch { /* noop */ } _browser = null; }
}
