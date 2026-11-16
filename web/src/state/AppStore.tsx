import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { demoData } from "../data/demo";
import type { Health } from "../lib/api";
import {
  DEFAULT_PREFERENCES,
  addPendingWatch,
  deleteUserWatch,
  loadLiveState,
  saveUserPreferences,
  updateUserWatch,
} from "../lib/live";
import {
  firebaseEnabled,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutFirebase,
  signUpWithEmail,
  watchAuth,
  type AuthUser,
} from "../lib/firebase";
import { looksLikeTarget } from "../lib/format";
import { normalizeTarget } from "../lib/matching";
import type {
  AlertPrefs,
  Change,
  DemoData,
  Platform,
  SourceRun,
  UserPreferences,
  UserProfile,
  Version,
  Watch,
} from "../types";

const V8_ID = "sandbox__acme-cloud__v8";
const THEME_KEY = "scopediff.theme";
const MODE_KEY = "scopediff.mode";
const TESTING_KEY = "scopediff.testing";
const WATCHLIST_KEY = "scopediff.watchlist";
const PREFS_KEY = "scopediff.alertPrefs";
const SIMULATED_KEY = "scopediff.simulated";
const localSessionEnabled = import.meta.env.VITE_ALLOW_LOCAL_SESSION === "1";

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  slackWebhook: "",
  minScore: 25,
  email: true,
};

export type Theme = "light" | "dark";
export type Mode = "demo" | "live";
type ToastKind = "info" | "error" | "success";

export interface ToastAction {
  label: string;
  to: string;
}

