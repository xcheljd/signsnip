import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <App />
    <Toaster position="bottom-center" />
  </TooltipProvider>,
);
