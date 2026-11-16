import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import type { AuthUser } from "./firebase";
import { getDb } from "./firebase";
import type {
  Change,
  ChangeItem,
  DemoData,
  PlatformStatus,
  Program,
  SourceRun,
  Snapshot,
  UserPreferences,
  UserProfile,
  Version,
  Watch,
} from "../types";

export const DEFAULT_PREFERENCES: UserPreferences = {
  role: "hunter",
  experience: "intermediate",
  interests: ["web", "api"],
  platforms: ["bugcrowd", "hackerone", "intigriti"],
  bounty_range: "any",
  severity: "any",
  alert_mode: "high",
  min_materiality: 25,
  interval_minutes: 30,
  testing_targets: [],
  slack_webhook: null,
  email_digest: true,
  onboarding_complete: false,
  updated_at: new Date().toISOString(),
};

function iso(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return "";
}

function isoOrNull(value: unknown): string | null {
  const out = iso(value);
  return out || null;
}

function toProfile(uid: string, raw: Record<string, unknown> | undefined): UserProfile | null {
  if (!raw) return null;
  const prefs = (raw.preferences || {}) as Partial<UserPreferences>;
  return {
    uid,
    email: (raw.email as string) || null,
    name: (raw.name as string) || "Hunter",
    photo_url: (raw.photo_url as string) || null,
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...prefs,
      interests: (prefs.interests || DEFAULT_PREFERENCES.interests) as UserPreferences["interests"],
      platforms: (prefs.platforms || DEFAULT_PREFERENCES.platforms) as UserPreferences["platforms"],
      testing_targets: prefs.testing_targets || [],
      updated_at: iso(prefs.updated_at) || new Date().toISOString(),
    },
    created_at: iso(raw.created_at) || new Date().toISOString(),
    updated_at: iso(raw.updated_at) || new Date().toISOString(),
  };
}

function toWatch(uid: string, raw: Record<string, unknown> | undefined, id: string): Watch {
  const data = raw || {};
  return {
    uid,
    program_id: (data.program_id as string) || id,
    platform: (data.platform as Watch["platform"]) || "hackerone",
    handle: (data.handle as string) || "",
    program_name: (data.program_name as string) || "Queued program",
    program_url: (data.program_url as string) || "",
    interval_minutes: Number(data.interval_minutes || 30),
    active: data.active !== false,
    status: (data.status as Watch["status"]) || "active",
    error: (data.error as string) || null,
    alert_mode: (data.alert_mode as Watch["alert_mode"]) || "high",
    min_materiality: Number(data.min_materiality ?? 25),
    slack_webhook: (data.slack_webhook as string) || null,
    created_at: iso(data.created_at) || new Date().toISOString(),
    last_checked_at: isoOrNull(data.last_checked_at),
    next_check_at: iso(data.next_check_at) || new Date().toISOString(),
    last_sync_status: (data.last_sync_status as string) || null,
    last_change_id: (data.last_change_id as string) || null,
    last_notified_change_id: (data.last_notified_change_id as string) || null,
  };
}

export async function ensureUserProfile(user: AuthUser): Promise<UserProfile> {
  const db = await getDb();
  const ref = doc(db, "users", user.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    const profile = toProfile(user.uid, existing.data());
    if (profile) return profile;
  }
  const now = new Date().toISOString();
  const profile: UserProfile = {
    uid: user.uid,
    email: user.email,
    name: user.name || user.email || "Hunter",
    photo_url: user.photoURL,
    preferences: { ...DEFAULT_PREFERENCES, updated_at: now },
    created_at: now,
    updated_at: now,
  };
  await setDoc(ref, profile);
  return profile;
}

export async function saveUserPreferences(
  uid: string,
  preferences: UserPreferences,
): Promise<UserProfile> {
  const db = await getDb();
  const ref = doc(db, "users", uid);
  await setDoc(
    ref,
    {
      preferences: { ...preferences, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  );
  const fresh = await getDoc(ref);
  const profile = toProfile(uid, fresh.data());
  if (!profile) throw new Error("Could not save your profile.");
  return profile;
}

function inferPlatform(url: string): Watch["platform"] {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("bugcrowd")) return "bugcrowd";
    if (host.includes("intigriti")) return "intigriti";
    return "hackerone";
  } catch {
    return "hackerone";
  }
}

export async function addPendingWatch(
  user: AuthUser,
  url: string,
  intervalMinutes: number,
  preferences: UserPreferences,
): Promise<Watch> {
  const db = await getDb();
  const now = new Date();
  const id = `pending_${crypto.randomUUID()}`;
  const platform = inferPlatform(url);
  const watch: Watch = {
    uid: user.uid,
    program_id: id,
    platform,
    handle: "",
    program_name: "Queued baseline",
    program_url: url.trim(),
    interval_minutes: intervalMinutes,
    active: true,
    status: "pending",
    error: null,
    alert_mode: preferences.alert_mode,
    min_materiality: preferences.min_materiality,
    slack_webhook: preferences.slack_webhook,
    created_at: now.toISOString(),
    last_checked_at: null,
    next_check_at: now.toISOString(),
    last_sync_status: "pending",
    last_change_id: null,
    last_notified_change_id: null,
  };
  await setDoc(doc(db, "users", user.uid, "watches", id), watch);
  return watch;
}

export async function updateUserWatch(
  uid: string,
  watchId: string,
  patch: Partial<
    Pick<
      Watch,
      "interval_minutes" | "active" | "alert_mode" | "min_materiality" | "slack_webhook"
    >
  >,
): Promise<void> {
  const db = await getDb();
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) payload[key] = value;
  }
  await updateDoc(doc(db, "users", uid, "watches", watchId), payload);
}

