# ScopeDiff — Research & Build Plan

**Status:** research complete, no application code written yet
**Date:** 2026-11-16
**Brief:** [`scopediff.txt`](./scopediff.txt) — "Watches bug bounty scopes and tells hunters exactly what changed, before they waste a weekend."
**Target stack:** React + TypeScript · Python · Firebase

---

## 0. The short version

1. **ScopeDiff is a change-detection product, not a scraper.** The value is a stable normalized scope model plus a diff engine that does not cry wolf. The fetching is commodity; the trust is the product.
2. **All three named platforms expose enough public data to build this.** I verified live that Bugcrowd publishes a per-program revision changelog and Intigriti publishes full historical scope revisions. HackerOne requires an API token (anonymous GraphQL returned **403**), with a public mirror as fallback.
3. **Firebase maps cleanly onto the brief.** Firestore replaces Postgres for current state and change events, Cloud Storage replaces it for immutable snapshots, Cloud Scheduler replaces APScheduler, Cloud Run hosts the Python worker, Firebase Auth handles users, Hosting serves React.
4. **The biggest engineering risk is false positives** — a truncated fetch or a reordered list can look like "200 assets removed." The design must treat a snapshot as untrusted until it passes a completeness check, and must require confirmation before reporting mass removals.
5. **The space is crowded.** HuntDeck, bbradar, bbscope, TargetFinder and ScopesExtractor already do global scope monitoring. ScopeDiff should not compete on "more scope dumps." It should compete on **what the change means for *you***: the assets you are actively testing, the reward/eligibility impact, and a diff you can verify against the source revision.
6. **"Heuristic" should mean an explainable scoring layer**, not an LLM guess. Every score should show its reasons ("wildcard added", "bounty eligibility false → true", "affects 2 assets you marked as testing"). Auditable rules are a feature in a security tool.

**Recommended MVP:** Bugcrowd + HackerOne adapters (Intigriti as the zero-credential third), a sandbox program for the live demo, a web feed, a diff page, Slack alerts, and a seeded "simulate scope change" path.

---

## 1. What the brief asks for, mapped to decisions

| Brief line | What it means | MVP decision |
|---|---|---|
| "Watches bug bounty scopes" | Periodically fetch public program scope from platforms | Adapter per platform, scheduled sync, immutable snapshot per run |
| "tells hunters exactly what changed" | Structured, per-asset diff — not "program updated" | Added / removed / re-added / modified / moved-out / moved-in, with field-level before→after |
| "before they waste a weekend" | Alert speed + relevance | Hourly (or 15-min) sync, Slack alert, materiality filter, "affects assets you're testing" |
| "One worker for two platforms" | Keep ingestion scope tight | Bugcrowd + HackerOne; Intigriti adapter if time (public data, no credentials) |
| "versioned scope diff" | Every snapshot is a version; diffs are between versions | `programs/{id}/versions/{n}` + immutable `changes/{id}` + GCS snapshot |
| "email/Slack alert" | At least one delivery channel | Slack webhook first; email digest stretch |
| "a web feed with filters" | Cross-program change stream | Firestore `changes` collection + React feed with platform/impact/date filters |
| "No scanning, no exploitation" | Read-only public metadata | No active requests to target assets, ever. Only platform pages/APIs. |
| "Demo: show a program, simulate a scope change, show the alert and exact diff" | Deterministic stage demo | Sandbox program + simulator endpoint + seeded fixture; never fake a real program's change |

---

## 2. The problem, sharpened

Scope changes are silent. A program can add `api.staging.example.com`, remove `legacy.example.com`, flip a wildcard from bounty-eligible to VDP-only, or quietly pause submissions — and the hunter finds out by reloading the page or by wasting a weekend on an asset that was removed three days ago.

Platform-native notifications are coarse: they announce "program updated", not "this specific asset changed from Tier 1 to Tier 3". Bugcrowd is the exception — it publishes a revision changelog — but it is still a revision feed, not a per-asset diff. HackerOne's structured scopes endpoint returns current state, not history. Intigriti keeps historical revisions, but you have to diff them yourself.

So the product has to do three things well:

1. **Capture** a complete, attributable snapshot of a program's scope.
2. **Diff** it against the previous snapshot without producing noise.
3. **Explain** the change in the hunter's terms: what was added, what was removed, what got less valuable, and whether it touches anything they care about.

The third one is where most existing tools stop short, and where ScopeDiff can win.

---

## 3. Prior art — and where the gap is

I searched for tools that already do this. The space is active; this matters for positioning and for what not to rebuild.

| Product / project | What it does | What it does not do |
|---|---|---|
| **HuntDeck** (`huntdeck.io`) | Live cross-platform change feed (HackerOne, Bugcrowd, Intigriti, YesWeHack), filters by change kind, platform, period; validates the event taxonomy (assets added/removed/edited, rewards, policy, status, new programs) | Not personal: no "this affects the assets I'm testing", no watchlist-driven impact |
| **bbradar** (`bbradar.io`) | Target change feed with Added / Re-added / Updated / Removed, opportunity score and dupe-risk estimate | Global feed; the scoring model is proprietary |
| **bbscope** (`bbscope.com`) | Aggregated scope browser across four platforms, change tracking, recon links | Scope database, not a personal alerting workflow |
| **TargetFinder** (`NaroChatyan/targetfinder`) | Self-hosted CLI/HTTP API/MCP; new programs, new targets, fee/reward changes, repo pushes; Discord/Telegram alerts | CLI-first; no polished web product; no per-hunter impact layer |
| **ScopesExtractor** (`JoshuaMart/ScopesExtractor`) | Multi-platform sync, SQLite history, REST API, Discord/HTTP webhooks | Generic webhook events (`add_scope` / `remove_scope`), not a rich diff or a product |
| **arkadiyt/bounty-targets-data** | Hourly JSON dumps of scopes for HackerOne, Bugcrowd, Intigriti, YesWeHack, Federacy | Raw dumps, no diff, no UI, no alerts |
| **PageCrawl** | Generic page-change monitoring for program pages | Page diffing, not structured scope semantics |

**The gap:** everyone tells you what changed globally. Almost nobody tells you **what changed that matters to the work you are doing**, with evidence and an explanation. That is the ScopeDiff wedge:

- **Personal impact:** you mark assets/programs you are testing; alerts say "this removes 1 asset you're testing" or "this adds a new wildcard in a program you watch."
- **Explainable materiality:** a visible rule set, not a black-box score. Show `why` on every change card.
- **Source-backed diffs:** every diff links to the platform revision/page it came from, with the capture timestamp. Trust is the feature.
- **Coverage honesty:** source health, last successful sync, partial/stale badges. If a platform fetch failed, say so instead of silently showing "no changes."

For a hackathon, the polished web experience alone is a differentiator against the CLI-first tools.

---

## 4. Data sources — the hard part

### 4.1 Summary

| Platform | Endpoint | Auth | What you get | Limits / gotchas |
|---|---|---|---|---|
| **Bugcrowd** | `https://bugcrowd.com/engagements.json?category=bug_bounty&page=N` | None | Program directory (name, brief URL, reward summary, industry, status) | Undocumented public JSON; paginate until empty; Cloudflare could challenge |
| **Bugcrowd** | `https://bugcrowd.com/engagements/{handle}/changelog.json` | None | **Revision history** with `id`, `publishedAt`, `tags` (`brief` / `targets`), `publishedBy` | Undocumented; this is the killer feature for a real diff demo |
| **Bugcrowd** | `https://bugcrowd.com/engagements/{handle}/changelog/{revisionId}.json` | None | Full revision: `data.scope` groups → `targets[]` (uri/name/category/tags/ip), `inScope`, `rewardRangeData`, `recentChangeFlags` | Large (21 KB for Nubank); no delta, full snapshot per revision |
| **HackerOne** | `GET https://api.hackerone.com/v1/hackers/programs/{handle}/structured_scopes` | HTTP Basic (`username:api_token`) | Structured scopes: `asset_identifier`, `asset_type`, `eligible_for_bounty`, `eligible_for_submission`, `max_severity`, `instruction`, `created_at`, `updated_at` | **50 req/min** on this endpoint; 10,000-scope pagination cap → use `filter[id__gt]`; token must be from a HackerOne account |
| **HackerOne** | `https://hackerone.com/graphql` (anonymous) | None | — | **Returned 403 in live test.** Do not build on anonymous GraphQL. |
| **Intigriti** | `https://app.intigriti.com/api/core/public/programs/{companyHandle}/{handle}` | None | Program + `assetsCollection` (all historical revisions, newest first by `createdAt`) with `content.assetsAndGroups`; `inScopes` / `outOfScopes`; bounty tables | Undocumented public API; one program was **173 KB**; revision timestamps are Unix seconds |
| **Mirror** | `https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/{platform}_data.json` | None | Normalized public scopes, updated every ~30 min | HackerOne file is **~18.7 MB**; third-party; use for bootstrap/fallback, label it as a mirror |

