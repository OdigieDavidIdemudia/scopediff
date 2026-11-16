import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../state/AppStore";
import { LoadingScreen } from "../components/ui";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  GlobeIcon,
  PlusIcon,
  ShieldIcon,
  SmartphoneIcon,
  StarIcon,
  XIcon,
} from "../components/Icons";
import { cn, looksLikeTarget } from "../lib/format";
import { normalizeTarget } from "../lib/matching";
import type {
  AlertMode,
  AssetFamily,
  BountyRange,
  Experience,
  Platform,
  SeverityPreference,
  UserPreferences,
  UserRole,
} from "../types";

const STEPS = ["About you", "What you hunt", "Signals", "Your targets", "First watch"];

const interests: Array<{ value: AssetFamily; label: string; hint: string }> = [
  { value: "web", label: "Web apps", hint: "Domains, portals, admin panels" },
  { value: "api", label: "APIs", hint: "REST, GraphQL, internal services" },
  { value: "wildcard", label: "Wildcards", hint: "Broad domain coverage" },
  { value: "mobile_android", label: "Android", hint: "APK and Play Store targets" },
  { value: "mobile_ios", label: "iOS", hint: "IPA and App Store targets" },
  { value: "source_code", label: "Source code", hint: "GitHub, GitLab, binaries" },
  { value: "hardware", label: "Hardware / IoT", hint: "Devices and firmware" },
  { value: "other", label: "Other", hint: "Cloud, networks, anything else" },
];

const platforms: Array<{ value: Platform; label: string }> = [
  { value: "bugcrowd", label: "Bugcrowd" },
  { value: "hackerone", label: "HackerOne" },
  { value: "intigriti", label: "Intigriti" },
];

const roles: Array<{ value: UserRole; label: string; hint: string }> = [
  { value: "hunter", label: "Solo hunter", hint: "I test programs myself" },
  { value: "team", label: "Security team", hint: "We track programs together" },
  { value: "consultancy", label: "Consultancy", hint: "We watch on behalf of clients" },
  { value: "other", label: "Other", hint: "Something else" },
];

const experience: Array<{ value: Experience; label: string }> = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "professional", label: "Professional" },
];

const bountyRanges: Array<{ value: BountyRange; label: string }> = [
  { value: "any", label: "Any bounty" },
  { value: "100", label: "$100+" },
  { value: "500", label: "$500+" },
  { value: "1000", label: "$1,000+" },
  { value: "5000", label: "$5,000+" },
];

const severities: Array<{ value: SeverityPreference; label: string }> = [
  { value: "any", label: "Any severity" },
  { value: "low", label: "Low+" },
  { value: "medium", label: "Medium+" },
  { value: "high", label: "High+" },
  { value: "critical", label: "Critical only" },
];

const alertModes: Array<{ value: AlertMode; label: string; hint: string }> = [
  { value: "all", label: "Everything", hint: "Every detected change" },
  { value: "high", label: "High signal", hint: "High or critical changes" },
  { value: "mine", label: "My targets", hint: "Only changes that touch me" },
];

const intervals: Array<{ value: number; label: string; hint: string }> = [
  { value: 30, label: "30 min", hint: "Free-plan default" },
  { value: 60, label: "1 hour", hint: "Low traffic" },
];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="choice" aria-pressed={active} onClick={onClick}>
      {active && <CheckIcon size={11} />}
      {children}
    </button>
  );
}

function ChoiceCard({
  active,
  onClick,
  title,
  hint,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <button type="button" className="choice-card" aria-pressed={active} onClick={onClick}>
      <span className="choice-card__top">
        {icon}
        <span>{title}</span>
        {active && <CheckIcon size={12} />}
      </span>
      {hint && <span className="choice-card__hint">{hint}</span>}
    </button>
  );
}

