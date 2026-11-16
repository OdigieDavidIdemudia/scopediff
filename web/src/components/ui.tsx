import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  AlertStatus,
  Change,
  ChangeCounts,
  Confidence,
  FieldChange,
  Impact,
  Magnitude,
  Platform,
  PlatformStatus,
  ScopeCounts,
} from "../types";
import {
  cn,
  confidenceLabel,
  familyLabel,
  formatDateTime,
  formatFieldValue,
  formatLatency,
  impactLabel,
  magnitudeLabel,
  platformLabel,
  scopeLabel,
  statusLabel,
  timeAgo,
  titleCase,
} from "../lib/format";
import { useApp } from "../state/AppStore";
import {
  AlertTriangleIcon,
  BellIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CopyIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  RefreshIcon,
  XIcon,
} from "./Icons";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" to="/" aria-label="ScopeDiff home">
      <span className="brand__mark" aria-hidden="true">
        <span className="brand__bar brand__bar--a" />
        <span className="brand__bar brand__bar--b" />
      </span>
      {!compact && (
        <span className="brand__word">
          Scope<span>Diff</span>
        </span>
      )}
    </Link>
  );
}

export function SectionHead({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <span className="section-head__title">{title}</span>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="page-header__eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p className="page-header__sub">{sub}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={cn("stat", accent && "stat--accent")}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

export function PlatformChip({ platform }: { platform: Platform }) {
  return (
    <span className={cn("platform-chip", `platform-chip--${platform}`)}>
      {platformLabel(platform)}
    </span>
  );
}

export function ImpactBadge({ impact }: { impact: Impact }) {
  return (
    <span className={cn("badge", `badge--${impact}`)}>
      {impact === "risk" ? <AlertTriangleIcon size={10} /> : null}
      {impact === "opportunity" ? <PlusIcon size={10} /> : null}
      {impact === "mixed" ? <RefreshIcon size={10} /> : null}
      {impactLabel(impact)}
    </span>
  );
}

export function MagnitudeBadge({ magnitude }: { magnitude: Magnitude }) {
  return (
    <span className={cn("badge", `badge--${magnitude}`)}>
      {magnitudeLabel(magnitude)}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className={cn("badge", `badge--confidence-${confidence}`)} title={confidenceLabel(confidence)}>
      {confidence === "high" ? <CheckIcon size={10} /> : <AlertTriangleIcon size={10} />}
      {confidence === "high" ? "High confidence" : "Low confidence"}
    </span>
  );
}

export function ScopeChip({ kind }: { kind: string }) {
  return (
    <span
      className={cn(
        "chip",
        kind === "in" ? "chip--green" : kind === "out" ? "chip--red" : "chip--yellow",
      )}
    >
      {scopeLabel(kind)}
    </span>
  );
}

export function AlertStatusChip({ status }: { status: AlertStatus }) {
  const label =
    status === "sent"
      ? "Alert sent"
      : status === "pending"
        ? "Alert pending"
        : status === "failed"
          ? "Alert failed"
          : "No alert";
  return (
    <span
      className={cn(
        "chip",
        status === "sent"
          ? "chip--green"
          : status === "failed"
            ? "chip--red"
            : status === "pending"
              ? "chip--yellow"
              : undefined,
      )}
    >
      <BellIcon size={10} />
      {label}
    </span>
  );
}

export function MaterialityBar({
  score,
  label = "Materiality",
  hideScore = false,
}: {
  score: number;
  label?: string;
  hideScore?: boolean;
}) {
  return (
    <div className="materiality" title={`Materiality ${score}/100`}>
      <span className="materiality__label">{label}</span>
      <div className="materiality__track">
        <div className="materiality__fill" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
      </div>
      {!hideScore && <span className="materiality__score">{score}</span>}
    </div>
  );
}

export function CountsRow({ counts }: { counts: ChangeCounts }) {
  const rows: Array<{ key: keyof ChangeCounts; label: string; tone: string }> = [
    { key: "added", label: "added", tone: "count-pill--added" },
    { key: "removed", label: "removed", tone: "count-pill--removed" },
    { key: "reintroduced", label: "returned", tone: "count-pill--returned" },
    { key: "modified", label: "changed", tone: "count-pill--modified" },
    { key: "moved_in", label: "moved in", tone: "count-pill--added" },
    { key: "moved_out", label: "moved out", tone: "count-pill--removed" },
  ];
  return (
    <div className="counts-row">
      {rows.map((row) =>
        counts[row.key] > 0 ? (
          <span key={row.key} className={cn("count-pill", row.tone)}>
            <strong>{counts[row.key]}</strong> {row.label}
          </span>
        ) : null,
      )}
      <span className="count-pill count-pill--plain">
        <strong>{counts.total}</strong> total
      </span>
    </div>
  );
}

export function SourceStrip({ platforms }: { platforms: PlatformStatus[] }) {
  return (
    <section aria-label="Source health">
      <SectionHead
        title="Source health"
        action={<Link to="/admin">Worker admin →</Link>}
      />
      <div className="source-strip">
        {platforms.map((platform) => (
          <div className="source-cell" key={platform.id}>
            <div className="source-cell__top">
              <span className="source-cell__name">
                <span
                  className={cn(
                    "dot",
                    platform.status === "ok"
                      ? "dot--ok"
                      : platform.status === "error"
                        ? "dot--error"
                        : platform.status === "warn"
                          ? "dot--warn"
                          : "dot--unknown",
                  )}
                  aria-hidden="true"
                />
                {platform.name}
              </span>
              <span className="source-cell__count" title={`${platform.programs_count} programs`}>
                {platform.programs_count}p
              </span>
            </div>
            <div className="source-cell__meta">{platform.message || "No status yet"}</div>
            <div className="source-cell__foot">
              <span>{timeAgo(platform.last_run_at)}</span>
              <span>{formatLatency(platform.latency_ms)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FieldDiff({ field }: { field: FieldChange }) {
  const before = formatFieldValue(field.field, field.before);
  const after = formatFieldValue(field.field, field.after);
  const long = before.length > 52 || after.length > 52 || before.includes("\n") || after.includes("\n");
  return (
    <div className={cn("field-diff", long && "field-diff--long")}>
      <div className="field-diff__label">{field.label || titleCase(field.field)}</div>
      <div className="field-diff__values">
        <span className="field-diff__before">{before}</span>
        <span className="field-diff__arrow">→</span>
        <span className="field-diff__after">{after}</span>
      </div>
    </div>
  );
}

export function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="fact">
      <span className="fact__label">{label}</span>
      <span className={cn("fact__value", mono && "mono")}>{value || "—"}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon || <InfoIcon size={18} />}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  );
}

export function Callout({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: "neutral" | "accent" | "danger" | "green";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn("callout", tone !== "neutral" && `callout--${tone}`)}>
      <span className="callout__icon">{icon || <InfoIcon size={13} />}</span>
      <div>{children}</div>
    </div>
  );
}

export function CopyButton({
  value,
  label = "Copy",
  compact = false,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const { notify } = useApp();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      notify(`Copied ${value}`, "success");
    } catch {
      notify("Could not access the clipboard.", "error");
    }
  }
  return (
    <button
      type="button"
      className={cn(compact ? "button button--ghost button--sm" : "button button--sm")}
      onClick={copy}
      title={`Copy ${value}`}
    >
      <CopyIcon size={12} />
      {label}
    </button>
  );
}

export function ToastView() {
  const { toast, dismissToast } = useApp();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismissToast, toast.kind === "error" ? 8000 : 6000);
    return () => window.clearTimeout(timer);
  }, [dismissToast, toast]);

  if (!toast) return null;

  return (
    <div
      className={cn("toast", toast.kind === "error" && "toast--error")}
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
    >
      <span className="toast__icon">
        {toast.kind === "error" ? (
          <CircleAlertIcon size={16} />
        ) : toast.kind === "success" ? (
          <CircleCheckIcon size={16} />
        ) : (
          <InfoIcon size={16} />
        )}
      </span>
      <div className="toast__message">
        {toast.message}
        {toast.action && (
          <div style={{ marginTop: 7 }}>
            <Link
              className="button button--sm"
              to={toast.action.to}
              onClick={dismissToast}
            >
              {toast.action.label}
            </Link>
          </div>
        )}
      </div>
      <button
        type="button"
        className="toast__close"
        onClick={dismissToast}
        aria-label="Dismiss notification"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

export function LoadingScreen({ label = "Loading the latest scope diffs…" }: { label?: string }) {
  return (
    <div className="loading-screen">
      <div className="brand__mark" aria-hidden="true">
        <span className="brand__bar brand__bar--a" />
        <span className="brand__bar brand__bar--b" />
      </div>
      <p>{label}</p>
      <div className="skeleton" style={{ width: 260, height: 10 }} />
      <div className="skeleton" style={{ width: 180, height: 10 }} />
    </div>
  );
}

export function DataErrorScreen({
  message,
  onRetry,
  onDemo,
}: {
  message: string;
  onRetry: () => void;
  onDemo: () => void;
}) {
  return (
    <div className="empty" style={{ maxWidth: 660, margin: "48px auto" }}>
      <div className="empty__icon">
        <AlertTriangleIcon size={18} />
      </div>
      <h3>The worker did not answer</h3>
      <p>
        ScopeDiff could not load the live bootstrap. {message}
        <br />
        The demo dataset is bundled and uses reserved domains only.
      </p>
      <div className="empty__actions">
        <button type="button" className="button button--primary" onClick={onRetry}>
          <RefreshIcon size={13} />
          Retry
        </button>
        <button type="button" className="button" onClick={onDemo}>
          Use demo data
        </button>
      </div>
    </div>
  );
}

export function RowStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kv__row">
      <span className="kv__key">{label}</span>
      <span className="kv__value">{value}</span>
    </div>
  );
}