**Adapter fallbacks worth building in from day one:**

- **Bugcrowd:** if `changelog.json` is empty or unavailable, fetch the current brief document used by the public brief page (`ResearcherEngagementBrief` → `getBriefVersionDocument`) and snapshot that. You lose history, but you keep coverage.
- **Intigriti:** if `assetsCollection` is empty, fall back to the top-level `inScopes` / `outOfScopes` arrays.
- **HackerOne:** `structured_scopes` with `eligible_for_submission: false` is the closest thing to out-of-scope; true out-of-scope policy text is prose, not a structured asset. Do not invent out-of-scope assets that the API did not return. The `scope_exclusions` endpoint is about report categories, not assets.

### 4.2 What I verified live (not assumed)

These are real requests made during this research, not documentation claims:

- `GET https://bugcrowd.com/engagements.json?page=1` → **200**, engagement list with `briefUrl`, `rewardSummary`, `accessStatus`.
- `GET https://bugcrowd.com/engagements.json?category=bug_bounty&page=1` → **200**, 21 KB, **24 engagements**. Each has `name`, `briefUrl`, `rewardSummary`, `accessStatus`, `industryName`.
- `GET https://bugcrowd.com/engagements/nubank/changelog.json` → **200**, 5.8 KB, **24 revisions**. `tags` includes `brief`, `targets`, `brief,targets` and `migration`; `publishedAt` dates are real; `changelogState: "Latest"` marks the current one.
- `GET https://bugcrowd.com/engagements/nubank/changelog/2680eec0-....json` → **200**, 21.7 KB. `data.scope` is an array of 4 groups. Each group has `name`, `inScope`, `targets[]`, `rewardRangeData`, `recentChangeFlags`. Each target has `uri`, `name`, `category`, `ipAddress`, `tags`, `recentChangeFlags`.
- `GET https://app.intigriti.com/api/core/public/programs/cmcom/cmcom` → **200**, 173 KB. `assetsCollection` has 23 revisions; the newest `createdAt` is a Unix timestamp; `content.assetsAndGroups` has 20 entries with `typeId`, `name`, `bountyTierId`, `description`.
- `POST https://hackerone.com/graphql` (anonymous structured-scope query) → **403**. Confirms the anonymous GraphQL path is not viable.
- `HEAD` on the mirror files: `hackerone_data.json` = **18,781,049 bytes**; `intigriti_data.json` = **537,169 bytes**.

### 4.3 What no platform gives you

- **No scope-change webhooks.** You must poll and snapshot.
- **No per-asset delta.** Bugcrowd gives full revisions; Intigriti gives full revisions; HackerOne gives current state. The diff is your job.
- **No cross-platform identity.** `api.example.com` on HackerOne and `api.example.com` on Bugcrowd are separate records with different IDs, types and reward semantics. Normalization is your job.
- **No guarantee of completeness.** A paginated fetch can time out mid-way. A truncated snapshot must never be diffed as if it were complete.

### 4.4 Legal and ethical guardrails

This is a read-only monitor of **public program metadata**. Keep it that way:

- **No scanning, probing, or exploitation** of any in-scope asset. The worker only requests platform pages/APIs, never `api.example.com`.
- **Prefer official APIs** where they exist (HackerOne Hacker API). For Bugcrowd/Intigriti public JSON, document that these are undocumented endpoints and plan a migration path to official API access (Bugcrowd API v1.3, Intigriti researcher API).
- **Rate-limit and identify.** One request at a time per platform, jittered, with a descriptive `User-Agent` and a contact URL. Respect `Retry-After` and back off on 429.
- **Attribution.** Store `source_url`, `source_revision_id`, `fetched_at` on every snapshot. Link back to the platform from the UI.
- **Do not republish full policy text.** Store what you need for the diff, show excerpts, link to the source. Program policies are copyrighted content.
- **Demo data uses reserved values.** `example.com` (RFC 2606), `192.0.2.10` (RFC 5737). Never imply a real program changed when you are simulating.
- **ToS review before launch.** Automated collection may be restricted by platform terms. For the hackathon, keep volume low and public; for production, get API access or written permission.

---

## 5. Domain model

### 5.1 Entities

```
Program        one public program on one platform
SourceRevision one published revision of a program's brief/scope (platform-side)
Snapshot       our normalized capture of a program at a point in time
Asset          one normalized scope entry (in, out, or conflicting)
ScopeGroup     a named group of assets (Bugcrowd/Intigriti); reward tier lives here
Change         the diff between two snapshots (immutable event)
ChangeItem     one added/removed/modified/moved asset inside a Change
Watch          a user's relationship to a program (notes, testing assets, alert prefs)
Delivery       one alert attempt to one user on one channel
SourceRun      one worker run against one source (health, counts, errors, duration)
```

### 5.2 Normalized asset shape

Every adapter produces the same shape. This is the contract that makes cross-platform diffing possible.

```json
{
  "key": "wildcard|*.example.com",
  "source_ids": ["bc-target-60d4e710"],
  "family": "wildcard",
  "kind": "in",
  "target": "*.example.com",
  "display": "*.example.com",
  "groups": [
    { "id": "core-assets", "name": "Core Assets", "in_scope": true, "tier": "Tier 1" }
  ],
  "attrs": {
    "bounty_eligible": true,
    "max_severity": "critical",
    "bounty_tier": "Tier 1",
    "max_bounty": 4000,
    "currency": "USD",
    "instruction": null
  },
  "raw": { "...": "platform-specific, kept for provenance" }
}
```

`family` is the cross-platform type: `web | api | wildcard | ip | cidr | mobile_android | mobile_ios | hardware | source_code | other`.
`kind` is `in | out | conflict`. A target that appears in both an in-scope and an out-of-scope group is `conflict` and gets a UI warning — never silently pick one.

### 5.3 Asset identity — the most important decision

Do **not** key assets by platform ID alone. Platforms regenerate IDs when a target is removed and re-added, and IDs differ across platforms. Do **not** key by display name alone either — names get cosmetic edits.

Recommended matching, in order:

1. **Canonical target key** — `family|canonical_target`. Matches the same asset across revisions and platforms.
2. **Source ID fallback** — for unmatched assets, match by platform `source_id`. This catches renames/retargets where the platform kept the asset identity.
3. **Remaining** — added / removed.

This gives you:
- **Re-added** detection when a previously removed target returns (canonical key matches history).
- **Renamed** detection when the target text changes but the platform ID persists (source ID match, `target` field diff).
- **No false "remove + add"** for a cosmetic rename.

Canonicalization rules per family:

| Family | Canonicalization |
|---|---|
| `web` / `api` | Parse URL if scheme present; lowercase scheme+host; IDNA-encode Unicode; strip default port; strip trailing `/` only for root; drop fragment; keep path case; sort query params **for identity only** |
| `wildcard` | Lowercase; keep `*.` distinct from the apex; do not expand |
| `ip` | `ipaddress.ip_address`; compress IPv6; lowercase |
| `cidr` | `ipaddress.ip_network(strict=False)` |
| `mobile_android` | Extract `id=` package from Play Store URL; fall back to URL |
| `mobile_ios` | Extract numeric app ID from App Store URL; fall back to URL |
| `source_code` | Lowercase host, keep repo path case; strip `.git`, trailing `/` |
| `other` | Unicode NFKC; collapse whitespace; casefold for identity, keep original display |

### 5.4 Change taxonomy

| Event | Meaning | Typical materiality |
|---|---|---|
| `baseline.captured` | First snapshot for a program | Not an alert; informational |
| `scope.added` | New in-scope asset | High if bounty-eligible or wildcard |
| `scope.removed` | Asset no longer in scope | High — "stop testing" |
| `scope.reintroduced` | Previously removed asset returns | High |
| `scope.modified` | Attribute change on an existing asset | Depends on field |
| `scope.moved_out` | `in_scope: true → false` | High |
| `scope.moved_in` | `in_scope: false → true` | High |
| `program.status_changed` | open / paused / closed | High |
| `program.added` / `program.removed` | Program appears / disappears | Medium |
| `reward.changed` | Bounty table / max payout changed | Medium–High |
| `policy.changed` | Policy/description text changed | Low–Medium (muteable) |

Field-level modifications worth calling out separately in the UI:

- `bounty_eligible: true → false` — **reward downgrade**, often more important than a removal.
- `max_severity: critical → none` — effectively a downgrade.
- `bounty_tier: Tier 1 → Tier 3` — lower payout.
- `instruction` changed — testing rules changed; can invalidate a planned attack.
- `group` changed — asset moved between reward groups.