export interface ToastState {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

export interface AppContextValue {
  data: DemoData;
  mode: Mode;
  setMode: (mode: Mode) => void;
  canUseLive: boolean;
  loading: boolean;
  loadError: string | null;
  retryLive: () => Promise<void>;
  useDemoInstead: () => void;
  theme: Theme;
  toggleTheme: () => void;
  user: AuthUser | null;
  authLoading: boolean;
  firebaseEnabled: boolean;
  localSessionEnabled: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  onboardingComplete: boolean;
  watches: Watch[];
  refreshLive: () => Promise<void>;
  signInDemo: () => void;
  signInLocalLive: () => void;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, name: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  savePreferences: (preferences: UserPreferences) => Promise<boolean>;
  addWatch: (url: string, intervalMinutes?: number) => Promise<Watch | null>;
  removeWatch: (programId: string) => Promise<boolean>;
  updateWatch: (
    programId: string,
    patch: Partial<
      Pick<
        Watch,
        "interval_minutes" | "active" | "alert_mode" | "min_materiality" | "slack_webhook"
      >
    >,
  ) => Promise<boolean>;
  simulated: boolean;
  simulateBusy: boolean;
  freshChangeId: string | null;
  simulate: () => Promise<void>;
  resetDemo: () => void;
  testing: string[];
  watchlist: string[];
  addTestingTarget: (value: string) => boolean;
  removeTestingTarget: (value: string) => void;
  toggleWatch: (programId: string) => void;
  alertPrefs: AlertPrefs;
  saveAlertPrefs: (prefs: AlertPrefs) => void;
  sendTestAlert: (webhook?: string) => Promise<boolean>;
  syncBusy: boolean;
  syncNow: (platform: Platform, handle: string) => Promise<boolean>;
  health: Health | null;
  toast: ToastState | null;
  notify: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  dismissToast: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function hasStorageKey(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function readSessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function initialTheme(): Theme {
  const current = document.documentElement.dataset.theme;
  if (current === "dark" || current === "light") return current;
  return "light";
}

function initialMode(): Mode {
  const saved = readJSON<Mode | null>(MODE_KEY, null);
  if (saved === "demo" || saved === "live") return saved;
  return firebaseEnabled ? "live" : "demo";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function alertPrefsFrom(profile: UserProfile | null): AlertPrefs {
  if (!profile) return DEFAULT_ALERT_PREFS;
  return {
    slackWebhook: profile.preferences.slack_webhook || "",
    minScore: profile.preferences.min_materiality,
    email: profile.preferences.email_digest,
  };
}

const demoUser: AuthUser = {
  uid: "demo-hunter",
  name: demoData.viewer.name,
  email: "demo@scopediff.local",
  photoURL: null,
  provider: "demo",
};

function revealSandboxV8(data: DemoData): DemoData {
  const change = data.changes.find((row) => row.id === V8_ID);
  if (!change || change.hidden === false) return data;

  const snapshot = data.snapshots.find(
    (row) => row.program_id === "sandbox__acme-cloud" && row.version === 8,
  );
  if (!snapshot) return data;

  const program = data.programs.find((row) => row.id === "sandbox__acme-cloud");
  if (!program) return data;

  const items = data.items.filter((item) => item.change_id === V8_ID);
  const visibleChange: Change = {
    ...change,
    hidden: false,
    items_preview: items.slice(0, 3),
    items,
  };

  const version: Version = {
    program_id: snapshot.program_id,
    version: snapshot.version,
    hash: snapshot.hash,
    captured_at: snapshot.captured_at,
    source_revision_id: snapshot.source_revision_id,
    source_published_at: snapshot.source_published_at,
    source_url: snapshot.source_url,
    is_baseline: false,
    confidence: snapshot.confidence,
    counts: snapshot.counts,
    change_id: change.id,
  };

  const run: SourceRun = {
    id: "run_sim_v8",
    platform: "sandbox",
    target: "acme-cloud",
    started_at: change.detected_at,
    finished_at: change.detected_at,
    status: "ok",
    programs_seen: 1,
    programs_changed: 1,
    assets_seen: snapshot.assets.length,
    latency_ms: 8,
    error: null,
    notes: ["Simulated v8 revision"],
  };

  return {
    ...data,
    programs: data.programs.map((row) =>
      row.id === program.id
        ? {
            ...row,
            current_version: snapshot.version,
            current_hash: snapshot.hash,
            scope_counts: snapshot.counts,
            last_checked_at: change.detected_at,
            last_changed_at: change.detected_at,
            source: {
              adapter: "sandbox",
              revision_id: snapshot.source_revision_id,
              published_at: snapshot.source_published_at,
              fetched_at: snapshot.captured_at,
              url: snapshot.source_url,
            },
          }
        : row,
    ),
    versions: [
      ...data.versions.filter(
        (row) => !(row.program_id === program.id && row.version === snapshot.version),
      ),
      version,
    ],
    changes: data.changes.map((row) => (row.id === V8_ID ? visibleChange : row)),
    platforms: data.platforms.map((row) =>
      row.id === "sandbox"
        ? {
            ...row,
            last_run_at: change.detected_at,
            programs_count: 1,
            latency_ms: 8,
            message: "Sandbox · current revision v8",
          }
        : row,
    ),
    runs: [run, ...data.runs.filter((row) => row.id !== run.id)],
  };
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const bootSimulated = readSessionFlag(SIMULATED_KEY);
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [data, setData] = useState<DemoData>(() =>
    initialMode() === "demo" && bootSimulated ? revealSandboxV8(demoData) : demoData,
  );
  const [loading, setLoading] = useState(mode === "live");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(firebaseEnabled);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [simulated, setSimulated] = useState(bootSimulated);
  const [simulateBusy, setSimulateBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [freshChangeId, setFreshChangeId] = useState<string | null>(null);
  const hadSavedTesting = useRef(hasStorageKey(TESTING_KEY));
  const hadSavedWatchlist = useRef(hasStorageKey(WATCHLIST_KEY));
  const [testing, setTesting] = useState<string[]>(() =>
    readJSON<string[]>(TESTING_KEY, demoData.viewer.testing),
  );
  const [watchlist, setWatchlist] = useState<string[]>(() =>
    readJSON<string[]>(WATCHLIST_KEY, demoData.viewer.watchlist),
  );
  const [alertPrefs, setAlertPrefs] = useState<AlertPrefs>(() =>
    readJSON<AlertPrefs>(PREFS_KEY, DEFAULT_ALERT_PREFS),
  );
  const [prefsReady, setPrefsReady] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastId = useRef(0);
  const modeRef = useRef(mode);

  const notify = useCallback(
    (message: string, kind: ToastKind = "info", action?: ToastAction) => {
      toastId.current += 1;
      setToast({ id: toastId.current, message, kind, action });
    },
    [],
  );

  const dismissToast = useCallback(() => setToast(null), []);

  const refreshLive = useCallback(async () => {
    if (!firebaseEnabled) {
      setLoadError("Firebase is not configured in this build.");
      setLoading(false);
      return;
    }
    if (!user) {
      setLoading(false);
      setProfile(null);
      setWatches([]);
      return;
    }
    setLoading(true);
    setProfileLoading(true);
    setLoadError(null);
    try {
      const next = await loadLiveState(user);
      if (modeRef.current !== "live") return;
      setData(next.data);
      setProfile(next.profile);
      setWatches(next.watches);
      setWatchlist(next.data.viewer.watchlist);
      const prefs = next.profile.preferences;
      setTesting(prefs.testing_targets);
      setAlertPrefs({
        slackWebhook: prefs.slack_webhook || "",
        minScore: prefs.min_materiality,
        email: prefs.email_digest,
      });
      setHealth(null);
    } catch (error) {
      setLoadError(messageOf(error));
    } finally {
      setLoading(false);
      setProfileLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!firebaseEnabled) {
      setAuthLoading(false);
      return;
    }
    let alive = true;
    let unsubscribe: () => void = () => undefined;
    watchAuth((next) => {
      if (!alive) return;
      setUser(next);
      setAuthLoading(false);
    })
      .then((stop) => {
        unsubscribe = stop;
      })
      .catch(() => {
        if (alive) setAuthLoading(false);
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (mode !== "live") return;
    void refreshLive();
  }, [mode, refreshLive]);

  useEffect(() => {
    modeRef.current = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // ignore
    }
    if (mode === "demo") {
      setData(bootSimulated ? revealSandboxV8(demoData) : demoData);
      setTesting(readJSON<string[]>(TESTING_KEY, demoData.viewer.testing));
      setWatchlist(readJSON<string[]>(WATCHLIST_KEY, demoData.viewer.watchlist));
      setAlertPrefs(readJSON<AlertPrefs>(PREFS_KEY, DEFAULT_ALERT_PREFS));
      setLoadError(null);
      setLoading(false);
      setPrefsReady(true);
    } else {
      setLoading(true);
      setPrefsReady(false);
    }
  }, [mode, bootSimulated]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage may be unavailable in private mode
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#0F0F0E" : "#F7F6F3");
    }
  }, [theme]);

  useEffect(() => {
    if (mode !== "demo" || !prefsReady) return;
    try {
      localStorage.setItem(TESTING_KEY, JSON.stringify(testing));
    } catch {
      // ignore
    }
  }, [mode, prefsReady, testing]);

  useEffect(() => {
    if (mode !== "demo" || !prefsReady) return;
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    } catch {
      // ignore
    }
  }, [mode, prefsReady, watchlist]);

  useEffect(() => {
    if (mode !== "demo" || !prefsReady) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(alertPrefs));
    } catch {
      // ignore
    }
  }, [alertPrefs, mode, prefsReady]);

