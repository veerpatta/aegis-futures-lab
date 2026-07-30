"use client";

import { Fragment } from "react";
import { PREVIEW_NOTE, sampleVerdict, type RateReadout } from "@/lib/stats";
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

/* ── The sample gate on screen ────────────────────────────────────────────
   Rule: no rate ships without its n, and below n=30 it renders greyed as
   "previewed, not judged". These two components are the only place that
   treatment is written, so it cannot drift between the eight surfaces that
   show a number. lib/stats.ts decides WHETHER a sample is judgeable; these
   decide how that reads.

   `SampleNote` is deliberately additive — it appends the honesty to markup
   that already renders the figure, which is how the dense dashboards get
   gated without restructuring their layout. `Rate` is the fuller treatment
   for a proportion, where the confidence interval is meaningful. */

export function SampleNote({
  n,
  ci,
  className,
}: {
  n: number;
  /** e.g. "38–76%" — a Wilson interval, when the metric is a proportion. */
  ci?: string | null;
  className?: string;
}) {
  const verdict = sampleVerdict(n);
  const cls = [styles.sampleNote, verdict !== "judged" ? styles.samplePreview : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      <span className={styles.sampleN}>n={Math.max(0, Math.trunc(n))}</span>
      {ci && <span className={styles.sampleCi}>95% CI {ci}</span>}
      {verdict === "previewed" && <span className={styles.sampleFlag}>{PREVIEW_NOTE}</span>}
      {verdict === "empty" && <span className={styles.sampleFlag}>nothing logged yet</span>}
    </span>
  );
}

/** A proportion with its n and Wilson interval. Greys out below n=30. */
export function Rate({
  readout,
  valueClassName,
  showCi = true,
}: {
  readout: RateReadout;
  /** The caller's own value class, so each surface keeps its typography. */
  valueClassName?: string;
  showCi?: boolean;
}) {
  const previewed = readout.verdict !== "judged";
  const valueCls = [valueClassName ?? "", previewed ? styles.sampleDimValue : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={styles.rateWrap} title={previewed ? PREVIEW_NOTE : undefined}>
      <b className={valueCls}>{readout.valueLabel}</b>
      <SampleNote n={readout.n} ci={showCi ? readout.ciLabel : null} />
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
  n,
  ci,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  /** When given, the value carries its sample size and greys below n=30. */
  n?: number;
  ci?: string | null;
}) {
  const previewed = n !== undefined && sampleVerdict(n) !== "judged";
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span
        className={`${styles.kpiValue} ${toneClass(tone)} ${previewed ? styles.sampleDimValue : ""}`}
        title={previewed ? PREVIEW_NOTE : undefined}
      >
        {value}
      </span>
      {n !== undefined && <SampleNote n={n} ci={ci} />}
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
  const emit = (raw: number) => {
    if (Number.isNaN(raw)) return; // empty/partial input — don't emit
    let v = raw;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };
  const stepBy = (dir: 1 | -1) => {
    const s = step ?? 1;
    emit(Number((value + dir * s).toFixed(6)));
  };

  if (slider && min !== undefined && max !== undefined) {
    return (
      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          {label}
          <span className={styles.fieldValue}>
            <input
              type="number"
              className={styles.inputCompact}
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => emit(Number(e.target.value))}
              aria-label={`${label} value`}
            />
            {unit ? ` ${unit}` : ""}
          </span>
        </span>
        <div className={styles.sliderRow}>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => stepBy(-1)}
            aria-label={`Decrease ${label}`}
          >
            −
          </button>
          <input
            type="range"
            className={styles.range}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={label}
          />
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => stepBy(1)}
            aria-label={`Increase ${label}`}
          >
            +
          </button>
        </div>
        {help && <span className={styles.fieldHelp}>{help}</span>}
      </div>
    );
  }

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        <span className={styles.fieldValue}>
          {value}
          {unit ? ` ${unit}` : ""}
        </span>
      </span>
      <input
        type="number"
        className={styles.input}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
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
  mobileCards,
}: {
  columns: string[];
  rows: React.ReactNode[][];
  empty?: string;
  /* Opt-in: on ≤768px screens, render rows as stacked cards instead of a
     wide horizontal-scroll table. titleIndexes pick the cells shown in the
     card header; hideIndexes drop cells entirely on mobile. */
  mobileCards?: { titleIndexes: number[]; hideIndexes?: number[] };
}) {
  if (!rows.length) return <div className={styles.empty}>{empty ?? "No rows."}</div>;
  const table = (
    <div className={mobileCards ? `${styles.tableWrap} ${styles.tableDesktop}` : styles.tableWrap}>
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
  if (!mobileCards) return table;
  const titles = new Set(mobileCards.titleIndexes);
  const hidden = new Set(mobileCards.hideIndexes ?? []);
  return (
    <>
      {table}
      <div className={styles.cardList}>
        {rows.map((r, i) => (
          <div key={i} className={styles.cardItem}>
            <div className={styles.cardItemHead}>
              {mobileCards.titleIndexes.map((idx) => (
                <span key={idx}>{r[idx]}</span>
              ))}
            </div>
            <div className={styles.cardItemBody}>
              {r.map((cell, j) =>
                titles.has(j) || hidden.has(j) ? null : (
                  <Fragment key={j}>
                    <span className={styles.cardItemLabel}>{columns[j]}</span>
                    <span className={styles.cardItemValue}>{cell}</span>
                  </Fragment>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
