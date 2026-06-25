// Multi-user access model.
// Admin (parent) sees everything. Employees are granted access to specific tabs.
// UI-only for now — replace with real Auth.js + DB-backed users later.

import {
  PRE_ORDER_STEPS,
  ON_WORKING_STEPS,
  POST_ORDER_STEPS,
  type ProcessStep,
} from "./steps";

export type TabKey =
  | "dashboard"
  | "directory"
  | "pre-order"
  | "on-working"
  | "post-order"
  | "order-summary";

export const TABS: { key: TabKey; label: string; tagline: string }[] = [
  { key: "dashboard", label: "Dashboard", tagline: "Overview across the pipeline" },
  { key: "directory", label: "Manufacturer / Trader Directory", tagline: "Reusable address book of factories & traders" },
  { key: "pre-order", label: "Pre-Order", tagline: "Decide before we spend a rupee" },
  { key: "on-working", label: "On-Working", tagline: "After we decide to buy" },
  { key: "post-order", label: "Post-Order", tagline: "Getting it home" },
  { key: "order-summary", label: "Order Summary", tagline: "Per-product P&L: amounts, expenses, profit" },
];

export type Role = "ADMIN" | "EMPLOYEE";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  // Tabs this user may open. Admin implicitly has all (see canAccess).
  access: TabKey[];
  active: boolean;
}

// Seed users. Admin is the parent; employees get scoped tab access.
// Only the admin login is wired right now (see login-form.tsx).
export const SEED_USERS: AppUser[] = [
  {
    id: "u-admin",
    name: "Bhavya",
    email: "admin@gmail.com",
    role: "ADMIN",
    access: ["dashboard", "directory", "pre-order", "on-working", "post-order"],
    active: true,
  },
  {
    id: "u-sourcing",
    name: "Sourcing Exec",
    email: "sourcing@lazerbelieve.com",
    role: "EMPLOYEE",
    access: ["dashboard", "directory", "pre-order"],
    active: true,
  },
  {
    id: "u-production",
    name: "Production Exec",
    email: "production@lazerbelieve.com",
    role: "EMPLOYEE",
    access: ["dashboard", "on-working"],
    active: true,
  },
  {
    id: "u-logistics",
    name: "Logistics Exec",
    email: "logistics@lazerbelieve.com",
    role: "EMPLOYEE",
    access: ["dashboard", "post-order"],
    active: false,
  },
];

export function canAccess(user: AppUser, tab: TabKey): boolean {
  if (user.role === "ADMIN") return true;
  return user.access.includes(tab);
}

// The "current" user for this UI-only build. Swap for a real session later.
export const CURRENT_USER: AppUser = SEED_USERS[0];

// Sub-tabs shown nested under each main tab in the sidebar. Built from the same
// step definitions the pages use, so the sidebar and content panel never drift.
export const TAB_STEPS: Partial<Record<TabKey, ProcessStep[]>> = {
  "pre-order": PRE_ORDER_STEPS,
  "on-working": ON_WORKING_STEPS,
  "post-order": POST_ORDER_STEPS,
};
