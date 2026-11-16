export type Platform = "bugcrowd" | "hackerone" | "intigriti" | "sandbox";

export type AssetFamily =
  | "web"
  | "api"
  | "wildcard"
  | "ip"
  | "cidr"
  | "mobile_android"
  | "mobile_ios"
  | "source_code"
  | "hardware"
  | "other";

export type AssetKind = "in" | "out" | "conflict";
export type Impact = "risk" | "opportunity" | "neutral" | "mixed";
export type Magnitude = "critical" | "high" | "medium" | "low";
export type Confidence = "high" | "low";
export type ChangeKind =
  | "added"
  | "removed"
  | "reintroduced"
  | "modified"
  | "moved_in"
  | "moved_out";
export type ChangeStatus = "ready" | "review" | "failed";
export type AlertStatus = "pending" | "sent" | "skipped" | "failed";

export interface ScopeGroup {
  id: string;
  name: string;
  in_scope: boolean;
  tier: string | null;
}

export interface AssetAttrs {
  bounty_eligible: boolean;
  bounty_tier: string | null;
  max_bounty: number | null;
  currency: string | null;
  max_severity: string | null;
  instruction: string | null;
  tags: string[];
}

export interface Asset {
  key: string;
  family: AssetFamily;
  kind: AssetKind;
  target: string;
  display: string;
  source_ids: string[];
  groups: ScopeGroup[];
  attrs: AssetAttrs;
}

export interface SourceRef {
  adapter: string;
  revision_id: string | null;
  published_at: string | null;
  fetched_at: string;
  url: string | null;
}

export interface ScopeCounts {
  in_scope: number;
  out_of_scope: number;
  conflict: number;
  total: number;
  bounty_eligible: number;
}

export interface Program {
  id: string;
  platform: Platform;
  handle: string;
  name: string;
  url: string;
  status: string;
  industry: string | null;
  offers_bounties: boolean;
  currency: string;
  min_bounty: number | null;
  max_bounty: number | null;
  tags: string[];
  current_version: number;
  current_hash: string;
  scope_counts: ScopeCounts;
  first_seen_at: string;
  last_checked_at: string;
  last_changed_at: string | null;
  source: SourceRef | null;
}

export interface Snapshot {
  program_id: string;
  version: number;
  hash: string;
  assets: Asset[];
  groups: ScopeGroup[];
  captured_at: string;
  source_revision_id: string | null;
  source_published_at: string | null;
  source_url: string | null;
  confidence: Confidence;
  complete: boolean;
  counts: ScopeCounts;
}

export interface Version {
  program_id: string;
  version: number;
  hash: string;
  captured_at: string;
  source_revision_id: string | null;
  source_published_at: string | null;
  source_url: string | null;
  is_baseline: boolean;
  confidence: Confidence;
  counts: ScopeCounts;
  change_id: string | null;
}

export interface FieldChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface AssetSummary {
  target: string;
  canonical: string;
  family: AssetFamily;
  kind: AssetKind;
  bounty_eligible: boolean;
  bounty_tier: string | null;
  max_bounty: number | null;
  currency: string | null;
  max_severity: string | null;
  instruction: string | null;
  groups: string[];
  tags: string[];
}

export interface ChangeItem {
  id: string;
  change_id: string;
  kind: ChangeKind;
  asset_key: string;
  family: AssetFamily;
  target: string;
  display: string;
  before: AssetSummary | null;
  after: AssetSummary | null;
  fields: FieldChange[];
  impact: Impact;
  materiality_score: number;
  reasons: string[];
  group_names: string[];
}

export interface ChangeCounts {
  added: number;
  removed: number;
  reintroduced: number;
  modified: number;
  moved_in: number;
  moved_out: number;
  total: number;
}

export interface Change {
  id: string;
  program_id: string;
  program_name: string;
  platform: Platform;
  program_url: string | null;
  from_version: number;
  to_version: number;
  detected_at: string;
  source_published_at: string | null;
  source_revision_id: string | null;
  source_url: string | null;
  is_baseline: boolean;
  is_simulation: boolean;
  confidence: Confidence;
  impact: Impact;
  magnitude: Magnitude;
  materiality_score: number;
  reasons: string[];
  counts: ChangeCounts;
  status: ChangeStatus;
  items_preview: ChangeItem[];
  items?: ChangeItem[];
  alert_status: AlertStatus;
  alerted_at: string | null;
  alert_error: string | null;
  hidden?: boolean;
}

export interface SourceRun {
  id: string;
  platform: string;
  target: string | null;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "warn" | "error" | "running";
  programs_seen: number;
  programs_changed: number;
  assets_seen: number;
  latency_ms: number | null;
  error: string | null;
  notes: string[];
}

export interface PlatformStatus {
  id: string;
  name: string;
  status: "ok" | "warn" | "error" | "unknown";
  last_run_at: string | null;
  programs_count: number;
  latency_ms: number | null;
  message: string | null;
}

export interface Viewer {
  name: string;
  handle: string;
  testing: string[];
  watchlist: string[];
}

export interface DemoMeta {
  title?: string;
  generated_at: string;
  demo: boolean;
  sandbox?: boolean;
  note?: string;
}

export type UserRole = "hunter" | "team" | "consultancy" | "other";
export type Experience = "beginner" | "intermediate" | "advanced" | "professional";
export type BountyRange = "any" | "100" | "500" | "1000" | "5000";
export type SeverityPreference = "any" | "low" | "medium" | "high" | "critical";
export type AlertMode = "all" | "high" | "mine";
export type CheckInterval = 1 | 5 | 15 | 60;

export interface UserPreferences {
  role: UserRole;
  experience: Experience;
  interests: AssetFamily[];
  platforms: Platform[];
  bounty_range: BountyRange;
  severity: SeverityPreference;
  alert_mode: AlertMode;
  min_materiality: number;
  interval_minutes: number;
  testing_targets: string[];
  slack_webhook: string | null;
  email_digest: boolean;
  onboarding_complete: boolean;
  updated_at: string;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  name: string;
  photo_url: string | null;
  preferences: UserPreferences;
  created_at: string;
  updated_at: string;
}

export interface Watch {
  uid: string;
  program_id: string;
  platform: Platform;
  handle: string;
  program_name: string;
  program_url: string;
  interval_minutes: number;
  active: boolean;
  status?: "active" | "pending" | "error";
  error?: string | null;
  alert_mode: AlertMode;
  min_materiality: number;
  slack_webhook: string | null;
  created_at: string;
  last_checked_at: string | null;
  next_check_at: string;
  last_sync_status: string | null;
  last_change_id: string | null;
  last_notified_change_id: string | null;
}

export interface DemoData {
  meta: DemoMeta;
  viewer: Viewer;
  platforms: PlatformStatus[];
  programs: Program[];
  versions: Version[];
  snapshots: Snapshot[];
  changes: Change[];
  items: ChangeItem[];
  runs: SourceRun[];
  profile?: UserProfile;
  watches?: Watch[];
}

export interface FeedFilters {
  platform: Platform | "all";
  impact: Impact | "all";
  confidence: Confidence | "all";
  watchedOnly: boolean;
  testingOnly: boolean;
  q: string;
}

export interface AlertPrefs {
  slackWebhook: string;
  minScore: number;
  email: boolean;
}
