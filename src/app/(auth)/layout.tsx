import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <Link href="/" className="mb-6 self-start" aria-label="DawaDost home"><Logo size={48} /></Link>
      <main id="main">{children}</main>
    </div>
  );
}