### 5.5 Materiality ("heuristic") scoring

Use a small, auditable rule table. Show the reasons in the UI. Example:

| Signal | Weight |
|---|---|
| Added in-scope, bounty-eligible | +40 |
| Added wildcard (broad surface) | +15 |
| Removed / moved out / bounty disabled | +35 (risk) |
| Reward tier downgraded | +25 |
| Max severity increased | +15 |
| Program paused/closed | +40 |
| Instruction/policy text only | +5 |
| Duplicate/conflicting asset | +10 (needs review) |
| Cosmetic name/order change | 0 (filtered) |

Then bucket: `critical` ≥ 70, `notable` ≥ 40, `minor` ≥ 15, `noise` < 15. Mark `impact: opportunity | risk | neutral` separately, so users can filter "show me opportunities" vs "show me risks". The score must never be the only signal — always pair it with a text label and the reasons list.

### 5.6 Canonical snapshot hash

Hash only **material** fields, sorted deterministically. Exclude volatile fields (sort order, `recentChangeFlags`, fetch timestamps, display labels) or every run will look changed.

```python
MATERIAL_TOP = ("kind", "family", "target", "groups")
MATERIAL_ATTRS = (
    "bounty_eligible", "max_severity", "bounty_tier",
    "max_bounty", "instruction",
)

def snapshot_hash(assets):
    canonical = [
        {
            "key": a.key,
            **{k: getattr(a, k) for k in MATERIAL_TOP},
            "attrs": {k: a.attrs.get(k) for k in MATERIAL_ATTRS},
        }
        for a in sorted(assets, key=lambda a: a.key)
    ]
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
```

If the hash is unchanged: update `last_seen_at` (throttled) and stop. No version, no diff, no alert.

---

## 6. Diff engine

### 6.1 Pipeline

```
adapter.fetch_revision()
        │
        ▼
 completeness gate ──► partial? record run, stop (never diff a partial snapshot)
        │
        ▼
 normalize() ──► Snapshot(assets, groups, meta)
        │
        ▼
 hash == previous? ──► yes: touch last_seen, stop
        │ no
        ▼
 sanity gate ──► suspicious drop? re-fetch once; still suspicious → mark low confidence
        │
        ▼
 diff(prev, curr) ──► Change(items, counts, materiality)
        │
        ▼
 persist version + change + items (idempotent)
        │
        ▼
 alert fan-out (Slack / email / in-app)
```

### 6.2 Matching algorithm

```python
def diff(prev, curr):
    items = []
    prev_by_key = {a.key: a for a in prev.assets}
    curr_by_key = {a.key: a for a in curr.assets}

    # 1. Canonical key matches
    for key in curr_by_key.keys() & prev_by_key.keys():
        before, after = prev_by_key[key], curr_by_key[key]
        fields = compare_material(before, after)
        if before.kind != after.kind:
            items.append(item("moved_in" if after.kind == "in" else "moved_out", before, after, fields))
        elif fields:
            items.append(item("modified", before, after, fields))

    only_prev = prev_by_key.keys() - curr_by_key.keys()
    only_curr = curr_by_key.keys() - prev_by_key.keys()

    # 2. Source-ID rescue for renames/retargets
    prev_by_sid = {sid: prev_by_key[k] for k, a in prev_by_key.items() for sid in a.source_ids}
    curr_by_sid = {sid: curr_by_key[k] for k, a in curr_by_key.items() for sid in a.source_ids}
    for sid in prev_by_sid.keys() & curr_by_sid.keys():
        before, after = prev_by_sid[sid], curr_by_sid[sid]
        if before.key in only_prev and after.key in only_curr:
            items.append(item("modified", before, after, compare_material(before, after), reason="retargeted"))
            only_prev.discard(before.key)
            only_curr.discard(after.key)

    # 3. Remaining
    for key in only_curr:
        items.append(item("added", None, curr_by_key[key]))
    for key in only_prev:
        if key in prev.removed_keys:       # tombstone set from earlier versions
            items.append(item("reintroduced", prev_by_key[key], None))
        else:
            items.append(item("removed", prev_by_key[key], None))

    return Change(items=items, counts=count(items), materiality=score(items))
```

### 6.3 Worked example

**Before (v7):**

```json
{
  "assets": [
    {"key": "api|api.example.com", "kind": "in", "family": "api",
     "attrs": {"bounty_eligible": true, "bounty_tier": "Tier 2", "max_bounty": 4000}},
    {"key": "wildcard|*.example.com", "kind": "in", "family": "wildcard",
     "attrs": {"bounty_eligible": true, "bounty_tier": "Tier 1"}},
    {"key": "web|legacy.example.com", "kind": "in", "family": "web",
     "attrs": {"bounty_eligible": true, "bounty_tier": "Tier 3"}}
  ]
}
```

**After (v8):** removed `legacy.example.com`, added `api.staging.example.com`, downgraded `*.example.com` to Tier 3.

**Diff:**

| Kind | Asset | Detail | Materiality |
|---|---|---|---|
| `scope.added` | `api.staging.example.com` | new API asset, bounty-eligible | 80 · critical · opportunity |
| `scope.removed` | `legacy.example.com` | no longer in scope | 75 · critical · risk |
| `scope.modified` | `*.example.com` | `bounty_tier: Tier 1 → Tier 3` | 55 · notable · risk |

The UI shows this as three rows, each with a source link and a "why" line. Slack shows the top three and a "View diff" button.

### 6.4 Edge cases and how to handle them

| Edge case | Handling |
|---|---|
| Target appears in both in-scope and out-of-scope groups | `kind = "conflict"`, UI warning, materiality bump, never auto-resolve |
| Same target listed twice in one group | Deduplicate by canonical key; merge group memberships; flag duplicate |
| Partial fetch / timeout mid-pagination | `complete = false`; persist a source run error; **do not diff**; retry next run |
| Sudden >30% drop in asset count | Re-fetch once; if confirmed, persist with `confidence = "low"` and a "possible platform change" banner; suppress mass-removal alerts until a second run confirms |
| Platform reorders the list | Canonical hash sorts by key; order is not material |
| Cosmetic name/description edit | Name is non-material; description/instruction changes are `modified` with low materiality |
| Target renamed, source ID stable | Source-ID rescue → `modified` with `target` field diff |
| Target removed then re-added later | `reintroduced` (needs a `removed_assets` history set or a tombstone) |
| Huge program (10k+ assets) | Snapshot to GCS; diff in memory in the worker; persist every asset change, not the whole snapshot |
| Free-text `other` assets | Normalize NFKC/whitespace; treat as unstructured; exact-match identity; lower confidence |
| Policy HTML churn | Strip HTML, compare text lines; event `policy.changed`; muteable by default |
| Program delisted | `program.removed` event; keep the history; mark the program `removed` |

### 6.5 Reliability rules (do not skip these)

1. **Never diff an incomplete snapshot.** A fetch that did not finish pagination is a failed run, not a removal event.
2. **Two-strike removals.** If the asset count drops more than a threshold (start with 25–30%), re-fetch. Only report removals after the drop is confirmed by a second complete snapshot.
3. **Confidence is a field.** Every change has `confidence: high | low` and a reason. Low-confidence changes are still visible but visually distinct and not pushed to Slack by default.
4. **Idempotent commits.** The same snapshot processed twice must create exactly one version and zero changes. Use a transaction keyed on the program's `current_hash`.
5. **Provenance.** Every version stores `source_url`, `source_revision_id`, `source_published_at`, `fetched_at`, `adapter_version`.
6. **Replayable.** Save the raw payload (GCS) so any diff can be reproduced offline.

---

## 7. Architecture on Firebase

### 7.1 Diagram

```
┌──────────────────────────────┐
│ React + TypeScript (Vite)    │
│ Firebase Hosting             │
│  · Auth (Google)             │
│  · Firestore realtime reads  │
│  · Cloud Run callable actions│
└──────────────┬───────────────┘
               │  Firebase JS SDK (read) + HTTPS (actions)
               ▼
┌──────────────────────────────┐        ┌─────────────────────────────┐
│ Firebase / GCP               │        │ Public platforms            │
│  · Firebase Auth             │        │  · Bugcrowd JSON            │
│  · Cloud Firestore           │◄───────┤  · HackerOne Hacker API     │
│  · Cloud Storage (snapshots) │        │  · Intigriti public API     │
│  · Secret Manager            │        │  · arkadiyt mirror          │
│  · App Check (optional)      │        └─────────────────────────────┘
└──────────────▲───────────────┘
               │ firebase-admin (Firestore + Storage)
               │
┌──────────────┴───────────────┐        ┌─────────────────────────────┐
│ Python worker                │◄───────┤ Cloud Scheduler             │
│ FastAPI on Cloud Run         │  OIDC  │  every 15–60 min            │
│  · adapters                  │        └─────────────────────────────┘
│  · normalize + diff          │
│  · persist + alert fan-out   │────────► Slack webhook / email API
└──────────────────────────────┘
```

