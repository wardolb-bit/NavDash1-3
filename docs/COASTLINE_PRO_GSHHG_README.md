# NavDash Coastline Pro: GSHHG Full Pacific Extract

This package sets up the ECR page to use the best local coastline source we can reasonably run on the shipboard mini-PC:

- NOAA/NCEI GSHHG 2.3.7
- GSHHS full-resolution Level 1 coastline
- Pacific regional extract
- Written into `app/ecr/coastline-data.ts`

## Replace

Copy:

```text
app/ecr/page.tsx
scripts/build-gshhg-pacific.py
```

into your NavDash project.

## Build the coastline extract

From the project root:

```powershell
python -m pip install pyshp
python scripts/build-gshhg-pacific.py
```

That downloads the official NOAA GSHHG shapefile zip, extracts `GSHHS_f_L1.shp`, clips the Pacific operating region, and writes:

```text
app/ecr/coastline-data.ts
```

## Default extract area

```text
Latitude:  -35 to +45
Longitude: 100E to 120W
```

That covers the western/central Pacific operating area, Guam/Marianas, Micronesia, Philippines approaches, PNG/Solomons, Marshall Islands, Wake, Hawaii side, and much of the North Pacific.

## More accurate, bigger file

```powershell
python scripts/build-gshhg-pacific.py --spacing-nm 0.05
```

## Smaller, faster file

```powershell
python scripts/build-gshhg-pacific.py --spacing-nm 0.25
```

## Important

This is distance-from-land awareness only.

It is not:
- a legal baseline calculation
- a MARPOL discharge authorization
- an approved navigation system
- a substitute for official charts, publications, bridge procedures, or vessel SMS
