import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/AppStore";
import type { Watch } from "../types";
import {
  EmptyState,
  PageHeader,
  PlatformChip,
  Stat,
} from "../components/ui";
import {
  ArrowRightIcon,
  ClockIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
} from "../components/Icons";
import {
  cn,
  formatBounty,
  formatNumber,
  platformLabel,
  timeAgo,
} from "../lib/format";
import { latestChangeFor } from "../lib/selectors";
import type { Program } from "../types";

export function ProgramsPage() {
  const {
    data,
    mode,
    watchlist,
    watches,
    toggleWatch,
    addWatch,
    updateWatch,
    notify,
    syncBusy,
  } = useApp();
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [trackPlatform, setTrackPlatform] = useState("all");
  const [handle, setHandle] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const [watchInterval, setWatchInterval] = useState(30);

  const programs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.programs
      .filter((program) => (platform === "all" ? true : program.platform === platform))
      .filter((program) => {
        if (!needle) return true;
        return [program.name, program.handle, program.id, program.industry || "", ...program.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .slice()
      .sort((a, b) => {
        const aChanged = a.last_changed_at ? Date.parse(a.last_changed_at) : 0;
        const bChanged = b.last_changed_at ? Date.parse(b.last_changed_at) : 0;
        if (aChanged !== bChanged) return bChanged - aChanged;
        return a.name.localeCompare(b.name);
      });
  }, [data.programs, platform, query]);

  const inScope = data.programs.reduce((sum, program) => sum + program.scope_counts.in_scope, 0);
  const bountyEligible = data.programs.reduce(
    (sum, program) => sum + program.scope_counts.bounty_eligible,
    0,
  );

  function submitTrack(event: FormEvent) {
    event.preventDefault();
    const needle = handle.trim().toLowerCase();
    if (!needle) {
      notify("Enter a program handle or ID.", "error");
      return;
    }
    const found = data.programs.find(
      (program) =>
        (trackPlatform === "all" || program.platform === trackPlatform) &&
        (program.id.toLowerCase() === needle ||
          program.handle.toLowerCase() === needle ||
          program.name.toLowerCase() === needle),
    );
    if (!found) {
      notify(
        "No seeded program matches that handle. In live mode the worker can sync a handle on demand.",
        "error",
      );
      return;
    }
    if (watchlist.includes(found.id)) {
      notify(`${found.name} is already on your watchlist.`, "info");
      return;
    }
    toggleWatch(found.id);
    setHandle("");
  }

  async function submitLiveWatch(event: FormEvent) {
    event.preventDefault();
    if (!watchUrl.trim()) {
      notify("Paste a supported program URL first.", "error");
      return;
    }
    const result = await addWatch(watchUrl.trim(), watchInterval);
    if (result) {
      setWatchUrl("");
    }
  }

  const unwatched = data.programs.filter((program) => !watchlist.includes(program.id)).slice(0, 3);
  const watchById = new Map(watches.map((watch) => [watch.program_id, watch]));
  const pendingWatches = watches.filter(
    (watch) => watch.status === "pending" || watch.status === "error",
  );

  return (
    <>
      <PageHeader
        eyebrow="Program directory"
        title="Programs worth watching."
        sub="Each program keeps an append-only snapshot history. Pick the programs that pay for the bugs you actually hunt, and the feed will rank their changes against your targets."
        actions={
          <Link className="button" to="/watchlist">
            <StarIcon size={13} />
            Watchlist ({watchlist.length})
          </Link>
        }
      />

      <div className="stats">
        <Stat label="Programs" value={data.programs.length} sub={`${data.platforms.length} sources`} />
        <Stat
          label="Watched"
          value={watchlist.length + pendingWatches.length}
          sub={`${pendingWatches.length} queued for baseline`}
          accent
        />
        <Stat
          label="In-scope targets"
          value={formatNumber(inScope)}
          sub="Across all current snapshots"
        />
        <Stat
          label="Bounty eligible"
          value={formatNumber(bountyEligible)}
          sub="Targets with a reward tier"
        />
      </div>

      <div className="feed-toolbar">
        <div className="search">
          <span className="search__icon">
            <SearchIcon size={14} />
          </span>
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search programs, handles or industries…"
            aria-label="Search programs"
          />
        </div>
        <div className="feed-toolbar__actions">
          <select
            className="select"
            style={{ width: "auto" }}
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
            aria-label="Filter programs by platform"
          >
            <option value="all">All platforms</option>
            {data.platforms.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <span className="feed-count">
            {programs.length} of {data.programs.length}
          </span>
        </div>
      </div>

      {programs.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={18} />}
          title="No programs match"
          actions={
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setQuery("");
                setPlatform("all");
              }}
            >
              Clear filters
            </button>
          }
        >
          Try a different name or platform.
        </EmptyState>
      ) : (
        <div className="program-grid">
          {programs.map((program) => (
            <ProgramCard
              key={program.id}
              program={program}
              watched={watchlist.includes(program.id)}
              watch={watchById.get(program.id)}
              onToggle={() => toggleWatch(program.id)}
              onIntervalChange={(value) =>
                void updateWatch(program.id, { interval_minutes: value })
              }
              latestVersion={latestChangeFor(data, program.id)?.to_version ?? null}
              latestAt={latestChangeFor(data, program.id)?.detected_at ?? null}
            />
          ))}
        </div>
      )}

      {mode === "live" && pendingWatches.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card__header">
            <div>
              <h2 className="card__title">Queued baselines</h2>
              <p className="card__sub">
                The free GitHub Actions cron processes these every 30 minutes.
              </p>
            </div>
            <span className="chip chip--yellow">{pendingWatches.length} queued</span>
          </div>
          <div className="watch-list">
            {pendingWatches.map((watch) => (
              <div className="watch-item" key={watch.program_id}>
                <div className="watch-item__main">
                  <div className="watch-item__name">
                    {watch.status === "error" ? "Baseline failed" : "Queued baseline"}
                  </div>
                  <div className="watch-item__meta mono">{watch.program_url}</div>
                  <div className="watch-item__meta">
                    every {watch.interval_minutes} min ·{" "}
                    {watch.status === "error"
                      ? watch.error || "The source could not be read."
                      : "waiting for the next cron run"}
                  </div>
                </div>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => void toggleWatch(watch.program_id)}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === "live" ? (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card__header">
            <div>
              <h2 className="card__title">Watch a program by URL</h2>
              <p className="card__sub">
                Paste a public Bugcrowd, HackerOne or Intigriti program page. The worker
                captures the first scope version immediately, then the cron re-checks it.
              </p>
            </div>
          </div>
          <form className="track-form" onSubmit={submitLiveWatch}>
            <div className="track-form__row">
              <input
                className="input input--mono"
                value={watchUrl}
                onChange={(event) => setWatchUrl(event.target.value)}
                placeholder="https://hackerone.com/rails"
                aria-label="Program URL"
                spellCheck={false}
              />
              <select
                className="select"
                style={{ width: "auto" }}
                value={watchInterval}
                onChange={(event) => setWatchInterval(Number(event.target.value))}
                aria-label="Check interval"
              >
                <option value={30}>Every 30 min</option>
                <option value={60}>Every 60 min</option>
              </select>
            </div>
            <div className="pref-inline">
              <button type="submit" className="button button--primary" disabled={syncBusy}>
                <PlusIcon size={13} />
                {syncBusy ? "Fetching first version…" : "Watch program"}
              </button>
              <span className="field-note">
                Supported: bugcrowd.com · hackerone.com · app.intigriti.com. Unknown pages
                are rejected instead of guessed at.
              </span>
            </div>
          </form>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card__header">
            <div>
              <h2 className="card__title">Add a program to your watchlist</h2>
              <p className="card__sub">
                This demo matches the four seeded programs below. Switch to Live to add a real
                program URL.
              </p>
            </div>
          </div>
          <form className="track-form" onSubmit={submitTrack}>
            <div className="track-form__row">
              <select
                className="select"
                value={trackPlatform}
                onChange={(event) => setTrackPlatform(event.target.value)}
                aria-label="Platform"
              >
                <option value="all">Any platform</option>
                {data.platforms.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
              <input
                className="input"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="acme-cloud, or sandbox__acme-cloud"
                aria-label="Program handle"
              />
            </div>
            <div className="pref-inline">
              <button type="submit" className="button button--primary">
                <PlusIcon size={13} />
                Watch program
              </button>
              <span className="field-note">
                Example handles:{" "}
                {unwatched.length
                  ? unwatched.map((program, index) => (
                      <span key={program.id}>
                        {index > 0 ? " · " : ""}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setHandle(program.handle)}
                        >
                          {program.handle}
                        </button>
                      </span>
                    ))
                  : "all seeded programs are watched"}
              </span>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function ProgramCard({
  program,
  watched,
  watch,
  onToggle,
  onIntervalChange,
  latestVersion,
  latestAt,
}: {
  program: Program;
  watched: boolean;
  watch?: Watch;
  onToggle: () => void;
  onIntervalChange: (value: number) => void;
  latestVersion: number | null;
  latestAt: string | null;
}) {
  return (
    <article className="program-card">
      <div className="program-card__top">
        <div>
          <PlatformChip platform={program.platform} />
          <h2 className="program-card__title">
            <Link to={`/programs/${program.id}`}>{program.name}</Link>
          </h2>
          <div className="program-card__handle">
            {program.handle} · {program.industry || platformLabel(program.platform)}
          </div>
        </div>
        <button
          type="button"
          className={cn("icon-button", watched && "icon-button--active")}
          onClick={onToggle}
          aria-pressed={watched}
          title={watched ? "Stop watching" : "Watch this program"}
        >
          <StarIcon size={14} fill={watched ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="program-card__counts">
        <div className="mini-stat">
          <span className="mini-stat__value">{program.scope_counts.in_scope}</span>
          <span className="mini-stat__label">In scope</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat__value">{program.scope_counts.out_of_scope}</span>
          <span className="mini-stat__label">Out</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat__value">
            {formatBounty(program.max_bounty, program.currency)}
          </span>
          <span className="mini-stat__label">Max bounty</span>
        </div>
      </div>

      {watch && (
        <div className="pref-inline program-card__watch">
          <ClockIcon size={12} />
          <select
            className="select"
            style={{ width: "auto" }}
            value={watch.interval_minutes}
            onChange={(event) => onIntervalChange(Number(event.target.value))}
            aria-label={`Check interval for ${program.name}`}
          >
            <option value={30}>Every 30 min</option>
            <option value={60}>Every 60 min</option>
          </select>
          <span className="field-note">
            next {new Date(watch.next_check_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      )}

      <div className="program-card__foot">
        <span>
          {latestVersion
            ? `Latest diff v${latestVersion} · ${timeAgo(latestAt)}`
            : "Baseline only · no changes yet"}
        </span>
        <Link to={`/programs/${program.id}`}>
          Open <ArrowRightIcon size={11} />
        </Link>
      </div>
    </article>
  );
}
