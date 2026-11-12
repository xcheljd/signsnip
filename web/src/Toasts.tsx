import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";

/** Gap between the lowest toast and the print bar. */
const GAP = 8;

/**
 * How far the sticky print bar reaches up from the bottom of the window (0 = no bar on screen).
 * It is not always the bar's height: at the end of the page the bar stops above the page's bottom padding.
 * Re-measured on scroll, resize and whenever the bar or the page changes size (e.g. Update/Cancel while editing).
 */
function usePrintBarReach(active: boolean) {
  const [reach, setReach] = useState(0);
  useEffect(() => {
    if (!active) { setReach(0); return; }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bar = document.querySelector("[data-slot=print-bar]");
      const top = bar?.getBoundingClientRect().top;
      setReach(top !== undefined && top < window.innerHeight ? Math.ceil(window.innerHeight - top) : 0);
    };
    const queue = () => { frame ||= requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    const bar = document.querySelector("[data-slot=print-bar]");
    const sizes = new ResizeObserver(queue);
    if (bar) { sizes.observe(bar); if (bar.parentElement) sizes.observe(bar.parentElement); }
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", queue); window.removeEventListener("resize", queue); sizes.disconnect(); };
  }, [active]);
  return reach;
}

/**
 * Toasts sit bottom-centre, clear of the batch header and row actions on the right: just above the
 * print bar on Make signs, at the bottom elsewhere. Offsets set only the bottom; a plain number would
 * set all four sides and squeeze toasts on a phone.
 */
export function Toasts({ theme, aboveBar }: { theme: "light" | "dark"; aboveBar: boolean }) {
  const reach = usePrintBarReach(aboveBar);
  return (
    <Toaster
      position="bottom-center" theme={theme}
      offset={{ bottom: reach ? reach + GAP : 24 }}
      mobileOffset={{ bottom: reach ? reach + GAP : 16 }}
    />
  );
}