export function ScopeCountChips({ counts }: { counts: ScopeCounts }) {
  return (
    <div className="counts-row">
      <span className="count-pill count-pill--added">{counts.in_scope} in</span>
      <span className="count-pill count-pill--removed">{counts.out_of_scope} out</span>
      {counts.conflict > 0 && (
        <span className="count-pill count-pill--modified">{counts.conflict} conflict</span>
      )}
      <span className="count-pill count-pill--plain">{counts.bounty_eligible} bounty</span>
    </div>
  );
}

export function ChangeMeta({ change }: { change: Change }) {
  return (
    <div className="change-card__meta">
      <PlatformChip platform={change.platform} />
      {change.is_simulation && <span className="chip chip--accent">Simulated</span>}
      {change.is_baseline && <span className="chip">Baseline</span>}
      {change.confidence === "low" && (
        <span className="chip chip--yellow">Partial revision</span>
      )}
    </div>
  );
}

export function TimeStamp({ iso }: { iso: string | null | undefined }) {
  return (
    <time className="change-card__time" dateTime={iso || undefined} title={formatDateTime(iso)}>
      {timeAgo(iso)}
    </time>
  );
}

export function FamilyLabel({ family }: { family: string }) {
  return <span className="mini-badge">{familyLabel(family)}</span>;
}

export function StatusText({ status }: { status: string }) {
  return <span className="status-dot">{statusLabel(status)}</span>;
}

export function MinusBadge() {
  return <MinusIcon size={10} />;
}

export function PlusBadge() {
  return <PlusIcon size={10} />;
}

export function formatScopeSummary(counts: ChangeCounts): string {
  const parts: string[] = [];
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  if (counts.modified) parts.push(`${counts.modified} changed`);
  if (counts.reintroduced) parts.push(`${counts.reintroduced} returned`);
  return parts.join(", ") || "no target changes";
}
