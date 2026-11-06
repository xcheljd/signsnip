import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "signo.theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");
export const resolveTheme = (t: Theme) => (t === "system" ? (media().matches ? "dark" : "light") : t);
export function applyTheme(t: Theme) { document.documentElement.classList.toggle("dark", resolveTheme(t) === "dark"); }
export const storedTheme = (): Theme => (localStorage.getItem(KEY) as Theme) || "system";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [resolved, setResolved] = useState(() => resolveTheme(storedTheme()));
  useEffect(() => {
    localStorage.setItem(KEY, theme);
    const sync = () => { applyTheme(theme); setResolved(resolveTheme(theme)); };
    sync();
    const m = media(); m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, [theme]);
  return { theme, setTheme, resolved };
}
