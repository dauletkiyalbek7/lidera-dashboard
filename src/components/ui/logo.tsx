import Link from 'next/link';

type LogoProps = {
  href?: string;
  /** Приглушённая версия для служебных экранов. */
  muted?: boolean;
  className?: string;
};

export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0E1012" />
      <path d="M18 14h8v27h18v9H18z" fill="var(--color-lime)" />
      <rect x="34" y="14" width="6" height="18" rx="3" fill="var(--color-positive)" />
      <rect
        x="44"
        y="14"
        width="6"
        height="26"
        rx="3"
        fill="var(--color-lime)"
        opacity="0.55"
      />
    </svg>
  );
}

export function Logo({ href = '/', muted = false, className = '' }: LogoProps) {
  const content = (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className="size-8 shrink-0" />
      <span
        className={`text-[17px] font-semibold tracking-[0.18em] ${
          muted ? 'text-ink-soft' : 'text-ink'
        }`}
      >
        LIDERA
      </span>
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="inline-flex rounded-control" aria-label="Lidera — на главную">
      {content}
    </Link>
  );
}
