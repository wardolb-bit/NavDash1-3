# NavDash runtime data policy

NavDash source control should contain application source and intentional immutable reference assets, not changing operational cache data.

## GRIB data

Uploaded GRIB files are processed from the operating system temporary directory and deleted after parsing. The processed current-GRIB summary is persisted to Cloudflare R2 when the standard `R2_*` environment variables are configured. Standalone/local deployments without R2 fall back to `data/grib/current-grib-summary.json`.

`data/grib/current-grib*` is ignored so future uploaded/current weather state does not grow Git history.

## Position and route state

Operational route state and position-history snapshots are runtime data and are not versioned. `data/loaded-route.json` and `data/position-history.json` are ignored so vessel state does not accumulate in Git history.

## wgrib2 runtime

The Windows wgrib2 executable and required Cygwin DLLs remain versioned because NavDash still supports local Windows GRIB processing. Hosted deployments can use a system `wgrib2` or `WGRIB2_PATH` when available. Do not remove the Windows runtime until local Windows GRIB processing is intentionally retired or replaced.
