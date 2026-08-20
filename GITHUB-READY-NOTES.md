# NavDash GitHub-ready copy

This folder is a clean source copy prepared for GitHub.

Excluded from this copy:

- `.git/` history from the old working folder
- `node_modules/`
- `.next/`
- logs and TypeScript build cache
- `data/gshhg/`, the raw coastline shapefile/archive bundle with files over GitHub's normal 100 MB file limit

Kept in this copy:

- app source under `app/`, `components/`, `lib/`, `server/`, and `scripts/`
- `package.json` and `package-lock.json`
- generated runtime coastline data at `public/data/gshhg-pacific-full.json`
- current GRIB runtime data under `data/grib/`
- bundled `tools/wgrib2/` runtime files

The full local backup, including the raw `data/gshhg/` bundle and old Git history, is on the USB at:

`D:\NavDash-source-backup-20260820-005607`
