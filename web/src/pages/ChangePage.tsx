import { Link, useParams } from "react-router-dom";
import type { ChangeItem } from "../types";
import { useApp } from "../state/AppStore";
import {
  AlertStatusChip,
  Callout,
  ConfidenceBadge,
  CopyButton,
  CountsRow,
  EmptyState,
  Fact,
  FieldDiff,
  ImpactBadge,
  MagnitudeBadge,
  MaterialityBar,
  PlatformChip,
  RowStat,
} from "../components/ui";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BellIcon,
  ChevronRightIcon,
  ClockIcon,
  ExternalLinkIcon,
  InfoIcon,
  PlayIcon,
  StarIcon,
  ZapIcon,
} from "../components/Icons";
import {
  changeHeadline,
  changeKindGlyph,
  changeKindLabel,
  cn,
  familyLabel,
  formatBounty,
  formatDateTime,
  impactLabel,
  scopeLabel,
  timeAgo,
} from "../lib/format";
import {
  changesFor,
  findProgram,
  itemsForChange,
  matchedTargetsForChange,
  visibleChanges,
} from "../lib/selectors";
import { itemMatchesTarget } from "../lib/matching";

const groupDefs = [
  { key: "added", title: "Added to scope", kinds: ["added"], tone: "added" },
  { key: "removed", title: "Removed from scope", kinds: ["removed"], tone: "removed" },
  { key: "modified", title: "Changed terms", kinds: ["modified"], tone: "changed" },
  { key: "reintroduced", title: "Returned to scope", kinds: ["reintroduced"], tone: "added" },
  { key: "moved", title: "Moved between groups", kinds: ["moved_in", "moved_out"], tone: "moved" },
];

