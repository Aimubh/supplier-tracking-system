"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Factory,
  Store,
  HelpCircle,
  Trash2,
  Star,
  X,
  Globe,
  BadgeCheck,
  Clock,
  CircleSlash,
  Pencil,
  FileText,
  ScanLine,
  MessageCircle,
} from "lucide-react";
import {
  useStore,
  PRODUCT_CATEGORIES,
  type Manufacturer,
  type CatalogItem,
  type SupplierType,
  type VerificationStatus,
} from "@/lib/store";
import { Field, Text, Select } from "./fields";
import { ImageUpload } from "./image-upload";
import { FileUpload } from "./file-upload";
import { motion, AnimatePresence, staggerParent, riseItem, useReducedMotion } from "./motion";

type FilterType = "ALL" | SupplierType;

const TYPE_META: Record<SupplierType, { label: string; icon: typeof Factory; cls: string }> = {
  FACTORY: { label: "Factory", icon: Factory, cls: "bg-surface text-ink ring-line" },
  TRADING: { label: "Trader", icon: Store, cls: "bg-pending/12 text-pending ring-pending/30" },
  UNKNOWN: { label: "Unknown", icon: HelpCircle, cls: "bg-surface text-muted ring-line" },
};

const VERIF_META: Record<VerificationStatus, { label: string; icon: typeof BadgeCheck; cls: string }> = {
  VERIFIED: { label: "Verified", icon: BadgeCheck, cls: "text-go" },
  IN_REVIEW: { label: "In review", icon: Clock, cls: "text-pending" },
  UNVERIFIED: { label: "Unverified", icon: CircleSlash, cls: "text-muted" },
};