### 7.2 Why this shape

- **Firestore + React direct reads** gives you a realtime feed with almost no backend read API to build.
- **Cloud Run for Python** keeps the FastAPI shape from the brief, supports long-running sync/backfill, and avoids Cloud Functions packaging and per-function timeout constraints. It also makes local development trivial (`uvicorn`).
- **Cloud Scheduler** replaces APScheduler. APScheduler inside a serverless service is a trap: multiple instances duplicate work, and a scale-to-zero instance stops scheduling. If you want APScheduler for local dev, keep it behind an env flag; in production use Scheduler → `POST /internal/sync`.
- **Cloud Storage** is the escape hatch for Firestore's 1 MiB document limit and for raw provenance.
- **Firebase Auth** removes the entire password/user-management build. Admin roles live in custom claims.

**Alternative:** write the worker as Python Cloud Functions (`firebase_functions`), using `@scheduler_fn.on_schedule` and `@on_document_created`. This is fewer moving parts, but per-function packaging, cold starts, and timeout constraints make large backfills awkward. For a hackathon, either works; I recommend Cloud Run because it preserves the FastAPI mental model and makes backfills/retries easier.

**Alternative:** Firebase SQL Connect (formerly Data Connect) if you want Postgres semantics. It is a managed Cloud SQL instance behind generated GraphQL operations (or native SQL), which is heavier for a 48-hour build and adds a fixed Cloud SQL cost. Firestore is the right default for this app shape (feed + documents + realtime). If reporting/joins become important later, move the analytical layer to SQL Connect or BigQuery.

### 7.3 What replaces Postgres and APScheduler

| Brief component | Replacement | Notes |
|---|---|---|
| FastAPI | FastAPI on Cloud Run (container) | Same code locally; `firebase-admin` for Firestore/Storage/Auth |
| Postgres | Cloud Firestore (Standard) | Documents for programs/versions/changes; GCS for large snapshots |
| APScheduler | Cloud Scheduler → `POST /internal/sync` | OIDC-authenticated; retries; one schedule per platform |
| Slack webhook | Same, called from the worker | Validate host, retry with backoff, record delivery |
| Email | Resend / SendGrid HTTP API (or Firebase "Trigger Email" extension) | Slack first; email as a digest |

### 7.4 Firestore limits and the three-tier storage model

Firestore documents max out at **1 MiB**, and a transaction or batch is capped at **500 writes**. A program with 5,000 assets cannot be one document, and a first-snapshot diff cannot be one transaction. Use three tiers:

1. **Firestore metadata + current state** — `programs/{id}` (summary), `programs/{id}/assets/{assetKey}` (current state, one doc per asset). This is what the UI reads.
2. **Cloud Storage immutable snapshots** — `gs://bucket/snapshots/{platform}/{handle}/v{n}.json.gz`. The full normalized snapshot, plus the raw platform payload. This is the source of truth for replay and large diffs.
3. **Firestore change summaries + item subcollection** — `changes/{id}` (counts, preview of ≤50 items, GCS pointer) and `changes/{id}/items/{itemKey}` (one doc per changed asset). Large diffs stay out of the 1 MiB limit and load incrementally.

This also keeps the hot path cheap: the feed reads one small `changes` doc per card; opening a diff reads its items; the program page reads current asset docs.

### 7.5 Scheduling and concurrency

- **Directory refresh:** once per hour (Bugcrowd directory, HackerOne program list, Intigriti index).
- **Per-program scope refresh:** every 15–60 minutes for watched/high-priority programs; every 6–24 hours for the long tail. Do not hammer every program every 15 minutes.
- **Fan-out:** the scheduler calls a lightweight `/internal/sync-plan` that writes a list of due program IDs to a Cloud Tasks queue, or returns them and the worker processes with bounded concurrency (e.g., 4). Cloud Tasks gives you per-task retries and rate control for free.
- **Idempotency:** the worker uses a Firestore transaction on `current_hash`; duplicate tasks are no-ops.
- **Backoff:** exponential with jitter on 429/5xx; circuit-break a platform after N consecutive failures and surface it in source health.

### 7.6 Local development

- Firebase Emulator Suite: Auth, Firestore, Storage, Hosting. Seed with `scripts/seed.py`.
- `uvicorn app.main:app --reload` for the worker; point `FIRESTORE_EMULATOR_HOST` and `FIREBASE_STORAGE_EMULATOR_HOST` at the emulators.
- `npm run dev` for React; Vite proxy `/api` to `localhost:8080`.
- A `FIXTURES=1` mode makes the worker use local JSON files, no network. This is also the demo fallback.

### 7.7 Deployment

- `firebase deploy --only hosting,firestore:rules,firestore:indexes,storage` for the web + rules.
- `gcloud run deploy scopediff-worker --source worker/ --region us-central1` for FastAPI.
- `firebase.json` hosting rewrite for `/api/**` → Cloud Run `scopediff-worker`, so the frontend is same-origin (no CORS).

```json
{
  "hosting": {
    "public": "dist",
    "rewrites": [
      { "source": "/api/**", "run": { "serviceId": "scopediff-worker", "region": "us-central1" } },
      { "source": "**", "destination": "/index.html" }
    ]
  }
}
```

- Secrets in Secret Manager: `H1_API_TOKEN`, `H1_API_USER`, `SLACK_CLIENT_SECRET` (if using OAuth), `SIMULATE_TOKEN`, `RESEND_API_KEY`.
- Cloud Scheduler job with OIDC service account; the worker verifies the Google-signed OIDC token (or a shared secret for the hackathon, but OIDC is not much harder).

### 7.8 Repository layout

```
scopediff/
  web/                     # React + Vite + TypeScript
    src/
      components/          # ui, diff, scope, layout
      features/            # feed, programs, watchlist, admin, simulator
      lib/                 # firebase, converters, api client
      routes/
      styles/              # tokens.css, globals.css
    index.html
  worker/                  # FastAPI + Python
    app/
      adapters/ normalize/ diff/ pipeline/ api/
    tests/fixtures/
    Dockerfile
    requirements.txt
  design/                  # copy of standards/standard.json + chosen variant notes
  scripts/                 # seed.py, set_admin.py, backfill.py
  firestore.rules
  firestore.indexes.json
  storage.rules
  firebase.json
  .firebaserc
```

---

## 8. Firestore data model

### 8.1 Collections

```
platforms/{platformId}                    // hackerone | bugcrowd | intigriti
  name, base_url, enabled, status, last_run_at, last_ok_at,
  programs_count, error, circuit_open_until

programs/{programId}                      // `${platform}__${handle}`, sanitized
  platform, handle, name, url, status, industry,
  offers_bounties, currency, min_bounty, max_bounty,
  scope_count, in_scope_count, out_of_scope_count,
  current_version, current_hash,
  first_seen_at, last_checked_at, last_changed_at,
  source: { adapter, revision_id, published_at, fetched_at, url },
  search_terms: ["acme", "acme cloud", "acme-cloud"]   // lowercase name/handle tokens (optional; client-side filter is fine for v1)

programs/{programId}/versions/{versionNumber}
  version, hash, captured_at, source_published_at, source_revision_id,
  is_baseline, confidence, counts: {in, out, conflict, total, bounty_eligible},
  change_id, snapshot_path, raw_path

programs/{programId}/assets/{assetKeyHash}
  key, family, kind, target, display,
  groups: [{id, name, in_scope, tier}],
  attrs: {bounty_eligible, max_severity, bounty_tier, max_bounty, currency, instruction},
  first_seen_at, last_seen_at, last_changed_at, version

changes/{changeId}                        // `${programId}__v${toVersion}`
  program_id, program_name, platform, program_url,
  from_version, to_version, detected_at, source_published_at,
  is_baseline, is_simulation, confidence,
  impact, magnitude, materiality_score, reasons: [],
  counts: {added, removed, reintroduced, modified, moved_out, moved_in, total},
  items_preview: [ ... ≤50 ... ],
  items_path, items_count,
  status: "pending" | "ready" | "failed"

changes/{changeId}/items/{itemKeyHash}
  kind, asset_key, family, target,
  before: {...}, after: {...},
  fields: [{name, from, to}],
  impact, materiality_score, reasons: []

users/{uid}
  email, display_name, role: "user" | "admin",
  watched_programs: [programId],       // array-contains query for alert fan-out
  alert_prefs: {email, slack, digest, min_materiality},
  created_at, last_login_at, disabled

users/{uid}/private/alerts
  slack_webhook_url, email_override        // owner-only; never in the public user doc

users/{uid}/watches/{programId}
  added_at, note, testing_assets: [assetKey], testing_status: "watching" | "testing" | "paused"

deliveries/{deliveryId}                   // `${changeId}__${uid}__${channel}`
  change_id, uid, channel, status, attempts, error, sent_at, provider_id

source_runs/{runId}
  platform, started_at, finished_at, status, programs_seen, programs_changed,
  requests, errors: [], duration_ms

config/app
  demo_mode, simulator_enabled, public_feed, updated_at
```

