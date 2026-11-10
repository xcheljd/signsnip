import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MODE, backup as backup_, saveDownload } from "./api";

function Notice({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-3 p-8">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
      <div className="mt-2 flex flex-wrap gap-2">{action}</div>
    </main>
  );
}
const reload = () => location.reload();

/** A crash in any screen shows this instead of a blank page. Saved work is untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("SignSnip crashed:", error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Notice title="Something went wrong" action={<Button onClick={reload}>Reload SignSnip</Button>}>
        <p className="text-muted-foreground">Your brands, templates and signs are saved{MODE === "browser" ? " in this browser" : ""}. Reloading usually fixes this.</p>
        <p className="rounded-md border bg-muted p-3 font-mono text-sm break-words">{error.message || String(error)}</p>
      </Notice>
    );
  }
}

/** Hosted app only: once another tab saves something (or storage goes away), this tab's copy is out of date. */
export function OneTab({ children }: { children: ReactNode }) {
  const [stale, setStale] = useState<"changed" | "closed" | null>(null);
  const [backedUp, setBackedUp] = useState<string>("");
  useEffect(() => {
    if (MODE !== "browser") return;
    let off = () => {};
    // "closed" wins: once storage is gone, a later "changed" message doesn't make reloading safe
    void import("./local/idb-repo").then((m) => { off = m.onChangedElsewhere((why) => setStale((s) => (s === "closed" ? s : why))); });
    return () => off();
  }, []);
  if (!stale) return children;
  if (stale === "closed") {
    const backup = async () => {
      try { saveDownload(await backup_()); setBackedUp("Backup downloaded. After reloading, choose “Continue your work” and pick that file."); }
      catch (e) { setBackedUp(`Couldn't make the backup: ${(e as Error).message}`); }
    };
    return (
      <Notice title="This tab can't save any more" action={<><Button autoFocus onClick={backup}>Back up</Button><Button variant="outline" onClick={reload}>Reload this tab</Button></>}>
        <p className="text-muted-foreground">This browser's storage for SignSnip was cleared while this tab was open, so nothing you do here can be saved. Your work is still in this tab: back it up first, because reloading may start you from an empty SignSnip.</p>
        {backedUp && <p role="status" className="font-medium">{backedUp}</p>}
      </Notice>
    );
  }
  return (
    <Notice title="SignSnip changed in another tab" action={<Button autoFocus onClick={reload}>Reload this tab</Button>}>
      <p className="text-muted-foreground">SignSnip was changed in another tab, so what this tab shows is out of date. Reload it to see the changes. Working in one tab at a time keeps edits from overwriting each other.</p>
    </Notice>
  );
}