export async function deleteUserWatch(uid: string, watchId: string): Promise<void> {
  const db = await getDb();
  await deleteDoc(doc(db, "users", uid, "watches", watchId));
}

function toProgram(id: string, raw: Record<string, unknown>): Program {
  return {
    id,
    platform: raw.platform as Program["platform"],
    handle: (raw.handle as string) || id,
    name: (raw.name as string) || id,
    url: (raw.url as string) || "",
    status: (raw.status as string) || "open",
    industry: (raw.industry as string) || null,
    offers_bounties: Boolean(raw.offers_bounties),
    currency: (raw.currency as string) || "USD",
    min_bounty: raw.min_bounty == null ? null : Number(raw.min_bounty),
    max_bounty: raw.max_bounty == null ? null : Number(raw.max_bounty),
    tags: (raw.tags as string[]) || [],
    current_version: Number(raw.current_version || 0),
    current_hash: (raw.current_hash as string) || "",
    scope_counts: (raw.scope_counts as Program["scope_counts"]) || {
      in_scope: 0,
      out_of_scope: 0,
      conflict: 0,
      total: 0,
      bounty_eligible: 0,
    },
    first_seen_at: iso(raw.first_seen_at),
    last_checked_at: iso(raw.last_checked_at),
    last_changed_at: isoOrNull(raw.last_changed_at),
    source: (raw.source as Program["source"]) || null,
  };
}

export async function loadLiveState(user: AuthUser): Promise<{
  profile: UserProfile;
  watches: Watch[];
  data: DemoData;
}> {
  const db = await getDb();
  const profile = await ensureUserProfile(user);
  const watchSnap = await getDocs(collection(db, "users", user.uid, "watches"));
  const watches = watchSnap.docs.map((item) => toWatch(user.uid, item.data(), item.id));
  const active = watches.filter(
    (watch) => watch.status === "active" && watch.program_id,
  );

  const programs: Program[] = [];
  const versions: Version[] = [];
  const snapshots: Snapshot[] = [];
  const changes: Change[] = [];
  const items: ChangeItem[] = [];

  for (const watch of active) {
    const programSnap = await getDoc(doc(db, "programs", watch.program_id));
    if (!programSnap.exists()) continue;
    const program = toProgram(programSnap.id, programSnap.data());
    programs.push(program);

    const versionSnap = await getDocs(collection(db, "programs", program.id, "versions"));
    const versionRows = versionSnap.docs
      .map((item) => {
        const raw = item.data();
        const version = {
          program_id: program.id,
          version: Number(raw.version),
          hash: (raw.hash as string) || "",
          captured_at: iso(raw.captured_at),
          source_revision_id: (raw.source_revision_id as string) || null,
          source_published_at: isoOrNull(raw.source_published_at),
          source_url: (raw.source_url as string) || null,
          is_baseline: Boolean(raw.is_baseline),
          confidence: (raw.confidence as Version["confidence"]) || "high",
          counts: (raw.counts as Version["counts"]) || program.scope_counts,
          change_id: (raw.change_id as string) || null,
        } satisfies Version;
        if (raw.snapshot) snapshots.push(raw.snapshot as Snapshot);
        return version;
      })
      .sort((a, b) => b.version - a.version);
    versions.push(...versionRows);

    const changeSnap = await getDocs(
      query(
        collection(db, "changes"),
        where("program_id", "==", program.id),
        orderBy("detected_at", "desc"),
        limit(100),
      ),
    );
    for (const changeDoc of changeSnap.docs) {
      const change = changeDoc.data() as Change;
      changes.push(change);
      const itemSnap = await getDocs(collection(db, "changes", changeDoc.id, "items"));
      for (const itemDoc of itemSnap.docs) {
        items.push(itemDoc.data() as ChangeItem);
      }
    }
  }

  const runSnap = await getDocs(
    query(collection(db, "source_runs"), orderBy("started_at", "desc"), limit(20)),
  );
  const runs = runSnap.docs.map((item) => item.data() as SourceRun);

  const names: Record<string, string> = {
    bugcrowd: "Bugcrowd",
    hackerone: "HackerOne",
    intigriti: "Intigriti",
    sandbox: "Sandbox",
  };
  const platforms: PlatformStatus[] = Object.entries(names).map(([id, name]) => {
    const platformRuns = runs.filter((run) => run.platform === id);
    const last = platformRuns[0];
    return {
      id,
      name,
      status: last?.status === "error" ? "error" : last?.status === "warn" ? "warn" : last ? "ok" : "unknown",
      last_run_at: last?.started_at || null,
      programs_count: programs.filter((program) => program.platform === id).length,
      latency_ms: last?.latency_ms ?? null,
      message: last
        ? `${last.programs_seen} program${last.programs_seen === 1 ? "" : "s"} checked`
        : "No sync yet",
    };
  });

  changes.sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at));

  const data: DemoData = {
    meta: {
      title: "ScopeDiff",
      generated_at: new Date().toISOString(),
      demo: false,
      sandbox: false,
      note: "Live data from published program revisions. Nothing is scanned.",
    },
    viewer: {
      name: profile.name,
      handle: profile.email || profile.uid,
      testing: profile.preferences.testing_targets,
      watchlist: active.map((watch) => watch.program_id),
    },
    profile,
    watches,
    platforms,
    programs,
    versions,
    snapshots,
    changes,
    items,
    runs,
  };
  return { profile, watches, data };
}
