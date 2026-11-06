# 🪧 Sign-O-Matic

Print-ready shelf signs for **47 × 70 mm** holders. Pick a brand, a collection and a percent off,
and get a PDF sheet ready to print and cut. Replaces hand-editing a spreadsheet full of text boxes.

> **All sample data is fake.** The brands, logos and collections in `seed/` are invented.
> Never commit real branding. Real data lives in the gitignored `data/` folder.

## Run it

```bash
pnpm install
pnpm build        # builds the web UI
pnpm start        # http://127.0.0.1:7047   (or: signo serve)
pnpm dev          # hot-reload UI on :7048, API on :7047
```

First run copies `seed/` into `data/` (your working copy). Reset by deleting `data/`.

## Web UI

- **Brands & logos**: drop in a PNG/JPG/WebP/SVG. Empty margins are trimmed, and the logo is scaled to fit its box (wide logos by width, tall ones by height).
- **Make signs**: brand, lead word (SELECT or none), collection (free text or the brand's list), percent chips, footer, copies. Live preview is the *same PDF renderer* that prints.
- **Batch**: edit/duplicate/remove rows, choose Letter or A4, 5×2 landscape (10/page) or 4×3 portrait (12/page), cut lines on/off, **Export PDF**.

## CLI (`signo`, shares the batch with the UI live)

```bash
signo brands
signo brands add "My Brand" --logo ./logo.png --collections "Line A,Line B"
signo add --brand northwind --collection "Harbor Line" --percent 50 --copies 3
signo add --preset sale-50
signo import rows.csv        # brand,collection,percent[,copies,prefix,footer]
signo batch
signo export -o out/signs.pdf [--grid portrait-4x3] [--paper a4] [--no-cut-marks]
signo make --brand orbital --collection Comet --percent 60 -o comet.pdf   # one-shot
```

## Layout

`src/core/layout.ts` is the single source of truth for what a sign looks like: logo box, text sizes
(14 pt header, 30 pt percent, 13 pt footer, matching the old spreadsheet) with auto-shrink / word-wrap so
long collection names never overflow. `pdf.ts` draws it with pdf-lib and an embedded bold font (Carlito, OFL).

## Gates

```bash
pnpm typecheck && pnpm test && pnpm build
pnpm seed:logos   # regenerate the fake brands/logos
```
