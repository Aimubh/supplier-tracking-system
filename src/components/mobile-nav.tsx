"use client";

// Mobile navigation — the StaggeredMenu overlay, shown only below `lg` where the
// desktop sidebar is hidden. Builds its items from the same TABS + access control
// as the sidebar (locked tabs render disabled), plus the admin links, and
// navigates client-side via the router.

import { useRouter, usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { TABS, canAccess } from "@/lib/access";
import { useCurrentUser } from "@/lib/use-current-user";
import { StaggeredMenu, type StaggeredMenuItem } from "./staggered-menu";

export function MobileNav() {
  const user = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();

  if (!user) return null;

  const items: StaggeredMenuItem[] = TABS.map((tab) => {
    const allowed = canAccess(user, tab.key);
    return {
      label: tab.label,
      ariaLabel: allowed ? `Go to ${tab.label}` : `${tab.label} — no access`,
      link: `/${tab.key}`,
      disabled: !allowed,
    };
  });

  if (user.role === "ADMIN") {
    items.push(
      { label: "Users & access", ariaLabel: "Manage users", link: "/users" },
      { label: "Settings", ariaLabel: "Settings", link: "/settings" }
    );
  }

  // A "Sign out" pseudo-item at the end.
  items.push({ label: "Sign out", ariaLabel: "Sign out", link: "__signout__" });

  const handleClick = (link: string) => {
    if (link === "__signout__") {
      void signOut({ callbackUrl: "/login" });
      return;
    }
    if (link !== pathname) router.push(link);
  };

  // Only render on mobile/tablet — the desktop sidebar covers lg+.
  return (
    <div className="lg:hidden">
      <StaggeredMenu
        position="right"
        items={items}
        displaySocials={false}
        displayItemNumbering
        colors={["#6F6A5C", "#15130E"]}
        menuButtonColor="#15130E"
        openMenuButtonColor="#15130E"
        accentColor="#C8902A"
        logoUrl="/lazer-mark.svg"
        isFixed
        onItemClick={handleClick}
      />
    </div>
  );
}
