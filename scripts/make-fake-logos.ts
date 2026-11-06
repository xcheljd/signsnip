/**
 * Generates the FAKE sample brands + logos in ./seed (and fixtures in tests/fixtures).
 * Everything here is invented. No real brand names, marks, or colours.
 *   pnpm seed:logos
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SIGNO_DATA = path.join(root, "seed"); // write straight into the seed dir
fs.rmSync(path.join(root, "seed"), { recursive: true, force: true });
fs.mkdirSync(path.join(root, "seed"), { recursive: true });
const { upsertBrand, saveLogo, savePresets } = await import("../src/core/store.js");

const svg = (w: number, h: number, body: string, bg = "none") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    (bg === "none" ? "" : `<rect width="100%" height="100%" fill="${bg}"/>`) + body + `</svg>`);

const serif = "DejaVu Serif, Georgia, serif";
const sans = "DejaVu Sans, Helvetica, Arial, sans-serif";

const logos: Record<string, { name: string; collections: string[]; img: Buffer; asJpg?: boolean }> = {
  northwind: {
    name: "Northwind Watch Co.",
    collections: ["Harbor Line", "Deckhand", "Lighthouse", "Seabird Chrono"],
    // wide wordmark, transparent bg
    img: svg(1400, 220, `<text x="700" y="120" font-family="${serif}" font-weight="700" font-size="124" letter-spacing="14" text-anchor="middle" fill="#14274e">NORTHWIND</text>
      <line x1="140" y1="168" x2="1260" y2="168" stroke="#14274e" stroke-width="4"/>
      <text x="700" y="208" font-family="${sans}" font-size="30" letter-spacing="22" text-anchor="middle" fill="#14274e">WATCH CO.</text>`),
  },
  "kestrel-vale": {
    name: "Kestrel & Vale",
    collections: ["Falcon", "Moorland", "Ridgeback", "Field Master Automatic"],
    // emblem + text, medium aspect
    img: svg(1100, 330, `<circle cx="165" cy="165" r="150" fill="none" stroke="#1f5b3f" stroke-width="14"/>
      <path d="M70 195 L165 85 L260 195 L215 180 L165 235 L115 180 Z" fill="#1f5b3f"/>
      <text x="360" y="150" font-family="${sans}" font-weight="700" font-size="104" fill="#1f5b3f">KESTREL</text>
      <text x="364" y="275" font-family="${sans}" font-size="92" letter-spacing="6" fill="#1f5b3f">&amp; VALE</text>`),
  },
  tidemark: {
    name: "tidemark",
    collections: ["Tidepool", "Reef Diver", "Driftwood", "Low Tide"],
    img: svg(1300, 220, `<path d="M20 120 q60 -80 120 0 t120 0 t120 0" fill="none" stroke="#0e8a8a" stroke-width="22" stroke-linecap="round"/>
      <path d="M20 175 q60 -80 120 0 t120 0 t120 0" fill="none" stroke="#0e8a8a" stroke-width="22" stroke-linecap="round" opacity=".5"/>
      <text x="430" y="160" font-family="${sans}" font-weight="700" font-size="170" fill="#0e8a8a">tidemark</text>`),
  },
  orbital: {
    name: "ORBITAL",
    collections: ["Comet", "Nebula", "Perihelion", "Deep Field Chronograph"],
    asJpg: true, // JPG with a big white margin: exercises trim + format conversion
    img: svg(1600, 500, `<circle cx="260" cy="250" r="95" fill="none" stroke="#e8590c" stroke-width="16"/>
      <ellipse cx="260" cy="250" rx="170" ry="48" fill="none" stroke="#e8590c" stroke-width="9" transform="rotate(-24 260 250)"/>
      <text x="470" y="298" font-family="${sans}" font-weight="300" font-size="150" letter-spacing="26" fill="#222">ORBITAL</text>`, "#ffffff"),
  },
  "lumen-atelier": {
    name: "Lumen Atelier",
    collections: ["Dusk", "Ember", "Lantern"],
    // tall / stacked: must scale by HEIGHT, not width
    img: svg(520, 640, `<circle cx="260" cy="190" r="170" fill="#5b2a86"/>
      <text x="260" y="262" font-family="${serif}" font-weight="700" font-size="230" text-anchor="middle" fill="#fff">L</text>
      <text x="260" y="470" font-family="${serif}" font-weight="700" font-size="74" letter-spacing="10" text-anchor="middle" fill="#5b2a86">LUMEN</text>
      <text x="260" y="560" font-family="${sans}" font-size="44" letter-spacing="26" text-anchor="middle" fill="#5b2a86">ATELIER</text>`),
  },
};

fs.mkdirSync(path.join(root, "tests/fixtures"), { recursive: true });
for (const [id, b] of Object.entries(logos)) {
  upsertBrand({ id, name: b.name, collections: b.collections });
  const raw = b.asJpg ? await sharp(b.img).flatten({ background: "#fff" }).jpeg({ quality: 88 }).toBuffer() : await sharp(b.img).png().toBuffer();
  fs.writeFileSync(path.join(root, "tests/fixtures", `${id}.${b.asJpg ? "jpg" : "png"}`), raw);
  const { aspect } = await saveLogo(id, raw);
  console.log(`${id.padEnd(14)} aspect ${aspect.toFixed(2)}`);
}

savePresets([
  { id: "sale-50", name: "Select models 50%", sign: { brandId: "northwind", kind: "percent", prefix: "SELECT", collection: "MODELS", percent: 50, offLabel: "OFF*", priceLabel: "", footer: "*MSRP" } },
  { id: "tidal-40", name: "Tidepool 40%", sign: { brandId: "tidemark", kind: "percent", prefix: "SELECT", collection: "TIDEPOOL", percent: 40, offLabel: "OFF*", priceLabel: "", footer: "*MSRP" } },
  { id: "orbital-60", name: "Comet 60%", sign: { brandId: "orbital", kind: "percent", prefix: "SELECT", collection: "COMET", percent: 60, offLabel: "OFF*", priceLabel: "", footer: "*MSRP" } },
  { id: "falcon-199", name: "Falcon $199", sign: { brandId: "kestrel-vale", kind: "price", prefix: "", collection: "FALCON", percent: 50, offLabel: "OFF*", price: 199, wasPrice: 395, priceLabel: "NOW", footer: "" } },
]);
console.log("seed written");
