export type NavStar = {
  no: number | "P";
  name: string;
  sha: number;
  dec: number;
  mag: number;
};

export type StarSolution = NavStar & {
  gha: number;
  lha: number;
  hc: number;
  zn: number;
};

// 57 Nautical Almanac navigational stars plus Polaris.
// SHA/declination values are intentionally rounded for star identification/planning.
// This module is not intended to replace current Nautical Almanac data for sight reduction.
export const NAV_STARS: NavStar[] = [
  { no: 1, name: "Alpheratz", sha: 358, dec: 29, mag: 2.06 },
  { no: 2, name: "Ankaa", sha: 354, dec: -42, mag: 2.37 },
  { no: 3, name: "Schedar", sha: 350, dec: 56, mag: 2.25 },
  { no: 4, name: "Diphda", sha: 349, dec: -18, mag: 2.04 },
  { no: 5, name: "Achernar", sha: 336, dec: -57, mag: 0.50 },
  { no: 6, name: "Hamal", sha: 328, dec: 23, mag: 2.00 },
  { no: 7, name: "Acamar", sha: 316, dec: -40, mag: 3.20 },
  { no: 8, name: "Menkar", sha: 315, dec: 4, mag: 2.50 },
  { no: 9, name: "Mirfak", sha: 309, dec: 50, mag: 1.82 },
  { no: 10, name: "Aldebaran", sha: 291, dec: 16, mag: 0.85 },
  { no: 11, name: "Rigel", sha: 282, dec: -8, mag: 0.12 },
  { no: 12, name: "Capella", sha: 281, dec: 46, mag: 0.71 },
  { no: 13, name: "Bellatrix", sha: 279, dec: 6, mag: 1.64 },
  { no: 14, name: "Elnath", sha: 279, dec: 29, mag: 1.68 },
  { no: 15, name: "Alnilam", sha: 276, dec: -1, mag: 1.70 },
  { no: 16, name: "Betelgeuse", sha: 271, dec: 7, mag: 0.58 },
  { no: 17, name: "Canopus", sha: 264, dec: -53, mag: -0.72 },
  { no: 18, name: "Sirius", sha: 259, dec: -17, mag: -1.47 },
  { no: 19, name: "Adhara", sha: 256, dec: -29, mag: 1.51 },
  { no: 20, name: "Procyon", sha: 245, dec: 5, mag: 0.34 },
  { no: 21, name: "Pollux", sha: 244, dec: 28, mag: 1.15 },
  { no: 22, name: "Avior", sha: 234, dec: -59, mag: 2.40 },
  { no: 23, name: "Suhail", sha: 223, dec: -43, mag: 2.23 },
  { no: 24, name: "Miaplacidus", sha: 222, dec: -70, mag: 1.70 },
  { no: 25, name: "Alphard", sha: 218, dec: -9, mag: 2.00 },
  { no: 26, name: "Regulus", sha: 208, dec: 12, mag: 1.35 },
  { no: 27, name: "Dubhe", sha: 194, dec: 62, mag: 1.87 },
  { no: 28, name: "Denebola", sha: 183, dec: 15, mag: 2.14 },
  { no: 29, name: "Gienah", sha: 176, dec: -17, mag: 2.80 },
  { no: 30, name: "Acrux", sha: 174, dec: -63, mag: 1.40 },
  { no: 31, name: "Gacrux", sha: 172, dec: -57, mag: 1.63 },
  { no: 32, name: "Alioth", sha: 167, dec: 56, mag: 1.76 },
  { no: 33, name: "Spica", sha: 159, dec: -11, mag: 1.04 },
  { no: 34, name: "Alkaid", sha: 153, dec: 49, mag: 1.85 },
  { no: 35, name: "Hadar", sha: 149, dec: -60, mag: 0.60 },
  { no: 36, name: "Menkent", sha: 149, dec: -36, mag: 2.06 },
  { no: 37, name: "Arcturus", sha: 146, dec: 19, mag: -0.04 },
  { no: 38, name: "Rigil Kentaurus", sha: 140, dec: -61, mag: -0.01 },
  { no: 39, name: "Zubenelgenubi", sha: 138, dec: -16, mag: 3.28 },
  { no: 40, name: "Kochab", sha: 137, dec: 74, mag: 2.08 },
  { no: 41, name: "Alphecca", sha: 127, dec: 27, mag: 2.24 },
  { no: 42, name: "Antares", sha: 113, dec: -26, mag: 1.09 },
  { no: 43, name: "Atria", sha: 108, dec: -69, mag: 1.92 },
  { no: 44, name: "Sabik", sha: 103, dec: -16, mag: 2.43 },
  { no: 45, name: "Shaula", sha: 97, dec: -37, mag: 1.62 },
  { no: 46, name: "Rasalhague", sha: 96, dec: 13, mag: 2.10 },
  { no: 47, name: "Eltanin", sha: 91, dec: 51, mag: 2.23 },
  { no: 48, name: "Kaus Australis", sha: 84, dec: -34, mag: 1.80 },
  { no: 49, name: "Vega", sha: 81, dec: 39, mag: 0.03 },
  { no: 50, name: "Nunki", sha: 76, dec: -26, mag: 2.06 },
  { no: 51, name: "Altair", sha: 63, dec: 9, mag: 0.77 },
  { no: 52, name: "Peacock", sha: 54, dec: -57, mag: 1.91 },
  { no: 53, name: "Deneb", sha: 50, dec: 45, mag: 1.25 },
  { no: 54, name: "Enif", sha: 34, dec: 10, mag: 2.40 },
  { no: 55, name: "Al Na'ir", sha: 28, dec: -47, mag: 1.74 },
  { no: 56, name: "Fomalhaut", sha: 16, dec: -30, mag: 1.16 },
  { no: 57, name: "Markab", sha: 14, dec: 15, mag: 2.49 },
  { no: "P", name: "Polaris", sha: 319, dec: 89, mag: 2.01 },
];

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;
export const norm360 = (value: number) => ((value % 360) + 360) % 360;

