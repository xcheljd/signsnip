import { z } from "zod";

/** Physical sign size (the paper cut-out that slides into the holder). */
export const SIGN_W_MM = 47;
export const SIGN_H_MM = 70;

export const SignKindSchema = z.enum(["percent", "price"]);
export type SignKind = z.infer<typeof SignKindSchema>;

/** Plain object (no refinements) so it can be .omit()-ed for presets. */
export const SignBaseSchema = z.object({
  id: z.string().min(1),
  brandId: z.string().min(1),
  /** "percent" = "50% OFF*"; "price" = "$199" (optionally with a struck-through was-price). */
  kind: SignKindSchema.default("percent"),
  /** Layout template; falls back to the built-in template for `kind` ("percent" / "price"). */
  templateId: z.string().max(40).optional(),
  /** Small lead word above the collection, e.g. "SELECT". Empty string = none. */
  prefix: z.string().max(24).default("SELECT"),
  /** Collection / line name, e.g. "HARBOR LINE" or the generic "MODELS". */
  collection: z.string().max(60).default("MODELS"),
  percent: z.number().int().min(1).max(99).default(50),
  /** Text after the percent number, e.g. "OFF*". */
  offLabel: z.string().max(20).default("OFF*"),
  /** Sale price in dollars (price signs). */
  price: z.number().positive().max(999_999).optional(),
  /** Optional original price, printed struck through ("WAS $395"). */
  wasPrice: z.number().positive().max(999_999).optional(),
  /** Small line above the price, e.g. "NOW", "ONLY", "STARTING AT". */
  priceLabel: z.string().max(24).default(""),
  footer: z.string().max(40).default("*MSRP"),
  copies: z.number().int().min(1).max(200).default(1),
});

export const SignSchema = SignBaseSchema.superRefine((s, ctx) => {
  if (s.kind === "price" && !(s.price && s.price > 0)) {
    ctx.addIssue({ code: "custom", path: ["price"], message: "price signs need a price" });
  }
});
export type Sign = z.infer<typeof SignBaseSchema>;

// ---------- templates (the editable layout of a sign)

/** What a text object prints. "heading" = lead word + collection stacked as one block. */
export const TEXT_FIELDS = ["heading", "prefix", "collection", "offer", "label", "was", "footer", "static"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
const mmX = z.number().min(-10).max(SIGN_W_MM + 10);
const mmY = z.number().min(-10).max(SIGN_H_MM + 10);

export const TextObjectSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.literal("text"),
  field: z.enum(TEXT_FIELDS),
  /** fixed wording for field="static" (e.g. "FINAL SALE") */
  text: z.string().max(80).default(""),
  x: mmX, y: mmY,
  w: z.number().min(1).max(SIGN_W_MM + 10),
  h: z.number().min(1).max(SIGN_H_MM + 10),
  /** font size in pt: the size it uses when the text fits; it shrinks (down to minSize) when it doesn't */
  size: z.number().min(4).max(120),
  minSize: z.number().min(3).max(120).default(7),
  weight: z.enum(["bold", "regular"]).default("bold"),
  align: z.enum(["left", "center", "right"]).default("center"),
  vAlign: z.enum(["top", "middle", "bottom"]).default("middle"),
  maxLines: z.number().int().min(1).max(5).default(1),
  uppercase: z.boolean().default(true),
  strike: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
});
export const LogoObjectSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.literal("logo"),
  x: mmX, y: mmY,
  w: z.number().min(2).max(SIGN_W_MM + 10),
  h: z.number().min(2).max(SIGN_H_MM + 10),
});
export const TemplateObjectSchema = z.discriminatedUnion("type", [TextObjectSchema, LogoObjectSchema]);
export type TextObject = z.infer<typeof TextObjectSchema>;
export type LogoObject = z.infer<typeof LogoObjectSchema>;
export type TemplateObject = z.infer<typeof TemplateObjectSchema>;

export const TemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(40),
  name: z.string().min(1).max(60),
  /** which offer the template prints: a percent ("50% OFF*") or a price ("$199") */
  kind: SignKindSchema,
  /** keep objects this far (mm) from the paper edge; the holder's lip covers it */
  safeMargin: z.number().min(0).max(10).default(2),
  objects: z.array(TemplateObjectSchema).max(40),
  updatedAt: z.string().optional(),
});
export type Template = z.infer<typeof TemplateSchema>;

/** A shareable file of templates ("sets I'm happy with"). */
export const TemplateSetSchema = z.object({
  format: z.literal("sign-o-matic/template-set"),
  version: z.literal(1),
  name: z.string().max(80).optional(),
  exportedAt: z.string(),
  templates: z.array(TemplateSchema).min(1).max(200),
});
export type TemplateSet = z.infer<typeof TemplateSetSchema>;

export const GridSchema = z.enum(["landscape-5x2", "portrait-4x3"]);
export const PaperSchema = z.enum(["letter", "a4"]);
export type Grid = z.infer<typeof GridSchema>;
export type Paper = z.infer<typeof PaperSchema>;
export const OptionsSchema = z.object({
  grid: GridSchema.default("landscape-5x2"),
  paper: PaperSchema.default("letter"),
  cutMarks: z.boolean().default(true),
});
export type Options = z.infer<typeof OptionsSchema>;
export const DEFAULT_OPTIONS: Options = { grid: "landscape-5x2", paper: "letter", cutMarks: true };

export const BrandSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  collections: z.array(z.string().min(1).max(60)).default([]),
  /** Multiplier on the auto-fitted logo size (0.5 to 1.6). Lets tall/stacked logos grow. */
  logoScale: z.number().min(0.5).max(1.6).default(1),
  hasLogo: z.boolean().default(false),
});
export type Brand = z.infer<typeof BrandSchema>;

export const PresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  sign: SignBaseSchema.omit({ id: true, copies: true }),
});
export type Preset = z.infer<typeof PresetSchema>;

export const BatchSchema = z.object({
  items: z.array(SignSchema).max(500),
  options: OptionsSchema.default(DEFAULT_OPTIONS),
});
export type Batch = z.infer<typeof BatchSchema>;

export const SavedBatchSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  savedAt: z.string(),
  batch: BatchSchema,
});
export type SavedBatch = z.infer<typeof SavedBatchSchema>;

export interface Warning {
  /** indexes into batch.items this applies to */
  items: number[];
  brandId: string;
  level: "warn" | "info";
  code: "low-res-logo" | "logo-background" | "small-text" | "no-logo";
  message: string;
}

export const PERCENT_CHOICES = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80];
