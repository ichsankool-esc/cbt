import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="text-center">
        <h1 className="text-4xl font-medium text-text mb-2">404</h1>
        <p className="text-sm text-text-secondary mb-6">
          Halaman tidak ditemukan.
        </p>
        <Link href="/">
          <Button variant="secondary">Kembali ke Beranda</Button>
        </Link>
      </div>
    </main>
  );
}
