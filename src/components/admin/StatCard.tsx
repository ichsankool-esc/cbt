"use client";

import Link from "next/link";
import {
  BookOpen,
  FolderOpen,
  FileText,
  Users,
  type LucideIcon,
} from "lucide-react";
import CountUp from "@/components/ui/CountUp";
import SpotlightCard from "@/components/ui/SpotlightCard";

const iconMap: Record<string, LucideIcon> = {
  BookOpen,
  FolderOpen,
  FileText,
  Users,
};

interface StatCardProps {
  label: string;
  value: number;
  iconName: string;
  href: string;
}

export function StatCard({ label, value, iconName, href }: StatCardProps) {
  const Icon = iconMap[iconName] ?? BookOpen;

  return (
    <Link href={href}>
      <SpotlightCard className="bg-surface border border-border rounded-[var(--radius)] shadow-[var(--shadow-sm)] p-5 cursor-pointer transition-colors hover:border-border-strong">
        <div className="flex items-center gap-3 relative z-10">
          <Icon size={20} className="text-text-muted shrink-0" />
          <div>
            <p className="text-2xl font-medium text-text">
              <CountUp to={value} duration={1} />
            </p>
            <p className="text-xs text-text-muted">{label}</p>
          </div>
        </div>
      </SpotlightCard>
    </Link>
  );
}
