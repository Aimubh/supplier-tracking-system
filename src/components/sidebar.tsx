"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Search,
  Factory,
  Ship,
  Settings,
  LogOut,
  Lock,
  Users,
  Building2,
  Receipt,
  QrCode,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { TABS, TAB_STEPS, type TabKey, canAccess } from "@/lib/access";
import { useCurrentUser } from "@/lib/use-current-user";
import { motion, AnimatePresence, staggerParent, riseItem, useReducedMotion } from "./motion";

const TAB_ICON: Record<TabKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  directory: Building2,
  "qr-generator": QrCode,
  "pre-order": Search,
  "on-working": Factory,
  "post-order": Ship,
  "order-summary": Receipt,
};

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useCurrentUser();
  const reduce = useReducedMotion();
  const activeStep = Number(searchParams.get("step")) || 1;

  if (!user) return null; // session still loading

  return (
    <aside className="sticky top-0 z-20 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-white lg:flex">
      {/* Masthead */}
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink p-2 text-white">
          {/* Lazer Believe mark */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/lazer-mark.svg" alt="Lazer Believe" className="h-full w-full brightness-0 invert" />
        </span>
        <div className="leading-tight">
          <p className="font-display text-[15px] font-semibold tracking-tight text-ink">
            Sourcing Tracker
          </p>
          <p className="eyebrow mt-0.5">Lazer Believe</p>
        </div>
      </div>

      {/* Nav */}
      <motion.nav
        className="flex flex-col gap-0.5 px-3 py-2"
        variants={reduce ? undefined : staggerParent}
        initial={reduce ? undefined : "hidden"}
        animate={reduce ? undefined : "show"}
      >
        <p className="eyebrow px-2 pb-2">Workspace</p>
        {TABS.map((tab) => {
          const Icon = TAB_ICON[tab.key];
          const href = `/${tab.key}`;
          const active = pathname === href;
          const allowed = canAccess(user, tab.key);

          if (!allowed) {
            return (
              <motion.div
                key={tab.key}
                variants={reduce ? undefined : riseItem}
                title="No access — ask an admin"
                className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2.5 text-[14px] text-line-strong"
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{tab.label}</span>
                <Lock className="h-3.5 w-3.5" />
              </motion.div>
            );
          }

          const subSteps = TAB_STEPS[tab.key] ?? [];

          return (
            <motion.div key={tab.key} variants={reduce ? undefined : riseItem}>
              <motion.div
                whileHover={reduce || active ? undefined : { x: 2 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                <Link
                  href={href}
                  className={clsx(
                    "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition",
                    active
                      ? "text-white"
                      : "text-body hover:bg-surface hover:text-ink"
                  )}
                >
                  {active &&
                    (reduce ? (
                      <span className="absolute inset-0 -z-10 rounded-md bg-ink" />
                    ) : (
                      <motion.span
                        layoutId="nav-active"
                        transition={{ type: "spring", stiffness: 500, damping: 36 }}
                        className="absolute inset-0 -z-10 rounded-md bg-ink"
                      />
                    ))}
                  <Icon
                    className={clsx(
                      "h-4 w-4 transition-colors",
                      active ? "text-white" : "text-muted group-hover:text-ink"
                    )}
                  />
                  <span className={clsx("flex-1", active && "font-medium")}>{tab.label}</span>
                  {subSteps.length > 0 && (
                    <span
                      className={clsx(
                        "figure rounded px-1.5 py-0.5 text-[11px]",
                        active ? "bg-white/15 text-white" : "text-line-strong"
                      )}
                    >
                      {subSteps.length}
                    </span>
                  )}
                </Link>
              </motion.div>

              {/* Nested sub-tabs — auto-expand for the active tab */}
              <AnimatePresence initial={false}>
                {active && subSteps.length > 0 && (
                  <motion.ul
                    key={`${tab.key}-sub`}
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={reduce ? {} : { height: "auto", opacity: 1 }}
                    exit={reduce ? {} : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                    className="ml-5 mt-0.5 overflow-hidden border-l border-line pl-1"
                  >
                    {subSteps.map((s, i) => {
                      const stepActive = s.n === activeStep;
                      return (
                        <motion.li
                          key={s.n}
                          initial={reduce ? false : { opacity: 0, x: -6 }}
                          animate={reduce ? {} : { opacity: 1, x: 0 }}
                          transition={{ delay: reduce ? 0 : 0.04 + i * 0.03 }}
                        >
                          <Link
                            href={`${href}?step=${s.n}`}
                            scroll={false}
                            className={clsx(
                              "group relative flex items-center gap-2 rounded-md py-2 pl-3 pr-2 text-[13.5px] transition",
                              stepActive
                                ? "font-medium text-ink"
                                : "text-muted hover:bg-surface hover:text-ink"
                            )}
                          >
                            <span
                              className={clsx(
                                "absolute -left-[5px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full transition",
                                stepActive ? "bg-ink" : "bg-line-strong group-hover:bg-muted"
                              )}
                            />
                            <span className="flex-1 truncate">{s.title}</span>
                            {s.gate && <span className="h-1.5 w-1.5 rounded-full bg-pending" />}
                          </Link>
                        </motion.li>
                      );
                    })}
                  </motion.ul>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.nav>

      {/* Admin */}
      {user.role === "ADMIN" && (
        <div className="mt-2 px-3 py-2">
          <p className="eyebrow px-2 pb-2">Admin</p>
          <Link
            href="/users"
            className={clsx(
              "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition",
              pathname === "/users" ? "bg-ink text-white" : "text-body hover:bg-surface hover:text-ink"
            )}
          >
            <Users className={clsx("h-4 w-4", pathname === "/users" ? "text-white" : "text-muted")} />
            Users &amp; access
          </Link>
          <Link
            href="/settings"
            className={clsx(
              "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition",
              pathname === "/settings" ? "bg-ink text-white" : "text-body hover:bg-surface hover:text-ink"
            )}
          >
            <Settings className={clsx("h-4 w-4", pathname === "/settings" ? "text-white" : "text-muted")} />
            Settings
          </Link>
        </div>
      )}

      {/* User card */}
      <div className="mt-auto p-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-white">
            {user.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[14px] font-medium text-ink">{user.name}</p>
            <p className="figure text-[10px] uppercase tracking-wider text-muted">{user.role}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Sign out"
            className="ml-auto text-muted transition hover:text-coral"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
