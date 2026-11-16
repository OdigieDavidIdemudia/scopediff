import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../state/AppStore";
import {
  Callout,
  EmptyState,
  PageHeader,
  PlatformChip,
  Stat,
} from "../components/ui";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BellIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  PlayIcon,
  RotateIcon,
  ShieldIcon,
  TerminalIcon,
  ZapIcon,
} from "../components/Icons";
import {
  cn,
  formatDateTime,
  formatLatency,
  plural,
  timeAgo,
} from "../lib/format";
import { runStatusTone } from "../lib/selectors";
import type { Platform } from "../types";

const V8_ID = "sandbox__acme-cloud__v8";

export function AdminPage() {
  const {
    data,
    mode,
    simulated,
    simulateBusy,
    simulate,
    resetDemo,
    health,
    firebaseEnabled,
    profile,
    watches,
  } = useApp();
  const runs = useMemo(
    () => data.runs.slice().sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)),
    [data.runs],
  );
  const sandbox = data.programs.find((program) => program.id === "sandbox__acme-cloud");
  const healthy = data.platforms.filter((platform) => platform.status === "ok").length;
  const changes = data.changes.filter((change) => !change.hidden).length;
  const lastRun = runs[0] || null;
  const currentVersion = sandbox?.current_version ?? 7;
  const previousVersion = simulated ? Math.max(1, currentVersion - 1) : currentVersion;

  return (
    <>
      <PageHeader
        eyebrow="Worker admin"
        title="Demo controls & source health."
        sub="Everything behind the feed: the simulator, source status, stored revisions and the live worker wiring. No target is ever scanned; the worker only fetches published scope metadata."
        actions={
          <Link className="button" to="/">
            <ArrowRightIcon size={13} />
            Back to feed
          </Link>
        }
      />

      <div className="stats">
        <Stat label="Programs stored" value={data.programs.length} sub={`${data.versions.length} versions`} />
        <Stat label="Changes" value={changes} sub={simulated ? "v8 revealed in this session" : "v8 hidden until simulated"} />
        <Stat label="Sources healthy" value={`${healthy}/${data.platforms.length}`} sub="Latest run per adapter" accent />
        <Stat
          label="Last run"
          value={lastRun ? timeAgo(lastRun.started_at) : "—"}
          sub={
            lastRun
              ? `${lastRun.programs_seen} ${plural(lastRun.programs_seen, "program")} checked`
              : "No runs yet"
          }
        />
      </div>

      <div className="admin-grid">
        {mode === "demo" ? (
          <section className="simulator">
            <div className="simulator__top">
              <div>
                <div className="page-header__eyebrow" style={{ marginBottom: 4 }}>
                  Demo simulator
                </div>
                <h2 className="card__title">Publish a fictional v8 revision</h2>
                <p className="card__sub">
                  Runs the real diff engine against a new sandbox snapshot. No mocks in the
                  comparison path.
                </p>
              </div>
              <span className="chip chip--accent">Sandbox</span>
            </div>

            <div className="simulator__flow">
              <div className="sim-flow__box">
                <div className="sim-flow__value">v{previousVersion}</div>
                <div className="sim-flow__label">{simulated ? "Previous" : "Current"}</div>
              </div>
              <span className="sim-flow__arrow" aria-hidden="true">
                →
              </span>
              <div className="sim-flow__box sim-flow__box--next">
                <div className="sim-flow__value">
                  v{simulated ? currentVersion : currentVersion + 1}
                </div>
                <div className="sim-flow__label">{simulated ? "Live now" : "Next revision"}</div>
              </div>
            </div>

            <p className="card__sub" style={{ marginBottom: 12 }}>
              v8 adds <span className="mono">*.staging.acme.example</span> and{" "}
              <span className="mono">api.staging.acme.example</span>, reprices the production
              wildcard from Tier 1 / $10,000 to Tier 3 / $2,000, and removes{" "}
              <span className="mono">legacy.acme.example</span>.
            </p>

            <div className="pref-inline">
              {simulated ? (
                <>
                  <Link className="button button--primary" to={`/changes/${V8_ID}`}>
                    <ZapIcon size={13} />
                    Open the v8 diff
                  </Link>
                  <button type="button" className="button" onClick={resetDemo}>
                    <RotateIcon size={13} />
                    Reset demo
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void simulate()}
                  disabled={simulateBusy}
                >
                  <PlayIcon size={13} />
                  {simulateBusy ? "Publishing v8…" : "Simulate v8 scope change"}
                </button>
              )}
              <span className="field-note">
                Detection → diff → score → alert. The whole path is the production path.
              </span>
            </div>

            <div className="card__section">
              <div className="config-list">
                <div className="config-row">
                  <span className="config-row__key">1 · Publish</span>
                  <span className="config-row__value">FixtureAdapter → v8 revision</span>
                </div>
                <div className="config-row">
                  <span className="config-row__key">2 · Compare</span>
                  <span className="config-row__value">canonicalise → diff → materiality</span>
                </div>
                <div className="config-row">
                  <span className="config-row__key">3 · Notify</span>
                  <span className="config-row__value">feed entry + Slack payload</span>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="simulator">
            <div className="simulator__top">
              <div>
                <div className="page-header__eyebrow" style={{ marginBottom: 4 }}>
                  Live account
                </div>
                <h2 className="card__title">Your watchlist is on a schedule.</h2>
                <p className="card__sub">
                  A free GitHub Actions workflow runs every 30 minutes. Each watch carries its
                  own next-check timestamp, so queued baselines and due checks are processed in
                  one pass without a paid scheduler.
                </p>
              </div>
              <span className="chip chip--green">Live</span>
            </div>

            <div className="kv" style={{ marginTop: 14 }}>
              <div className="kv__row">
                <span className="kv__key">Account</span>
                <span className="kv__value">{profile?.email || "—"}</span>
              </div>
              <div className="kv__row">
                <span className="kv__key">Watched programs</span>
                <span className="kv__value">{watches.length}</span>
              </div>
              <div className="kv__row">
                <span className="kv__key">Testing targets</span>
                <span className="kv__value">{profile?.preferences.testing_targets.length ?? 0}</span>
              </div>
              <div className="kv__row">
                <span className="kv__key">Default interval</span>
                <span className="kv__value">
                  {profile?.preferences.interval_minutes ?? 15} minutes
                </span>
              </div>
              <div className="kv__row">
                <span className="kv__key">Alert mode</span>
                <span className="kv__value">{profile?.preferences.alert_mode ?? "high"}</span>
              </div>
            </div>

            <div className="pref-inline" style={{ marginTop: 14 }}>
              <Link className="button button--primary" to="/programs">
                Add a program
                <ArrowRightIcon size={12} />
              </Link>
              <Link className="button" to="/watchlist">
                Edit preferences
              </Link>
            </div>

            {watches.length > 0 && (
              <div className="card__section">
                <div className="config-list">
                  {watches.map((watch) => (
                    <div className="config-row" key={watch.program_id}>
                      <span className="config-row__key">
                        {watch.program_name} · {watch.interval_minutes}m
                      </span>
                      <span className="config-row__value">
                        next {timeAgo(watch.next_check_at)} · {watch.last_sync_status || "queued"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <section className="card">
          <div className="card__header">
            <div>
              <h2 className="card__title">Worker wiring</h2>
              <p className="card__sub">What is configured in this build</p>
            </div>
            <TerminalIcon size={15} />
          </div>
          <div className="config-list">
            <div className="config-row">
              <span className="config-row__key">Mode</span>
              <span className="config-row__value">{mode}</span>
            </div>
            <div className="config-row">
              <span className="config-row__key">API base</span>
              <span className="config-row__value">
                {mode === "live"
                  ? "Firestore direct"
                  : import.meta.env.VITE_API_URL || "bundled demo"}
              </span>
            </div>
            <div className="config-row">
              <span className="config-row__key">Store</span>
              <span className="config-row__value">
                {health?.store || (mode === "demo" ? "json (bundled)" : "firestore")}
              </span>
            </div>
            <div className="config-row">
              <span className="config-row__key">Auth</span>
              <span className="config-row__value">
                {firebaseEnabled ? "Firebase Auth" : mode === "demo" ? "demo session" : "not configured"}
              </span>
            </div>
            <div className="config-row">
              <span className="config-row__key">Slack</span>
              <span className="config-row__value">
                {health
                  ? health.slack_configured
                    ? "configured"
                    : "not configured"
                  : mode === "live"
                    ? "GitHub cron"
                    : "demo disabled"}
              </span>
            </div>
            <div className="config-row">
              <span className="config-row__key">HackerOne</span>
              <span className="config-row__value">
                {health
                  ? health.hackerone_configured
                    ? "token present"
                    : "token-gated"
                  : mode === "live"
                    ? "configured in cron"
                    : "token-gated"}
              </span>
            </div>
            <div className="config-row">
              <span className="config-row__key">Generated</span>
              <span className="config-row__value">{formatDateTime(data.meta.generated_at)}</span>
            </div>
          </div>
          <div className="card__section">
            <Callout tone="neutral" icon={<DatabaseIcon size={13} />}>
              Free-plan architecture: Firebase Auth + Firestore for accounts, Firebase
              Hosting for the app, and a GitHub Actions workflow for the 30-minute cron.
              The FastAPI worker is still in the repo for a future Cloud Run deployment,
              but the public app does not depend on it.
            </Callout>
          </div>
        </section>

        <section className="card watch-span">
          <div className="card__header">
            <div>
              <h2 className="card__title">Source status</h2>
              <p className="card__sub">The last observed run for each adapter</p>
            </div>
            <ShieldIcon size={15} />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="source-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Last run</th>
                  <th>Programs</th>
                  <th>Latency</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {data.platforms.map((platform) => (
                  <tr key={platform.id}>
                    <td>
                      <PlatformChip platform={platform.id as Platform} />
                    </td>
                    <td>
                      <span className="status-dot">
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
                        />
                        {platform.status}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 10 }}>
                      {timeAgo(platform.last_run_at)}
                    </td>
                    <td className="mono" style={{ fontSize: 10 }}>
                      {platform.programs_count}
                    </td>
                    <td className="mono" style={{ fontSize: 10 }}>
                      {formatLatency(platform.latency_ms)}
                    </td>
                    <td>{platform.message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card watch-span">
          <div className="card__header">
            <div>
              <h2 className="card__title">Recent runs</h2>
              <p className="card__sub">Structured source runs, including warnings</p>
            </div>
            <span className="field-note">Manual refresh only</span>
          </div>
          {runs.length === 0 ? (
            <EmptyState title="No runs recorded">Run a sync to populate source status.</EmptyState>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="source-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Platform</th>
                    <th>Started</th>
                    <th>Result</th>
                    <th>Programs</th>
                    <th>Assets</th>
                    <th>Latency</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 6).map((run) => (
                    <tr key={run.id}>
                      <td className="mono" style={{ fontSize: 9 }}>
                        {run.id}
                      </td>
                      <td>
                        <PlatformChip platform={run.platform as Platform} />
                      </td>
                      <td className="mono" style={{ fontSize: 10 }}>
                        {timeAgo(run.started_at)}
                      </td>
                      <td>
                        <span className="status-dot">
                          <span className={cn("dot", `dot--${runStatusTone(run.status)}`)} />
                          {run.status}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 10 }}>
                        {run.programs_seen} / {run.programs_changed}
                      </td>
                      <td className="mono" style={{ fontSize: 10 }}>
                        {run.assets_seen}
                      </td>
                      <td className="mono" style={{ fontSize: 10 }}>
                        {formatLatency(run.latency_ms)}
                      </td>
                      <td>{run.error || run.notes.join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card__header">
            <div>
              <h2 className="card__title">Safety & scope</h2>
              <p className="card__sub">Guardrails that are part of the pipeline</p>
            </div>
            <ShieldIcon size={15} />
          </div>
          <div className="config-list">
            <div className="config-row">
              <span className="config-row__key">No scanning</span>
              <span className="config-row__value">metadata only</span>
            </div>
            <div className="config-row">
              <span className="config-row__key">Collapse gate</span>
              <span className="config-row__value">&lt;40% scope held for second fetch</span>
            </div>
            <div className="config-row">
              <span className="config-row__key">Removal gate</span>
              <span className="config-row__value">≥50% removals need confirmation</span>
            </div>
            <div className="config-row">
              <span className="config-row__key">Zero targets</span>
              <span className="config-row__value">refused, never a change</span>
            </div>
            <div className="config-row">
              <span className="config-row__key">Webhooks</span>
              <span className="config-row__value">Slack hosts only</span>
            </div>
          </div>
          <div className="card__section">
            <Callout tone="green" icon={<BellIcon size={13} />}>
              Alerts are dispatched only after the change passes the confidence and
              materiality gates.
            </Callout>
          </div>
        </section>

        {mode === "demo" ? (
          <section className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Demo reset</h2>
                <p className="card__sub">Restores the bundled v7 dataset</p>
              </div>
              <AlertTriangleIcon size={15} />
            </div>
            <div className="danger-zone">
              <h3>Reset the local demo</h3>
              <p>
                Removes the simulated v8 change from this session and returns the sandbox to v7.
                This never touches the live worker store.
              </p>
              <button type="button" className="button button--danger button--sm" onClick={resetDemo}>
                <RotateIcon size={12} />
                Reset demo state
              </button>
            </div>
            <div className="card__section">
              <div className="pref-inline">
                <a
                  className="button button--ghost button--sm"
                  href={data.programs[0]?.url || "https://example.com"}
                  target="_blank"
                  rel="noreferrer"
                >
                  Reserved domain reference
                  <ExternalLinkIcon size={11} />
                </a>
                <span className="field-note">RFC 2606 / RFC 5737 only.</span>
              </div>
            </div>
          </section>
        ) : (
          <section className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Demo reset</h2>
                <p className="card__sub">Only available with the bundled dataset</p>
              </div>
              <RotateIcon size={15} />
            </div>
            <p className="side-empty">
              The live worker store is never reset from the browser. Use the demo build or the
              worker admin tooling to replay the sandbox scenario.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
