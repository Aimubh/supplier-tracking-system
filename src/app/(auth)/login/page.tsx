import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { PageEnter, EnterItem } from "@/components/page-enter";
import { ShieldCheck, Wallet, Lock } from "lucide-react";

export const metadata: Metadata = {
  title: "Sign in · Sourcing Tracker",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <PageEnter className="w-full max-w-[420px]">
        {/* Brand */}
        <EnterItem className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-ink font-display text-lg font-semibold text-white">
            LB
          </div>
          <h1 className="mt-4 font-display text-[28px] font-medium tracking-tight text-ink">
            Welcome to <span className="grad-text">Sourcing Tracker</span>
          </h1>
          <p className="mt-1.5 text-[14px] text-muted">
            Lazer Believe · internal import control
          </p>
        </EnterItem>

        {/* Card */}
        <EnterItem className="glass rounded-lg p-6 sm:p-7">
          <div className="mb-5">
            <h2 className="font-display text-[16px] font-medium text-ink">Sign in</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Authorised personnel only. Access is role-based.
            </p>
          </div>
          <LoginForm />
        </EnterItem>

        {/* Trust strip */}
        <EnterItem>
          <div className="mt-5 flex items-center justify-center gap-5 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> Gated workflow
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Compliance-first
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" /> Cash ledger
            </span>
          </div>
        </EnterItem>
      </PageEnter>
    </div>
  );
}
