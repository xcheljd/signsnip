import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Batch, Brand, Preset, Sign } from "../../src/core/types";
import * as api from "./api";
import { PdfView } from "./PdfView";
import { BrandsTab } from "./BrandsTab";

const PERCENTS = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80];
const uid = () => crypto.randomUUID();

const blank = (brandId: string): Sign => ({
  id: uid(), brandId, prefix: "SELECT", collection: "MODELS", percent: 50, offLabel: "OFF*", footer: "*MSRP", copies: 1,
});

function usePdf(items: Sign[], options: Batch["options"], mode: "sheet" | "single") {
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; pages: number; signs: number } | null>(null);
  const [err, setErr] = useState("");
  const key = JSON.stringify([items, options, mode]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.fetchPdf(items, options, mode).then((p) => { setPdf(p); setErr(""); }).catch((e) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { pdf, err };
}

export function App() {
  const [tab, setTab] = useState<"make" | "brands">("make");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [batch, setBatch] = useState<Batch>({ items: [], options: { grid: "landscape-5x2", paper: "letter", cutMarks: true } });
  const [draft, setDraft] = useState<Sign | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [logoVer, setLogoVer] = useState(0);
  const serverJson = useRef("");
  const loaded = useRef(false);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  const refresh = useCallback(async (initial = false) => {
    const s = await api.getState();
    setBrands(s.brands); setPresets(s.presets);
    const theirs = JSON.stringify(s.batch);
    // adopt CLI-side changes only when we have nothing unsaved
    if (initial || (theirs !== serverJson.current && JSON.stringify(batchRef.current) === serverJson.current)) {
      serverJson.current = theirs; setBatch(s.batch);
    }
    if (initial) { loaded.current = true; setDraft((d) => d ?? blank(s.brands[0]?.id ?? "")); }
  }, []);
  const batchRef = useRef(batch);
  batchRef.current = batch;

  useEffect(() => { refresh(true).catch((e) => say(e.message)); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => refresh().catch(() => {}), 2500);
    const onFocus = () => refresh().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  // autosave batch
  useEffect(() => {
    if (!loaded.current) return;
    const mine = JSON.stringify(batch);
    if (mine === serverJson.current) return;
    const t = setTimeout(() => {
      api.putBatch(batch).then(() => { serverJson.current = mine; }).catch((e) => say(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [batch]);

  const brand = brands.find((b) => b.id === draft?.brandId);
  const single = useMemo(() => (draft && brand ? [draft] : []), [draft, brand]);
  const singlePdf = usePdf(single, batch.options, "single");
  const sheetPdf = usePdf(batch.items, batch.options, "sheet");

  const set = (patch: Partial<Sign>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const addOrUpdate = () => {
    if (!draft) return;
    if (editing) {
      setBatch((b) => ({ ...b, items: b.items.map((i) => (i.id === editing ? { ...draft, id: editing } : i)) }));
      setEditing(null); say("Row updated");
    } else {
      setBatch((b) => ({ ...b, items: [...b.items, { ...draft, id: uid() }] })); say("Added to batch");
    }
  };
  const edit = (s: Sign) => { setEditing(s.id); setDraft({ ...s }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const patchItem = (id: string, patch: Partial<Sign>) => setBatch((b) => ({ ...b, items: b.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const totalSigns = batch.items.reduce((a, s) => a + s.copies, 0);

  const exportPdf = async () => {
    try {
      const p = await api.fetchPdf(batch.items, batch.options, "sheet", true);
      const url = URL.createObjectURL(new Blob([p.bytes.slice().buffer], { type: "application/pdf" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `signs-${new Date().toISOString().slice(0, 10)}.pdf` });
      a.click(); URL.revokeObjectURL(url);
      say(`Exported ${p.signs} signs on ${p.pages} page${p.pages === 1 ? "" : "s"}`);
    } catch (e) { say((e as Error).message); }
  };

  const savePreset = async () => {
    if (!draft) return;
    const name = prompt("Preset name?", `${draft.collection} ${draft.percent}%`);
    if (!name) return;
    const { id: _id, copies: _c, ...sign } = draft;
    await api.savePreset({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, sign });
    await refresh(); say("Preset saved");
  };

  return (
    <div className="app">
      <header>
        <h1><span aria-hidden>🪧</span> Sign-O-Matic</h1>
        <nav>
          <button className={tab === "make" ? "on" : ""} onClick={() => setTab("make")}>Make signs</button>
          <button className={tab === "brands" ? "on" : ""} onClick={() => setTab("brands")}>Brands &amp; logos</button>
        </nav>
        <span className="muted">47 × 70 mm · sample data only</span>
      </header>

      {tab === "brands" ? (
        <BrandsTab brands={brands} refresh={async () => { await refresh(); setLogoVer((v) => v + 1); }} say={say} logoVer={logoVer} />
      ) : (
        <main className="make">
          <section className="card editor">
            <h2>{editing ? "Editing a row" : "New sign"}</h2>
            {presets.length > 0 && (
              <div className="chips">
                <span className="muted">Presets</span>
                {presets.map((p) => (
                  <span key={p.id} className="chip-wrap">
                    <button className="chip" onClick={() => { setEditing(null); setDraft({ ...p.sign, id: uid(), copies: draft?.copies ?? 1 }); }}>{p.name}</button>
                    <button className="x" title="Delete preset" onClick={async () => { await api.removePreset(p.id); await refresh(); }}>×</button>
                  </span>
                ))}
              </div>
            )}
            {draft && (
              <div className="form">
                <label>Brand
                  <select value={draft.brandId} onChange={(e) => set({ brandId: e.target.value })}>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>

                <label>Lead word
                  <div className="row">
                    <input value={draft.prefix} maxLength={24} onChange={(e) => set({ prefix: e.target.value })} placeholder="(none)" />
                    <button className="chip" onClick={() => set({ prefix: "SELECT" })}>SELECT</button>
                    <button className="chip" onClick={() => set({ prefix: "" })}>none</button>
                  </div>
                </label>

                <label>Collection
                  <input list="collections" value={draft.collection} maxLength={60} onChange={(e) => set({ collection: e.target.value })} />
                  <datalist id="collections">{(brand?.collections ?? []).map((c) => <option key={c} value={c} />)}</datalist>
                  <div className="chips">
                    <button className="chip" onClick={() => set({ collection: "MODELS" })}>MODELS</button>
                    {(brand?.collections ?? []).map((c) => <button className="chip" key={c} onClick={() => set({ collection: c })}>{c}</button>)}
                  </div>
                </label>

                <label>Percent off
                  <div className="chips">
                    {PERCENTS.map((p) => <button key={p} className={`chip ${draft.percent === p ? "sel" : ""}`} onClick={() => set({ percent: p })}>{p}%</button>)}
                    <input className="num" type="number" min={1} max={99} value={draft.percent} onChange={(e) => set({ percent: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
                  </div>
                </label>

                <div className="row two">
                  <label>After the number<input value={draft.offLabel} maxLength={20} onChange={(e) => set({ offLabel: e.target.value })} /></label>
                  <label>Footer<input value={draft.footer} maxLength={40} onChange={(e) => set({ footer: e.target.value })} /></label>
                  <label>Copies<input className="num" type="number" min={1} max={200} value={draft.copies} onChange={(e) => set({ copies: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} /></label>
                </div>

                <div className="row">
                  <button className="primary" onClick={addOrUpdate} disabled={!brand}>{editing ? "Update row" : "Add to batch"}</button>
                  {editing && <button onClick={() => { setEditing(null); setDraft(blank(draft.brandId)); }}>Cancel</button>}
                  <button onClick={savePreset}>Save as preset</button>
                </div>
              </div>
            )}
          </section>

          <section className="card preview">
            <h2>Live preview <span className="muted">actual size ratio</span></h2>
            <div className="single"><PdfView bytes={singlePdf.pdf?.bytes ?? null} width={282} label="sign preview" /></div>
            {singlePdf.err && <p className="err">{singlePdf.err}</p>}
          </section>

          <section className="card batch">
            <h2>Batch <span className="muted">{totalSigns} sign{totalSigns === 1 ? "" : "s"} · {sheetPdf.pdf?.pages ?? 0} page{sheetPdf.pdf?.pages === 1 ? "" : "s"}</span></h2>
            {batch.items.length === 0 ? <p className="muted">Nothing yet. Build a sign and hit “Add to batch”.</p> : (
              <table>
                <thead><tr><th>#</th><th>Brand</th><th>Sign</th><th>Qty</th><th></th></tr></thead>
                <tbody>
                  {batch.items.map((s, i) => (
                    <tr key={s.id} className={editing === s.id ? "hl" : ""}>
                      <td>{i + 1}</td>
                      <td><img className="thumb" src={`/api/logos/${s.brandId}?v=${logoVer}`} alt="" />{brands.find((b) => b.id === s.brandId)?.name}</td>
                      <td><span className="caps">{[s.prefix, s.collection].filter(Boolean).join(" ")}</span> · <b>{s.percent}%</b></td>
                      <td><input className="num sm" type="number" min={1} max={200} value={s.copies} onChange={(e) => patchItem(s.id, { copies: Math.max(1, Number(e.target.value) || 1) })} /></td>
                      <td className="acts">
                        <button onClick={() => edit(s)}>Edit</button>
                        <button onClick={() => setBatch((b) => ({ ...b, items: [...b.items.slice(0, i + 1), { ...s, id: uid() }, ...b.items.slice(i + 1)] }))}>Dup</button>
                        <button className="danger" onClick={() => setBatch((b) => ({ ...b, items: b.items.filter((x) => x.id !== s.id) }))}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="row opts">
              <label>Paper
                <select value={batch.options.paper} onChange={(e) => setBatch((b) => ({ ...b, options: { ...b.options, paper: e.target.value as "letter" | "a4" } }))}>
                  <option value="letter">Letter</option><option value="a4">A4</option>
                </select>
              </label>
              <label>Layout
                <select value={batch.options.grid} onChange={(e) => setBatch((b) => ({ ...b, options: { ...b.options, grid: e.target.value as Batch["options"]["grid"] } }))}>
                  <option value="landscape-5x2">Landscape · 5×2 (10/page)</option>
                  <option value="portrait-4x3">Portrait · 4×3 (12/page)</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={batch.options.cutMarks} onChange={(e) => setBatch((b) => ({ ...b, options: { ...b.options, cutMarks: e.target.checked } }))} /> Cut lines</label>
              <span className="grow" />
              <button onClick={() => setBatch((b) => ({ ...b, items: [] }))} disabled={!batch.items.length}>Clear</button>
              <button className="primary" onClick={exportPdf} disabled={!batch.items.length}>Export PDF</button>
            </div>
          </section>

          <section className="card sheet">
            <h2>Print sheet</h2>
            {batch.items.length ? <PdfView bytes={sheetPdf.pdf?.bytes ?? null} width="fill" label="print sheet" /> : <p className="muted">The sheet appears here.</p>}
            {sheetPdf.err && <p className="err">{sheetPdf.err}</p>}
          </section>
        </main>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
