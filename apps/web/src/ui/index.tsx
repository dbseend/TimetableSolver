/** 반복 사용하는 최소 UI 요소. 새 디자인 시스템 라이브러리는 쓰지 않는다. 아이콘은 한 가지 선 스타일(1.75px)로 통일. */
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from "react";

type IconName = "check" | "alert" | "info" | "x" | "upload" | "edit" | "trash" | "sparkle" | "plus" | "chevron";
const PATHS: Record<IconName, ReactNode> = {
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="M9 6l6 6-6 6" />,
};

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {PATHS[name]}
    </svg>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger-ghost";
export function Button({ variant = "primary", size, block, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm"; block?: boolean }) {
  return <button type="button" {...rest} className={["btn", `btn-${variant}`, size === "sm" && "btn-sm", block && "btn-block", className].filter(Boolean).join(" ")} />;
}

export function IconButton({ icon, label, variant = "ghost", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; variant?: Variant }) {
  return (
    <button type="button" {...rest} aria-label={label} title={label} className={`btn btn-${variant} btn-icon`}>
      <Icon name={icon} />
    </button>
  );
}

export function Card({ children, className, tight, ...rest }: { children: ReactNode; className?: string; tight?: boolean } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className={["card", tight && "tight", className].filter(Boolean).join(" ")}>
      {children}
    </section>
  );
}

export function Badge({ tone, children, title }: { tone?: "primary" | "success" | "warning" | "danger" | "outline"; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone ?? ""}`} title={title}>
      {children}
    </span>
  );
}

const ALERT_ICON = { info: "info", success: "check", warning: "alert", danger: "alert" } as const;
export function Alert({ tone, title, children, testId }: { tone: "info" | "success" | "warning" | "danger"; title?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className={`alert ${tone}`} role={tone === "danger" ? "alert" : "status"} data-testid={testId}>
      <Icon name={ALERT_ICON[tone]} />
      <div className="alert-body">
        {title && <b>{title}</b>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

/** 탭/세그먼트. 좌우 화살표로 이동(WAI-ARIA tabs 패턴). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = options.findIndex((o) => o.value === value);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const n = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
      onChange(n.value);
      (e.currentTarget.querySelector(`[data-v="${n.value}"]`) as HTMLButtonElement | null)?.focus();
    }
  }
  return (
    <div className="seg" role="tablist" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" data-v={o.value} aria-selected={o.value === value} tabIndex={o.value === value ? 0 : -1} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
