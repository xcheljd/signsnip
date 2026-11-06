import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";
import { applyTheme, storedTheme } from "./theme";

applyTheme(storedTheme()); // before first paint: no light flash in dark mode

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <App />
  </TooltipProvider>,
);
