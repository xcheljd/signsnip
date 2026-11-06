# 🪧 SignSnip

Print-ready shelf signs for **47 × 70 mm** holders. Pick a brand, a collection and a percent off
(or a price), and get a PDF sheet ready to print and cut. Replaces hand-editing a spreadsheet full of text boxes.

> **All sample data is fake.** The brands, logos and collections in `seed/` are invented.
> Never commit real branding. Real data lives in the gitignored `data/` folder.

## Run it

```bash
pnpm install
pnpm build        # builds the web UI
pnpm start        # http://127.0.0.1:7047   (or: signsnip serve)
pnpm dev          # hot-reload UI on :7048, API on :7047
```

First run copies `seed/` into `data/` (your working copy). Reset by deleting `data/`.

## Web UI

**Make signs**
- Two sign types: **Percent off** (`SELECT / HARBOR LINE / 50% OFF* / *MSRP`) and **Price**
  (`NOW / $249 / WAS $399` with the old price struck through; label and was-price optional).
- Collection box suggests the brand's collections as you type, and any custom text works too.
- **Enter** adds the sign (or saves the edit), then jumps back to the collection box for the next one.
  **Esc** cancels an edit, **Ctrl/Cmd+Z** undoes, **Ctrl/Cmd+P** prints the sheet.
- Live preview is the *same PDF renderer* that prints.

**Batch**
- Tick rows to **bulk edit**: set percent / price / copies / brand, duplicate or remove in one go.
- Drag rows by the grip to reorder. Removing, clearing, bulk edits and loading a batch all show an **Undo** toast.
- **Page meter** shows slots used per page; **Fill** tops up the last page with copies of the last row.
- **Warnings** before you print: low-resolution logos, logos on a coloured box (one-click *Remove background*),
  collection names that had to shrink too far, brands without a logo.
- **Saved batches**: name the batch ("Holiday sale"), load it next time (undoable).
- **Print** opens the print dialog directly; **Download PDF** saves it; **Printer check** prints a
  47 × 70 mm box + rulers to confirm your printer isn't scaling the page.

**Print sheet**: click any sign to edit it, drag signs onto each other to rearrange, click an empty slot
to drop in the sign you're building.

**Templates** (the visual designer): every sign prints with a template, which decides what goes where
and how big. Built in: *Percent off* and *Price* (can be edited and reset, not deleted), plus two
examples: *Buy one get one* and *Final sale*.
- Click an object on the sign to select it. Drag it to move, and pull its handles to resize. Snaps to 0.5 mm,
  the centre, the safe margin and other objects' edges (hold **Alt** to drag freely).
- **Arrow keys** nudge 0.1 mm, **Shift+Arrow** 1 mm. **Del** removes, **Ctrl+D** duplicates,
  **Ctrl+Z / Ctrl+Shift+Z** undo/redo, **Ctrl+S** saves.
- Inspector: what the text shows (lead word + collection, offer, label, was-price, footer, or fixed text),
  font size (it prints at this size and shrinks down to *Smallest* only if needed), max lines, bold/regular,
  alignment, vertical position in its box, ALL CAPS, strike-through, colour, exact mm position.
- The canvas uses the same layout engine and font as the PDF; *Print preview* shows the real PDF.
- Warnings: off the paper, past the safe margin (dashed line), text that can't fit its box.
- Saving updates every sign that uses the template. The Make-signs form only shows the fields the
  chosen template prints.
- **Export** writes a template set (`*.signsnip.json`) with the templates you pick. **Import** shows what's new,
  what you already have, and what differs from yours (keep both, or replace yours).

**Hosted version (no server)**: `pnpm build:static` builds a copy that runs entirely in the browser and can be served by any static host (GitHub Pages workflow included). On first visit it asks how to start: from scratch, with the made-up samples, or by restoring a backup. **The site does not save your work**: nothing is uploaded, and the browser's own temporary copy can be erased without warning. To pick up where you left off, download a backup (**Back up now** in the status bar) and use **Restore** next time; **Start over** is next to it and restore it next time. The status bar shows whether you have changes since your last backup. Backups move between the hosted app, the local app and the CLI (`signsnip backup`, `signsnip restore file --yes`).

