export const HELP = `signsnip - SignSnip CLI (47x70mm shelf signs -> print-ready PDF)

Brands
  signsnip brands                              list brands, collections, logo status
  signsnip brands add "Name" [--logo file] [--collections "A,B,C"]
  signsnip brands logo <brand> <file>          set/replace a logo (png/jpg/webp/svg)
  signsnip brands collections <brand> "A,B,C"  replace the collection list
  signsnip brands scale <brand> <0.5-1.6>      grow/shrink that brand's logo on every sign
  signsnip brands fix-bg <brand>               make a logo's solid background transparent
  signsnip brands restore <brand>              undo fix-bg
  signsnip brands rm <brand>

Batch (shared live with the web UI)
  signsnip add --brand <id|name> --collection "Harbor Line" --percent 50 [--prefix SELECT] [--footer "*MSRP"] [--copies 2]
  signsnip add --brand <b> --collection Comet --price 199 [--was 395] [--price-label NOW]   price-point sign
  signsnip add --preset <id|name> [--copies 4]
  signsnip add --template bogo --brand <b> --collection Comet --percent 50   any template
  signsnip import <file.csv>                   columns: brand,collection,percent|price[,was,price_label,copies,prefix,footer]
  signsnip batch                               show the current batch + page fill
  signsnip bulk [--rows 1,3-5|all] --percent 50 | --price 199 | --brand <b> | --template <t> | --footer "x" | --copies 2
  signsnip fill                                top up the last page with copies of the last row
  signsnip rm <row#>                           remove one row (1-based)
  signsnip clear                               empty the batch

Templates (layouts: what goes where, font sizes)
  signsnip templates                           list templates (+ how many batch rows use each)
  signsnip templates show <tpl>                every object with position/size (mm) and font size (pt)
  signsnip templates set <tpl> offer.size=34 heading.y=20 footer.weight=regular ...
                                            object = id or field name; props: x y w h size minSize weight
                                            align vAlign maxLines lineSpacing balance uppercase strike color text
  signsnip templates duplicate <tpl> "New name"
  signsnip templates rename <tpl> "New name"
  signsnip templates reset <percent|price|bogo|final-sale>   back to the original layout
  signsnip templates rm <tpl>
  signsnip templates export [tpl ...] [-o file.signsnip.json] [--name "Holiday set"]
  signsnip templates import <file> [--replace]  default keeps both when a template differs

Readable text (auto-fit)
  signsnip rules                               readable minimum + abbreviation list
  signsnip rules min 10                        text that would shrink below 10pt gets auto-fixed or flagged
  signsnip rules abbr "Chronograph" "Chrono"   add/replace an abbreviation (used only when needed)
  signsnip rules abbr-rm "Chronograph"
  signsnip templates fallback percent percent-long   use this template when text gets too small (none = off)
  signsnip templates min percent 9 | none      per-template readable minimum (none = use the store setting)
  signsnip templates background <tpl> <image> [--fit cover|contain] [--strength 30]
                                               picture printed behind the sign (cover = fill and crop,
                                               contain = whole picture). Strength in % (default 30)
  signsnip templates background <tpl> --strength 25 | --fit contain   change it
  signsnip templates background <tpl> none     remove it
  signsnip export --strict                     refuse to export if any sign is still below the minimum

Backups (everything: brands, logos, templates, text rules, presets, batches)
  signsnip backup [-o file.signsnip-backup.json]  one file you can restore here or in the hosted app
  signsnip restore <file> --yes                REPLACES everything with the backup
  signsnip start scratch|samples --yes         wipe and start empty, or with the made-up sample brands

Saved batches
  signsnip batches                             list saved batches
  signsnip save "Holiday sale"                 save the current batch under a name
  signsnip load "Holiday sale"                 replace the current batch with a saved one
  signsnip batches rm "Holiday sale"

Output
  signsnip export [-o out/signs.pdf] [--grid landscape-5x2|portrait-4x3] [--paper letter|a4] [--no-cut-marks]
  signsnip make  <same flags as add> [-o file]  one-shot: a sheet from a single spec
  signsnip check                               pre-print warnings (low-res logos, tiny text, ...)
  signsnip calibrate [-o file] [--paper a4]     printer check page (47x70 box + rulers)
  signsnip presets
  signsnip save-preset <name> <add flags>      save a sign spec as a preset (then: add --preset <name>)
  signsnip serve                               start the web UI (http://127.0.0.1:7047)
`;
