import type { ReactNode } from "react";
import { Search } from "lucide-react";

/** Shared Pterodactyl-style layout primitives used by the panel views. */

export function PteroPage({ children }: { children: ReactNode }) {
  return <div className="grid gap-4">{children}</div>;
}

export function PteroPageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-[22px] font-extrabold text-ice">{title}</h1>
        {description ? <p className="mt-1 text-[13px] text-steel">{description}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}

export function PteroPanel({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold text-ice">{title}</h2>
          {description ? <p className="text-[11px] text-steel">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function PteroStatGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function PteroStat({
  icon,
  label,
  value,
  hint,
  accent = true,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="glass flex items-start gap-3 px-4 py-3">
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-[10px] border border-line bg-fill ${
          accent ? "text-accent" : "text-steel"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold tracking-wide text-steel uppercase">{label}</p>
        <p className="text-[20px] leading-tight font-extrabold text-ice">{value}</p>
        {hint ? <p className="truncate text-[11px] text-faint">{hint}</p> : null}
      </div>
    </div>
  );
}

export function PteroStatus({
  status,
  label,
}: {
  status: "online" | "offline" | "loading";
  label: ReactNode;
}) {
  const dot = status === "online" ? "bg-ok" : status === "loading" ? "bg-warn animate-pulse" : "bg-danger";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-fill px-3 py-1 text-[11px] font-bold text-ice">
      <span className={`size-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

export function PteroSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="relative block w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
      <input
        type="search"
        className="panel-input h-10 w-full pl-9 text-[12px]"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function PteroEmpty({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <span className="grid size-11 place-items-center rounded-full border border-line bg-fill text-steel">{icon}</span> : null}
      <p className="text-[14px] font-bold text-ice">{title}</p>
      {body ? <p className="max-w-sm text-[12px] text-steel">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