**Why `changes` is top-level:** one query powers the global feed (`orderBy detected_at desc`), and per-program timelines use `where program_id == ...`. Denormalizing `program_name`, `platform` and `program_url` into the change doc avoids N+1 reads on the feed.

**Why the item subcollection:** a large diff (first capture, or a real platform reshuffle) can exceed 1 MiB. Items are written in batches and the change doc flips to `ready` only when all items are present.

### 8.2 Indexes (`firestore.indexes.json`)

```json
{
  "indexes": [
    { "collectionGroup": "changes", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "platform", "order": "ASCENDING" },
                 { "fieldPath": "detected_at", "order": "DESCENDING" }] },
    { "collectionGroup": "changes", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "program_id", "order": "ASCENDING" },
                 { "fieldPath": "detected_at", "order": "DESCENDING" }] },
    { "collectionGroup": "changes", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "impact", "order": "ASCENDING" },
                 { "fieldPath": "detected_at", "order": "DESCENDING" }] },
    { "collectionGroup": "changes", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "confidence", "order": "ASCENDING" },
                 { "fieldPath": "detected_at", "order": "DESCENDING" }] },
    { "collectionGroup": "programs", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "platform", "order": "ASCENDING" },
                 { "fieldPath": "name", "order": "ASCENDING" }] },
    { "collectionGroup": "programs", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "last_changed_at", "order": "DESCENDING" }] }
  ],
  "fieldOverrides": []
}
```

Single-field indexes are automatic. Composite indexes are required when you combine a filter with an `orderBy`.

### 8.3 Security rules (illustrative)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function isAdmin() { return signedIn() && request.auth.token.admin == true; }

    // Read-only platform + app config
    match /platforms/{platformId} {
      allow read: if signedIn();
      allow write: if false;
    }
    match /config/{doc} {
      allow read: if signedIn();
      allow write: if false;
    }

    // Public program data: authenticated read only (v1)
    match /programs/{programId} {
      allow read: if signedIn();
      match /{sub=**} { allow read: if signedIn(); }
      allow write: if false;
    }

    match /changes/{changeId} {
      allow read: if signedIn();
      match /items/{itemId} { allow read: if signedIn(); }
      allow write: if false;
    }

    match /source_runs/{runId} {
      allow read: if isAdmin();
      allow write: if false;
    }

    match /users/{uid} {
      allow read: if signedIn() && request.auth.uid == uid;
      allow update: if signedIn() && request.auth.uid == uid
                    && !request.resource.data.diff(resource.data)
                         .affectedKeys().hasAny(['role', 'disabled']);
      allow create: if signedIn() && request.auth.uid == uid
                    && request.resource.data.role == 'user';
      match /private/{doc} {
        allow read, write: if signedIn() && request.auth.uid == uid;
      }
      match /watches/{programId} {
        allow read, write: if signedIn() && request.auth.uid == uid;
      }
    }

    match /deliveries/{deliveryId} {
      allow read: if signedIn() && resource.data.uid == request.auth.uid;
      allow write: if false;
    }

    match /{document=**} { allow read, write: if false; }
  }
}
```

Notes:
- Writes are server-only (Admin SDK bypasses rules). The client only edits its own user doc and watch subcollection.
- `role` is protected from client updates; admins are set via a script using custom claims + a mirrored Firestore field.
- The `users` rule is owner-only, so the admin user list must go through a Cloud Run endpoint using the Admin SDK (or a separate `public_profiles` collection), not by loosening this rule.
- If you want a public marketing feed later, add a separate `public_changes` collection rather than loosening these rules.

### 8.4 Storage rules

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /snapshots/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }
    match /raw/{allPaths=**} {
      allow read, write: if false;   // server-only provenance
    }
    match /{allPaths=**} { allow read, write: if false; }
  }
}
```

### 8.5 Query patterns

- **Global feed:** `changes.orderBy("detected_at", "desc").limit(25)` + `startAfter(cursor)`.
- **Filtered feed:** add `where("platform", "==", ...)` or `where("impact", "==", ...)`, then the matching composite index.
- **Watched feed:** query `changes.where("program_id", "in", chunk(ids))` and merge client-side; or filter the global feed client-side for small watchlists. Keep watchlists small (5–20 programs) for v1.
- **Program page:** `programs/{id}` + `programs/{id}/assets` (paginated/ordered by `family` or `kind`) + `programs/{id}/versions` (latest 20).
- **Search:** for v1, load a cached list of program names/handles and filter client-side. For scale, add a `search_terms` array + `array-contains` prefix query, or Algolia/Typesense. Firestore Standard has no native full-text search.

---

## 9. Python worker

### 9.1 Module layout

```
worker/
  app/
    main.py                 # FastAPI app, lifespan, admin init
    config.py               # env, Secret Manager, feature flags
    firebase.py             # firestore client, bucket, auth guard
    models.py               # Pydantic: RawAsset, Asset, Snapshot, ChangeItem, Change
    normalize/
      __init__.py
      urls.py               # scheme/host/path/query canonicalization
      wildcards.py
      ips.py
      mobile.py
      text.py
    adapters/
      base.py               # Adapter protocol + RawRevision
      bugcrowd.py
      hackerone.py
      intigriti.py
      mirror.py
      fixture.py
    diff/
      engine.py             # matching + attribute diff
      hash.py
      materiality.py
    pipeline/
      sync.py               # orchestration per program
      persist.py            # Firestore transactions + batches + GCS
      alerts.py             # fan-out, Slack, email, dedupe
      sanity.py             # completeness + truncation checks
    api/
      internal.py           # /internal/sync, /internal/sync-plan, /internal/simulate
      admin.py              # /api/admin/sources, /api/admin/runs
      health.py             # /healthz
  tests/
    fixtures/
      bugcrowd/nubank_v1.json
      bugcrowd/nubank_v2.json
      intigriti/cmcom_v22.json
      intigriti/cmcom_v23.json
    test_normalize.py
    test_diff.py
    test_materiality.py
    test_idempotency.py
  requirements.txt
  Dockerfile
```

### 9.2 Adapter contract

```python
@dataclass
class RawRevision:
    revision_id: str
    published_at: datetime | None
    fetched_at: datetime
    complete: bool
    program: ProgramMeta
    assets: list[RawAsset]
    raw: dict
    source_url: str

class Adapter(Protocol):
    platform: str
    def list_programs(self, *, page: int | None = None) -> Iterable[ProgramRef]: ...
    def fetch_revision(self, ref: ProgramRef) -> RawRevision: ...
```

`complete=False` is a first-class outcome. The pipeline persists a source-run error and refuses to diff.

### 9.3 Sync orchestration

```python
async def sync_program(ref: ProgramRef, adapter: Adapter, store: Store):
    raw = await adapter.fetch_revision(ref)
    if not raw.complete:
        store.record_partial(ref, raw)
        return

    snapshot = normalize(raw)
    current = store.get_current(ref.id)

    if current and current.hash == snapshot.hash:
        store.touch(ref.id)
        return

    if current is None:
        store.write_baseline(snapshot, raw)
        return

    if looks_truncated(current, snapshot):
        retry = await adapter.fetch_revision(ref)
        if not retry.complete or looks_truncated(current, normalize(retry)):
            snapshot.confidence = "low"
            store.flag_suspicious(ref, snapshot)

    change = diff(current, snapshot)
    store.commit(ref.id, snapshot, change, raw)
    await alert_fanout(change)
```

`looks_truncated`: `len(snapshot.assets) < 0.7 * len(current.assets)` or a missing expected group. Tune per platform; log every trigger so false positives are visible.

### 9.4 Persistence and idempotency

```python
@firestore.transactional
def commit_tx(tx, program_ref, snapshot, change):
    current = program_ref.get(transaction=tx)
    if current.get("current_hash") == snapshot.hash:
        return None                      # duplicate task; no-op
    version = current.get("current_version", 0) + 1
    tx.set(program_ref, {
        "current_version": version,
        "current_hash": snapshot.hash,
        "last_checked_at": SERVER_TIMESTAMP,
        "last_changed_at": SERVER_TIMESTAMP,
        "scope_count": len(snapshot.assets),
    }, merge=True)
    tx.set(version_ref, {...})
    tx.set(change_ref, {..., "status": "pending"})
    return version
```

