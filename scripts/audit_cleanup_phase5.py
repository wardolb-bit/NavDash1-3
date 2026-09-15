from pathlib import Path
import re

route = Path('app/api/grib-summary/route.ts')
text = route.read_text(encoding='utf-8')

# R2-backed processed GRIB summary, with local fallback for standalone/local use.
import_anchor = 'import { promisify } from "util";\n'
if text.count(import_anchor) != 1:
    raise SystemExit('Could not locate util import')
text = text.replace(import_anchor, import_anchor + 'import { deleteR2Object, getR2Object, putR2Object } from "../../../lib/r2Storage";\n', 1)

anchor = 'const execFileAsync = promisify(execFile);\n'
addition = '''const R2_GRIB_SUMMARY_KEY = "runtime/grib/current-grib-summary.json";

function r2Configured() {
  return Boolean(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}
'''
if text.count(anchor) != 1:
    raise SystemExit('Could not locate execFileAsync')
text = text.replace(anchor, anchor + '\n' + addition, 1)

save_pattern = re.compile(r'async function savePersistedGrib\(buffer: Buffer, safeName: string, summary: PersistedGribSummary\) \{.*?\n\}\n\nasync function clearPersistedGrib', re.S)
save_replacement = '''async function savePersistedGrib(safeName: string, summary: PersistedGribSummary) {
  const nextSummary = { ...summary, savedFileName: "" };
  const serialized = JSON.stringify(nextSummary, null, 2);

  if (r2Configured()) {
    await putR2Object(R2_GRIB_SUMMARY_KEY, serialized, "application/json");
    return nextSummary;
  }

  const dir = gribDataDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(gribSummaryPath(), serialized, "utf8");
  return nextSummary;
}

async function clearPersistedGrib'''
text, n = save_pattern.subn(save_replacement, text, count=1)
if n != 1:
    raise SystemExit(f'savePersistedGrib block matches={n}')

# R2 clear before legacy/local cache cleanup.
clear_anchor = '''async function clearPersistedGrib() {
  const dir = gribDataDir();
'''
clear_replacement = '''async function clearPersistedGrib() {
  if (r2Configured()) {
    try { await deleteR2Object(R2_GRIB_SUMMARY_KEY); } catch {}
  }

  const dir = gribDataDir();
'''
if text.count(clear_anchor) != 1:
    raise SystemExit('clearPersistedGrib anchor not found')
text = text.replace(clear_anchor, clear_replacement, 1)

# The raw uploaded GRIB is parsed from /tmp during POST and is no longer persisted after processing.
old_call = '    const persisted = await savePersistedGrib(buffer, safeName, {'
if text.count(old_call) != 1:
    raise SystemExit('savePersistedGrib call not found')
text = text.replace(old_call, '    const persisted = await savePersistedGrib(safeName, {', 1)

get_pattern = re.compile(r'export async function GET\(\) \{.*?\n\}\n\nexport async function DELETE', re.S)
get_replacement = '''export async function GET() {
  if (r2Configured()) {
    try {
      const response = await getR2Object(R2_GRIB_SUMMARY_KEY);
      if (response.ok) {
        const summary = await response.json();
        return Response.json({ hasGrib: true, ...summary });
      }
    } catch {
      // Fall through to the local cache for standalone/local operation.
    }
  }

  try {
    const raw = await fs.readFile(gribSummaryPath(), "utf8");
    const summary = JSON.parse(raw);
    return Response.json({ hasGrib: true, ...summary });
  } catch {
    return Response.json({ hasGrib: false });
  }
}

export async function DELETE'''
text, n = get_pattern.subn(get_replacement, text, count=1)
if n != 1:
    raise SystemExit(f'GET block matches={n}')
route.write_text(text, encoding='utf-8')

# Ignore future mutable GRIB cache artifacts.
gitignore = Path('.gitignore')
gi = gitignore.read_text(encoding='utf-8')
needle = 'data/grib/*.tmp\n'
replacement = '''data/grib/*.tmp
data/grib/current-grib*
'''
if needle not in gi:
    raise SystemExit('Expected GRIB gitignore anchor missing')
gitignore.write_text(gi.replace(needle, replacement, 1), encoding='utf-8')

# Runtime-data policy documentation.
Path('docs/RUNTIME_DATA.md').write_text('''# NavDash runtime data policy

NavDash source control should contain application source and intentional immutable reference assets, not changing operational cache data.

## GRIB data

Uploaded GRIB files are processed from the operating system temporary directory and deleted after parsing. The processed current-GRIB summary is persisted to Cloudflare R2 when the standard `R2_*` environment variables are configured. Standalone/local deployments without R2 fall back to `data/grib/current-grib-summary.json`.

`data/grib/current-grib*` is ignored so future uploaded/current weather state does not grow Git history.

## Coastline reference data

`public/data/gshhg-pacific-full.json` is an immutable runtime reference asset and remains versioned intentionally.

## wgrib2 runtime

The Windows wgrib2 executable and required Cygwin DLLs remain versioned because NavDash supports local Windows processing. Hosted Linux deployments can use a system `wgrib2` or `WGRIB2_PATH` when available. Do not remove the Windows runtime until local vessel workflows no longer depend on it.
''', encoding='utf-8')
