"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { FileText, BarChart3 } from "lucide-react";

const links = [
  { href: "/ujian", label: "Ujian", icon: FileText },
  { href: "/ujian/hasil", label: "Hasil", icon: BarChart3 },
];

export function StudentNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {links.map(({ href, label, icon: Icon }) => {
        const isActive =
          pathname === href ||
          (href !== "/ujian" && pathname.startsWith(href));

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors",
              isActive
                ? "bg-primary text-on-primary"
                : "text-text-muted hover:text-text hover:bg-surface-muted"
            )}
          >
            <Icon size={14} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
