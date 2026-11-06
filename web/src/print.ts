/**
 * Open the browser's print dialog for a PDF without downloading it. Uses a hidden iframe
 * (Chrome/Brave/Edge/Firefox all print PDFs from one); falls back to opening a new tab.
 */
export function printPdf(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/pdf" }));
  document.querySelectorAll("iframe[data-print-frame]").forEach((f) => f.remove());
  const frame = Object.assign(document.createElement("iframe"), { src: url, title: "print" });
  frame.dataset.printFrame = "1";
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0" });
  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, "_blank");
      }
    }, 150);
  };
  document.body.appendChild(frame);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}

export function downloadPdf(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
