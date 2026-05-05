import { useEffect, useRef, useState } from "react";
import { loadYandexMaps } from "@/lib/yandexMaps";

interface Props {
  lat: number;
  lon: number;
  zoom?: number;
  draggable?: boolean;
  onChange?: (lat: number, lon: number) => void;
  className?: string;
}

export default function MapPicker({
  lat,
  lon,
  zoom = 14,
  draggable = false,
  onChange,
  className,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const placemarkRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadYandexMaps()
      .then((ymaps) => {
        if (cancelled || !ref.current) return;
        const map = new ymaps.Map(ref.current, {
          center: [lat, lon],
          zoom,
          controls: ["zoomControl"],
        });
        const placemark = new ymaps.Placemark(
          [lat, lon],
          {},
          { draggable, preset: "islands#blueDotIcon" },
        );
        if (draggable && onChange) {
          placemark.events.add("dragend", () => {
            const c = placemark.geometry.getCoordinates();
            onChange(c[0], c[1]);
          });
          map.events.add("click", (e: any) => {
            const c = e.get("coords");
            placemark.geometry.setCoordinates(c);
            onChange(c[0], c[1]);
          });
        }
        map.geoObjects.add(placemark);
        mapRef.current = map;
        placemarkRef.current = placemark;
      })
      .catch((e) => setError(e.message));

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mapRef.current && placemarkRef.current) {
      mapRef.current.setCenter([lat, lon]);
      placemarkRef.current.geometry.setCoordinates([lat, lon]);
    }
  }, [lat, lon]);

  if (error) {
    return <div className={`grid place-items-center bg-muted rounded-lg text-sm text-muted-foreground ${className}`}>Карта: {error}</div>;
  }
  return <div ref={ref} className={className} />;
}
