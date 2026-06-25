"use client";

// Admin-only Users & access management. List team members, add new ones with a
// role + tab access, edit, reset password, activate/deactivate, delete.

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Users, Plus, Trash2, ShieldCheck, X, Check } from "lucide-react";
import { TABS, type TabKey, type Role } from "@/lib/access";
import { useCurrentUser } from "@/lib/use-current-user";
import { SpotlightCard } from "./spotlight-card";

interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  access: TabKey[];
  active: boolean;
  createdAt: string;
}

const BLANK = {
  name: "",
  email: "",
  password: "",
  role: "EMPLOYEE" as Role,
  access: ["dashboard"] as TabKey[],
  active: true,
};

export function UsersView() {
  const me = useCurrentUser();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<null | (typeof BLANK & { id?: string })>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  if (me && me.role !== "ADMIN") {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="glass flex max-w-sm flex-col items-center gap-3 rounded-lg px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-block/10 text-block ring-1 ring-inset ring-block/20">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h2 className="font-display text-lg font-medium text-ink">Admins only</h2>
          <p className="text-[13px] text-muted">User management is restricted to administrators.</p>
        </div>
      </main>
    );
  }

  async function save() {
    if (!editing) return;
    setError(null);
    setBusy(true);
    try {
      const isEdit = !!editing.id;
      const url = isEdit ? `/api/users/${editing.id}` : "/api/users";
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, unknown> = {
        name: editing.name,
        role: editing.role,
        access: editing.access,
        active: editing.active,
      };
      if (!isEdit) body.email = editing.email;
      if (editing.password) body.password = editing.password;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Failed to save user.");
        setBusy(false);
        return;
      }
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) load();
    else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Failed to delete.");
    }
  }

  function toggleAccess(tab: TabKey) {
    if (!editing) return;
    const has = editing.access.includes(tab);
    setEditing({
      ...editing,
      access: has ? editing.access.filter((t) => t !== tab) : [...editing.access, tab],
    });
  }

  return (
    <main className="px-7 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-white">
            <Users className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className="font-display text-[22px] font-medium tracking-tight text-ink">Users &amp; access</h1>
            <p className="text-[13px] text-muted">Add team members and control which tabs they can open.</p>
          </div>
        </div>
        <button
          onClick={() => { setError(null); setEditing({ ...BLANK }); }}
          className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[14px] font-medium text-white transition hover:bg-brand-600"
        >
          <Plus className="h-4 w-4" /> Add user
        </button>
      </div>

      <SpotlightCard className="overflow-hidden">
        {loading ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">Loading…</p>
        ) : users.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">No users yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-[12px] font-semibold text-ink ring-1 ring-inset ring-line">
                  {u.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-ink">{u.name}</span>
                    <span className={clsx("figure rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1 ring-inset",
                      u.role === "ADMIN" ? "bg-ink text-white ring-ink" : "bg-surface text-muted ring-line")}>
                      {u.role}
                    </span>
                    {!u.active && <span className="figure rounded bg-block/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-block ring-1 ring-inset ring-block/25">inactive</span>}
                  </div>
                  <p className="truncate text-[12px] text-muted">{u.email}</p>
                </div>
                <div className="hidden flex-wrap gap-1 sm:flex">
                  {u.role === "ADMIN" ? (
                    <span className="text-[11px] text-muted">all tabs</span>
                  ) : (
                    u.access.map((t) => (
                      <span key={t} className="figure rounded bg-surface px-1.5 py-0.5 text-[10px] text-body ring-1 ring-inset ring-line">{t}</span>
                    ))
                  )}
                </div>
                <button
                  onClick={() => { setError(null); setEditing({ id: u.id, name: u.name, email: u.email, password: "", role: u.role, access: u.access, active: u.active }); }}
                  className="rounded-md border border-line bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink transition hover:bg-surface"
                >
                  Edit
                </button>
                {me?.id !== u.id && (
                  <button onClick={() => remove(u.id)} className="text-line-strong transition hover:text-block" title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </SpotlightCard>

      {/* Add / edit dialog */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-lg border border-line bg-white shadow-lift" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-display text-[16px] font-medium text-ink">{editing.id ? "Edit user" : "Add user"}</h2>
              <button onClick={() => setEditing(null)} className="text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-body">Name</span>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="h-11 w-full rounded-sm border border-line bg-white px-3.5 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-body">Email</span>
                <input type="email" value={editing.email} disabled={!!editing.id}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  className="h-11 w-full rounded-sm border border-line bg-white px-3.5 text-[14px] text-ink disabled:bg-surface disabled:text-muted focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-body">
                  {editing.id ? "New password (leave blank to keep)" : "Password"}
                </span>
                <input type="password" value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                  placeholder="6+ characters"
                  className="h-11 w-full rounded-sm border border-line bg-white px-3.5 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-body">Role</span>
                <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}
                  className="h-11 w-full appearance-none rounded-sm border border-line bg-white px-3.5 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15">
                  <option value="EMPLOYEE">Employee</option>
                  <option value="ADMIN">Admin (sees everything)</option>
                </select>
              </label>
              {editing.role === "EMPLOYEE" && (
                <div>
                  <span className="mb-1.5 block text-[13px] font-medium text-body">Tab access</span>
                  <div className="flex flex-wrap gap-2">
                    {TABS.map((t) => {
                      const on = editing.access.includes(t.key);
                      return (
                        <button key={t.key} type="button" onClick={() => toggleAccess(t.key)}
                          className={clsx("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium ring-1 ring-inset transition",
                            on ? "bg-ink text-white ring-ink" : "bg-white text-body ring-line hover:bg-surface")}>
                          {on && <Check className="h-3 w-3" />} {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2.5">
                <button type="button" onClick={() => setEditing({ ...editing, active: !editing.active })}
                  className={clsx("relative h-5 w-9 rounded-full border transition", editing.active ? "border-ink bg-ink" : "border-line bg-surface-strong")}>
                  <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition", editing.active ? "left-[18px]" : "left-0.5")} />
                </button>
                <span className="text-[14px] text-body">Active (can sign in)</span>
              </label>

              {error && <p className="rounded-md border border-block/30 bg-block/10 px-3 py-2 text-[12px] font-medium text-block">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-line bg-white px-3.5 py-2 text-[14px] font-medium text-ink transition hover:bg-surface">Cancel</button>
              <button onClick={save} disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-[14px] font-medium text-white transition hover:bg-brand-600 disabled:opacity-60">
                {busy ? "Saving…" : editing.id ? "Save changes" : "Create user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
