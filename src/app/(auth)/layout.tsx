import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <Link href="/" className="mb-6 flex items-center gap-2 text-xl font-extrabold text-brand-700">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white" aria-hidden>+</span> MediCare Local
      </Link>
      <main id="main">{children}</main>
    </div>
  );
}