export function julianDate(date: Date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Greenwich Mean Sidereal Time, adequate for star identification/planning.
export function ghaAries(date: Date) {
  const jd = julianDate(date);
  const t = (jd - 2451545.0) / 36525;
  return norm360(
    280.46061837 +
      360.98564736629 * (jd - 2451545.0) +
      0.000387933 * t * t -
      (t * t * t) / 38710000,
  );
}

export function solveStar(star: NavStar, lat: number, lon: number, date: Date): StarSolution {
  const gha = norm360(ghaAries(date) + star.sha);
  // East-positive longitude: LHA = GHA + west longitude = GHA - east longitude.
  const lha = norm360(gha - lon);
  const phi = rad(lat);
  const dec = rad(star.dec);
  const h = rad(lha);

  const sinAlt =
    Math.sin(phi) * Math.sin(dec) +
    Math.cos(phi) * Math.cos(dec) * Math.cos(h);
  const hc = deg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));

  const az = deg(
    Math.atan2(
      Math.sin(h),
      Math.cos(h) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi),
    ),
  );
  const zn = norm360(az + 180);

  return { ...star, gha, lha, hc, zn };
}

export function solveNavStars(lat: number, lon: number, date: Date) {
  return NAV_STARS.map((star) => solveStar(star, lat, lon, date));
}

export function formatLatitude(value: number) {
  const hemi = value >= 0 ? "N" : "S";
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  return `${String(degrees).padStart(2, "0")}° ${minutes.toFixed(2).padStart(5, "0")}' ${hemi}`;
}

export function formatLongitude(value: number) {
  const hemi = value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  return `${String(degrees).padStart(3, "0")}° ${minutes.toFixed(2).padStart(5, "0")}' ${hemi}`;
}
