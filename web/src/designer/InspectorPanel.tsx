import type { Template, TemplateObject } from "../../../src/core/types";
import { ObjectInspector, TemplateInspector } from "./Inspector";

export function Inspector({
  template, selected, onTemplate, onObject, onPick, onDelete, onDuplicate,
}: {
  template: Template; selected: TemplateObject | null;
  onTemplate: (p: Partial<Template>) => void; onObject: (p: Partial<TemplateObject>) => void;
  onPick: (id: string) => void; onDelete: () => void; onDuplicate: () => void;
}) {
  if (selected) return <ObjectInspector key={selected.id} o={selected} set={onObject} onDelete={onDelete} onDuplicate={onDuplicate} />;
  return <TemplateInspector t={template} set={onTemplate} objects={template.objects} onPick={onPick} />;
}
