import { useState } from "react";
import type { Brand } from "../../src/core/types";
import * as api from "./api";

export function BrandsTab({ brands, refresh, say, logoVer }: { brands: Brand[]; refresh: () => Promise<void>; say: (m: string) => void; logoVer: number }) {
  const [newName, setNewName] = useState("");
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); await refresh(); if (ok) say(ok); } catch (e) { say((e as Error).message); }
  };
  return (
    <main className="brands">
      <section className="card">
        <h2>Add a brand</h2>
        <div className="row">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Brand name" onKeyDown={(e) => e.key === "Enter" && newName.trim() && run(async () => { await api.saveBrand({ name: newName.trim() }); setNewName(""); }, "Brand added")} />
          <button className="primary" disabled={!newName.trim()} onClick={() => run(async () => { await api.saveBrand({ name: newName.trim() }); setNewName(""); }, "Brand added")}>Add</button>
        </div>
        <p className="muted">Then drop a logo (PNG, JPG, WebP or SVG) on its card. Empty margins are trimmed automatically and the logo is scaled to fit the sign.</p>
      </section>
      <div className="brand-grid">
        {brands.map((b) => <BrandCard key={b.id} b={b} run={run} logoVer={logoVer} />)}
      </div>
    </main>
  );
}

function BrandCard({ b, run, logoVer }: { b: Brand; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; logoVer: number }) {
  const [name, setName] = useState(b.name);
  const [cols, setCols] = useState(b.collections.join("\n"));
  const [over, setOver] = useState(false);
  const upload = (f?: File) => f && run(() => api.uploadLogo(b.id, f), "Logo updated");
  const dirty = name !== b.name || cols !== b.collections.join("\n");
  return (
    <section className="card brand">
      <label
        className={`drop ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}
      >
        {b.hasLogo ? <img src={`/api/logos/${b.id}?v=${logoVer}`} alt={`${b.name} logo`} /> : <span>Drop a logo here<br />or click to choose</span>}
        <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Collections <span className="muted">(one per line)</span>
        <textarea rows={5} value={cols} onChange={(e) => setCols(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" disabled={!dirty} onClick={() => run(() => api.saveBrand({ id: b.id, name, collections: cols.split("\n").map((s) => s.trim()).filter(Boolean) }), "Saved")}>Save</button>
        <button className="danger" onClick={() => confirm(`Delete ${b.name}?`) && run(() => api.removeBrand(b.id), "Brand removed")}>Delete</button>
      </div>
    </section>
  );
}
