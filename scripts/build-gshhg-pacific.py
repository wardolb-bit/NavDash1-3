#!/usr/bin/env python3
"""
Build a Pacific-only GSHHG full-resolution coastline extract for NavDash ECR.

What it does:
- Downloads official GSHHG shapefile package from SOEST/Hawaii if missing.
- Reads GSHHS full-resolution Level 1 coastline polygons.
- Extracts Pacific operating region segments.
- Writes public/data/gshhg-pacific-full.json for the ECR Distance From Land engine.

This uses GSHHG full-resolution source data, but exports a browser-safe regional
polyline dataset for distance calculations.

Requirements:
  python -m pip install pyshp

Run from project root:
  python scripts/build-gshhg-pacific.py

Optional:
  python scripts/build-gshhg-pacific.py --spacing-nm 0.05
  python scripts/build-gshhg-pacific.py --lat-min -35 --lat-max 45 --lon-min 100 --lon-max 240
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import sys
import urllib.request
import zipfile

GSHHG_URLS = [
    # Current upstream location referenced by SOEST / University of Hawaii.
    "https://www.soest.hawaii.edu/pwessel/gshhg/gshhg-shp-2.3.7.zip",
    "http://www.soest.hawaii.edu/pwessel/gshhg/gshhg-shp-2.3.7.zip",

    # Older NOAA/NCEI paths kept as fallbacks for mirrors or restored hosting.
    "https://www.ngdc.noaa.gov/mgg/shorelines/data/gshhs/latest/gshhg-shp-2.3.7.zip",
    "https://www.ngdc.noaa.gov/mgg/shorelines/data/gshhg/latest/gshhg-shp-2.3.7.zip",
]
DEFAULT_CACHE_DIR = Path("data/gshhg")
DEFAULT_OUTPUT = Path("public/data/gshhg-pacific-full.json")

try:
    import shapefile  # type: ignore
except ImportError:
    print("Missing dependency: pyshp")
    print("Install it with:")
    print("  python -m pip install pyshp")
    sys.exit(1)


def normalize_lon_180(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def normalize_lon_360(lon: float) -> float:
    return lon % 360.0


def point_in_region(lat: float, lon: float, lat_min: float, lat_max: float, lon_min_360: float, lon_max_360: float) -> bool:
    if lat < lat_min or lat > lat_max:
        return False
    lon360 = normalize_lon_360(lon)
    if lon_min_360 <= lon_max_360:
        return lon_min_360 <= lon360 <= lon_max_360
    return lon360 >= lon_min_360 or lon360 <= lon_max_360


def distance_nm(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    earth_radius_nm = 3440.065
    phi1 = math.radians(a_lat)
    phi2 = math.radians(b_lat)
    d_phi = math.radians(b_lat - a_lat)
    d_lon = math.radians(((b_lon - a_lon + 540.0) % 360.0) - 180.0)

    h = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lon / 2) ** 2
    return 2 * earth_radius_nm * math.asin(min(1.0, math.sqrt(h)))


def download_url(url: str, zip_path: Path) -> None:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 NavDash-CoastlinePro/1.0",
            "Accept": "application/zip,application/octet-stream,*/*",
        },
    )

    temp_path = zip_path.with_suffix(".download")
    if temp_path.exists():
        temp_path.unlink()

    with urllib.request.urlopen(request, timeout=120) as response:
        total = response.headers.get("Content-Length")
        expected = int(total) if total and total.isdigit() else None

        with temp_path.open("wb") as handle:
            downloaded = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                downloaded += len(chunk)
                if expected:
                    pct = downloaded / expected * 100
                    print(f"  {downloaded / 1024 / 1024:7.1f} MB / {expected / 1024 / 1024:7.1f} MB ({pct:5.1f}%)", end="\r")
                else:
                    print(f"  {downloaded / 1024 / 1024:7.1f} MB", end="\r")

    print()
    if temp_path.stat().st_size < 10_000_000:
        raise RuntimeError(f"Downloaded file is too small: {temp_path.stat().st_size} bytes")

    temp_path.replace(zip_path)


def download_if_needed(zip_path: Path) -> None:
    if zip_path.exists() and zip_path.stat().st_size > 10_000_000:
        print(f"Using cached {zip_path}")
        return

    zip_path.parent.mkdir(parents=True, exist_ok=True)

    last_error: Exception | None = None
    print("Downloading GSHHG shapefile package...")

    for url in GSHHG_URLS:
        try:
            print(f"Trying: {url}")
            download_url(url, zip_path)
            print(f"Downloaded {zip_path} ({zip_path.stat().st_size / 1024 / 1024:.1f} MB)")
            return
        except Exception as err:
            last_error = err
            print(f"  Failed: {err}")

    print()
    print("Automatic download failed.")
    print("Manual fallback:")
    print("1. Open: https://www.soest.hawaii.edu/pwessel/gshhg/index.html")
    print("2. Download the ESRI shapefile zip: gshhg-shp-2.3.7.zip")
    print(f"3. Put it here: {zip_path}")
    print("4. Run this script again.")
    raise RuntimeError(f"Could not download GSHHG zip. Last error: {last_error}")


def extract_if_needed(zip_path: Path, cache_dir: Path) -> Path:
    shp_path = cache_dir / "GSHHS_shp" / "f" / "GSHHS_f_L1.shp"
    if shp_path.exists():
      return shp_path

    print("Extracting GSHHG shapefiles...")
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(cache_dir)

    if not shp_path.exists():
        matches = list(cache_dir.rglob("GSHHS_f_L1.shp"))
        if matches:
            return matches[0]
        raise FileNotFoundError("Could not find GSHHS_f_L1.shp after extraction.")

    return shp_path


def keep_segment(a: tuple[float, float], b: tuple[float, float], args: argparse.Namespace) -> bool:
    a_lat, a_lon = a
    b_lat, b_lon = b

    if point_in_region(a_lat, a_lon, args.lat_min, args.lat_max, args.lon_min, args.lon_max):
        return True
    if point_in_region(b_lat, b_lon, args.lat_min, args.lat_max, args.lon_min, args.lon_max):
        return True

    # Keep short crossings through the region even if endpoints are just outside.
    mid_lat = (a_lat + b_lat) / 2
    mid_lon = normalize_lon_180((normalize_lon_360(a_lon) + normalize_lon_360(b_lon)) / 2)
    return point_in_region(mid_lat, mid_lon, args.lat_min, args.lat_max, args.lon_min, args.lon_max)


def append_point(line: list[list[float]], point: tuple[float, float], spacing_nm: float) -> None:
    lat, lon = point
    lon = normalize_lon_180(lon)

    if line:
        prev_lat, prev_lon = line[-1]
        # Avoid giant antimeridian jump artifacts.
        if abs(((lon - prev_lon + 540.0) % 360.0) - 180.0) > 20:
            return
        if distance_nm(prev_lat, prev_lon, lat, lon) < spacing_nm:
            return

    line.append([round(lat, 5), round(lon, 5)])


def build_extract(shp_path: Path, args: argparse.Namespace) -> list[list[list[float]]]:
    reader = shapefile.Reader(str(shp_path))
    lines: list[list[list[float]]] = []
    processed_shapes = 0
    kept_segments = 0

    print(f"Reading {shp_path}")
    print(f"Pacific extract bounds: lat {args.lat_min}..{args.lat_max}, lon360 {args.lon_min}..{args.lon_max}")
    print(f"Point spacing: {args.spacing_nm} NM")

    for shape_record in reader.iterShapeRecords():
        shape = shape_record.shape
        points = [(float(lat), float(lon)) for lon, lat in shape.points]  # pyshp gives x,y = lon,lat
        part_starts = list(shape.parts) + [len(points)]

        processed_shapes += 1

        for part_index in range(len(part_starts) - 1):
            part = points[part_starts[part_index]:part_starts[part_index + 1]]
            if len(part) < 2:
                continue

            current: list[list[float]] = []

            for i in range(len(part) - 1):
                a = part[i]
                b = part[i + 1]

                if keep_segment(a, b, args):
                    if not current:
                        append_point(current, a, args.spacing_nm)
                    append_point(current, b, args.spacing_nm)
                    kept_segments += 1
                else:
                    if len(current) >= 2:
                        lines.append(current)
                    current = []

            if len(current) >= 2:
                lines.append(current)

    # Remove tiny line fragments.
    lines = [line for line in lines if len(line) >= 2]

    print(f"Processed shapes: {processed_shapes}")
    print(f"Kept segments: {kept_segments}")
    print(f"Output polylines: {len(lines)}")
    print(f"Output points: {sum(len(line) for line in lines)}")
    return lines


def write_json(lines: list[list[list[float]]], output: Path, args: argparse.Namespace) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)

    metadata = {
        "source": "GSHHG 2.3.7, GSHHS full-resolution Level 1",
        "bounds": {
            "latMin": args.lat_min,
            "latMax": args.lat_max,
            "lonMin360": args.lon_min,
            "lonMax360": args.lon_max,
        },
        "spacingNm": args.spacing_nm,
        "polylineCount": len(lines),
        "pointCount": sum(len(line) for line in lines),
    }

    payload = {
        "metadata": metadata,
        "coastlines": lines,
    }

    output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {output}")
    print(f"File size: {output.stat().st_size / 1024 / 1024:.2f} MB")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--lat-min", type=float, default=-35.0)
    parser.add_argument("--lat-max", type=float, default=45.0)
    parser.add_argument("--lon-min", type=float, default=100.0, help="0..360 longitude minimum")
    parser.add_argument("--lon-max", type=float, default=240.0, help="0..360 longitude maximum, 240 = 120W")
    parser.add_argument("--spacing-nm", type=float, default=0.10, help="Minimum point spacing in nautical miles")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    zip_path = args.cache_dir / "gshhg-shp-2.3.7.zip"

    download_if_needed(zip_path)
    shp_path = extract_if_needed(zip_path, args.cache_dir)
    lines = build_extract(shp_path, args)
    write_json(lines, args.output, args)


if __name__ == "__main__":
    main()
