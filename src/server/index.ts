import "../core/node.js";
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { API_PORT, ROOT } from "../core/paths.js";
import { checkSigns, expandCopies, renderCalibration, renderPdf } from "../core/pdf.js";
import {
  deleteBrand, deleteSavedBatch, findBrand, listBrands, listPresets, listSavedBatches, logoInfo,
  readBackground, saveBackground, readBatch, readLogo, removeLogoBackground, restoreLogo, saveLogo, saveNamedBatch, savePresets, upsertBrand, writeBatch,
  readRules, writeRules,
  deleteTemplate, duplicateTemplate, exportTemplateSet, importTemplateSet, inspectTemplateSet, listTemplates, parseTemplateSet, resetTemplate, saveTemplate,
} from "../core/store.js";
import { seedSamples } from "../core/node.js";
import { exportWorkspace, parseWorkspace, restoreWorkspace, startFromScratch, startWithSamples, summarizeWorkspace } from "../core/workspace.js";
import { BatchSchema, OptionsSchema, PaperSchema, PresetSchema, RulesSchema, SignSchema, TemplateSchema } from "../core/types.js";

const app = new Hono();

app.onError((err, c) => c.json({ error: err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : err.message }, 400));

app.get("/api/state", async (c) => {
  const brands = await Promise.all(listBrands().map(async (b) => ({ ...b, logo: await logoInfo(b.id) })));
  const saved = listSavedBatches().map((s) => ({ id: s.id, name: s.name, savedAt: s.savedAt, signs: s.batch.items.reduce((a, i) => a + i.copies, 0) }));
  return c.json({ brands, presets: listPresets(), batch: readBatch(), saved, templates: listTemplates(), rules: readRules() });
});
app.put("/api/rules", async (c) => c.json(writeRules(RulesSchema.parse(await c.req.json()))));

