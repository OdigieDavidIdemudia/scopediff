# ScopeDiff â€” Submission

**Tagline:** Know what changed before you test.

**Demo:** https://scopediff.web.app  
**Code:** https://github.com/OdigieDavidIdemudia/scopediff  
**Security assessment:** [OWASP_ASSESSMENT.md](OWASP_ASSESSMENT.md)  
**Demo video:** _[paste YouTube/Vimeo URL after upload]_

---

## About the project

### Inspiration

I kept running into the same bug bounty failure mode: a hunter spends a weekend on a target that was removed, repriced or moved out of scope days earlier. Program pages change quietly, changelogs are inconsistent across platforms, and notification feeds are noisy. There is no universal â€œgit diffâ€ for the rules of engagement.

ScopeDiff is my attempt to build that diff.

The core idea is simple:

> Store every published scope revision. Compare it to the previous one. Tell the hunter exactly what changed, how much it matters, and whether it touches the targets they actually test.

The project is deliberately not a scanner. It only reads published program metadata. No exploitation, no fuzzing, no traffic to program assets.

### What it does

- Watches Bugcrowd, HackerOne and Intigriti program scopes.
- Stores immutable, versioned snapshots with content hashes.
- Detects added, removed, reintroduced, modified, moved-in and moved-out targets.
- Handles renames, group changes, bounty eligibility, reward tiers, maximum bounties and scope instructions.
- Scores each change for materiality.
- Matches changes against the hunterâ€™s manually entered testing targets.
- Sends Slack alerts when the change clears the userâ€™s materiality and confidence floor.
- Lets users add a supported program by URL and choose a 30- or 60-minute check cadence.
- Runs on the Firebase free tier and a free GitHub Actions cron.

A materiality score is a weighted sum of observed signals, capped at 100:

$$
M = \min\left(100,\; \sum_{s \in S} w_s\right)
$$

where \(S\) contains signals such as new bounty-eligible scope, wildcard coverage, high reward tier, high maximum bounty, removals and downgrades. The score is a prioritisation aid, not a vulnerability severity score.

### How I built it

The system has four layers:

1. **Collection** â€” Python adapters fetch public program metadata from Bugcrowd, HackerOne and Intigriti.
2. **Normalisation** â€” URLs, wildcards, IPs, CIDRs, mobile packages and source repositories are canonicalised so cosmetic differences do not look like scope changes.
3. **Diff + materiality** â€” a deterministic Python engine compares the previous and current snapshots, detects rename resurrections, builds per-target before/after records, and scores the result.
4. **Product** â€” React/TypeScript UI with a feed, diff pages, program history, watchlist, preference wizard, alert settings and admin status.

The free-plan architecture uses:

- **Firebase Auth** for Google SSO and email/password.
- **Firestore** for profiles, preferences, watches, programs, versions, changes and runs.
- **Firebase Hosting** for the app.
- **GitHub Actions** as the scheduled worker every 30 minutes.

I originally planned Cloud Run + Cloud Scheduler, but the project is intentionally staying on the free plan. The FastAPI worker remains in the repository for a future paid deployment; the public build does not depend on it. The free cron reads queued watches from Firestore, fetches each supported program, stores the baseline or diff, updates `next_check_at`, and sends Slack alerts.

### Challenges

- **Different source models.** Bugcrowd, HackerOne and Intigriti describe scope in different shapes. A target can be a URL, wildcard, IP, CIDR, mobile package or repository. Normalising those without erasing real changes took more care than the UI.
- **False positives.** Public scope pages occasionally return partial data. A naive tool would announce â€œ80% of the scope disappearedâ€ and destroy trust. I added zero-target refusal, collapse and removal gates, partial-revision confidence, and a second-fetch confirmation.
- **Rename rescue.** Platforms sometimes keep the same source ID while changing the target string. A pure string diff reports a remove + add; the engine treats it as a rename when provenance survives.
- **Alert fatigue.** Materiality alone is not enough. The watcher needs to know whether a change touches the hosts, wildcards or packages they actually test.
- **Free-plan constraints.** Cloud Run and Cloud Scheduler require billing, so I replaced them with a Firestore-first app and a GitHub Actions cron. The trade-off is a 30-minute cadence and queued baselines instead of instant fetching.
- **Security boundaries.** Users write only their own profile and queued watches. Global program data is read-only. Firestore rules validate watch ownership, status, platform, interval and URL shape.
- **Trustworthy provenance.** Every diff links back to the published revision and source revision ID, and every run is recorded.

### What I learned

- A diff engine is mostly a data-quality problem. Canonicalisation and false-positive gates matter more than the visual diff.
- â€œWhat changed?â€ is not the same as â€œwhat matters to me?â€. Personal target matching is the feature that turns a feed into a tool.
- Free-tier architecture decisions shape the product. A 30-minute cron forces honest UX: queued baselines, explicit pending states and a manual â€œrun workflowâ€ escape hatch.
- Security rules are product logic. Firestore rules, Auth claims and client-written watch documents have to be designed together.
- Operational monitoring is a feature. A silent cron is worse than a noisy one because the user assumes the scope is stable.

### Whatâ€™s next

- Email verification and stricter Firebase password policy.
- Per-user watch counters and a server-side rate limit.
- Cron failure alerts and Cloud Audit Logs.
- Public/team workspaces with shared watchlists.
- Optional paid Cloud Run deployment with 1/5-minute cadence.
- More adapters and a generic â€œcustom programâ€ importer with a review step.

