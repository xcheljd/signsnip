import fs from "node:fs";
import { maxLogoScale } from "../core/layout.js";
import { addBrand, brandMatches, deleteBrand, listBrands, logoInfo, removeLogoBackground, restoreLogo, saveLogo, upsertBrand } from "../core/store.js";
import { die, list, log, pick, type Flags } from "./shared.js";

const readFile = (file: string) => (fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file) : die(`No file "${file}"`));

/** `signsnip brands ...` */
export async function brandsCommand(p: string[], v: Flags) {
  const [sub, a, b] = p;
  if (!sub) {
    for (const br of listBrands()) {
      const info = await logoInfo(br.id);
      const logo = info ? `${info.width}x${info.height}px${info.background !== "transparent" ? `, ${info.background} bg` : ""}` : "NO LOGO";
      log(`${br.id.padEnd(16)} ${br.name}  [${logo}${br.logoScale !== 1 ? `, scale ${br.logoScale}` : ""}]\n${" ".repeat(17)}${br.collections.join(", ") || "(no collections)"}`);
    }
    return;
  }
  if (sub === "add") {
    if (!a) die('usage: signsnip brands add "Name" [--logo file] [--collections "A,B"]');
    // addBrand reads the logo before writing anything, so a bad file leaves every brand as it was
    const logo = typeof v.logo === "string" ? readFile(v.logo) : undefined;
    const br = await addBrand({ name: a, collections: typeof v.collections === "string" ? list(v.collections) : undefined }, logo)
      .catch((e: Error) => die(`${e.message} - nothing changed${typeof v.logo === "string" ? ` (${v.logo})` : ""}`));
    return log(`${br.created ? "added" : "updated"} brand ${br.id}${logo ? " with logo" : ""}`);
  }
  const USAGE: Record<string, string> = {
    logo: "signsnip brands logo <brand> <file>", collections: 'signsnip brands collections <brand> "A,B,C"', scale: "signsnip brands scale <brand> <0.5-1.6>",
    "fix-bg": "signsnip brands fix-bg <brand>", restore: "signsnip brands restore <brand>", rm: "signsnip brands rm <brand>",
  };
  const usage = USAGE[sub] ?? die(`unknown brands subcommand "${sub}"`);
  const br = pick(brandMatches(a ?? ""), a, "brand", usage, "signsnip brands");
  if (sub === "logo") {
    if (!b) die(`usage: ${usage}`);
    const { aspect } = await saveLogo(br.id, readFile(b));
    return log(`logo set for ${br.id} (aspect ${aspect.toFixed(2)})`);
  }
  if (sub === "collections") {
    if (b === undefined) die(`usage: ${usage}`);
    upsertBrand({ id: br.id, name: br.name, collections: list(b) });
    return log("collections updated");
  }
  if (sub === "scale") {
    const k = Number(b);
    if (!(k >= 0.5 && k <= 1.6)) die(`usage: ${usage}`);
    const info = await logoInfo(br.id);
    const max = info ? maxLogoScale(info.aspect) : 1.6;
    const use = Math.min(Math.round(k * 100) / 100, max);
    upsertBrand({ id: br.id, name: br.name, logoScale: use });
    return log(`${br.id} logo scale = ${use}${use < k ? ` (capped: this logo's shape maxes out at ${max})` : ""}`);
  }
  if (sub === "fix-bg") {
    const info = await removeLogoBackground(br.id);
    return log(`background removed for ${br.id} (now ${info.background}); undo with: signsnip brands restore ${br.id}`);
  }
  if (sub === "restore") { await restoreLogo(br.id); return log(`restored original logo for ${br.id}`); }
  if (sub === "rm") { deleteBrand(br.id); return log(`removed ${br.id}`); }
  return die(`unknown brands subcommand "${sub}"`); // unreachable: USAGE covers every subcommand above
}
