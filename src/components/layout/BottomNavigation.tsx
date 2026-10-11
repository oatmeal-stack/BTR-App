"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, House, ListChecks, Search, User } from "lucide-react";
import { NAV_TABS } from "@/routes";

const ICONS = {
  home: House,
  browse: Search,
  library: BookOpen,
  lists: ListChecks,
  profile: User,
} as const;

/** Pages that live under a tab without having one of their own. */
function activeKey(pathname: string): string {
  const p = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (p === "/book") return "browse";
  if (p === "/add") return "home";
  const tab = NAV_TABS.find((t) => t.href === p);
  return tab?.key ?? "";
}

export function BottomNavigation() {
  const active = activeKey(usePathname());
  return (
    <nav className="tabs" aria-label="Main">
      {NAV_TABS.map((tab) => {
        const Icon = ICONS[tab.key];
        const on = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`tabs__link${on ? " is-active" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            <Icon size={22} aria-hidden="true" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
