// Map approximate coords -> Yandex region id (lr= parameter for /search).
// Coarse bounding boxes for major RU cities; fallback to Moscow (213).
type Box = { name: string; id: number; lat: [number, number]; lon: [number, number] };

const BOXES: Box[] = [
  { name: "Москва",          id: 213, lat: [55.35, 56.05], lon: [36.95, 37.95] },
  { name: "Санкт-Петербург", id: 2,   lat: [59.65, 60.20], lon: [29.55, 30.75] },
  { name: "Екатеринбург",    id: 54,  lat: [56.65, 57.05], lon: [60.40, 60.80] },
  { name: "Новосибирск",     id: 65,  lat: [54.85, 55.20], lon: [82.75, 83.15] },
  { name: "Казань",          id: 43,  lat: [55.65, 55.95], lon: [49.00, 49.40] },
  { name: "Нижний Новгород", id: 47,  lat: [56.20, 56.40], lon: [43.85, 44.15] },
  { name: "Краснодар",       id: 35,  lat: [44.95, 45.15], lon: [38.85, 39.15] },
  { name: "Ростов-на-Дону",  id: 39,  lat: [47.15, 47.35], lon: [39.55, 39.85] },
  { name: "Самара",          id: 51,  lat: [53.10, 53.35], lon: [50.05, 50.35] },
  { name: "Уфа",             id: 172, lat: [54.65, 54.85], lon: [55.85, 56.15] },
];

export function regionIdFromCoords(lat: number | null, lon: number | null): number {
  if (lat == null || lon == null) return 213;
  for (const b of BOXES) {
    if (lat >= b.lat[0] && lat <= b.lat[1] && lon >= b.lon[0] && lon <= b.lon[1]) return b.id;
  }
  return 213;
}

export function regionName(id: number): string {
  const b = BOXES.find((x) => x.id === id);
  return b?.name ?? "Россия";
}