---

## Built with

`Python` Â· `FastAPI` Â· `Pydantic` Â· `React` Â· `TypeScript` Â· `Vite` Â· `Firebase Auth` Â· `Firestore` Â· `Firebase Hosting` Â· `GitHub Actions` Â· `HackerOne API` Â· `Bugcrowd` Â· `Intigriti` Â· `Slack` Â· `CSS` Â· `Playwright` Â· `Pytest` Â· `Google Fonts` Â· `GitHub`

---

## Try it out

- **Live app:** https://scopediff.web.app
- **Source code:** https://github.com/OdigieDavidIdemudia/scopediff
- **Cron workflow:** https://github.com/OdigieDavidIdemudia/scopediff/actions/workflows/scopediff-cron.yml
- **Security assessment:** [OWASP_ASSESSMENT.md](OWASP_ASSESSMENT.md)

> The repository is public for judging. It contains no API keys; HackerOne credentials and the Firebase service account are stored only in GitHub Actions secrets.

---

## Demo video â€” 3-minute script

**Target length:** 2:45â€“2:55  
**Format:** 1920Ã—1080, 30 fps, H.264/AAC  
**Narration:** calm, technical, no hype  
**Assets:** `docs/screenshots/` plus the live site

### 0:00â€“0:12 â€” Hook

**Visual:** Title card, then the demo feed with the simulated v8 diff card.  
**Narration:**

> Bug bounty scopes change quietly. A target is removed, a reward tier drops, a new wildcard appears. Hunters usually find out after they have already wasted the weekend. This is ScopeDiff.

### 0:12â€“0:35 â€” Problem

**Visual:** Feed cards; highlight â€œ2 added, 1 removed, 1 changedâ€ and the materiality bar.  
**Narration:**

> A scope is the list of systems a program allows you to test. There is no universal changelog for it. ScopeDiff stores every published revision, compares it to the previous one, and shows the exact targets that moved, disappeared or changed terms.

### 0:35â€“1:05 â€” Accounts and onboarding

**Visual:** Register page â†’ preference wizard step 1 â†’ testing targets step.  
**Narration:**

> The live product is account-based. Sign up with Google or email, then answer a short preference wizard: what you hunt, which platforms you use, your bounty range, how often to check, and the targets you actually test. Testing targets are entered manually, because guessing them would make the personal-impact ranking meaningless.

### 1:05â€“1:30 â€” Add a program by URL

**Visual:** Programs page â†’ paste a HackerOne URL â†’ queued baseline â†’ active watch.  
**Narration:**

> Add a program by pasting a public Bugcrowd, HackerOne or Intigriti URL. The free build writes a queued baseline to Firestore. A GitHub Actions cron picks it up within thirty minutes, captures the first scope version, activates the watch, and schedules the next check.

### 1:30â€“2:05 â€” The diff payoff

**Visual:** Demo mode â†’ Simulate scope change â†’ feed card â†’ diff page. Highlight added, removed, changed groups, materiality 91, and â€œYour targets.â€  
**Narration:**

> Here is the moment that matters. A new revision adds two staging targets, removes a legacy portal, and downgrades the production wildcard from Tier 1 and ten thousand dollars to Tier 3 and two thousand. ScopeDiff scores the change at ninety-one out of one hundred and tells the hunter that api dot acme dot example and the acme wildcard are affected. The diff links back to the exact published revision.

### 2:05â€“2:30 â€” Free-plan architecture

**Visual:** Admin page / worker wiring; then an architecture card: Auth, Firestore, Hosting, GitHub Actions.  
**Narration:**

> The free-plan architecture is Firebase Auth, Firestore and Hosting, with a GitHub Actions cron every thirty minutes. The Python diff engine is deterministic: fetch published metadata, canonicalise, compare, score, persist, notify. No scanning. No exploitation. No billing.

### 2:30â€“2:50 â€” Close

**Visual:** Outro card with URL and repo.  
**Narration:**

> ScopeDiff. Know what changed before you test. Try it at scopediff dot web dot app.

### Upload checklist

- Upload the MP4 to YouTube or Vimeo.
- Set visibility to **public** or **unlisted without a password**.
- Keep the first three minutes self-contained.
- Paste the URL into the submission form.
- Add the same link to `SUBMISSION.md`.

---

## Media gallery

Recommended order:

1. `docs/screenshots/feed-light.png` â€” change feed
2. `docs/screenshots/diff-v8.png` â€” exact diff
3. `docs/screenshots/live-programs-v2.png` â€” live programs and queued baselines
4. `docs/screenshots/onboarding-1.png` â€” preference wizard
5. `docs/screenshots/live-watchlist-v2.png` â€” personal targets and alerts
6. `docs/screenshots/admin.png` â€” worker/source status
7. `docs/screenshots/feed-dark.png` â€” dark mode
8. `docs/screenshots/feed-mobile.png` â€” mobile layout

---

## Submission notes

- The public demo uses a fictional sandbox program with RFC 2606 domains and RFC 5737 ranges.
- Live accounts use real public program metadata only when the user adds a supported URL.
- The HackerOne token is configured in GitHub Actions secrets, not in the client.
- The repository is public for judging. HackerOne credentials and the Firebase service account live only in GitHub Actions secrets.
- The security assessment is in [OWASP_ASSESSMENT.md](OWASP_ASSESSMENT.md).

