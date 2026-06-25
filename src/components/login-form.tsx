"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Eye, EyeOff, Loader2, ArrowRight, Check } from "lucide-react";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";

// Seeded admin login, for convenience (the "Fill" button). Real verification
// happens server-side against the DB via NextAuth.
const DEFAULT_ADMIN = {
  email: "admin@gmail.com",
  password: "admin@123",
};

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Enter both email and password.");
      return;
    }
    setLoading(true);
    const res = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    });
    if (!res || res.error) {
      setLoading(false);
      setError("Invalid email or password.");
      return;
    }
    setLoading(false);
    setAuthorized(true);
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 650);
  }

  const field =
    "h-11 w-full rounded-sm border border-line bg-white px-3.5 text-[14px] text-ink placeholder:text-line-strong transition focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15";

  return (
    <form onSubmit={onSubmit} className="relative space-y-4">
      {/* Success overlay */}
      <AnimatePresence>
        {authorized && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/85 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 360, damping: 16 }}
              className="flex items-center gap-2 rounded-pill bg-ink px-5 py-2.5 text-white"
            >
              <Check className="h-5 w-5" strokeWidth={3} />
              <span className="text-sm font-semibold">Welcome back</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Email */}
      <div>
        <label className="eyebrow mb-1.5 block">Email</label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@lazerbelieve.com"
          className={field}
        />
      </div>

      {/* Password */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="eyebrow block">Password</label>
          <button
            type="button"
            className="text-[12px] font-medium text-link hover:underline"
          >
            Forgot?
          </button>
        </div>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={clsx(field, "pr-10")}
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition hover:text-ink"
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Remember */}
      <label className="flex cursor-pointer select-none items-center gap-2">
        <button
          type="button"
          onClick={() => setRemember((r) => !r)}
          className={clsx(
            "flex h-4 w-4 items-center justify-center rounded-[4px] border transition",
            remember ? "border-ink bg-ink" : "border-line bg-white"
          )}
        >
          {remember && (
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none">
              <path
                d="M2.5 6.5L5 9l4.5-5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        <span className="text-[13px] text-body">Keep me signed in</span>
      </label>

      {error && (
        <p className="rounded-md border border-block/30 bg-block/10 px-3 py-2 text-[12px] font-medium text-block">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-ink text-[14px] font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
          </>
        ) : (
          <>
            Sign in
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </>
        )}
      </button>

      {/* Demo credentials */}
      <div className="flex items-center justify-between rounded-md border border-dashed border-line bg-surface px-3 py-2.5">
        <div className="leading-tight">
          <p className="eyebrow">Demo admin</p>
          <p className="figure mt-1 text-[11px] text-muted">
            {DEFAULT_ADMIN.email} · {DEFAULT_ADMIN.password}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEmail(DEFAULT_ADMIN.email);
            setPassword(DEFAULT_ADMIN.password);
            setError(null);
          }}
          className="rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-ink transition hover:bg-surface"
        >
          Fill
        </button>
      </div>
    </form>
  );
}
