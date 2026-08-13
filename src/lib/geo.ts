/**
 * Расстояние между двумя точками на земле (формула гаверсинуса).
 *
 * Для проверки «сотрудник в офисе» этого достаточно: на расстояниях в сотни
 * метров ошибка от сферической модели Земли — сантиметры, тогда как точность
 * GPS на телефоне в городе измеряется десятками метров.
 */

const EARTH_RADIUS_M = 6_371_000;

export type Point = { lat: number; lng: number };

export function distanceMeters(a: Point, b: Point): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/** Координаты приходят из браузера и из Telegram — обе стороны проверяем. */
export function isValidPoint(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} км` : `${meters} м`;
}
