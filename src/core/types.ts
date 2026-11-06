import { z } from "zod";

/** Physical sign size (the paper cut-out that slides into the holder). */
export const SIGN_W_MM = 47;
export const SIGN_H_MM = 70;

export const SignSchema = z.object({
  id: z.string().min(1),
  brandId: z.string().min(1),
  /** Small lead word above the collection, e.g. "SELECT". Empty string = none. */
  prefix: z.string().max(24).default("SELECT"),
  /** Collection / line name, e.g. "HARBOR LINE" or the generic "MODELS". */
  collection: z.string().max(60).default("MODELS"),
  percent: z.number().int().min(1).max(99),
  /** Text after the percent number, e.g. "OFF*". */
  offLabel: z.string().max(20).default("OFF*"),
  footer: z.string().max(40).default("*MSRP"),
  copies: z.number().int().min(1).max(200).default(1),
});
export type Sign = z.infer<typeof SignSchema>;

export const GridSchema = z.enum(["landscape-5x2", "portrait-4x3"]);
export const PaperSchema = z.enum(["letter", "a4"]);
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
  /** Defaults used when this brand is picked in the editor. */
  hasLogo: z.boolean().default(false),
});
export type Brand = z.infer<typeof BrandSchema>;

export const PresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  sign: SignSchema.omit({ id: true, copies: true }),
});
export type Preset = z.infer<typeof PresetSchema>;

export const BatchSchema = z.object({
  items: z.array(SignSchema).max(500),
  options: OptionsSchema.default(DEFAULT_OPTIONS),
});
export type Batch = z.infer<typeof BatchSchema>;

export const PERCENT_CHOICES = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80];
