import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Where popups (menus, selects, autocomplete lists, tooltips) mount: a node inside <main>,
 * so they sit in a landmark for screen readers (axe "region"). Falls back to <body>.
 */
export const overlayRoot = (): HTMLElement | undefined =>
  (typeof document !== "undefined" && document.getElementById("overlays")) || undefined;
