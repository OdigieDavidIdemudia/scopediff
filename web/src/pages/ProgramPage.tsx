import { Link, useParams } from "react-router-dom";
import { useApp } from "../state/AppStore";
import { ScopeTable } from "../components/ScopeTable";
import { VersionTimeline } from "../components/Timeline";
import {
  ConfidenceBadge,
  EmptyState,
  MaterialityBar,
  PageHeader,
  PlatformChip,
  RowStat,
  Stat,
  AlertStatusChip,
} from "../components/ui";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  LayersIcon,
  StarIcon,
} from "../components/Icons";
import {
  changeHeadline,
  cn,
  formatBounty,
  formatDateTime,
  formatNumber,
  timeAgo,
} from "../lib/format";
import {
  changesFor,
  currentSnapshot,
  findProgram,
  itemsForChange,
  versionsFor,
} from "../lib/selectors";

export function ProgramPage() {
  const { programId = "" } = useParams();
  const { data, watchlist, toggleWatch } = useApp();
  const program = findProgram(data, programId);

  if (!program) {
    return (
      <EmptyState
        icon={<LayersIcon size={18} />}
        title="Program not found"
        actions={
          <Link className="button button--primary" to="/programs">
            Back to programs
          </Link>
        }
      >
        That program is not in the current dataset. It may have been removed or never synced.
      </EmptyState>
    );
  }

  const snapshot = currentSnapshot(data, program);
  const assets = snapshot?.assets ?? [];
  const versions = versionsFor(data, program.id);
  const changes = changesFor(data, program.id);
  const latest = changes[0] ?? null;
  const latestItems = latest ? itemsForChange(data, latest) : [];
  const watched = watchlist.includes(program.id);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/programs">Programs</Link>
        <ChevronRightIcon size={11} />
        <span>{program.name}</span>
      </nav>

      <PageHeader
        eyebrow={`${program.platform} program`}
        title={program.name}
        sub={
          <>
            {program.scope_counts.in_scope} in-scope targets ·{" "}
            {program.scope_counts.bounty_eligible} bounty eligible · last checked{" "}
            {timeAgo(program.last_checked_at)}
            {program.last_changed_at ? ` · last change ${timeAgo(program.last_changed_at)}` : ""}
          </>
        }
        actions={
          <>
            <button
              type="button"
              className={cn("button", watched ? "button--primary" : "button")}
              onClick={() => toggleWatch(program.id)}
              aria-pressed={watched}
            >
              <StarIcon size={13} fill={watched ? "currentColor" : "none"} />
              {watched ? "Watching" : "Watch"}
            </button>
            {latest && (
              <Link className="button button--primary" to={`/changes/${latest.id}`}>
                Latest diff
                <ArrowRightIcon size={13} />
              </Link>
            )}
            <a
              className="button button--ghost"
              href={program.url}
              target="_blank"
              rel="noreferrer"
              title="Official program page (example.com in this demo)"
            >
              Program page
              <ExternalLinkIcon size={12} />
            </a>
          </>
        }
      />

      <div className="change-card__meta" style={{ marginBottom: 18 }}>
        <PlatformChip platform={program.platform} />
        <span className="chip">{program.status}</span>
        {program.industry && <span className="chip">{program.industry}</span>}
        <span className="chip">{program.handle}</span>
        {latest && <AlertStatusChip status={latest.alert_status} />}
      </div>

      <div className="stats">
        <Stat label="In scope" value={program.scope_counts.in_scope} sub="Current snapshot" />
        <Stat
          label="Bounty eligible"
          value={program.scope_counts.bounty_eligible}
          sub="Targets with a reward tier"
          accent
        />
        <Stat label="Out of scope" value={program.scope_counts.out_of_scope} sub="Explicit exclusions" />
        <Stat
          label="Max bounty"
          value={formatBounty(program.max_bounty, program.currency)}
          sub={program.min_bounty ? `Minimum ${formatBounty(program.min_bounty, program.currency)}` : "Program maximum"}
        />
      </div>

      <div className="diff-layout">
        <div className="diff-main">
          <section className="card" id="scope">
            <div className="card__header">
              <div>
                <h2 className="card__title">Current scope</h2>
                <p className="card__sub">
                  v{program.current_version} · revision{" "}
                  {snapshot?.source_revision_id || program.source?.revision_id || "—"} ·{" "}
                  {formatNumber(assets.length)} published targets
                </p>
              </div>
              {snapshot && <ConfidenceBadge confidence={snapshot.confidence} />}
            </div>

            {snapshot ? (
              <ScopeTable assets={assets} latestChange={latest} latestItems={latestItems} />
            ) : (
              <EmptyState title="No snapshot captured">
                The worker has not stored a scope snapshot for this program yet.
              </EmptyState>
            )}
          </section>

          {latest && (
            <section className="card">
              <div className="card__header">
                <div>
                  <h2 className="card__title">Latest change · {changeHeadline(latest)}</h2>
                  <p className="card__sub">
                    v{latest.from_version} → v{latest.to_version} · detected{" "}
                    {formatDateTime(latest.detected_at)}
                  </p>
                </div>
                <AlertStatusChip status={latest.alert_status} />
              </div>
              <MaterialityBar score={latest.materiality_score} />
              <div className="pref-inline" style={{ marginTop: 12 }}>
                <Link className="button button--primary button--sm" to={`/changes/${latest.id}`}>
                  Open full diff
                  <ArrowRightIcon size={12} />
                </Link>
                <span className="field-note">
                  {latest.counts.total} targets affected · {latest.confidence} confidence
                </span>
              </div>
            </section>
          )}
        </div>

        <aside className="diff-side">
          <section className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Snapshot history</h2>
                <p className="card__sub">{versions.length} stored revisions</p>
              </div>
            </div>
            <VersionTimeline versions={versions} currentVersion={program.current_version} />
          </section>

          <section className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Program facts</h2>
                <p className="card__sub">From the published program metadata</p>
              </div>
            </div>
            <div className="kv">
              <RowStat label="Platform" value={program.platform} />
              <RowStat label="Handle" value={program.handle} />
              <RowStat label="Status" value={program.status} />
              <RowStat label="Industry" value={program.industry || "—"} />
              <RowStat label="Bounties" value={program.offers_bounties ? "Offered" : "VDP only"} />
              <RowStat label="Currency" value={program.currency} />
              <RowStat label="First seen" value={timeAgo(program.first_seen_at)} />
              <RowStat label="Last checked" value={timeAgo(program.last_checked_at)} />
            </div>
          </section>

          <section className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Source revision</h2>
                <p className="card__sub">The exact published revision behind this snapshot</p>
              </div>
            </div>
            <div className="kv">
              <RowStat label="Adapter" value={snapshot?.source_revision_id ? program.source?.adapter || program.platform : program.platform} />
              <RowStat label="Revision" value={snapshot?.source_revision_id || program.source?.revision_id || "—"} />
              <RowStat label="Published" value={formatDateTime(snapshot?.source_published_at || program.source?.published_at)} />
              <RowStat label="Fetched" value={formatDateTime(program.source?.fetched_at)} />
              <RowStat label="Complete" value={snapshot?.complete === false ? "No" : "Yes"} />
            </div>
            {snapshot?.source_url && (
              <a
                className="link-button"
                href={snapshot.source_url}
                target="_blank"
                rel="noreferrer"
                style={{ display: "inline-flex", gap: 5, marginTop: 10, alignItems: "center", fontSize: 10 }}
              >
                Open revision
                <ExternalLinkIcon size={11} />
              </a>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
