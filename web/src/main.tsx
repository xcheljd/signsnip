import { createRoot } from "react-dom/client";
import { App } from "./App";
import * as api from "./api";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";
import { applyTheme, storedTheme } from "./theme";

applyTheme(storedTheme()); // before first paint: no light flash in dark mode

const root = createRoot(document.getElementById("root")!);
api.init().then(
  () => root.render(<TooltipProvider><App /></TooltipProvider>),
  (e: Error) => root.render(
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-lg font-semibold">Sign-O-Matic couldn't start</h1>
      <p className="mt-2 text-muted-foreground">{e.message}</p>
      <p className="mt-2 text-sm text-muted-foreground">This browser may block site storage (private windows often do). Try a normal window, or another browser.</p>
    </main>,
  ),
);
