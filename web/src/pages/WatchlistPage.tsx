import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AlertPrefs } from "../types";
import { useApp } from "../state/AppStore";
import {
  Callout,
  EmptyState,
  PageHeader,
  PlatformChip,
  Stat,
} from "../components/ui";
import {
  ArrowRightIcon,
  BellIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  MessageIcon,
  PlusIcon,
  ShieldIcon,
  StarIcon,
  XIcon,
} from "../components/Icons";
import {
  changeHeadline,
  cn,
  formatDateTime,
  timeAgo,
} from "../lib/format";
import {
  changeTouchesTesting,
  countMatchedTestingTargets,
  visibleChanges,
} from "../lib/selectors";
import { hostPart } from "../lib/matching";

export function WatchlistPage() {
  const {
    data,
    mode,
    testing,
    watchlist,
    watches,
    updateWatch,
    addTestingTarget,
    removeTestingTarget,
    toggleWatch,
    alertPrefs,
    saveAlertPrefs,
    sendTestAlert,
  } = useApp();
  const [targetInput, setTargetInput] = useState("");
  const [prefs, setPrefs] = useState<AlertPrefs>(alertPrefs);
  const [showWebhook, setShowWebhook] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const watchedPrograms = data.programs.filter((program) => watchlist.includes(program.id));
  const unknownWatchlist = watchlist.filter(
    (id) => !data.programs.some((program) => program.id === id),
  );
  const pendingWatches = watches.filter(
    (watch) => watch.status === "pending" || watch.status === "error",
  );
  const changes = useMemo(() => visibleChanges(data), [data]);
  const affected = changes.filter((change) => changeTouchesTesting(data, change, testing));
  const matchedTargets = countMatchedTestingTargets(data, testing);

  const suggestions = useMemo(() => {
    const rows = data.snapshots
      .filter((snapshot) => snapshot.version === 1)
      .flatMap((snapshot) => snapshot.assets)
      .filter((asset) => ["web", "api", "wildcard"].includes(asset.family))
      .map((asset) => hostPart(asset.target));
    return Array.from(new Set(rows))
      .filter((target) => !testing.includes(target))
      .slice(0, 3);
  }, [data.snapshots, testing]);

  function submitTarget(event: FormEvent) {
    event.preventDefault();
    if (addTestingTarget(targetInput)) {
      setTargetInput("");
    }
  }

  function submitPrefs(event: FormEvent) {
    event.preventDefault();
    saveAlertPrefs(prefs);
    setLastSaved(new Date().toISOString());
  }

  return (
    <>
      <PageHeader
        eyebrow="Watchlist & alerts"
        title="Your targets, ranked."
        sub="Add the hosts, wildcards and package names you actually test. The feed then ranks every scope diff by whether it touches your work — and Slack gets the ones that clear the materiality floor."
        actions={
          <Link className="button" to="/">
            <ArrowRightIcon size={13} />
            Back to feed
          </Link>
        }
      />

      <div className="stats">
        <Stat label="Watched programs" value={watchedPrograms.length} sub={`${unknownWatchlist.length} unknown IDs`} />
        <Stat label="Testing targets" value={testing.length} sub="Hosts, wildcards, packages" />
        <Stat
          label="Changes touching you"
          value={affected.length}
          sub={`${matchedTargets} testing targets hit`}
          accent
        />
        <Stat
          label="Alert floor"
          value={alertPrefs.minScore}
          sub="Minimum materiality for Slack"
        />
      </div>

      <div className="watch-grid">
        <section className="card">
          <div className="card__header">
            <div>
              <h2 className="card__title">Watched programs</h2>
              <p className="card__sub">Watched programs sort first in the feed</p>
            </div>
            <StarIcon size={15} />
          </div>

          {watchedPrograms.length === 0 &&
          unknownWatchlist.length === 0 &&
          pendingWatches.length === 0 ? (
            <EmptyState
              title="Nothing watched yet"
              actions={
                <Link className="button button--primary button--sm" to="/programs">
                  Browse programs
                </Link>
              }
            >
              Pick a program from the directory to keep its changes close.
            </EmptyState>
          ) : (
            <div className="watch-list">
              {watchedPrograms.map((program) => (
                <div className="watch-item" key={program.id}>
                  <div className="watch-item__main">
                    <div className="watch-item__name">{program.name}</div>
                    <div className="watch-item__meta">
                      {program.handle} · {program.scope_counts.in_scope} in scope · last change{" "}
                      {program.last_changed_at ? timeAgo(program.last_changed_at) : "never"}
                    </div>
                  </div>
                  <div className="card-actions">
                    {mode === "live" && (
                      <select
                        className="select"
                        style={{ width: "auto" }}
                        value={
                          watches.find((watch) => watch.program_id === program.id)
                            ?.interval_minutes ?? 30
                        }
                        onChange={(event) =>
                          void updateWatch(program.id, {
                            interval_minutes: Number(event.target.value),
                          })
                        }
                        aria-label={`Check interval for ${program.name}`}
                      >
                        <option value={30}>30m</option>
                        <option value={60}>60m</option>
                      </select>
                    )}
                    <Link
                      className="icon-button icon-button--small"
                      to={`/programs/${program.id}`}
                      title={`Open ${program.name}`}
                      aria-label={`Open ${program.name}`}
                    >
                      <ArrowRightIcon size={12} />
                    </Link>
                    <button
                      type="button"
                      className="icon-button icon-button--small"
                      onClick={() => toggleWatch(program.id)}
                      title="Remove from watchlist"
                      aria-label={`Remove ${program.name} from watchlist`}
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                </div>
              ))}
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
                        : "waiting for the 30-minute cron"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => void toggleWatch(watch.program_id)}
                    title="Cancel queued baseline"
                    aria-label="Cancel queued baseline"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              ))}
              {unknownWatchlist.map((id) => (
                <div className="watch-item" key={id}>
                  <div className="watch-item__main">
                    <div className="watch-item__name">{id}</div>
                    <div className="watch-item__meta">Not present in this dataset</div>
                  </div>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => toggleWatch(id)}
                    aria-label={`Remove ${id}`}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card__header">
            <div>
              <h2 className="card__title">My testing targets</h2>
              <p className="card__sub">
                {testing.length} saved · wildcards and bare domains are matched broadly
              </p>
            </div>
            <ShieldIcon size={15} />
          </div>

          {testing.length === 0 ? (
            <p className="side-empty">
              Add a hostname such as <span className="mono">api.example.com</span>, a wildcard
              such as <span className="mono">*.example.com</span>, or a package name.
            </p>
          ) : (
            <div className="tag-list">
              {testing.map((target) => (
                <span className="tag" key={target}>
                  <span>{target}</span>
                  <button
                    type="button"
                    onClick={() => removeTestingTarget(target)}
                    aria-label={`Remove ${target}`}
                  >
                    <XIcon size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form className="add-target" onSubmit={submitTarget}>
            <input
              className="input input--mono"
              value={targetInput}
              onChange={(event) => setTargetInput(event.target.value)}
              placeholder="api.acme.example"
              aria-label="Add a testing target"
            />
            <button type="submit" className="button button--primary">
              <PlusIcon size={12} />
              Add
            </button>
          </form>
          {suggestions.length > 0 && (
            <div className="field-note" style={{ marginTop: 7 }}>
              Try:{" "}
              {suggestions.map((target, index) => (
                <span key={target}>
                  {index > 0 ? " · " : ""}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setTargetInput(target)}
                  >
                    {target}
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="card watch-span">
          <div className="card__header">
            <div>
              <h2 className="card__title">Changes touching your work</h2>
              <p className="card__sub">
                {affected.length
                  ? `${affected.length} of ${changes.length} tracked changes match your targets`
                  : "No tracked change matches your current targets"}
              </p>
            </div>
            <Link className="link-button" to="/">
              Open feed →
            </Link>
          </div>

          {affected.length === 0 ? (
            <p className="side-empty">
              {mode === "live"
                ? "No tracked change matches your current targets yet. The cron will create a change when one of your watched programs publishes a new scope."
                : `This is quieter than it looks: there are only ${changes.length} seeded changes. Simulate the sandbox revision to see a live match.`}
            </p>
          ) : (
            <div className="watch-list">
              {affected.slice(0, 5).map((change) => (
                <div className="watch-item" key={change.id}>
                  <div className="watch-item__main">
                    <Link className="watch-item__name" to={`/changes/${change.id}`}>
                      {changeHeadline(change)} · {change.program_name}
                    </Link>
                    <div className="watch-item__meta">
                      <PlatformChip platform={change.platform} /> v{change.from_version} → v
                      {change.to_version} · {timeAgo(change.detected_at)} · score{" "}
                      {change.materiality_score}
                    </div>
                  </div>
                  <Link className="button button--sm" to={`/changes/${change.id}`}>
                    Diff
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card watch-span">
          <div className="card__header">
            <div>
              <h2 className="card__title">Alert preferences</h2>
              <p className="card__sub">
                Slack first. Email digest is a stretch goal in this build.
              </p>
            </div>
            <BellIcon size={15} />
          </div>

          <form className="pref-form" onSubmit={submitPrefs}>
            <div className="pref-row">
              <label className="label" htmlFor="slack-webhook">
                Slack webhook
              </label>
              <div className="pref-inline">
                <input
                  id="slack-webhook"
                  className="input input--mono"
                  type={showWebhook ? "text" : "password"}
                  value={prefs.slackWebhook}
                  onChange={(event) =>
                    setPrefs((current) => ({ ...current, slackWebhook: event.target.value }))
                  }
                  placeholder="https://hooks.slack.com/services/…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setShowWebhook((value) => !value)}
                  aria-label={showWebhook ? "Hide webhook" : "Show webhook"}
                  title={showWebhook ? "Hide webhook" : "Show webhook"}
                >
                  {showWebhook ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                </button>
              </div>
              <span className="field-note">
                {mode === "live"
                  ? "Stored on your profile. The worker only posts to hooks.slack.com or hooks.slack-gov.com."
                  : "Stored only in this browser for the demo. The worker only posts to hooks.slack.com or hooks.slack-gov.com."}
              </span>
            </div>

            <div className="pref-row">
              <label className="label" htmlFor="min-score">
                Minimum materiality · {prefs.minScore}
              </label>
              <input
                id="min-score"
                type="range"
                min={0}
                max={100}
                step={5}
                value={prefs.minScore}
                onChange={(event) =>
                  setPrefs((current) => ({
                    ...current,
                    minScore: Number(event.target.value),
                  }))
                }
                style={{ accentColor: "var(--accent)" }}
              />
              <span className="field-note">
                The worker drops anything below this score. The default is 25.
              </span>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={prefs.email}
                onChange={(event) =>
                  setPrefs((current) => ({ ...current, email: event.target.checked }))
                }
              />
              <span>
                Email digest for low-priority changes
                <span className="subtle">
                  {mode === "live"
                    ? " — stored as a preference; delivery is a stretch goal."
                    : " — stored as a preference; not sent in this build."}
                </span>
              </span>
            </label>

            <div className="pref-inline">
              <button type="submit" className="button button--primary">
                Save preferences
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void sendTestAlert(prefs.slackWebhook)}
              >
                <MessageIcon size={13} />
                Send test alert
              </button>
              {mode === "demo" && (
                <span className="field-note">Slack delivery is disabled in demo mode.</span>
              )}
            </div>
          </form>

          <div className="card__section">
            <Callout tone="accent" icon={<ShieldIcon size={13} />}>
              {mode === "live"
                ? "Your profile and watches are stored against your Firebase account. The worker reads them with the Admin SDK and never exposes another user’s data."
                : "The public feed is authenticated. The bundled demo signs you in as a local viewer; production uses Firebase Auth."}
            </Callout>
          </div>

          <div className="kv" style={{ marginTop: 10 }}>
            <div className="kv__row">
              <span className="kv__key">Last saved</span>
              <span className="kv__value">
                {lastSaved ? formatDateTime(lastSaved) : "Not saved this session"}
              </span>
            </div>
            <div className="kv__row">
              <span className="kv__key">Channels</span>
              <span className="kv__value">Slack{prefs.email ? " + email digest" : ""}</span>
            </div>
            <div className="kv__row">
              <span className="kv__key">Feed access</span>
              <span className="kv__value">authenticated</span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
