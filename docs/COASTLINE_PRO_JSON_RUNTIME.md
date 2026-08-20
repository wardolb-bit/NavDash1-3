# NavDash Coastline Pro JSON Runtime Data

This version keeps the GSHHG full-resolution Pacific extract out of the TypeScript compiler.

## Cancel the current build

Press:

```text
Ctrl + C
```

## Remove baked-in TypeScript coastline data

If you generated a huge TypeScript coastline file, remove it:

```powershell
Remove-Item app\ecr\coastline-data.ts
```

## Copy files

Copy these into your project:

```text
app/ecr/page.tsx
scripts/build-gshhg-pacific.py
public/data/gshhg-pacific-full.json
```

The included JSON file is a tiny placeholder so the app can build before you generate the real data.

## Generate real coastline JSON

From project root:

```powershell
python scripts/build-gshhg-pacific.py
```

This writes:

```text
public/data/gshhg-pacific-full.json
```

## Build

```powershell
npm run build
```

The build should no longer compile the coastline database. The ECR page loads the JSON at runtime.
