export function formatNumber(value: number | null | undefined, decimals = 1, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value.toFixed(decimals)}${suffix}`;
}

export function propertyNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function formatDirection(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "---";
  return `${String(Math.round(value)).padStart(3, "0")} deg`;
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "--";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatLatLon(value: number, isLat: boolean) {
  if (!Number.isFinite(value)) return "--";

  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const hemi = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${degrees} ${minutes.toFixed(1)}' ${hemi}`;
}
