// Solve Yandex SmartCaptcha via RuCaptcha / 2Captcha / CapMonster
export async function solveYandexCaptcha(sitekey: string, pageUrl: string): Promise<string | null> {
  const provider = (process.env.CAPTCHA_PROVIDER ?? "rucaptcha").toLowerCase();
  const key = process.env.CAPTCHA_API_KEY;
  if (!key) return null;

  if (provider === "capmonster") {
    const create = await fetch("https://api.capmonster.cloud/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: key,
        task: { type: "YandexSmartCaptchaTaskProxyless", websiteURL: pageUrl, websiteKey: sitekey },
      }),
    });
    const created: any = await create.json();
    const taskId = created?.taskId;
    if (!taskId) return null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await fetch("https://api.capmonster.cloud/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: key, taskId }),
      });
      const j: any = await r.json();
      if (j?.status === "ready") return j?.solution?.token ?? null;
      if (j?.errorId && j.errorId !== 0) return null;
    }
    return null;
  }

  const base = provider === "2captcha" ? "https://2captcha.com" : "https://rucaptcha.com";
  const inResp = await fetch(
    `${base}/in.php?key=${key}&method=yandex&sitekey=${encodeURIComponent(sitekey)}&pageurl=${encodeURIComponent(pageUrl)}&json=1`,
  );
  const inJson: any = await inResp.json();
  if (inJson?.status !== 1) return null;
  const id = inJson.request;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${base}/res.php?key=${key}&action=get&id=${id}&json=1`);
    const j: any = await res.json();
    if (j?.status === 1) return j.request as string;
    if (j?.request && j.request !== "CAPCHA_NOT_READY") return null;
  }
  return null;
}

export function detectCaptcha(html: string): { sitekey: string } | null {
  const m = html.match(/data-sitekey="([A-Za-z0-9_-]+)"/);
  if (m) return { sitekey: m[1] };
  if (/showcaptcha|smartcaptcha/i.test(html)) {
    const j = html.match(/"sitekey"\s*:\s*"([A-Za-z0-9_-]+)"/);
    if (j) return { sitekey: j[1] };
  }
  return null;
}