  useEffect(() => {
    try {
      if (simulated) {
        sessionStorage.setItem(SIMULATED_KEY, "1");
      } else {
        sessionStorage.removeItem(SIMULATED_KEY);
      }
    } catch {
      // ignore
    }
  }, [simulated]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const setMode = useCallback(
    (next: Mode) => {
      if (next === "live" && !firebaseEnabled) {
        notify("Live mode needs the Firebase web config.", "error");
        return;
      }
      setModeState(next);
    },
    [notify],
  );

  const useDemoInstead = useCallback(() => {
    setModeState("demo");
    setData(demoData);
    setLoading(false);
    setLoadError(null);
    setUser(demoUser);
    setAuthLoading(false);
    setSimulated(false);
    setFreshChangeId(null);
    setHealth(null);
    notify("Demo dataset loaded. You can still sign in for the live feed.", "info");
  }, [notify]);

  const signInDemo = useCallback(() => {
    setModeState("demo");
    setUser(demoUser);
    setAuthLoading(false);
    notify("Viewing the bundled demo as Demo Hunter.", "success");
  }, [notify]);

  const signInLocalLive = useCallback(() => {
    setUser(demoUser);
    setAuthLoading(false);
    setModeState("live");
    notify("Local live preview enabled. This is for development only.", "info");
  }, [notify]);

  const signInEmail = useCallback(
    async (email: string, password: string) => {
      setAuthLoading(true);
      try {
        const next = await signInWithEmail(email, password);
        setUser(next);
        setModeState("live");
        notify(`Signed in as ${next.name}.`, "success");
      } catch (error) {
        notify(`Sign-in failed: ${messageOf(error)}`, "error");
        throw error;
      } finally {
        setAuthLoading(false);
      }
    },
    [notify],
  );

  const signUpEmail = useCallback(
    async (email: string, password: string, name: string) => {
      setAuthLoading(true);
      try {
        const next = await signUpWithEmail(email, password, name);
        setUser(next);
        setModeState("live");
        notify("Account created. Let’s set up your hunting preferences.", "success");
      } catch (error) {
        notify(`Sign-up failed: ${messageOf(error)}`, "error");
        throw error;
      } finally {
        setAuthLoading(false);
      }
    },
    [notify],
  );

  const signInGoogle = useCallback(async () => {
    setAuthLoading(true);
    try {
      const next = await signInWithGoogle();
      setUser(next);
      setModeState("live");
      notify(`Signed in as ${next.name}.`, "success");
    } catch (error) {
      notify(`Sign-in failed: ${messageOf(error)}`, "error");
      throw error;
    } finally {
      setAuthLoading(false);
    }
  }, [notify]);

  const resetPassword = useCallback(
    async (email: string) => {
      try {
        await sendPasswordReset(email);
        notify("Password reset email sent.", "success");
      } catch (error) {
        notify(`Could not send reset email: ${messageOf(error)}`, "error");
        throw error;
      }
    },
    [notify],
  );

  const signOut = useCallback(async () => {
    try {
      await signOutFirebase();
    } catch {
      // Firebase may not be configured; sign out locally regardless.
    }
    setUser(null);
    setProfile(null);
    setWatches([]);
    setWatchlist([]);
    notify("Signed out.", "info");
  }, [notify]);

  const savePreferences = useCallback(
    async (preferences: UserPreferences): Promise<boolean> => {
      if (mode === "demo") {
        setTesting(preferences.testing_targets);
        setAlertPrefs({
          slackWebhook: preferences.slack_webhook || "",
          minScore: preferences.min_materiality,
          email: preferences.email_digest,
        });
        notify("Demo preferences saved locally.", "success");
        return true;
      }
      if (!user) {
        notify("Sign in again to save preferences.", "error");
        return false;
      }
      try {
        const saved = await saveUserPreferences(user.uid, preferences);
        setProfile(saved);
        setTesting(saved.preferences.testing_targets);
        setAlertPrefs({
          slackWebhook: saved.preferences.slack_webhook || "",
          minScore: saved.preferences.min_materiality,
          email: saved.preferences.email_digest,
        });
        await refreshLive();
        notify("Preferences saved.", "success");
        return true;
      } catch (error) {
        notify(`Could not save preferences: ${messageOf(error)}`, "error");
        return false;
      }
    },
    [mode, notify, refreshLive, user],
  );

  const addWatch = useCallback(
    async (url: string, intervalMinutes?: number): Promise<Watch | null> => {
      if (mode !== "live" || !user) {
        notify("Sign in to add a real program.", "error");
        return null;
      }
      const prefs = profile?.preferences;
      if (
        watches.filter(
          (watch) => watch.status === "active" || watch.status === "pending",
        ).length >= 10
      ) {
        notify(
          "The free plan allows 10 watched programs. Remove one before adding another.",
          "error",
        );
        return null;
      }
      try {
        const host = new URL(url).hostname.toLowerCase();
        const supported = [
          "bugcrowd.com",
          "www.bugcrowd.com",
          "hackerone.com",
          "www.hackerone.com",
          "app.intigriti.com",
          "www.intigriti.com",
        ];
        if (!supported.includes(host)) {
          notify(
            "Only Bugcrowd, HackerOne and Intigriti program URLs are supported on the free plan.",
            "error",
          );
          return null;
        }
      } catch {
        notify("Paste a full public program URL.", "error");
        return null;
      }
      setSyncBusy(true);
      try {
        const watch = await addPendingWatch(
          user,
          url,
          intervalMinutes ?? prefs?.interval_minutes ?? 30,
          prefs ?? {
            ...DEFAULT_PREFERENCES,
          },
        );
        await refreshLive();
        notify(
          "Baseline queued. The free GitHub cron will fetch it within 30 minutes.",
          "success",
        );
        return watch;
      } catch (error) {
        notify(`Could not queue program: ${messageOf(error)}`, "error");
        return null;
      } finally {
        setSyncBusy(false);
      }
    },
    [mode, notify, profile?.preferences, refreshLive, user, watches],
  );

  const removeWatch = useCallback(
    async (programId: string): Promise<boolean> => {
      if (mode !== "live" || !user) {
        toggleWatchDemo(programId);
        return true;
      }
      try {
        const program = data.programs.find((row) => row.id === programId);
        const watch = watches.find((row) => row.program_id === programId);
        await deleteUserWatch(user.uid, watch?.program_id || programId);
        await refreshLive();
        notify(`Stopped watching ${program?.name || programId}.`, "info");
        return true;
      } catch (error) {
        notify(`Could not remove program: ${messageOf(error)}`, "error");
        return false;
      }
    },
    [data.programs, mode, notify, refreshLive, user, watches],
  );

  const updateWatch = useCallback(
    async (
      programId: string,
      patch: Partial<
        Pick<
          Watch,
          "interval_minutes" | "active" | "alert_mode" | "min_materiality" | "slack_webhook"
        >
      >,
    ): Promise<boolean> => {
      if (mode !== "live" || !user) {
        notify("Watch intervals are only stored in live mode.", "info");
        return false;
      }
      try {
        await updateUserWatch(user.uid, programId, patch);
        await refreshLive();
        notify("Watch settings updated.", "success");
        return true;
      } catch (error) {
        notify(`Could not update watch: ${messageOf(error)}`, "error");
        return false;
      }
    },
    [mode, notify, refreshLive, user],
  );

  const toggleWatchDemo = useCallback(
    (programId: string) => {
      const exists = watchlist.includes(programId);
      setWatchlist((current) =>
        exists ? current.filter((row) => row !== programId) : [...current, programId],
      );
      const program = data.programs.find((row) => row.id === programId);
      notify(
        exists
          ? `Stopped watching ${program?.name || programId}.`
          : `Watching ${program?.name || programId}.`,
        exists ? "info" : "success",
      );
    },
    [data.programs, notify, watchlist],
  );

  const toggleWatch = useCallback(
    (programId: string) => {
      if (mode === "demo") {
        toggleWatchDemo(programId);
        return;
      }
      if (
        watchlist.includes(programId) ||
        watches.some((watch) => watch.program_id === programId)
      ) {
        void removeWatch(programId);
      } else {
        const program = data.programs.find((row) => row.id === programId);
        if (program) {
          void addWatch(program.url);
        } else {
          notify("Add a program by pasting its public program URL.", "info");
        }
      }
    },
    [addWatch, data.programs, mode, notify, removeWatch, watchlist, watches],
  );

  const addTestingTarget = useCallback(
    (value: string): boolean => {
      const target = normalizeTarget(value);
      if (!target) {
        notify("Enter a hostname, URL or package name.", "error");
        return false;
      }
      if (!looksLikeTarget(target)) {
        notify("That does not look like a target. Try a hostname such as api.example.com.", "error");
        return false;
      }
      if (testing.includes(target)) {
        notify(`${target} is already on your testing list.`, "info");
        return false;
      }
      const next = [...testing, target];
      setTesting(next);
      if (mode === "live" && profile) {
        void savePreferences({
          ...profile.preferences,
          testing_targets: next,
          updated_at: new Date().toISOString(),
        });
      } else {
        notify(`Added ${target} to your testing list.`, "success");
      }
      return true;
    },
    [mode, notify, profile, savePreferences, testing],
  );

  const removeTestingTarget = useCallback(
    (value: string) => {
      const next = testing.filter((row) => row !== value);
      setTesting(next);
      if (mode === "live" && profile) {
        void savePreferences({
          ...profile.preferences,
          testing_targets: next,
          updated_at: new Date().toISOString(),
        });
      } else {
        notify(`Removed ${value} from your testing list.`, "info");
      }
    },
    [mode, notify, profile, savePreferences, testing],
  );

  const saveAlertPrefs = useCallback(
    (prefs: AlertPrefs) => {
      setAlertPrefs(prefs);
      if (mode === "live" && profile) {
        void savePreferences({
          ...profile.preferences,
          slack_webhook: prefs.slackWebhook || null,
          min_materiality: prefs.minScore,
          email_digest: prefs.email,
          updated_at: new Date().toISOString(),
        });
      } else {
        notify("Alert preferences saved locally.", "success");
      }
    },
    [mode, notify, profile, savePreferences],
  );

  const sendTestAlert = useCallback(
    async (_webhook?: string): Promise<boolean> => {
      notify(
        "Slack test delivery needs the worker. On the free plan, the GitHub cron sends real alerts after a detected change.",
        "info",
      );
      return false;
    },
    [notify],
  );

  const syncNow = useCallback(
    async (_platform: Platform, _handle: string): Promise<boolean> => {
      notify("Use “Check now” on a watched program. Cron handles the rest.", "info");
      return false;
    },
    [notify],
  );

  const simulate = useCallback(async () => {
    if (simulateBusy || simulated) return;
    if (mode !== "demo") {
      notify("The v8 scenario is demo-only.", "info");
      return;
    }
    setSimulateBusy(true);
    try {
      await delay(650);
      setData((current) => revealSandboxV8(current));
      setSimulated(true);
      setFreshChangeId(V8_ID);
      notify(
        "Acme Cloud v8 published: 2 added, 1 removed, 1 repriced. Materiality 91/100.",
        "success",
        { label: "Open diff", to: `/changes/${V8_ID}` },
      );
    } catch (error) {
      notify(`Simulation failed: ${messageOf(error)}`, "error");
    } finally {
      setSimulateBusy(false);
    }
  }, [mode, notify, simulateBusy, simulated]);

  const resetDemo = useCallback(() => {
    if (mode !== "demo") {
      notify("Reset only applies to the bundled demo dataset.", "error");
      return;
    }
    setData(demoData);
    setSimulated(false);
    setFreshChangeId(null);
    notify("Demo reset. The sandbox is back at v7.", "info");
  }, [mode, notify]);

  return (
    <AppContext.Provider
      value={{
        data,
        mode,
        setMode,
        canUseLive: firebaseEnabled,
        loading,
        loadError,
        retryLive: refreshLive,
        useDemoInstead,
        theme,
        toggleTheme,
        user,
        authLoading,
        firebaseEnabled,
        localSessionEnabled,
        profile,
        profileLoading,
        onboardingComplete: Boolean(profile?.preferences.onboarding_complete),
        watches,
        refreshLive,
        signInDemo,
        signInLocalLive,
        signInEmail,
        signUpEmail,
        signInGoogle,
        signOut,
        resetPassword,
        savePreferences,
        addWatch,
        removeWatch,
        updateWatch,
        simulated,
        simulateBusy,
        freshChangeId,
        simulate,
        resetDemo,
        testing,
        watchlist,
        addTestingTarget,
        removeTestingTarget,
        toggleWatch,
        alertPrefs,
        saveAlertPrefs,
        sendTestAlert,
        syncBusy,
        syncNow,
        health,
        toast,
        notify,
        dismissToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error("useApp must be used inside AppStoreProvider");
  }
  return value;
}