export function ChangePage() {
  const { changeId = "" } = useParams();
  const { data, mode, testing, alertPrefs, simulate, simulateBusy, simulated } = useApp();
  const change = visibleChanges(data).find((row) => row.id === changeId) ?? null;

  if (!change) {
    const isHiddenV8 = mode === "demo" && changeId === "sandbox__acme-cloud__v8";
    return (
      <EmptyState
        icon={isHiddenV8 ? <ZapIcon size={18} /> : <InfoIcon size={18} />}
        title={isHiddenV8 ? "The v8 diff is still hidden" : "Change not found"}
        actions={
          isHiddenV8 ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => void simulate()}
              disabled={simulateBusy || simulated}
            >
              <PlayIcon size={13} />
              {simulateBusy ? "Publishing…" : "Simulate the v8 revision"}
            </button>
          ) : (
            <Link className="button button--primary" to="/">
              Back to the feed
            </Link>
          )
        }
      >
        {isHiddenV8
          ? mode === "demo"
            ? "The demo keeps v8 out of the store until you simulate the change, so the feed can prove it was detected after the fact."
            : "This change has not been published by the worker yet."
          : "That change ID is not in the current dataset."}
      </EmptyState>
    );
  }

  const program = findProgram(data, change.program_id);
  const items = itemsForChange(data, change);
  const matched = matchedTargetsForChange(data, change, testing);
  const matchedItems = items.filter((item) =>
    testing.some((target) => itemMatchesTarget(item, target)),
  );
  const recent = changesFor(data, change.program_id)
    .filter((row) => row.id !== change.id)
    .slice(0, 4);
  const instruction = items.find((item) => item.after?.instruction || item.before?.instruction);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Feed</Link>
        <ChevronRightIcon size={11} />
        {program ? <Link to={`/programs/${program.id}`}>{program.name}</Link> : <span>Program</span>}
        <ChevronRightIcon size={11} />
        <span>
          v{change.from_version} → v{change.to_version}
        </span>
      </nav>

      <section className="diff-hero">
        <div className="diff-hero__top">
          <div className="diff-hero__identity">
            <div className="diff-hero__program">
              <PlatformChip platform={change.platform} />
              {program ? (
                <Link className="anchor-link" to={`/programs/${program.id}`}>
                  {change.program_name}
                </Link>
              ) : (
                <span>{change.program_name}</span>
              )}
              {change.is_simulation && <span className="chip chip--accent">Simulated</span>}
              {change.is_baseline && <span className="chip">Baseline</span>}
            </div>
            <h1>{changeHeadline(change)}</h1>
            <div className="diff-hero__pair">
              v{change.from_version} → v{change.to_version}
              {change.source_revision_id ? ` · ${change.source_revision_id}` : ""}
              {change.source_published_at ? ` · published ${formatDateTime(change.source_published_at)}` : ""}
            </div>
          </div>
          <div className="diff-hero__meta">
            <ImpactBadge impact={change.impact} />
            <MagnitudeBadge magnitude={change.magnitude} />
            <ConfidenceBadge confidence={change.confidence} />
            <AlertStatusChip status={change.alert_status} />
            <CopyButton value={typeof window === "undefined" ? change.id : window.location.href} label="Copy link" compact />
          </div>
        </div>

        <div className="diff-hero__grid">
          <div className="score-block">
            <div className="score-block__value">
              {change.materiality_score}
              <small>/100</small>
            </div>
            <div className="score-block__label">Materiality score</div>
            <div className="score-block__bar">
              <MaterialityBar score={change.materiality_score} label="Weighted" hideScore />
            </div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              Why this ranks here
            </div>
            <ul className="reason-list">
              {change.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {change.confidence === "low" && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="accent" icon={<AlertTriangleIcon size={14} />}>
            <strong>Partial revision.</strong> The worker saw fewer targets than the previous
            snapshot and held this diff for a second identical fetch before alerting.
          </Callout>
        </div>
      )}

      <div className="diff-layout">
        <div className="diff-main">
          {groupDefs.map((group) => {
            const groupItems = items.filter((item) => group.kinds.includes(item.kind));
            if (!groupItems.length) return null;
            return (
              <section key={group.key} className={cn("diff-group", `diff-group--${group.tone}`)}>
                <div className="diff-group__bar" />
                <div className="diff-group__head">
                  <h2>{group.title}</h2>
                  <span className="chip">{groupItems.length}</span>
                </div>
                {groupItems.map((item) => (
                  <DiffItemRow key={item.id} item={item} programId={change.program_id} changeId={change.id} />
                ))}
              </section>
            );
          })}

          {items.length === 0 && (
            <EmptyState title="No target-level changes">
              This revision changed metadata but left the published target list intact.
            </EmptyState>
          )}

          {instruction && (
            <Callout tone="neutral" icon={<InfoIcon size={13} />}>
              <strong>Scope note on this diff:</strong>{" "}
              {instruction.after?.instruction || instruction.before?.instruction}
            </Callout>
          )}

          <div className="card card--soft">
            <div className="card__header">
              <div>
                <h2 className="card__title">What did not change</h2>
                <p className="card__sub">
                  ScopeDiff only reports observed deltas. Everything else in v
                  {change.to_version} is unchanged from v{change.from_version}.
                </p>
              </div>
            </div>
            <div className="pref-inline">
              <Link className="button button--sm" to={`/programs/${change.program_id}#scope`}>
                View current scope
                <ArrowRightIcon size={12} />
              </Link>
              {change.source_url && (
                <a
                  className="button button--sm button--ghost"
                  href={change.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Source revision
                  <ExternalLinkIcon size={11} />
                </a>
              )}
            </div>
          </div>
        </div>

        <aside className="diff-side">
          <section className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Change counts</h2>
                <p className="card__sub">One row per affected target</p>
              </div>
            </div>
            <CountsRow counts={change.counts} />
            <div className="kv" style={{ marginTop: 10 }}>
              <RowStat label="Detected" value={timeAgo(change.detected_at)} />
              <RowStat label="Status" value={change.status} />
              <RowStat label="Materiality" value={`${change.materiality_score}/100`} />
            </div>
          </section>

          <section className={cn("card", matched.length ? "card--accent" : undefined)}>
            <div className="card__header">
              <div>
                <h2 className="card__title">Your targets</h2>
                <p className="card__sub">
                  {testing.length
                    ? `${matched.length} of ${testing.length} testing targets matched`
                    : "No testing targets added yet"}
                </p>
              </div>
              <StarIcon size={15} />
            </div>
            {matched.length > 0 ? (
              <ul className="side-list">
                {matched.map((target) => (
                  <li key={target}>
                    <span className="mono">{target}</span>
                    <span className="side-score">affected</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="side-empty">
                {testing.length
                  ? "This diff does not touch the hosts or packages on your list."
                  : "Add the hosts and packages you test to see if a change hits your work."}
              </p>
            )}
            {matchedItems.length > 0 && (
              <div className="card__section">
                <div className="label" style={{ marginBottom: 5 }}>
                  Matching targets
                </div>
                <ul className="side-list">
                  {matchedItems.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <a className="anchor-link" href={`#${item.id}`}>
                        {item.display}
                      </a>
                      <span className="side-score">{item.materiality_score}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link className="link-button" to="/watchlist" style={{ display: "inline-block", marginTop: 9, fontSize: 10 }}>
              Edit testing targets →
            </Link>
          </section>

          <section className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Alert</h2>
                <p className="card__sub">Slack is the first channel</p>
              </div>
              <BellIcon size={14} />
            </div>
            <div className="alert-status">
              <AlertStatusChip status={change.alert_status} />
            </div>
            <div className="kv" style={{ marginTop: 8 }}>
              <RowStat label="Alerted" value={change.alerted_at ? formatDateTime(change.alerted_at) : "—"} />
              <RowStat label="Floor" value={`materiality ≥ ${alertPrefs.minScore}`} />
            </div>
            {change.alert_error && (
              <Callout tone="danger" icon={<AlertTriangleIcon size={12} />}>
                {change.alert_error}
              </Callout>
            )}
            <p className="side-empty" style={{ marginTop: 8 }}>
              {change.alert_status === "sent"
                ? "A Slack message was sent for this diff."
                : change.alert_status === "skipped"
                  ? "No alert was sent for this change."
                  : "The alert is queued or waiting for review."}
            </p>
            <Link className="link-button" to="/watchlist" style={{ display: "inline-block", marginTop: 5, fontSize: 10 }}>
              Alert preferences →
            </Link>
          </section>

          <section className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Source</h2>
                <p className="card__sub">Published facts only</p>
              </div>
            </div>
            <div className="kv">
              <RowStat label="Revision" value={change.source_revision_id || "—"} />
              <RowStat label="Published" value={formatDateTime(change.source_published_at)} />
              <RowStat label="Detected" value={formatDateTime(change.detected_at)} />
              <RowStat label="Program" value={change.program_id} />
            </div>
            {change.source_url && (
              <a
                className="link-button"
                href={change.source_url}
                target="_blank"
                rel="noreferrer"
                style={{ display: "inline-flex", gap: 5, marginTop: 9, alignItems: "center", fontSize: 10 }}
              >
                Open source revision
                <ExternalLinkIcon size={11} />
              </a>
            )}
          </section>

          {recent.length > 0 && (
            <section className="card">
              <div className="card__header">
                <div>
                  <h2 className="card__title">Recent changes</h2>
                  <p className="card__sub">Same program</p>
                </div>
                <ClockIcon size={14} />
              </div>
              <ul className="side-list">
                {recent.map((row) => (
                  <li key={row.id}>
                    <Link className="anchor-link" to={`/changes/${row.id}`}>
                      v{row.from_version} → v{row.to_version} · {changeHeadline(row)}
                    </Link>
                    <span className="side-score">{row.materiality_score}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function DiffItemRow({
  item,
  programId,
  changeId,
}: {
  item: ChangeItem;
  programId: string;
  changeId: string;
}) {
  const before = item.before;
  const after = item.after;
  const target = after?.canonical || before?.canonical || item.target;
  const summary = after || before;
  const facts = summary
    ? [
        { label: "Family", value: familyLabel(summary.family) },
        { label: "Scope", value: scopeLabel(summary.kind) },
        { label: "Groups", value: summary.groups.join(", ") || "—" },
        { label: "Reward tier", value: summary.bounty_tier || "—" },
        { label: "Max bounty", value: summary.bounty_eligible ? formatBounty(summary.max_bounty, summary.currency) : "Not eligible" },
        { label: "Severity", value: summary.max_severity || "—" },
      ]
    : [];

  return (
    <article className={cn("diff-row", `diff-row--${item.kind}`)} id={item.id}>
      <div className="diff-row__top">
        <div className="diff-row__identity">
          <span className="diff-row__glyph">{changeKindGlyph(item.kind)}</span>
          <div className="diff-row__body">
            <div className="diff-row__name">{item.display || target}</div>
            <div className="diff-row__target">{target}</div>
            <div className="diff-row__chips">
              <span className="chip">{changeKindLabel(item.kind)}</span>
              <span className="chip">{familyLabel(item.family)}</span>
              <span className={cn("chip", item.impact === "risk" ? "chip--red" : "chip--green")}>
                {impactLabel(item.impact)}
              </span>
              {item.group_names.map((group) => (
                <span className="chip" key={group}>
                  {group}
                </span>
              ))}
            </div>
          </div>
        </div>
        <span className="diff-row__score" title="Materiality score">
          {item.materiality_score}
        </span>
      </div>

      {item.reasons.length > 0 && (
        <div className="diff-row__reasons">
          {item.reasons.map((reason) => (
            <span className="chip" key={reason}>
              {reason}
            </span>
          ))}
        </div>
      )}

      {item.fields.length > 0 && (
        <div className="field-diffs">
          {item.fields.map((field) => (
            <FieldDiff key={`${item.id}-${field.field}`} field={field} />
          ))}
        </div>
      )}

      {facts.length > 0 && (
        <div className="facts">
          {facts.map((fact) => (
            <Fact key={`${item.id}-${fact.label}`} label={fact.label} value={fact.value} />
          ))}
        </div>
      )}

      {summary?.instruction && (
        <div className="instruction-box">
          <span className="label">Published instruction</span>
          <div style={{ marginTop: 3 }}>{summary.instruction}</div>
        </div>
      )}

      <div className="diff-row__actions">
        <CopyButton value={target} label="Copy target" compact />
        <Link className="button button--ghost button--sm" to={`/programs/${programId}#scope`}>
          Program scope
          <ArrowRightIcon size={11} />
        </Link>
        <span className="field-note" style={{ marginLeft: "auto" }}>
          {changeId} · {item.asset_key}
        </span>
      </div>
    </article>
  );
}
