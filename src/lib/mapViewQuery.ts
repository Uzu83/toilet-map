/**
 * エリアLPの「このエリアを地図で見る」が付ける ?lat=&lng=&zoom= を読む。
 * lat/lng 必須・範囲内。zoom 省略時 13。不正は null(DeepLinkResolver が無視)。
 */
export function parseMapViewQuery(
  params: URLSearchParams,
): { lat: number; lng: number; zoom: number } | null {
  const latRaw = params.get("lat");
  const lngRaw = params.get("lng");
  if (latRaw == null || lngRaw == null) return null;

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const zoomRaw = params.get("zoom");
  let zoom = 13;
  if (zoomRaw != null && zoomRaw !== "") {
    zoom = Number(zoomRaw);
    // Leaflet の実用ズームは 1..19。範囲外はリンク破損とみなして無視する。
    if (!Number.isFinite(zoom) || zoom < 1 || zoom > 19) return null;
  }

  return { lat, lng, zoom };
}