Then write assets/items in batches of ≤500 outside the transaction, and finally set `change.status = "ready"`. Why: a big diff can exceed the 500-write transaction cap, and the UI must not show a half-written change. Writing items first, then flipping `ready`, also makes retries safe.

### 9.5 Rate limits, retries, circuit breaker

- One `httpx.AsyncClient` per platform with a semaphore (e.g., 2 concurrent requests).
- Token bucket per platform. HackerOne structured scopes: stay under 50 req/min; default to 1 request/sec with jitter.
- Retry on 429/500/502/503/504 with exponential backoff + jitter; honor `Retry-After`.
- Do not retry 401/403/404; mark the source unhealthy and alert the admin.
- Circuit breaker: after 5 consecutive failures, stop calling the platform for 30 minutes; surface `circuit_open_until` in `platforms/{id}`.
- A `User-Agent` like `ScopeDiff/0.1 (+https://scopediff.example/contact)`; `example` is a placeholder until a real domain exists.

### 9.6 Observability

- Structured JSON logs: `run_id`, `platform`, `program`, `revision`, `duration_ms`, `assets`, `items`, `errors`.
- `source_runs` doc per platform run; `platforms/{id}` holds the latest status for the admin screen.
- Metrics: programs synced, changes detected, alerts sent, failures by platform, p95 fetch time. For a hackathon, logs + Firestore health docs are enough; Cloud Monitoring dashboards are a stretch.
- Never log tokens, webhook URLs, or full policy text.

### 9.7 Backfill

- The first run is a **baseline**: one version, no change, no alert. Show "Baseline captured · 342 assets" in the feed.
- Backfill Bugcrowd history from `changelog.json`: fetch the last N revisions and create versions/diffs in order. This gives you a real, populated timeline on day one and is excellent for the demo. Do this once, offline, and store it as a seed.
- HackerOne has no public history endpoint; history starts when you start capturing. Say so in the UI ("tracking since ...").

---

## 10. Alerts

### 10.1 Slack

Send a Block Kit message per material change (or a digest if many changes at once):

```json
{
  "text": "ScopeDiff · Acme Cloud · 4 changes",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "ScopeDiff · Acme Cloud" } },
    { "type": "context", "elements": [ { "type": "mrkdwn",
      "text": "Bugcrowd · v7 → v8 · 2 min ago · critical" } ] },
    { "type": "section", "fields": [
      { "type": "mrkdwn", "text": "*+2* added" },
      { "type": "mrkdwn", "text": "*-1* removed" },
      { "type": "mrkdwn", "text": "*~1* changed" }
    ] },
    { "type": "section", "text": { "type": "mrkdwn",
      "text": "*ADDED* `api.staging.example.com`\n*ADDED* `*.staging.example.com`\n*REMOVED* `legacy.example.com`\n*CHANGED* `*.example.com` — Tier 1 → Tier 3" } },
    { "type": "actions", "elements": [
      { "type": "button", "text": { "type": "plain_text", "text": "View diff" },
        "url": "https://scopediff.example/p/acme/diff/7..8" } ] }
  ]
}
```

Rules:
- Max 5 asset lines in Slack; link to the full diff.
- If `confidence = low`, add a warning line and do not send by default.
- If a change touches an asset the user marked as testing, prepend "**Affects 2 assets you're testing**".
- One message per change per user; dedupe via `deliveries/{changeId}__{uid}__slack`.

### 10.2 Email digest

- Daily or immediate; default daily for non-critical, immediate for critical.
- Group by program; subject line includes the count: `ScopeDiff daily · 6 changes across 3 watched programs`.
- Plain-text + simple HTML. Unsubscribe link. Only send to verified emails.
- Provider: Resend (simple HTTP), SendGrid, or the Firebase "Trigger Email from Firestore" extension. For the hackathon, Slack is enough; email is a stretch.

### 10.3 Fan-out and dedupe

```python
users = db.collection("users") \
          .where("watched_programs", "array-contains", change.program_id) \
          .stream()

for user in users:
    prefs = user.to_dict().get("alert_prefs", {})
    watch = user.reference.collection("watches").document(change.program_id).get()
    if not watch.exists:
        continue
    affected = set(watch.to_dict().get("testing_assets", [])) & change.asset_keys
    if not should_notify(prefs, change, affected):
        continue
    for channel in enabled_channels(prefs):
        delivery_id = f"{change.id}__{user.id}__{channel}"
        if db.document(f"deliveries/{delivery_id}").get().exists:
            continue
        send(channel, user, change, affected)
        db.document(f"deliveries/{delivery_id}").set({...})
```

The Firestore trigger is at-least-once, so dedupe is mandatory. Keep the delivery doc as the idempotency key.

### 10.4 Preferences

