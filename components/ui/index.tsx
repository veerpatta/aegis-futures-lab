"use client";

import styles from "./ui.module.css";

export function Panel({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `${styles.panel} ${className}` : styles.panel}>
      {(title || actions) && (
        <div className={styles.panelTitle}>
          <h2>{title}</h2>
          {hint && <span className={styles.panelHint}>{hint}</span>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "good" | "bad" | "warn" | "dim" | undefined;

export function toneClass(tone: Tone): string {
  return tone === "good"
    ? styles.good
    : tone === "bad"
      ? styles.bad
      : tone === "warn"
        ? styles.warn
        : tone === "dim"
          ? styles.dim
          : "";
}

export function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={`${styles.kpiValue} ${toneClass(tone)}`}>{value}</span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
    </div>
  );
}

export function Button({
  variant = "default",
  small,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
  small?: boolean;
}) {
  const base =
    variant === "primary" ? styles.btnPrimary : variant === "ghost" ? styles.btnGhost : styles.btn;
  const cls = [base, small ? styles.btnSmall : "", className ?? ""].filter(Boolean).join(" ");
  return <button className={cls} {...rest} />;
}

export function Badge({
  tone = "default",
  children,
}: {
  tone?: "default" | "green" | "red" | "amber" | "blue";
  children: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? styles.badgeGreen
      : tone === "red"
        ? styles.badgeRed
        : tone === "amber"
          ? styles.badgeAmber
          : tone === "blue"
            ? styles.badgeBlue
            : styles.badge;
  return <span className={cls}>{children}</span>;
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  help,
  slider,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  help?: string;
  slider?: boolean;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        <span className={styles.fieldValue}>
          {value}
          {unit ? ` ${unit}` : ""}
        </span>
      </span>
      {slider && min !== undefined && max !== undefined ? (
        <input
          type="range"
          className={styles.range}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      ) : (
        <input
          type="number"
          className={styles.input}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
      {help && <span className={styles.fieldHelp}>{help}</span>}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  help?: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <span className={styles.fieldHelp}>{help}</span>}
    </label>
  );
}

export function ToggleField({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  help?: string;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.toggleRow}>
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {help && <span className={styles.fieldHelp}>{help}</span>}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={t.id === active ? styles.tabActive : styles.tab}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function DataTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: React.ReactNode[][];
  empty?: string;
}) {
  if (!rows.length) return <div className={styles.empty}>{empty ?? "No rows."}</div>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