**Background pictures** (Templates → template settings): a picture printed behind the whole sign. *Fill the sign* crops the edges, *Whole picture* shows all of it; *Strength* (default 30%) keeps black text readable, and above 50% the designer warns. The picture is stored once per template, included in backups and template-set files, and logos with a white box get flagged once they'd print over it.

**Text rules**: a store-wide *readable minimum* (default 10pt) and your own abbreviation list. When text would shrink below the minimum, auto-fit applies abbreviations (only as many as needed), then the template's long-name fallback (set in the designer), and only then warns. Print/Download asks first if anything is still too small. "Try a name" previews the exact result.

**Brands & logos**: drop in a PNG/JPG/WebP/SVG (margins auto-trimmed), see pixel size and printed dpi,
a live sample sign, a **logo size slider** (capped where the logo would hit the text), and
**Remove background / Restore original**.

## CLI (`signsnip`, shares the batch with the UI live)

```bash
signsnip brands
signsnip brands add "My Brand" --logo ./logo.png --collections "Line A,Line B"
signsnip brands scale lumen 1.2          # logo size on every sign for that brand
signsnip brands fix-bg orbital           # make a white/solid logo background transparent (restore: brands restore)
signsnip add --brand northwind --collection "Harbor Line" --percent 50 --copies 3
signsnip add --brand kestrel --collection Falcon --price 249 --was 399 --price-label NOW
signsnip add --preset sale-50
signsnip import rows.csv                 # brand,collection,percent|price[,was,price_label,copies,prefix,footer]
signsnip batch                           # rows + page fill
signsnip bulk --rows 1,3-5 --percent 60  # or --price / --brand / --footer / --copies; --rows all
signsnip fill                            # top up the last page
signsnip save "Holiday sale" ; signsnip batches ; signsnip load holiday
signsnip templates                       # list; show <tpl>; set <tpl> offer.size=34 heading.y=20 ...
signsnip templates duplicate bogo "Holiday BOGO" ; signsnip templates reset percent ; signsnip templates rm <tpl>
signsnip templates export bogo final-sale --name "Holiday set" -o holiday.signsnip.json
signsnip templates import holiday.signsnip.json [--replace]
signsnip add --template bogo --brand orbital --collection Comet --percent 50
signsnip rules ; signsnip rules min 10 ; signsnip rules abbr "Chronograph" "Chrono" ; signsnip rules abbr-rm Chronograph
signsnip templates fallback percent percent-long ; signsnip templates min percent 9
signsnip templates background percent pattern.jpg --fit cover --strength 25 ; signsnip templates background percent none
signsnip export --strict                 # refuse if anything is below the readable minimum
signsnip check                           # pre-print warnings
signsnip calibrate                       # printer check page
signsnip export -o out/signs.pdf [--grid portrait-4x3] [--paper a4] [--no-cut-marks]
```

## How it's built

- `src/core/template.ts`: templates (objects in mm, sizes in pt), built-ins, `layoutTemplate()` (wrap,
  shrink-to-fit by width *and* height, alignment), designer checks. `layout.ts`: shared text/logo fitting
  helpers.
- `src/core/layout.ts`: pure sign geometry (logo box + scale, text sizes 14/30/13 pt like the old
  spreadsheet, auto-shrink and word-wrap, price lines). `geometry.ts`: sheet grid, shared by the
  PDF and the UI's click/drag overlay. `pdf.ts`: draws with pdf-lib + embedded Carlito Bold (OFL);
  sets PrintScaling=None so viewers default to actual size.
- Web UI: Vite + React + shadcn/ui (base-nova / Base UI). The preview *is* the PDF, rendered with pdf.js.

## Gates

```bash
pnpm typecheck && pnpm test && pnpm build
pnpm seed:logos   # regenerate the fake brands/logos
```