// templates
app.put("/api/templates/:id", async (c) => {
  const t = TemplateSchema.parse(await c.req.json());
  if (t.id !== c.req.param("id")) throw new Error("Template id doesn't match the URL");
  return c.json(saveTemplate(t));
});
app.post("/api/templates/:id/duplicate", async (c) => {
  const { name } = z.object({ name: z.string().max(60).optional() }).parse(await c.req.json().catch(() => ({})));
  return c.json(duplicateTemplate(c.req.param("id"), name));
});
app.post("/api/templates/:id/reset", (c) => c.json(resetTemplate(c.req.param("id"))));
app.delete("/api/templates/:id", (c) => { deleteTemplate(c.req.param("id")); return c.json({ ok: true }); });
app.get("/api/templates/export", (c) => {
  const ids = (c.req.query("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const name = c.req.query("name") || undefined;
  const set = exportTemplateSet(ids, name);
  const file = (name ?? "sign-templates").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sign-templates";
  return new Response(JSON.stringify(set, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${file}.signsnip.json"` },
  });
});
/** Look inside a set before importing: which templates are new, identical, or would clash. */
app.post("/api/templates/inspect", async (c) => c.json(inspectTemplateSet(parseTemplateSet(await c.req.json()))));
app.post("/api/templates/import", async (c) => {
  const body = z.object({ set: z.unknown(), mode: z.enum(["keep-both", "replace"]).default("keep-both"), only: z.array(z.string()).optional() }).parse(await c.req.json());
  return c.json(importTemplateSet(parseTemplateSet(body.set), body.mode, body.only));
});

app.post("/api/check", async (c) => {
  const { items } = z.object({ items: z.array(SignSchema) }).parse(await c.req.json());
  return c.json(await checkSigns(items));
});

app.get("/api/calibration", async (c) => {
  const paper = PaperSchema.parse(c.req.query("paper") ?? "letter");
  return new Response(Buffer.from(await renderCalibration(paper)), {
    headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="printer-check.pdf"' },
  });
});

// whole-workspace backup / restore
app.get("/api/workspace", () => new Response(JSON.stringify(exportWorkspace()), {
  headers: { "content-type": "application/json", "content-disposition": `attachment; filename="signsnip-backup-${new Date().toISOString().slice(0, 10)}.signsnip-backup.json"` },
}));
app.post("/api/workspace/inspect", async (c) => c.json(summarizeWorkspace(parseWorkspace(await c.req.json()))));
app.post("/api/workspace/restore", async (c) => c.json(restoreWorkspace(await c.req.json())));
app.post("/api/workspace/start", async (c) => {
  const { from } = z.object({ from: z.enum(["scratch", "samples"]) }).parse(await c.req.json());
  if (from === "scratch") startFromScratch(); else startWithSamples(seedSamples());
  return c.json({ ok: true });
});

// saved batches
app.post("/api/batches", async (c) => {
  const { name, batch } = z.object({ name: z.string().min(1).max(60), batch: BatchSchema }).parse(await c.req.json());
  return c.json(saveNamedBatch(name, batch));
});
app.get("/api/batches/:id", (c) => {
  const b = listSavedBatches().find((x) => x.id === c.req.param("id"));
  return b ? c.json(b) : c.json({ error: "not found" }, 404);
});
app.delete("/api/batches/:id", (c) => { deleteSavedBatch(c.req.param("id")); return c.json({ ok: true }); });

app.put("/api/batch", async (c) => c.json(writeBatch(BatchSchema.parse(await c.req.json()))));

app.post("/api/brands", async (c) => {
  const body = z.object({
    id: z.string().optional(), name: z.string().min(1), collections: z.array(z.string()).optional(),
    logoScale: z.number().min(0.5).max(1.6).optional(),
  }).parse(await c.req.json());
  return c.json(upsertBrand(body));
});
app.delete("/api/brands/:id", (c) => { deleteBrand(c.req.param("id")); return c.json({ ok: true }); });
app.post("/api/brands/:id/logo", async (c) => {
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (!buf.length) throw new Error("Empty upload");
  const id = c.req.param("id");
  if (!findBrand(id)) throw new Error(`Unknown brand "${id}"`);
  return c.json(await saveLogo(id, buf));
});
app.post("/api/brands/:id/logo/remove-bg", async (c) => c.json(await removeLogoBackground(c.req.param("id"))));
app.post("/api/brands/:id/logo/restore", async (c) => { await restoreLogo(c.req.param("id")); return c.json({ ok: true }); });
app.get("/api/logos/:id", (c) => {
  const buf = readLogo(c.req.param("id").replace(/\.png$/, ""));
  if (!buf) return c.notFound();
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
});

app.post("/api/backgrounds", async (c) => {
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (!buf.length) throw new Error("Empty upload");
  return c.json(await saveBackground(buf));
});
app.get("/api/backgrounds/:id", (c) => {
  const buf = readBackground(c.req.param("id"));
  if (!buf) return c.notFound();
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  return new Response(new Uint8Array(buf), { headers: { "content-type": jpeg ? "image/jpeg" : "image/png", "cache-control": "max-age=31536000, immutable" } });
});

app.post("/api/presets", async (c) => {
  const p = PresetSchema.parse(await c.req.json());
  const all = listPresets().filter((x) => x.id !== p.id);
  savePresets([...all, p]);
  return c.json(p);
});
app.delete("/api/presets/:id", (c) => { savePresets(listPresets().filter((x) => x.id !== c.req.param("id"))); return c.json({ ok: true }); });

/** Live preview + export. `single` = one sign at true size; `sheet` = full print layout. */
app.post("/api/pdf", async (c) => {
  const body = z.object({
    items: z.array(SignSchema), options: OptionsSchema.default(OptionsSchema.parse({})),
    mode: z.enum(["sheet", "single"]).default("sheet"), download: z.boolean().optional(),
    /** unsaved templates from the designer, used instead of the saved ones with the same id */
    templates: z.array(TemplateSchema).optional(),
  }).parse(await c.req.json());
  const signs = body.mode === "single" ? body.items.slice(0, 1) : expandCopies(body.items);
  const pdf = await renderPdf(signs, body.options, body.mode, body.templates);
  return new Response(Buffer.from(pdf.bytes), {
    headers: {
      "content-type": "application/pdf",
      "x-pages": String(pdf.pages), "x-signs": String(pdf.signs),
      "content-disposition": `${body.download ? "attachment" : "inline"}; filename="signs.pdf"`,
    },
  });
});

// Production: serve the built UI
const dist = path.join(ROOT, "web/dist");
if (fs.existsSync(dist)) {
  app.get("*", (c) => {
    const rel = c.req.path === "/" ? "index.html" : c.req.path.slice(1);
    const file = path.join(dist, rel);
    const ok = file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile();
    const target = ok ? file : path.join(dist, "index.html");
    const ext = path.extname(target);
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
    return new Response(new Uint8Array(fs.readFileSync(target)), { headers: { "content-type": types[ext] ?? "application/octet-stream" } });
  });
}

serve({ fetch: app.fetch, port: API_PORT, hostname: "127.0.0.1" }, () =>
  console.log(`SignSnip API on http://127.0.0.1:${API_PORT}${fs.existsSync(dist) ? " (serving built UI)" : ""}`));