export function DirectoryView() {
  const { manufacturers, addManufacturer, updateManufacturer, removeManufacturer, uid } = useStore();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return manufacturers.filter((m) => {
      if (filter !== "ALL" && m.type !== filter) return false;
      if (!q) return true;
      return [m.name, m.city, m.address, m.productLines, m.repName, m.repNumber, m.repWechat]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [manufacturers, query, filter]);

  const counts = useMemo(
    () => ({
      total: manufacturers.length,
      factories: manufacturers.filter((m) => m.type === "FACTORY").length,
      traders: manufacturers.filter((m) => m.type === "TRADING").length,
      verified: manufacturers.filter((m) => m.verification === "VERIFIED").length,
    }),
    [manufacturers]
  );

  const editing = manufacturers.find((m) => m.id === editingId) ?? null;

  function addAndEdit() {
    const id = addManufacturer();
    setEditingId(id);
  }

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Total contacts" value={counts.total} />
        <Tile label="Factories" value={counts.factories} tone="indigo" />
        <Tile label="Traders" value={counts.traders} tone="amber" />
        <Tile label="Verified" value={counts.verified} tone="go" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, city, address, product, representative…"
            className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-[13px] text-ink placeholder:text-muted transition focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
          />
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
          {(["ALL", "FACTORY", "TRADING", "UNKNOWN"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
                filter === f ? "bg-ink text-white" : "text-muted hover:text-ink"
              }`}
            >
              {f === "ALL" ? "All" : TYPE_META[f].label}
            </button>
          ))}
        </div>
        <button
          onClick={addAndEdit}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Add company
        </button>
      </div>

      {/* List */}
      {manufacturers.length === 0 ? (
        <EmptyState onAdd={addAndEdit} />
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface px-4 py-12 text-center text-[13px] text-muted">
          No companies match your search.
        </p>
      ) : (
        <motion.div
          className="space-y-2"
          variants={reduce ? undefined : staggerParent}
          initial={reduce ? undefined : "hidden"}
          animate={reduce ? undefined : "show"}
        >
          {/* Column header */}
          <div className="hidden grid-cols-[1.4fr_0.9fr_1.1fr_120px_70px_72px] gap-3 px-3 lg:grid">
            <span className="eyebrow">Company</span>
            <span className="eyebrow">City</span>
            <span className="eyebrow">Representative</span>
            <span className="eyebrow">Verification</span>
            <span className="eyebrow">Catalog</span>
            <span />
          </div>
          {filtered.map((m) => (
            <motion.div key={m.id} variants={reduce ? undefined : riseItem}>
              <Row m={m} onEdit={() => setEditingId(m.id)} onDelete={() => removeManufacturer(m.id)} />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Editor slide-over */}
      <AnimatePresence>
        {editing && (
          <Editor
            key={editing.id}
            m={editing}
            uid={uid}
            onChange={(p) => updateManufacturer(editing.id, p)}
            onClose={() => setEditingId(null)}
            onDelete={() => {
              removeManufacturer(editing.id);
              setEditingId(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Tile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "indigo" | "amber" | "go" }) {
  const color = { default: "text-ink", indigo: "text-ink", amber: "text-pending", go: "text-go" }[tone];
  return (
    <div className="glass rounded-2xl px-4 py-3.5">
      <p className="eyebrow">{label}</p>
      <p className={`figure mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Row({ m, onEdit, onDelete }: { m: Manufacturer; onEdit: () => void; onDelete: () => void }) {
  const t = TYPE_META[m.type];
  const v = VERIF_META[m.verification];
  const TypeIcon = t.icon;
  const VerifIcon = v.icon;
  return (
    <div className="glass group grid grid-cols-1 items-center gap-3 rounded-2xl px-3 py-3 transition hover:ring-1 hover:ring-inset hover:ring-line-strong lg:grid-cols-[1.4fr_0.9fr_1.1fr_120px_70px_72px]">
      {/* Company + type */}
      <button onClick={onEdit} className="flex items-center gap-3 text-left">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${t.cls}`}>
          <TypeIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold text-ink">
            {m.name || "Untitled company"}
          </span>
          <span className="block truncate text-[11.5px] text-muted">{t.label}</span>
        </span>
      </button>

      <span className="truncate text-[13px] text-muted">{m.city || "—"}</span>
      <span className="min-w-0 truncate text-[13px] text-muted">
        {m.repName || "—"}
        {m.repNumber && <span className="text-line-strong"> · {m.repNumber}</span>}
      </span>

      <span className={`flex items-center gap-1.5 text-[12.5px] ${v.cls}`}>
        <VerifIcon className="h-3.5 w-3.5" /> {v.label}
      </span>

      <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
        <FileText className={`h-3.5 w-3.5 ${m.catalogs.length ? "text-ink" : "text-line-strong"}`} />
        {m.catalogs.length}
      </span>

      <div className="flex items-center justify-end gap-1">
        <button onClick={onEdit} className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-ink" title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDelete} className="rounded-lg p-2 text-line-strong transition hover:bg-block/10 hover:text-block" title="Delete">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className={onChange ? "cursor-pointer" : "cursor-default"}
        >
          <Star className={`h-3.5 w-3.5 ${n <= value ? "fill-mustard text-mustard" : "text-line-strong"}`} />
        </button>
      ))}
    </div>
  );
}

// Small section divider used inside the editor.
function SectionLabel({ icon: Icon, children }: { icon: typeof Factory; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Icon className="h-3.5 w-3.5 text-ink" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Editor({
  m,
  uid,
  onChange,
  onClose,
  onDelete,
}: {
  m: Manufacturer;
  uid: (prefix?: string) => string;
  onChange: (p: Partial<Manufacturer>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const reduce = useReducedMotion();
  const [lightbox, setLightbox] = useState<string | null>(null);

  function addCatalog(file: { name: string; type: string; data: string }) {
    const item: CatalogItem = {
      id: uid("cat"),
      fileName: file.name,
      fileData: file.data,
      fileType: file.type,
      category: "",
      uploadedAt: Date.now(),
    };
    onChange({ catalogs: [item, ...m.catalogs] });
  }
  function setCatalogCategory(id: string, category: string) {
    onChange({ catalogs: m.catalogs.map((c) => (c.id === id ? { ...c, category } : c)) });
  }
  function removeCatalog(id: string) {
    onChange({ catalogs: m.catalogs.filter((c) => c.id !== id) });
  }

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-lg flex-col border-l border-line bg-surface/95 backdrop-blur-xl"
        initial={reduce ? false : { x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="eyebrow">Directory entry</p>
            <h2 className="font-display text-lg font-medium tracking-tight text-ink">
              {m.name || "New company"}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {/* Identity */}
          <SectionLabel icon={Factory}>Company</SectionLabel>
          <Field label="Name">
            <Text value={m.name} onChange={(v) => onChange({ name: v })} placeholder="Shenzhen … Co., Ltd" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select
                value={m.type}
                onChange={(v) => onChange({ type: v })}
                options={[
                  { value: "FACTORY", label: "Factory" },
                  { value: "TRADING", label: "Trading company" },
                  { value: "UNKNOWN", label: "Unknown" },
                ]}
              />
            </Field>
            <Field label="Verification">
              <Select
                value={m.verification}
                onChange={(v) => onChange({ verification: v })}
                options={[
                  { value: "UNVERIFIED", label: "Unverified" },
                  { value: "IN_REVIEW", label: "In review" },
                  { value: "VERIFIED", label: "Verified" },
                ]}
              />
            </Field>
          </div>
          <Field label="City / region">
            <Text value={m.city} onChange={(v) => onChange({ city: v })} placeholder="Shenzhen, Yiwu…" />
          </Field>
          <Field label="Address">
            <textarea
              value={m.address}
              onChange={(e) => onChange({ address: e.target.value })}
              rows={2}
              placeholder="Full street address, building, district…"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
            />
          </Field>
          <Field label="Product lines" hint="What they make or trade">
            <Text value={m.productLines} onChange={(v) => onChange({ productLines: v })} placeholder="silicone kitchenware, ABS toys…" />
          </Field>

          {/* Business certification */}
          <SectionLabel icon={ScanLine}>Business certification</SectionLabel>
          <Field label="Certificate / licence number">
            <Text value={m.certNumber} onChange={(v) => onChange({ certNumber: v })} placeholder="business licence no." />
          </Field>
          <ClickableImageUpload
            label="Certification photo / scan"
            value={m.certImage}
            onChange={(v) => onChange({ certImage: v })}
            onView={setLightbox}
          />

          {/* Representative */}
          <SectionLabel icon={MessageCircle}>Representative</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Text value={m.repName} onChange={(v) => onChange({ repName: v })} placeholder="Lily Wang" />
            </Field>
            <Field label="Phone number">
              <Text value={m.repNumber} onChange={(v) => onChange({ repNumber: v })} placeholder="+86 …" />
            </Field>
          </div>
          <Field label="WeChat ID">
            <Text value={m.repWechat} onChange={(v) => onChange({ repWechat: v })} placeholder="wechat id" />
          </Field>
          <ClickableImageUpload
            label="WeChat QR code"
            value={m.repWechatQr}
            onChange={(v) => onChange({ repWechatQr: v })}
            onView={setLightbox}
          />

          {/* Product catalogs */}
          <SectionLabel icon={FileText}>Product catalogs</SectionLabel>
          <FileUpload label="Upload product catalog" onPick={addCatalog} />
          {m.catalogs.length > 0 && (
            <ul className="space-y-2">
              {m.catalogs.map((c) => (
                <CatalogRow
                  key={c.id}
                  c={c}
                  onCategory={(cat) => setCatalogCategory(c.id, cat)}
                  onRemove={() => removeCatalog(c.id)}
                  onView={setLightbox}
                />
              ))}
            </ul>
          )}

          {/* Working notes */}
          <SectionLabel icon={Star}>Our assessment</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Website">
              <Text value={m.website} onChange={(v) => onChange({ website: v })} placeholder="alibaba.com/…" />
            </Field>
            <Field label="Typical MOQ" hint="Free text">
              <Text value={m.moq} onChange={(v) => onChange({ moq: v })} placeholder="500 pcs / negotiable" />
            </Field>
          </div>
          <div>
            <span className="eyebrow mb-1.5 block">Working rating</span>
            <Stars value={m.rating} onChange={(v) => onChange({ rating: v })} />
          </div>
          <Field label="Notes / red flags">
            <textarea
              value={m.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              rows={3}
              placeholder="Lead time, audit, past orders, red flags…"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
            />
          </Field>
          {m.website && (
            <a
              href={m.website.startsWith("http") ? m.website : `https://${m.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink hover:text-ink"
            >
              <Globe className="h-3.5 w-3.5" /> Open website
            </a>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-4">
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition hover:bg-block/10 hover:text-block"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
          >
            Done
          </button>
        </div>
        <p className="px-5 pb-3 text-center text-[11px] text-line-strong">Changes save automatically.</p>
      </motion.aside>

      {/* Lightbox for any uploaded image */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
          >
            <button className="absolute right-5 top-5 rounded-lg bg-ink/70 p-2 text-white hover:bg-ink">
              <X className="h-5 w-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox} alt="preview" className="max-h-full max-w-full rounded-xl object-contain" />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Image upload that also lets you click the thumbnail to view it large.
function ClickableImageUpload({
  label,
  value,
  onChange,
  onView,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onView: (src: string) => void;
}) {
  if (value) {
    return (
      <div>
        <span className="eyebrow mb-1.5 block">{label}</span>
        <div className="group relative overflow-hidden rounded-xl border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt={label}
            onClick={() => onView(value)}
            className="h-40 w-full cursor-zoom-in object-contain bg-black/20"
          />
          <button
            onClick={() => onChange("")}
            className="absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-block/80 px-2 py-1 text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100 hover:bg-block"
          >
            <X className="h-3 w-3" /> Remove
          </button>
        </div>
      </div>
    );
  }
  return <ImageUpload label={label} value={value} onChange={onChange} />;
}

function CatalogRow({
  c,
  onCategory,
  onRemove,
  onView,
}: {
  c: CatalogItem;
  onCategory: (cat: string) => void;
  onRemove: () => void;
  onView: (src: string) => void;
}) {
  const isPdf = c.fileType === "application/pdf" || c.fileName.toLowerCase().endsWith(".pdf");
  const isImage = c.fileType.startsWith("image/");
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-3">
        {/* thumbnail / icon */}
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.fileData}
            alt={c.fileName}
            onClick={() => onView(c.fileData)}
            className="h-12 w-12 shrink-0 cursor-zoom-in rounded-lg object-cover ring-1 ring-inset ring-line"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-surface text-ink ring-1 ring-inset ring-line">
            <FileText className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-ink">{c.fileName}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
            <span className="uppercase">{isPdf ? "PDF" : isImage ? "Image" : "File"}</span>
            {(isPdf || isImage) && (
              <a
                href={c.fileData}
                download={c.fileName}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink hover:text-ink"
              >
                Open
              </a>
            )}
          </div>
        </div>
        <button onClick={onRemove} className="rounded-lg p-1.5 text-muted transition hover:bg-block/10 hover:text-block">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* category dropdown — appears after upload */}
      <div className="mt-2.5">
        <span className="eyebrow mb-1 block">Product category</span>
        <Select
          value={c.category}
          onChange={onCategory}
          options={[
            { value: "", label: "Select a category…" },
            ...PRODUCT_CATEGORIES.map((p) => ({ value: p, label: p })),
          ]}
        />
      </div>
    </li>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-surface text-ink ring-1 ring-inset ring-line">
        <Factory className="h-6 w-6" />
      </div>
      <h2 className="mt-1 font-display text-lg font-medium tracking-tight text-ink">No companies yet</h2>
      <p className="max-w-sm text-[13px] leading-relaxed text-muted">
        Build your reusable address book of factories and traders. Add a company once — with its
        certification, representative, and catalogs — then reach for it on every product you source.
      </p>
      <button
        onClick={onAdd}
        className="mt-2 flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110"
      >
        <Plus className="h-4 w-4" /> Add your first company
      </button>
    </div>
  );
}
