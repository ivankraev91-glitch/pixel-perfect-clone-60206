import { supabase } from "@/integrations/supabase/client";

let loadPromise: Promise<any> | null = null;

declare global {
  interface Window {
    ymaps?: any;
  }
}

export async function loadYandexMaps(): Promise<any> {
  if (window.ymaps) return window.ymaps;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { data, error } = await supabase.functions.invoke("yandex-config");
    if (error || !data?.jsApiKey) {
      throw new Error("Failed to load Yandex Maps API key");
    }
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://api-maps.yandex.ru/2.1/?apikey=${data.jsApiKey}&lang=ru_RU`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Yandex Maps script"));
      document.head.appendChild(s);
    });
    await new Promise<void>((resolve) => window.ymaps.ready(resolve));
    return window.ymaps;
  })();

  return loadPromise;
}
