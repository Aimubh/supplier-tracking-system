"use client";

// Account settings — the signed-in user changes their own email and/or password.
// Requires the current password to confirm. After a change, the session is stale,
// so we sign out and bounce to /login to re-authenticate with the new credentials.

import { useState } from "react";
import { signOut } from "next-auth/react";
import { ShieldCheck, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useCurrentUser } from "@/lib/use-current-user";
import { PageHeader } from "./page-header";

export function SettingsView() {
  const user = useCurrentUser();

  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Prefill the email field once the session loads.
  const currentEmail = user?.email ?? "";
  const emailValue = email || currentEmail;

  const wantsEmailChange = email.trim() !== "" && email.trim().toLowerCase() !== currentEmail.toLowerCase();
  const wantsPwChange = newPassword.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);

    if (!wantsEmailChange && !wantsPwChange) {
      setError("Change your email or set a new password first.");
      return;
    }
    if (!currentPassword) {
      setError("Enter your current password to confirm.");
      return;
    }
    if (wantsPwChange) {
      if (newPassword.length < 6) {
        setError("New password must be at least 6 characters.");
        return;
      }
      if (newPassword !== confirm) {
        setError("New password and confirmation don't match.");
        return;
      }
    }

    setBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          email: wantsEmailChange ? email.trim() : undefined,
          newPassword: wantsPwChange ? newPassword : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't save changes.");
        return;
      }
      setDone("Saved. Signing you out so you can sign back in with the new details…");
      // Email/password changed → JWT is stale, force a fresh login.
      setTimeout(() => signOut({ callbackUrl: "/login" }), 1600);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-7 py-6">
      <PageHeader
        eyebrow="Admin"
        section="Account"
        title="Settings"
        subtitle="Change your sign-in email and password. You'll re-enter your current password to confirm."
      />

      <div className="mt-5 max-w-xl">
        <form onSubmit={onSubmit} className="rounded-lg border border-line bg-white p-5">
          <div className="mb-4 flex items-center gap-2 text-[12.5px] text-muted">
            <ShieldCheck className="h-4 w-4" /> Signed in as <span className="font-medium text-ink">{currentEmail || "…"}</span>
          </div>

          <p className="eyebrow mb-3">Sign-in email</p>
          <label className="mb-4 block">
            <span className="mb-1 block text-[12px] font-medium text-body">Email</span>
            <input
              type="email"
              value={emailValue}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@lazerbelieve.com"
              className="h-10 w-full rounded-sm border border-line bg-white px-3 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
            />
          </label>

          <p className="eyebrow mb-3 mt-2">New password <span className="normal-case text-muted">(leave blank to keep current)</span></p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PwField label="New password" value={newPassword} onChange={setNewPassword} show={showPw} setShow={setShowPw} placeholder="min 6 characters" />
            <PwField label="Confirm new password" value={confirm} onChange={setConfirm} show={showPw} setShow={setShowPw} placeholder="repeat new password" />
          </div>

          <div className="my-4 border-t border-line" />

          <p className="eyebrow mb-3">Confirm it's you</p>
          <PwField label="Current password" value={currentPassword} onChange={setCurrentPassword} show={showPw} setShow={setShowPw} placeholder="your current password" />

          {error && (
            <p className="mt-4 flex items-center gap-1.5 rounded-md bg-block/10 px-3 py-2 text-[13px] text-block ring-1 ring-inset ring-block/20">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}
          {done && (
            <p className="mt-4 flex items-center gap-1.5 rounded-md bg-go/10 px-3 py-2 text-[13px] text-go ring-1 ring-inset ring-go/20">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {done}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-3 text-[14px] font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>
    </main>
  );
}

function PwField({
  label, value, onChange, show, setShow, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; show: boolean; setShow: (b: boolean) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-body">{label}</span>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="h-10 w-full rounded-sm border border-line bg-white px-3 pr-10 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted transition hover:text-ink"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}
