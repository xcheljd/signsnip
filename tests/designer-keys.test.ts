import { describe, expect, it } from "vitest";
import { controlHasKey, destructiveAllowed, type KeyTarget } from "../web/src/designer/keys";

const at = (p: Partial<KeyTarget>): KeyTarget => ({ tag: "DIV", role: null, editable: false, inOverlay: false, overlayOpen: false, ...p });

describe("designer shortcuts only when the canvas is in use", () => {
  it("the page body and the canvas take every shortcut", () => {
    for (const t of [at({ tag: "BODY" }), at({ tag: "SVG", role: "application" }), at({ tag: "DIV" })]) {
      expect(controlHasKey(t)).toBe(false);
      expect(destructiveAllowed(t)).toBe(true);
    }
  });
  it("text fields and editable text keep their keys", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) expect(controlHasKey(at({ tag }))).toBe(true);
    expect(controlHasKey(at({ editable: true }))).toBe(true);
  });
  it("widgets keep their keys", () => {
    for (const role of ["slider", "combobox", "option", "menuitem", "switch", "tab", "spinbutton", "checkbox"]) {
      expect(controlHasKey(at({ role }))).toBe(true);
      expect(destructiveAllowed(at({ role }))).toBe(false);
    }
  });
  it("anything inside a menu, list or dialog keeps its keys", () => {
    expect(controlHasKey(at({ tag: "DIV", role: "menu", inOverlay: true }))).toBe(true);
    expect(controlHasKey(at({ tag: "BUTTON", inOverlay: true }))).toBe(true);
  });
  it("while a menu, list or dialog is open, nothing goes to the canvas", () => {
    expect(controlHasKey(at({ tag: "BODY", overlayOpen: true }))).toBe(true);
    expect(destructiveAllowed(at({ tag: "BODY", overlayOpen: true }))).toBe(false);
  });
  it("a focused toolbar button still nudges, but never deletes", () => {
    expect(controlHasKey(at({ tag: "BUTTON" }))).toBe(false);
    expect(destructiveAllowed(at({ tag: "BUTTON" }))).toBe(false);
    expect(destructiveAllowed(at({ tag: "A" }))).toBe(false);
  });
});
