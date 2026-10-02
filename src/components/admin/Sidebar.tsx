"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { adminLinks } from "./nav-links";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="hidden md:block w-56 shrink-0 border-r border-border bg-surface-muted">
      <div className="flex flex-col gap-0.5 p-4">
        {adminLinks.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== "/admin" && pathname.startsWith(href));

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 text-sm rounded-[var(--radius-sm)] transition-colors",
                isActive
                  ? "bg-primary text-on-primary"
                  : "text-text-secondary hover:bg-surface hover:text-text"
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