- Channels: Slack, email, in-app (always).
- Minimum materiality: all / notable / critical.
- Mute policy-only changes.
- Per-program mute.
- Quiet hours (nice-to-have; use the user's timezone).
- "Only changes affecting assets I'm testing" — the differentiator.

### 10.5 Security

- **SSRF:** the Slack webhook URL is user-supplied. Validate `https`, host exactly `hooks.slack.com`, no IP literals, no localhost, no metadata endpoints. Do not follow redirects.
- **Secrets:** store webhook URLs in `users/{uid}/private/alerts`, never in a world-readable doc. Mask the URL in the UI after save (`https://hooks.slack.com/services/••••`).
- **Rate limit:** max N alerts per user per hour; collapse into a digest beyond that.
- **Content sanitization:** platform descriptions are HTML. Sanitize with DOMPurify before rendering; never `dangerouslySetInnerHTML` unsanitized. Store the raw text, render a sanitized subset.
- **Unsubscribe:** signed token, no login required, one-click.

---

## 11. React application

### 11.1 Routes

| Route | Screen | Purpose |
|---|---|---|
| `/` | Change feed | Cross-program changes, filters, search, "watched only" toggle |
| `/programs` | Program directory | Browse/search programs, watch/unwatch |
| `/p/:programId` | Program detail | Current scope, version timeline, program metadata |
| `/p/:programId/diff/:from..:to` | Diff view | The exact change, grouped by kind, with source links |
| `/watchlist` | Watchlist | Watched programs, testing assets, alert preferences |
| `/admin` | Admin | Source health, runs, simulator, users (admin only) |
| `/login` | Auth | Google sign-in |

### 11.2 Component inventory

- `AppShell` — nav, theme toggle, user menu.
- `ChangeCard` — platform chip, program name, counts, materiality badge, top lines, "View diff".
- `DiffSummary` — counts + impact + "why" reasons.
- `DiffGroup` — Added / Removed / Changed / Moved, collapsible.
- `DiffRow` — status badge, mono target, type chip, before→after fields, actions (copy, open source, mark as testing).
- `ScopeTable` — current assets, virtualized, filter by family/kind.
- `VersionTimeline` — version numbers, dates, counts, links to diffs.
- `FilterBar` — platform, impact, magnitude, date range, watched-only, confidence.
- `EmptyState` — message + primary action (never a bare table).
- `SimulatorPanel` — admin-only, scenario picker, "Simulate" button, "SIMULATED" label.
- `SourceHealthTable` — last run, status, error, circuit state, "Sync now".
- `AlertSettings` — Slack webhook, email, materiality threshold, test alert.

### 11.3 Diff rendering rules

- **Always** pair colour with a text label and a glyph: `+ ADDED`, `− REMOVED`, `~ CHANGED`, `→ MOVED OUT`, `← MOVED IN`, `↺ RE-ADDED`.
- Targets/domains/IDs in JetBrains Mono; prose in Inter.
- Changed rows show field-level `before → after`, not a wall of JSON.
- Added/removed rows show the reward tier and bounty eligibility; those are the hunter's decision inputs.
- A "source" link per row (or per change) opens the platform page/revision in a new tab.
- `confidence: low` gets a subtle striped background + "LOW CONFIDENCE" label.
- Long diffs: show 50, then "Show more" (or virtualize). Never freeze the page.
- Copy button on every target; `c` shortcut for the focused row.
- Keyboard: `j`/`k` next/prev, `Enter` open, `/` focus search, `g f` go to feed.

### 11.4 Design tokens (mapped from the standards)

The portfolio's design system is explicit: pick **one** style variant, ship both modes, never hand-pick one-off values, never convey meaning by colour alone. For ScopeDiff:

- **Variant:** `neobrutalism` structure × `minimalism` restraint — the same combination as the publication standard. It fits a security instrument: visible structure, dense technical content, no SaaS gloss.
- **Accent:** amber/oxide `#B45309` (light) / `#F59E0B` (dark). **Not** indigo/violet — explicitly banned.
- **Status palette:** added `#15803D`, removed `#B91C1C`, changed `#B45309`, neutral `#656565`. Always with text.
- **Typography:** `technicalMono` — Space Grotesk 500/700 headings, Inter 400/500 body, JetBrains Mono 400/700 for targets, IDs, versions and code.
- **Borders:** 2px solid, `--fg`; radius 4–8px. Hard offset shadow `5px 5px 0 var(--fg)` on **at most two** element classes: the hero block and the diff figure. No background texture, no dot grid, no sticker tags.
- **Spacing:** only the 9-step scale (4/8/12/16/24/32/48/64/96). Max width 1200px; prose 46rem.
- **Motion:** 80/150/220/400ms, standard easing; `prefers-reduced-motion` disables all.
- **Accessibility:** 4.5:1 text, 3:1 large, 44px touch targets, 2px focus ring with 2px offset, landmarks, one `h1`, no skipped heading levels.
- **Tables:** sticky headers, row actions, search/filter above, pagination or infinite scroll, real empty states. Breakpoint check at 320px: tables scroll in their own container, never widen the page.

Implementation: `src/styles/tokens.css` with CSS custom properties for both modes; Tailwind theme maps to the variables; a `data-theme` attribute on `<html>` with `localStorage` persistence and `prefers-color-scheme` fallback.

### 11.5 Accessibility specifics for a diff

- Do not use colour alone; the badge text carries the meaning.
- `aria-live="polite"` on the feed when a new change arrives (but don't spam).
- The diff table is a real `<table>` with `<caption>` and `<th scope="col">`; on mobile it becomes a list of cards, not a horizontally scrolling mystery.
- Focus is moved to the diff heading after navigation; "Back to feed" is the first focusable element.
- Screen-reader text for changed fields: "Bounty tier changed from Tier 1 to Tier 3".

### 11.6 State and data fetching

- **Reads:** Firestore `onSnapshot` for the feed and program docs (realtime, offline cache). Use typed converters.
- **Actions:** `fetch('/api/...')` to Cloud Run with a Firebase ID token in `Authorization: Bearer ...`; verify with `firebase-admin` in FastAPI.
- **Server state:** TanStack Query for the action endpoints and any paginated REST; Firestore listeners for live data. Don't mirror the same data in both.
- **Auth:** `onAuthStateChanged` → context; route guards; admin claim from the ID token result.
- **Errors:** a toast + an inline retry; never a blank screen. Log to console with a correlation ID.

### 11.7 Performance

- Feed: `limit(25)`, `startAfter`, keep the last page in memory; `onSnapshot` only on page 1.
- Program scope: virtualize beyond ~200 rows (`@tanstack/react-virtual`).
- Diff: lazy-load items on expand; cache by `changeId`.
- Images: use `<img loading="lazy">` with a fixed aspect ratio and a fallback monogram (no Next.js in this stack).
- Bundle: route-level `React.lazy`; Firebase modular imports only.

---

## 12. Demo plan (the 3-minute story)

**Setup (before the demo):**

- Seed the Firestore emulator/production with a sandbox program `Acme Cloud (Sandbox)` using RFC 2606 values: `example.com`, `*.example.com`, `api.example.com`, `192.0.2.10`.
- Seed 7 versions and 3 prior changes, so the current state is v7 and the timeline looks alive.
- Seed a real Bugcrowd program baseline (e.g., a public program) to show real data, clearly labelled with its source and capture time.
- Configure a real Slack webhook to a demo channel.

**Script:**

1. **Landing / feed (20s).** Show the real seeded counts: programs tracked, changes captured, last sync. Point at the source-health strip: platform status, last run time, coverage. This establishes trust — and never use invented numbers on screen.
2. **Open the sandbox program (25s).** "Acme Cloud, 42 in-scope assets, version 7. Here's the current scope and the version timeline."
3. **Simulate a change (20s).** Admin panel → "Expansion + reward downgrade" → Run. Show the toast: "Sync complete · v7 → v8".
4. **The feed updates (30s).** A new card at the top: `+2 added · −1 removed · ~1 changed · critical`. Open it.
5. **The diff (60s).** Green `ADDED api.staging.example.com`, green `ADDED *.staging.example.com`; red `REMOVED legacy.example.com`; amber `CHANGED *.example.com — Tier 1 → Tier 3`. Point at the "why": "wildcard reward downgraded", "affects 1 asset you're testing". Click the source link: the platform revision/page opens.
6. **The alert (25s).** Slack message arrives on the demo channel: same counts, the top asset lines, "View diff" button. "This is what a hunter gets before they waste a weekend."
7. **Close (20s).** "No scanning. No exploitation. Just the changes that matter, with the receipts." Show the source-health footer: last sync, coverage, confidence.

**Fallbacks:**

- No network: `FIXTURES=1` mode + seeded data; the simulator never touches the network.
- Slack down: show the delivery log in the admin panel and the in-app notification.
- Firestore emulator vs production: have both seeded; switch with one env var.
- If a live platform changed unexpectedly: the feed may show a real baseline/change; keep the sandbox card pinned at the top during the demo.

**Honesty rules:**

- The sandbox is labelled `SANDBOX` in the UI and `is_simulation: true` in the data.
- Never claim a real program changed if it did not.
- If a real diff is shown, include the capture timestamp and the source revision.

---

## 13. Build plan

Estimates assume one developer and a 24–36 hour hackathon. The order is chosen so the demo is never blocked by a platform.

### Phase 0 — Foundation (2–3h)

- `firebase init` (hosting, firestore, storage, emulators), React + Vite + TS, Tailwind, tokens, app shell, auth.
- Copy `standards/standard.json` to `design/standard.json`; write `design/README.md` with the chosen variant and tokens.
- Seed script skeleton.
- **Exit:** signed-in user sees an empty feed with a real empty state and both themes.

### Phase 1 — Domain core (3–4h)

- Pydantic models, normalizers, canonical hash, diff engine, materiality rules.
- Pytest golden tests for URL/wildcard/IP/mobile normalization and the worked example.
- Replay CLI: `python -m app.replay fixture_before fixture_after`.
- **Exit:** `pytest` green; replay prints the expected diff; `diff(a, a)` is empty.

### Phase 2 — Persistence (2–3h)

- Firestore repository: programs, versions, assets, changes, items.
- Transaction on `current_hash`; batch writes; `status: pending → ready`.
- Emulator integration test: same snapshot twice → one version, zero changes.
- **Exit:** seeded snapshots are queryable from the emulator; idempotency test passes.

### Phase 3 — React product (4–5h)

- Feed, program page, diff page, filters, watchlist, empty/loading/error states.
- Diff components with labels, mono targets, before→after.
- **Exit:** the seeded fixture is browsable end-to-end in both themes at 320px and 1440px.

### Phase 4 — Ingestion + alerts (3–4h)

- Bugcrowd adapter (directory + changelog + revision), Intigriti adapter, HackerOne mirror/token adapter.
- `/internal/sync` + Cloud Scheduler; Slack delivery + delivery log.
- Source health + admin runs table.
- **Exit:** a real Bugcrowd baseline appears; a simulated change sends a Slack message; a failed fetch shows as unhealthy, not as "no changes".

### Phase 5 — Demo polish (2–3h)

- Sandbox program + simulator UI + seed data + demo script.
- Deploy to Firebase Hosting + Cloud Run; set secrets; verify from a phone.
- **Exit:** the 3-minute demo runs offline, twice in a row, without touching a live platform.

**Total:** ~16–22h, leaving buffer for the inevitable.

### Cut list (in order)

1. Email digest (Slack is enough for the brief).
2. Admin user CRUD (Firebase Auth console is enough; show a read-only user list).
3. Full-text search (client-side filter over ~2k programs is fine).
4. Policy-text diffs (scope only for MVP; the taxonomy is ready).
5. Public marketing site (a single landing page is enough if needed).
6. Multi-tenant orgs, billing, SSO.
7. Recon integrations (crt.sh, Shodan, etc.) — explicitly out of scope, and it would blur the "no scanning" promise.

---

## 14. Testing strategy

**Golden fixtures.** Save raw platform payloads for two revisions of the same program. Run normalize → diff → compare to a checked-in expected JSON. Do this for Bugcrowd and Intigriti; HackerOne once a token exists.

**Property tests (Hypothesis).**

- `diff(a, a)` has zero items.
- `added(a, b)` equals `removed(b, a)` (set-wise, ignoring labels).
- Reordering assets does not change the hash.
- Re-running the same snapshot twice is a no-op.
- Normalization is idempotent (`normalize(normalize(x)) == normalize(x)`).

**Replay CLI.** `python -m app.replay --platform bugcrowd --before v1.json --after v2.json --format table`. This is the debugging tool and the demo backup.

**Emulator integration.** Firestore emulator + a fake adapter that returns a scripted sequence of snapshots; assert versions, changes, items, and delivery docs.

**Frontend.** Vitest + Testing Library for `DiffRow` (labels, ARIA, keyboard), `FilterBar` (query params), `EmptyState` (copy + action). Playwright smoke test for login → feed → diff.

**Accessibility.** `axe-core` on the feed and diff pages; keyboard-only pass; contrast check on both themes.

**Load.** Synthesize a 10,000-asset program; measure normalize/diff time and Firestore batch count. The diff should be O(n) and run in seconds; the UI should never load the whole snapshot.

---

## 15. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A platform endpoint changes or blocks us | High | High | Adapter contract tests; source health; mirror fallback; official API path; circuit breaker |
| HackerOne token unavailable | Medium | High | Mirror bootstrap; demo on Bugcrowd/Intigriti; label the source honestly |
| Partial fetch looks like mass removal | Medium | High | Completeness gate; two-strike rule; confidence field; suppress low-confidence alerts |
| Diff noise from ordering/timestamps | High | Medium | Canonical hash excludes volatile fields; golden tests; sort by key |
| Firestore 1 MiB doc limit | Medium | High | Per-asset docs; GCS snapshots; change items subcollection |
| Firestore 500-write transaction cap | Medium | Medium | Small transaction (pointer + summary), batched item writes, `ready` flag |
| Alert fatigue | High | Medium | Materiality filter, grouping, digest, mute policy-only, "only my testing assets" |
| Secrets leak (Slack webhook, tokens) | Low | High | Secret Manager; private subcollection; masked UI; SSRF allowlist |
| XSS from platform HTML | Medium | High | DOMPurify; CSP; never render raw HTML |
| ToS / legal objection to collection | Medium | High | Public metadata only; rate limits; attribution; official API access before launch |
| Demo fails on stage | Medium | High | Offline fixtures; seeded data; simulator; no live dependency |
| Scope creep (recon, scanning) | High | High | Explicit out-of-scope list; the promise is "what changed", not "what's vulnerable" |

---

## 16. Decisions I recommend (and the alternatives)

1. **Platforms:** Bugcrowd + HackerOne for the MVP; Intigriti as the third adapter because it is public and gives real revision history without credentials. If HackerOne API access is a blocker, swap it for Intigriti in the live demo and keep HackerOne as a mirror-backed baseline.
2. **Compute:** FastAPI on Cloud Run + Firestore. Alternative: Python Cloud Functions (`firebase_functions`) if you want zero containers; accept per-function timeout and packaging constraints.
3. **Database:** Firestore Standard. Alternative: Firebase SQL Connect if you want Postgres joins/SQL and are willing to pay for a Cloud SQL instance and write GraphQL operations or native SQL.
4. **Feed visibility:** authenticated-only for v1. A public marketing feed is a separate collection/page, not loosened rules.
5. **Alerts:** Slack first, email digest second. The brief says "email/Slack"; one solid channel beats two half-built ones.
6. **Demo data:** a sandbox program with RFC 2606 values, plus real baselines. Never simulate on a real program ID without a visible `SIMULATED` label.

---

## 17. How the standards in this repo apply

| File | Applies to ScopeDiff? | What to take |
|---|---|---|
| `standards/standard.json` | Yes | One style variant; both light/dark; spacing/type scales; accessibility; no indigo/violet accent; 44px targets; focus rings |
| `standards/admin-standard.json` | Yes, for `/admin` and user settings | Explicit roles (admin/user); user list with last login and deactivate; empty states with an action; destructive confirmations; sticky table headers; search/filter; no bare empty tables |
| `standards/publication-standard.json` | Only if you build a public write-up page | Neobrutalism × minimalism, amber accent, technicalMono, single-file HTML, RFC 2606 examples, content-safety rules, no fake live URLs |
| `standards/marketing-standard.json` | Only if you build a landing page | Required section order, specific CTAs, no fake social proof, real metrics only, compliance banner if analytics |
| `standards/legal_standard.json` | Only if you publish publicly | Terms/privacy/cookie structure — **but the company details in that file belong to AssetPulse, not ScopeDiff.** Do not copy the registered address, emails or product description. Adapt the sections, not the identity. |
| `standards/deployment-standard.json` | No | It is an on-prem LinkPass deployment spec (Docker, air-gap, RSA licensing). ScopeDiff is a Firebase SaaS. Only the audit/honesty principles carry over. |
| `standards/onprem-deployment-standard.json`, `linkpass-onprem-deployment.json`, `Generic_OnPrem_Deployment_Standard_Template.json` | No | Project-specific on-prem artifacts, irrelevant to a Firebase-hosted app. |

**Design decision for ScopeDiff:** `neobrutalism × minimalism`, amber `#B45309` / `#F59E0B`, `technicalMono`, hard borders, at most two hard shadows. This is consistent with the portfolio's security-instrument register and avoids the generic dark-dashboard look that the admin standard explicitly warns about.

---

## 18. Appendix — references and verified requests

### Verified requests

```bash
# Bugcrowd directory
curl -s "https://bugcrowd.com/engagements.json?category=bug_bounty&page=1"

# Bugcrowd revision history
curl -s "https://bugcrowd.com/engagements/nubank/changelog.json"

# Bugcrowd full revision (scope groups + targets)
curl -s "https://bugcrowd.com/engagements/nubank/changelog/2680eec0-bd72-4b5b-bd5c-1e9d66b11fac.json"

# Intigriti public program + historical scope revisions
curl -s "https://app.intigriti.com/api/core/public/programs/cmcom/cmcom"

# HackerOne Hacker API (requires a token)
curl -s -u "$H1_USER:$H1_TOKEN" \
  "https://api.hackerone.com/v1/hackers/programs/security/structured_scopes?page[size]=100"

# Mirror fallback
curl -sI "https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/hackerone_data.json"
```

### References

- HackerOne Hacker API — Getting Started: <https://api.hackerone.com/getting-started-hacker-api>
- HackerOne Hacker API — Resources (structured scopes): <https://api.hackerone.com/hacker-resources>
- HackerOne rate limits (600 read/min, 50/min structured scopes): <https://api.hackerone.com/getting-started-hacker-api#rate-limits>
- Bugcrowd public engagements JSON: <https://bugcrowd.com/engagements.json>
- Bugcrowd API docs (official, token-based): <http://docs.bugcrowd.com/api/latest/>
- Intigriti public program endpoint (undocumented, verified): `https://app.intigriti.com/api/core/public/programs/{company}/{handle}`
- arkadiyt/bounty-targets-data: <https://github.com/arkadiyt/bounty-targets-data>
- Cloud Firestore document size (1 MiB): <https://firebase.google.com/docs/firestore/storage-size>
- Firestore transactions/batches (500 writes): <https://firebase.google.com/docs/firestore/manage-data/transactions>
- Cloud Functions for Firebase Python: <https://firebase.google.com/docs/functions/get-started>
- Scheduled functions (`on_schedule`): <https://firebase.google.com/docs/functions/schedule-functions>
- Firebase Hosting → Cloud Run rewrites: <https://firebase.google.com/docs/hosting/cloud-run>
- Firebase SQL Connect (formerly Data Connect): <https://firebase.google.com/docs/sql-connect>
- Prior art: <https://huntdeck.io/changes>, <https://bbradar.io>, <https://bbscope.com>, <https://github.com/NaroChatyan/targetfinder>, <https://github.com/JoshuaMart/ScopesExtractor>

---

## 19. One-paragraph pitch (for the README / demo)

> Bug bounty scopes change silently. A program adds a staging API, removes a legacy host, or quietly downgrades a wildcard from Tier 1 to Tier 3 — and hunters find out by wasting a weekend. ScopeDiff watches the programs you care about, captures a versioned snapshot of every scope, and turns each change into a per-asset diff with a plain-English reason: added, removed, re-added, moved out, or reward downgraded. It tells you when a change touches an asset you're actively testing, and it shows the source revision so you can verify it yourself. No scanning. No exploitation. Just what changed, why it matters, and the receipts.

---

## 20. Immediate next actions

1. **Create the Firebase project** (Blaze plan), enable Auth / Firestore / Storage / Hosting, and copy `standards/standard.json` to `design/standard.json`.
2. **Capture two Bugcrowd revisions** for one program and check them into `worker/tests/fixtures/`. That pair is the first golden diff and the seed for the demo.
3. **Build the normalizer + diff engine with pytest before touching React.** The product is only as good as the diff; the UI is a view over it.
4. **Scaffold the feed and diff page against the fixture**, then wire Firestore. Do not wait for live ingestion to build the UI.
5. **Add the simulator and Slack delivery before the live adapters.** The demo must not depend on a platform being reachable.
6. **Only then add live Bugcrowd / Intigriti / HackerOne ingestion**, with the completeness gate and source health from the start.

