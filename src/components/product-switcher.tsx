"use client";

import { useState } from "react";
import { Plus, ChevronDown, Package, Trash2, CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store";

// Pick or create the product you're working on. Everything in the working tabs
// attaches to this active product, so one product flows through the whole pipeline.
// Filed products live on the dashboard and are hidden from this in-process list.
export function ProductSwitcher() {
  const { products, active, setActiveId, addProduct, removeProduct, fileProduct } = useStore();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const inProcess = products.filter((p) => !p.filed);

  function commit() {
    if (name.trim()) {
      addProduct(name.trim());
      setName("");
      setAdding(false);
      setOpen(false);
    }
  }

  function finishAndFile() {
    if (!active) return;
    if (
      confirm(
        `File "${active.name}" to the dashboard and clear it from the process?\n\nIt stays on the dashboard and can be reopened anytime.`
      )
    ) {
      fileProduct(active.id);
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="glass glass-hover flex min-w-[240px] items-center gap-2.5 rounded-xl px-3 py-2 text-left"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-white">
            <Package className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="eyebrow block">Active product</span>
            <span className="block truncate text-[13px] font-semibold text-white">
              {active ? active.name : "None selected"}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted" />
        </button>
        <button
          onClick={() => {
            setAdding(true);
            setOpen(true);
          }}
          className="flex h-[42px] items-center gap-1.5 rounded-xl bg-surface px-3 text-[13px] font-semibold text-ink ring-1 ring-inset ring-line transition hover:bg-surface"
        >
          <Plus className="h-4 w-4" /> New
        </button>
        {active && (
          <button
            onClick={finishAndFile}
            className="flex h-[42px] items-center gap-1.5 rounded-xl bg-ink px-3 text-[13px] font-semibold text-white transition hover:brightness-110"
            title="File this product to the dashboard and clear the process"
          >
            <CheckCircle2 className="h-4 w-4" /> Finish &amp; file
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[320px] rounded-xl border border-line bg-surface/95 p-2 shadow-card backdrop-blur-xl">
          {adding && (
            <div className="mb-2 flex gap-2 border-b border-line pb-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commit()}
                placeholder="Product name…"
                className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-muted focus:border-link focus:outline-none"
              />
              <button
                onClick={commit}
                className="rounded-lg bg-ink px-3 text-[12px] font-semibold text-white"
              >
                Add
              </button>
            </div>
          )}

          {inProcess.length === 0 && !adding && (
            <p className="px-3 py-4 text-center text-[12px] text-muted">
              No products in process. Click <span className="text-ink">New</span> to start one
              {products.length > 0 ? " — filed products are on the dashboard." : "."}
            </p>
          )}

          <ul className="max-h-64 overflow-y-auto">
            {inProcess.map((p) => (
              <li key={p.id}>
                <div
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2 ${
                    p.id === active?.id ? "bg-brand-soft" : "hover:bg-surface"
                  }`}
                >
                  <button
                    onClick={() => {
                      setActiveId(p.id);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {p.name}
                    </span>
                    <span className="eyebrow">{p.category || "uncategorised"}</span>
                  </button>
                  <button
                    onClick={() => removeProduct(p.id)}
                    className="text-line-strong opacity-0 transition hover:text-block group-hover:opacity-100"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
