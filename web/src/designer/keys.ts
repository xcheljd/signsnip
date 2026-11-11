/** What the key handler needs to know about where the key was pressed (kept DOM-free so it can be tested). */
export interface KeyTarget {
  tag: string;                 // upper-case tag name
  role: string | null;
  editable: boolean;           // isContentEditable
  inOverlay: boolean;          // inside #overlays, or inside any [role=dialog|alertdialog|menu|listbox]
  overlayOpen: boolean;        // any dialog/menu/listbox is currently open on the page
}

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
// New Base UI widget kinds used in the inspector need their role added here.
const WIDGET_ROLES = new Set(["slider", "spinbutton", "combobox", "listbox", "option", "menu", "menuitem", "menuitemradio", "menuitemcheckbox", "tab", "switch", "radio", "checkbox", "textbox"]);

/** typing or operating a control: the designer must not treat the key as a canvas shortcut */
export function controlHasKey(t: KeyTarget): boolean {
  return t.editable || FIELD_TAGS.has(t.tag) || (t.role !== null && WIDGET_ROLES.has(t.role)) || t.inOverlay || t.overlayOpen;
}

/** Delete/Backspace on a focused button or link would be a surprise deletion */
export function destructiveAllowed(t: KeyTarget): boolean {
  return !controlHasKey(t) && t.tag !== "BUTTON" && t.tag !== "A";
}

// Base UI removes a closed popup from the DOM (checked in a browser), so these roles only match open ones.
const POPUPS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export function describeTarget(el: HTMLElement): KeyTarget {
  return {
    tag: el.tagName.toUpperCase(), role: el.getAttribute("role"), editable: el.isContentEditable,
    inOverlay: !!el.closest(`#overlays, ${POPUPS}`),
    overlayOpen: !!document.querySelector(POPUPS),
  };
}
