import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pins WCAG contrast for the Nord theme tokens in web/src/styles.css, in both themes.
 * Text >= 4.5:1 (AA), control edges / focus ring >= 3:1 (WCAG 1.4.11).
 * The live axe sweep (see AGENTS.md) checks real rendered pairs; this keeps the tokens honest.
 */
const css = fs.readFileSync(path.resolve(__dirname, "../web/src/styles.css"), "utf8");
const block = (sel: string) => {
  const m = new RegExp(`(^|\\n)${sel.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  if (!m) throw new Error(`no ${sel} block`);
  return Object.fromEntries([...m[2]!.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1]!, x[2]!.trim()]));
};
const root = block(":root");
const dark = { ...root, ...block(".dark") };
const resolve = (vars: Record<string, string>, name: string, depth = 0): string => {
  const v = vars[name];
  if (!v) throw new Error(`--${name} missing`);
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref) { if (depth > 5) throw new Error("var loop"); return resolve(vars, ref[1]!, depth + 1); }
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`--${name} is not a hex colour: ${v}`);
  return v;
};
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
/** `fg` at `alpha` over `bg` (how bg-destructive/10 etc. composite) */
const tint = (fg: string, bg: string, alpha: number) =>
  "#" + rgb(fg).map((c, i) => Math.round((c * alpha + rgb(bg)[i]! * (1 - alpha)) * 255).toString(16).padStart(2, "0")).join("");

for (const [theme, vars] of [["light", root], ["dark", dark]] as const) {
  const c = (n: string) => resolve(vars, n);
  const surfaces = ["background", "card", "popover"];
  describe(`${theme} theme contrast`, () => {
    it("body and muted text >= 4.5:1 on every surface", () => {
      for (const s of [...surfaces, "muted", "secondary"]) {
        expect(ratio(c("foreground"), c(s)), `foreground on ${s}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c("muted-foreground"), c(s)), `muted-foreground on ${s}`).toBeGreaterThanOrEqual(4.5);
      }
      // hierarchy: muted text must still look quieter than body text
      expect(ratio(c("foreground"), c("muted-foreground"))).toBeGreaterThan(1.25);
    });
    it("filled pairs (button, selected toggle, badge) >= 4.5:1", () => {
      for (const [fg, bg] of [["primary-foreground", "primary"], ["accent-foreground", "accent"], ["secondary-foreground", "secondary"], ["card-foreground", "card"], ["popover-foreground", "popover"]]) {
        expect(ratio(c(fg!), c(bg!)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it("destructive text >= 4.5:1 on surfaces and on its own 10% tint", () => {
      for (const s of surfaces) {
        expect(ratio(c("destructive"), c(s)), `destructive on ${s}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c("destructive"), tint(c("destructive"), c(s), 0.1)), `destructive on destructive/10 over ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it("primary used as text (links, icons in ghost buttons) >= 4.5:1 on cards", () => {
      for (const s of surfaces) expect(ratio(c("primary"), c(s)), `primary on ${s}`).toBeGreaterThanOrEqual(4.5);
    });
    it("control edges and focus ring >= 3:1 (inputs, selects, checkboxes are findable)", () => {
      for (const s of surfaces) {
        expect(ratio(c("input"), c(s)), `input edge on ${s}`).toBeGreaterThanOrEqual(3);
        expect(ratio(c("ring"), c(s)), `focus ring on ${s}`).toBeGreaterThanOrEqual(3);
      }
    });
    it("warning icons >= 3:1", () => {
      for (const s of surfaces) expect(ratio(c("warning"), c(s)), `warning on ${s}`).toBeGreaterThanOrEqual(3);
    });
  });
}
