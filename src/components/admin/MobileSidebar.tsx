"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";
import { adminLinks } from "./nav-links";

export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="md:hidden -ml-1 p-1.5 text-text-secondary hover:text-text"
        aria-label="Buka menu"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <nav className="absolute left-0 top-0 h-full w-64 bg-surface border-r border-border p-4 flex flex-col gap-0.5">
            <button
              onClick={() => setOpen(false)}
              className="self-end mb-2 p-1 text-text-muted hover:text-text"
              aria-label="Tutup menu"
            >
              <X size={18} />
            </button>
            {adminLinks.map(({ href, label, icon: Icon }) => {
              const isActive =
                pathname === href ||
                (href !== "/admin" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 text-sm rounded-[var(--radius-sm)] transition-colors",
                    isActive
                      ? "bg-primary text-on-primary"
                      : "text-text-secondary hover:bg-surface-muted hover:text-text"
                  )}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}
