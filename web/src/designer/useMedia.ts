import { useEffect, useState } from "react";

/** true while the media query matches (follows window resizes, rotation, pointer changes) */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const update = () => setOn(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return on;
}