export function OnboardingPage() {
  const {
    mode,
    profile,
    profileLoading,
    loading,
    onboardingComplete,
    watches,
    addWatch,
    savePreferences,
    notify,
    syncBusy,
  } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [savedPrefs, setSavedPrefs] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [programUrl, setProgramUrl] = useState("");
  const [watchAdded, setWatchAdded] = useState(false);
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);

  useEffect(() => {
    if (!profile || prefs) return;
    const base = profile.preferences;
    setPrefs({
      ...base,
      interests: base.interests.length ? base.interests : ["web", "api"],
      platforms: base.platforms.length
        ? base.platforms
        : ["bugcrowd", "hackerone", "intigriti"],
      testing_targets: base.testing_targets ?? [],
      onboarding_complete: false,
      updated_at: new Date().toISOString(),
    });
  }, [prefs, profile]);

  if (mode !== "live") {
    return (
      <div className="empty" style={{ maxWidth: 620, margin: "48px auto" }}>
        <div className="empty__icon">
          <StarIcon size={18} />
        </div>
        <h3>Preferences belong to a live account</h3>
        <p>Sign in to create a profile, add real programs and schedule checks.</p>
        <Link className="button button--primary" to="/login">
          Sign in
        </Link>
      </div>
    );
  }

  if (profileLoading || loading || !prefs) {
    return <LoadingScreen label="Loading your preferences…" />;
  }

  if (onboardingComplete && !watchAdded) {
    return (
      <div className="onboarding-shell">
        <div className="card" style={{ maxWidth: 680, margin: "32px auto" }}>
          <div className="page-header__eyebrow">Onboarding complete</div>
          <h1 style={{ fontSize: 34, margin: "8px 0" }}>You're already set up.</h1>
          <p className="page-header__sub">
            Your profile has {profile?.preferences.testing_targets.length ?? 0} testing
            targets and {watches.length} watched program{watches.length === 1 ? "" : "s"}.
          </p>
          <div className="pref-inline">
            <Link className="button button--primary" to="/">
              Go to feed
              <ArrowRightIcon size={13} />
            </Link>
            <Link className="button" to="/programs">
              Add another program
            </Link>
          </div>
        </div>
      </div>
    );
  }

  function update(patch: Partial<UserPreferences>) {
    setPrefs((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleArray<T extends string>(values: T[], value: T): T[] {
    return values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
  }

  function next() {
    if (step === 1) {
      if (!prefs?.interests.length) {
        notify("Pick at least one thing you hunt.", "error");
        return;
      }
      if (!prefs?.platforms.length) {
        notify("Pick at least one platform.", "error");
        return;
      }
    }
    if (step === 3) {
      if (!prefs?.testing_targets.length) {
        notify("Add at least one hostname, wildcard or package you test.", "error");
        return;
      }
      setBusy(true);
      void savePreferences({
        ...(prefs as UserPreferences),
        onboarding_complete: false,
      })
        .then((ok) => {
          if (ok) {
            setSavedPrefs(true);
            setStep(4);
          }
        })
        .finally(() => setBusy(false));
      return;
    }
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  function addTarget() {
    if (!prefs) return;
    const target = normalizeTarget(targetInput);
    if (!target) {
      notify("Enter a hostname, wildcard, package or repository URL.", "error");
      return;
    }
    if (!looksLikeTarget(target)) {
      notify("That does not look like a target. Try api.example.com or *.example.com.", "error");
      return;
    }
    if (prefs.testing_targets.includes(target)) {
      notify("That target is already on your list.", "info");
      return;
    }
    update({ testing_targets: [...prefs.testing_targets, target] });
    setTargetInput("");
  }

  async function addFirstWatch() {
    if (!prefs) return;
    if (!programUrl.trim()) {
      notify("Paste a Bugcrowd, HackerOne or Intigriti program URL.", "error");
      return;
    }
    const result = await addWatch(programUrl.trim(), prefs.interval_minutes);
    if (result) {
      setWatchAdded(true);
      setProgramUrl("");
    }
  }

  async function finish() {
    if (!prefs) return;
    if (!watches.length && !watchAdded) {
      notify("Add at least one program to watch before finishing.", "error");
      return;
    }
    setBusy(true);
    const ok = await savePreferences({ ...prefs, onboarding_complete: true });
    setBusy(false);
    if (ok) {
      notify("You're set. The cron will check your programs on schedule.", "success");
      navigate("/", { replace: true });
    }
  }

  const stepContent: ReactNode[] = [
    <div key="about" className="wizard__body">
      <h2>How do you hunt?</h2>
      <p className="card__sub">This changes the language and defaults, not what you can watch.</p>
      <div className="choice-grid choice-grid--2">
        {roles.map((role) => (
          <ChoiceCard
            key={role.value}
            active={prefs.role === role.value}
            onClick={() => update({ role: role.value })}
            title={role.label}
            hint={role.hint}
            icon={<ShieldIcon size={15} />}
          />
        ))}
      </div>
      <div className="wizard__divider" />
      <div className="label">Experience</div>
      <div className="chip-row">
        {experience.map((item) => (
          <Chip
            key={item.value}
            active={prefs.experience === item.value}
            onClick={() => update({ experience: item.value })}
          >
            {item.label}
          </Chip>
        ))}
      </div>
    </div>,

    <div key="hunt" className="wizard__body">
      <h2>What do you actually test?</h2>
      <p className="card__sub">
        Pick the families you care about. We use this to rank new scope and to filter noise.
      </p>
      <div className="choice-grid choice-grid--2">
        {interests.map((item) => (
          <ChoiceCard
            key={item.value}
            active={prefs.interests.includes(item.value)}
            onClick={() =>
              update({ interests: toggleArray(prefs.interests, item.value) })
            }
            title={item.label}
            hint={item.hint}
            icon={
              ["mobile_android", "mobile_ios"].includes(item.value) ? (
                <SmartphoneIcon size={15} />
              ) : (
                <GlobeIcon size={15} />
              )
            }
          />
        ))}
      </div>
      <div className="wizard__divider" />
      <div className="label">Platforms you use</div>
      <div className="chip-row">
        {platforms.map((item) => (
          <Chip
            key={item.value}
            active={prefs.platforms.includes(item.value)}
            onClick={() =>
              update({ platforms: toggleArray(prefs.platforms, item.value) })
            }
          >
            {item.label}
          </Chip>
        ))}
      </div>
    </div>,

    <div key="signals" className="wizard__body">
      <h2>What should interrupt you?</h2>
      <p className="card__sub">
        These are preferences, not promises. You can change them later without losing history.
      </p>
      <div className="wizard__split">
        <div>
          <div className="label">Reward range</div>
          <div className="chip-row">
            {bountyRanges.map((item) => (
              <Chip
                key={item.value}
                active={prefs.bounty_range === item.value}
                onClick={() => update({ bounty_range: item.value })}
              >
                {item.label}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <div className="label">Severity interest</div>
          <div className="chip-row">
            {severities.map((item) => (
              <Chip
                key={item.value}
                active={prefs.severity === item.value}
                onClick={() => update({ severity: item.value })}
              >
                {item.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>
      <div className="wizard__divider" />
      <div className="label">Alert mode</div>
      <div className="choice-grid choice-grid--3">
        {alertModes.map((item) => (
          <ChoiceCard
            key={item.value}
            active={prefs.alert_mode === item.value}
            onClick={() => update({ alert_mode: item.value })}
            title={item.label}
            hint={item.hint}
          />
        ))}
      </div>
      <div className="wizard__divider" />
      <div className="wizard__split">
        <div>
          <div className="label">Minimum materiality · {prefs.min_materiality}</div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={prefs.min_materiality}
            onChange={(event) =>
              update({ min_materiality: Number(event.target.value) })
            }
            style={{ accentColor: "var(--accent)" }}
          />
          <span className="field-note">The worker drops anything below this score.</span>
        </div>
        <div>
          <div className="label">Check every</div>
          <div className="chip-row">
            {intervals.map((item) => (
              <Chip
                key={item.value}
                active={prefs.interval_minutes === item.value}
                onClick={() => update({ interval_minutes: item.value })}
              >
                {item.label}
              </Chip>
            ))}
          </div>
          <span className="field-note">
            Free plan: the GitHub cron runs every 30 minutes. One hour is also available.
          </span>
        </div>
      </div>
      <div className="wizard__divider" />
      <div className="wizard__split">
        <div>
          <label className="label" htmlFor="wizard-slack">
            Slack webhook (optional)
          </label>
          <input
            id="wizard-slack"
            className="input input--mono"
            type="password"
            value={prefs.slack_webhook || ""}
            onChange={(event) =>
              update({ slack_webhook: event.target.value || null })
            }
            placeholder="https://hooks.slack.com/services/…"
            autoComplete="off"
          />
          <span className="field-note">Only hooks.slack.com and hooks.slack-gov.com are accepted.</span>
        </div>
        <label className="checkbox-row" style={{ alignSelf: "end" }}>
          <input
            type="checkbox"
            checked={prefs.email_digest}
            onChange={(event) => update({ email_digest: event.target.checked })}
          />
          <span>Email digest for lower-priority changes</span>
        </label>
      </div>
    </div>,

    <div key="targets" className="wizard__body">
      <h2>Add the targets you actually test.</h2>
      <p className="card__sub">
        Manual input only. These are the hosts, wildcards, packages or repos we compare against
        every scope change. At least one is required.
      </p>
      <div className="wizard__targets">
        {prefs.testing_targets.length === 0 && (
          <span className="field-note">No targets yet. Add your first below.</span>
        )}
        {prefs.testing_targets.map((target) => (
          <span className="tag" key={target}>
            <span className="mono">{target}</span>
            <button
              type="button"
              onClick={() =>
                update({
                  testing_targets: prefs.testing_targets.filter(
                    (row) => row !== target,
                  ),
                })
              }
              aria-label={`Remove ${target}`}
            >
              <XIcon size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="add-target">
        <input
          className="input input--mono"
          value={targetInput}
          onChange={(event) => setTargetInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTarget();
            }
          }}
          placeholder="api.example.com, *.example.com, com.example.app"
          aria-label="Add a testing target"
        />
        <button type="button" className="button button--primary" onClick={addTarget}>
          <PlusIcon size={12} />
          Add
        </button>
      </div>
      <div className="field-note">
        Examples: <span className="mono">api.acme.example</span> ·{" "}
        <span className="mono">*.acme.example</span> ·{" "}
        <span className="mono">https://github.com/acme/app</span>
      </div>
    </div>,

    <div key="watch" className="wizard__body">
      <h2>Watch your first program.</h2>
      <p className="card__sub">
        Paste a public Bugcrowd, HackerOne or Intigriti program URL. We fetch the published
        scope, store the first version and schedule the next check.
      </p>
      {watches.length > 0 && (
        <div className="watch-list" style={{ marginBottom: 12 }}>
          {watches.map((watch) => (
            <div className="watch-item" key={watch.program_id}>
              <div className="watch-item__main">
                <div className="watch-item__name">{watch.program_name}</div>
                <div className="watch-item__meta">
                  {watch.platform} · every {watch.interval_minutes} min · next{" "}
                  {new Date(watch.next_check_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <span className="chip chip--green">
                <CheckIcon size={10} /> watching
              </span>
            </div>
          ))}
        </div>
      )}
      <label className="label" htmlFor="wizard-program">
        Program URL
      </label>
      <div className="add-target">
        <input
          id="wizard-program"
          className="input input--mono"
          value={programUrl}
          onChange={(event) => setProgramUrl(event.target.value)}
          placeholder="https://hackerone.com/rails"
          spellCheck={false}
        />
        <button
          type="button"
          className="button button--primary"
          onClick={() => void addFirstWatch()}
          disabled={syncBusy}
        >
          <PlusIcon size={12} />
          {syncBusy ? "Fetching…" : "Watch"}
        </button>
      </div>
      <div className="field-note">
        Supported domains: bugcrowd.com · hackerone.com · app.intigriti.com. Unknown pages are
        rejected instead of guessed at.
      </div>
      <div className="wizard__divider" />
      <div className="pref-inline">
        <ClockIcon size={13} />
        <span className="field-note">
          Next check: every {prefs.interval_minutes} min after the first snapshot. You can
          change it per program later.
        </span>
      </div>
    </div>,
  ];

  return (
    <div className="wizard">
      <div className="wizard__head">
        <div>
          <div className="page-header__eyebrow">Preference wizard</div>
          <h1>Let’s make the feed yours.</h1>
          <p className="page-header__sub">
            Five short steps. The answers drive ranking, personal impact and alert routing.
          </p>
        </div>
        <div className="wizard__progress">
          {STEPS.map((label, index) => (
            <div
              key={label}
              className={cn(
                "wizard__progress-step",
                index === step && "is-current",
                index < step && "is-done",
              )}
            >
              <span>{index < step ? <CheckIcon size={10} /> : index + 1}</span>
              <small>{label}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="card wizard__card">
        <div className="wizard__step">Step {step + 1} of {STEPS.length}</div>
        {stepContent[step]}
        <div className="wizard__footer">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0 || busy}
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="button button--primary" onClick={next} disabled={busy}>
              {busy ? "Saving…" : step === 3 ? "Save & continue" : "Continue"}
              <ChevronRightIcon size={12} />
            </button>
          ) : (
            <button
              type="button"
              className="button button--primary"
              onClick={() => void finish()}
              disabled={busy || (!watchAdded && watches.length === 0)}
            >
              {busy ? "Finishing…" : "Finish setup"}
              <CheckIcon size={12} />
            </button>
          )}
        </div>
      </div>

      {savedPrefs && (
        <p className="field-note" style={{ marginTop: 10, textAlign: "center" }}>
          Preferences saved. Adding a program does not complete onboarding until you press
          Finish.
        </p>
      )}
    </div>
  );
}
