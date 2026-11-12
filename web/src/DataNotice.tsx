import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * The damaged-data notice: a full-width alert at the top of every tab, in the page flow, so it never
 * covers a control. dataNotice.ts decides the text and when it goes; only Close takes it away.
 */
export function DataNotice({ text, onClose }: { text: string; onClose: () => void }) {
  if (!text) return null;
  return (
    // pr-20: the long text keeps a clear gap from Close (the default pr-18 left about 4 px)
    <Alert variant="destructive" data-notice="data-problems" className="has-data-[slot=alert-action]:pr-20">
      <TriangleAlertIcon />
      <AlertDescription>{text}</AlertDescription>
      <AlertAction><Button type="button" size="sm" variant="outline" onClick={onClose}>Close</Button></AlertAction>
    </Alert>
  );
}
