import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { FeedFilters } from "../types";
import { useApp } from "../state/AppStore";
import { ChangeCard } from "../components/ChangeCard";
import { FilterPanel } from "../components/FilterPanel";
import {
  Callout,
  EmptyState,
  PageHeader,
  SourceStrip,
  Stat,
} from "../components/ui";
import {
  changeTouchesTesting,
  countMatchedTestingTargets,
  queryMatchesChange,
  visibleChanges,
} from "../lib/selectors";
import {
  FilterIcon,
  PlayIcon,
  SearchIcon,
  StarIcon,
  ZapIcon,
} from "../components/Icons";
import { formatDateTime } from "../lib/format";

const initialFilters: FeedFilters = {
  platform: "all",
  impact: "all",
  confidence: "all",
  watchedOnly: false,
  testingOnly: false,
  q: "",
};

export function FeedPage() {
  const {
    data,
    mode,
    testing,
    watchlist,
    watches,
    simulate,
    simulateBusy,
    simulated,
    freshChangeId,
  } = useApp();
  const [filters, setFilters] = useState<FeedFilters>(initialFilters);
  const [sort, setSort] = useState<"newest" | "score">("newest");
  const [limit, setLimit] = useState(8);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const changes = useMemo(() => visibleChanges(data), [data]);
  const platformCounts = useMemo(() => {
    const result: Record<string, number> = { all: changes.length };
    for (const change of changes) {
      result[change.platform] = (result[change.platform] || 0) + 1;
    }
    return result;
  }, [changes]);
  const impactCounts = useMemo(() => {
    const result: Record<string, number> = { all: changes.length };
    for (const change of changes) {
      result[change.impact] = (result[change.impact] || 0) + 1;
    }
    return result;
  }, [changes]);
  const confidenceCounts = useMemo(() => {
    const result: Record<string, number> = { all: changes.length };
    for (const change of changes) {
      result[change.confidence] = (result[change.confidence] || 0) + 1;
    }
    return result;
  }, [changes]);

  const watchedCount = changes.filter((change) => watchlist.includes(change.program_id)).length;
  const testingCount = changes.filter((change) => changeTouchesTesting(data, change, testing)).length;
  const matchedTargetCount = countMatchedTestingTargets(data, testing);

  const filtered = useMemo(() => {
    const rows = changes.filter((change) => {
      if (filters.platform !== "all" && change.platform !== filters.platform) return false;
      if (filters.impact !== "all" && change.impact !== filters.impact) return false;
      if (filters.confidence !== "all" && change.confidence !== filters.confidence) return false;
      if (filters.watchedOnly && !watchlist.includes(change.program_id)) return false;
      if (filters.testingOnly && !changeTouchesTesting(data, change, testing)) return false;
      if (!queryMatchesChange(data, change, filters.q)) return false;
      return true;
    });
    if (sort === "score") {
      rows.sort((a, b) => b.materiality_score - a.materiality_score);
    }
    return rows;
  }, [changes, data, filters, sort, testing, watchlist]);

  useEffect(() => {
    setLimit(8);
  }, [
    filters.platform,
    filters.impact,
    filters.confidence,
    filters.watchedOnly,
    filters.testingOnly,
    filters.q,
    sort,
  ]);

  const activeFilters =
    (filters.platform !== "all" ? 1 : 0) +
    (filters.impact !== "all" ? 1 : 0) +
    (filters.confidence !== "all" ? 1 : 0) +
    (filters.watchedOnly ? 1 : 0) +
    (filters.testingOnly ? 1 : 0) +
    (filters.q ? 1 : 0);

  const riskCount = changes.filter(
    (change) => change.impact === "risk" || change.impact === "mixed",
  ).length;
  const opportunityCount = changes.filter((change) => change.impact === "opportunity").length;
  const latest = changes[0];
  const maxScore = changes.reduce((max, change) => Math.max(max, change.materiality_score), 0);

  return (
    <>
      <PageHeader
        eyebrow="Change feed"
        title="Know what changed before you test."
        sub={
          <>
            Every published scope revision is stored, diffed and scored. Watching{" "}
            <strong>
              {data.programs.length} program{data.programs.length === 1 ? "" : "s"}
            </strong>{" "}
            across <strong>{data.platforms.length} sources</strong>. The feed shows published
            facts, not guesses.
          </>
        }
        actions={
          <>
            {mode === "demo" ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => void simulate()}
                disabled={simulateBusy || simulated}
                title={simulated ? "The v8 simulation is already live" : "Publish a fictional v8 revision"}
              >
                <PlayIcon size={13} />
                {simulateBusy
                  ? "Fetching revision…"
                  : simulated
                    ? "Simulation live"
                    : "Simulate scope change"}
              </button>
            ) : (
              <Link className="button button--primary" to="/programs">
                <ZapIcon size={13} />
                Add a program
              </Link>
            )}
            <Link className="button" to="/watchlist">
              <StarIcon size={13} />
              Watchlist
            </Link>
          </>
        }
      />

      <div className="stats">
        <Stat
          label="Changes tracked"
          value={changes.length}
          sub={`${data.programs.length} program${data.programs.length === 1 ? "" : "s"} · ${data.platforms.length} sources`}
        />
        <Stat
          label="Risk-side changes"
          value={riskCount}
          sub="Risk or mixed impact"
        />
        <Stat
          label="Opportunities"
          value={opportunityCount}
          sub="New scope or better rewards"
          accent
        />
        <Stat
          label="Your exposure"
          value={matchedTargetCount}
          sub={
            testing.length
              ? `${testing.length} testing targets watched`
              : "Add targets in the watchlist"
          }
        />
      </div>

      <SourceStrip platforms={data.platforms} />

      {simulated && mode === "demo" && (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="accent" icon={<ZapIcon size={14} />}>
            <strong>A simulated v8 revision was detected.</strong> The sandbox published two
            staging targets, repriced the production wildcard and removed one legacy target.{" "}
            <Link to="/changes/sandbox__acme-cloud__v8">Open the full diff →</Link>
          </Callout>
        </div>
      )}

      <div className="feed-toolbar">
        <div className="search">
          <span className="search__icon">
            <SearchIcon size={14} />
          </span>
          <input
            className="input"
            type="search"
            value={filters.q}
            onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
            placeholder="Search programs, targets or reasons…"
            aria-label="Search changes"
          />
        </div>
        <div className="feed-toolbar__actions">
          <button
            type="button"
            className="button button--ghost button--sm filter-toggle"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
          >
            <FilterIcon size={12} />
            Filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          <div className="segmented" role="group" aria-label="Sort changes">
            <button
              type="button"
              aria-pressed={sort === "newest"}
              onClick={() => setSort("newest")}
            >
              Newest
            </button>
            <button
              type="button"
              aria-pressed={sort === "score"}
              onClick={() => setSort("score")}
            >
              Materiality
            </button>
          </div>
          <span className="feed-count">
            {filtered.length} {filtered.length === 1 ? "change" : "changes"}
            {maxScore > 0 ? ` · top ${maxScore}` : ""}
          </span>
        </div>
      </div>

      <div className="feed-layout">
        <FilterPanel
          filters={filters}
          onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
          onClear={() => setFilters(initialFilters)}
          platformCounts={platformCounts}
          impactCounts={impactCounts}
          confidenceCounts={confidenceCounts}
          watchedCount={watchedCount}
          testingCount={testingCount}
          open={filtersOpen}
        />

        <div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={18} />}
              title={
                mode === "live" && data.programs.length === 0 && watches.length > 0
                  ? "Baseline queued"
                  : mode === "live" && data.programs.length === 0
                    ? "No watched programs yet"
                    : mode === "live" && changes.length === 0
                      ? "No scope changes yet"
                      : "No changes match this view"
              }
              actions={
                <>
                  {mode === "live" && data.programs.length === 0 && watches.length > 0 ? (
                    <Link className="button button--primary" to="/programs">
                      View queued programs
                    </Link>
                  ) : mode === "live" && data.programs.length === 0 ? (
                    <Link className="button button--primary" to="/programs">
                      Add your first program
                    </Link>
                  ) : mode === "live" && changes.length === 0 ? (
                    <Link className="button button--primary" to="/programs">
                      Add another program
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => setFilters(initialFilters)}
                    >
                      Clear filters
                    </button>
                  )}
                  <Link className="button" to="/watchlist">
                    Edit testing targets
                  </Link>
                </>
              }
            >
              {mode === "live" && data.programs.length === 0 && watches.length > 0
                ? "The program URL is queued. The free GitHub Actions cron runs every 30 minutes, captures the first scope version and activates the watch."
                : mode === "live" && data.programs.length === 0
                  ? "Paste a Bugcrowd, HackerOne or Intigriti program URL. The free cron captures the first version and checks it every 30 minutes."
                  : mode === "live" && changes.length === 0
                    ? "Your first program snapshot is stored. The cron will create a diff the next time the published scope changes."
                    : "Try a different platform or impact, clear the search, or add the hosts you actually test to the watchlist."}
            </EmptyState>
          ) : (
            <>
              <div className="feed-list">
                {filtered.slice(0, limit).map((change) => (
                  <ChangeCard
                    key={change.id}
                    change={change}
                    fresh={freshChangeId === change.id}
                  />
                ))}
              </div>
              {filtered.length > limit && (
                <div className="load-more">
                  <button
                    type="button"
                    className="button"
                    onClick={() => setLimit((value) => value + 8)}
                  >
                    Load {Math.min(8, filtered.length - limit)} more
                  </button>
                </div>
              )}
              {latest && (
                <p className="feed-count" style={{ marginTop: 12, textAlign: "center" }}>
                  Latest revision {latest.source_revision_id || "—"} · published{" "}
                  {latest.source_published_at
                    ? formatDateTime(latest.source_published_at)
                    : "unknown"}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
