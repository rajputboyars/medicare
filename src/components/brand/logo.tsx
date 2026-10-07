import clsx from "clsx";

export const BRAND = { name: "DawaDost", nameHi: "दवा दोस्त", tagline: "Medicines, delivered locally." } as const;

/** The DawaDost mark: a map pin with a medical cross ("a verified pharmacy near you"). Pure SVG, scales from 16px up. */
export function LogoMark({ className, title, style }: { className?: string; title?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 64 64" className={clsx("shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" style={style}>
      <rect width="64" height="64" rx="14" fill="#0f766e" />
      <ellipse cx="32" cy="58.4" rx="8.5" ry="2" fill="#f59e0b" />
      <path d="M32 8.5c-10.7 0-18.8 8.1-18.8 18.5 0 12.7 13.9 25 17.8 28.5a1.5 1.5 0 0 0 2 0c3.9-3.5 17.8-15.8 17.8-28.5C50.8 16.6 42.7 8.5 32 8.5z" fill="#fff" />
      <path d="M28.6 18.2h6.8v6.9h6.9v6.8h-6.9v6.9h-6.8v-6.9h-6.9v-6.8h6.9z" fill="#0f766e" />
    </svg>
  );
}

/** Mark + wordmark. `onDark` flips the wordmark for coloured backgrounds. */
export function Logo({ size = 36, wordmark = true, onDark = false, className }: { size?: number; wordmark?: boolean; onDark?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <LogoMark title={wordmark ? undefined : BRAND.name} style={{ width: size, height: size }} />
      {wordmark && (
        <span className="leading-none" style={{ fontSize: size * 0.62 }}>
          <span className={clsx("font-extrabold tracking-tight", onDark ? "text-white" : "text-ink")}>Dawa</span>
          <span className={clsx("font-extrabold tracking-tight", onDark ? "text-teal-200" : "text-brand-600")}>Dost</span>
        </span>
      )}
    </span>
  );
}
