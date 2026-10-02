import { BookOpen, FolderOpen, FileText, LayoutDashboard } from "lucide-react";

export const adminLinks = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/mata-pelajaran", label: "Mata Pelajaran", icon: BookOpen },
  { href: "/admin/bank-soal", label: "Bank Soal", icon: FolderOpen },
  { href: "/admin/ujian", label: "Ujian", icon: FileText },
];
