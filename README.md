# ScopeDiff

**Know what changed before you test.**

**Live demo:** [https://scopediff.web.app](https://scopediff.web.app)

ScopeDiff watches bug bounty scopes across Bugcrowd, HackerOne and Intigriti, stores every
published revision, and tells hunters exactly what changed — added targets, removed targets,
reward changes and scope moves — with a materiality score and a Slack alert.

No scanning. No exploitation. Just published scope revisions, diffed.

![ScopeDiff change feed](docs/screenshots/feed-light.png)

## The problem

A hunter finds a promising program, spends a weekend on a target, then discovers the target
was removed or repriced days earlier. Program pages do not announce changes, changelogs are
inconsistent, and notification feeds are noisy. ScopeDiff turns a scope into an append-only
version history and surfaces the delta.

## What the demo shows

- A feed of 6 seeded changes with impact, confidence, materiality and personal-impact
  matching.
- A **hybrid AI Diff Analyst** that prefers on-device inference in Chrome and automatically
  falls back to Gemini in the cloud.
- Four fictional programs across Bugcrowd, HackerOne, Intigriti and a sandbox.
- A hidden **v8** sandbox revision. Click **Simulate scope change** and the real diff engine
  produces:
  - `*.staging.acme.example` added, Tier 1, $5,000
  - `api.staging.acme.example` added, Tier 2, $3,000
  - `*.acme.example` repriced from Tier 1 / $10,000 to Tier 3 / $2,000
  - `legacy.acme.example` removed
  - materiality **91/100**, 4 targets, mixed impact
- A full diff page with field-level before/after changes, personal-impact matching against
  the viewer's testing targets, alert status and source provenance.
- Program detail pages with current scope, version timeline and snapshot history.
- Watchlist and alert preferences, worker admin, light/dark themes and mobile layouts.

All demo targets use RFC 2606 reserved domains (`example.com`) and RFC 5737 test ranges
(`192.0.2.10`). The seeded programs are fictional. No real program ID is used.

## Live accounts, onboarding and scheduled checks

The live product path is now account-based and runs entirely on free tiers:

- **Sign up / sign in** with Google SSO or email/password via Firebase Auth.
- **Preference wizard** on first sign-in, with clickable answers and manual testing-target input.
- **Watch a program by URL** from the Programs page. Supported links:
  - `bugcrowd.com/<handle>`
  - `hackerone.com/<handle>`
  - `app.intigriti.com/programs/<company>/<program>/detail`
- Adding a program writes a **queued baseline** to Firestore. No paid worker is involved.
- A free **GitHub Actions workflow runs every 30 minutes**. It processes queued baselines,
  fetches the first published version, stores it, and activates the watch.
- The same cron re-checks due watches, creates diffs, updates `next_check_at`, and sends Slack
  alerts for matching user preferences.
- The feed is personalized to the signed-in user's watched programs and testing targets.
- A **Demo / Live** toggle in the header switches between the bundled showcase and the
  account-backed live feed.

The scheduler is deterministic, not an LLM agent: fetch published metadata → canonicalise →
diff → score → persist → notify. That is deliberate. Cron handles timing; the diff engine
handles truth.

**Free-plan trade-offs:** the cron cadence is 30 minutes (GitHub Actions minimum practical
schedule), the Slack “test alert” button is disabled, and the FastAPI worker is not hosted.
The FastAPI code remains in the repo for an optional future Cloud Run deployment.

## Three-minute demo script

1. Open `/` — point out the feed, the four source status cells and the personal-exposure
   stat.
2. Open **Acme Cloud (Sandbox)** — show the current scope and version timeline.
3. Return to the feed and click **Simulate scope change**.
4. The v8 card appears at the top with a toast action. Open the diff.
5. Walk the diff groups: two added staging targets, one removed legacy target, one repriced
   production wildcard.
6. Point at **Your targets**: `api.acme.example` and `*.acme.example` are affected.
7. Open `/admin` — show the simulator, source runs, guardrails and worker wiring.
8. Toggle dark mode and resize to mobile.

The simulation is persisted in `sessionStorage` so a refresh does not lose the demo. Use
**Reset demo** in `/admin` to go back to v7.

## Architecture

```
Bugcrowd ─┐
HackerOne ─┼─> Python worker (FastAPI) ─> canonical snapshot ─> diff engine ─> materiality
Intigriti ─┘          │                         │                    │
                      │                         │                    ├─> Firestore change + items
                      │                         │                    ├─> Slack alert
                      │                         └─> version history  └─> web bootstrap / API
                      │
              Cloud Scheduler
                      │
              Firestore + Cloud Storage
                      │
                React + Vite web app on Firebase Hosting
```

- **Worker:** `worker/` — FastAPI, Pydantic, adapters, canonicalisation, diff engine,
  materiality, guardrails, Slack, JSON/Firestore stores.
- **Web:** `web/` — React 18 + Vite + TypeScript, plain CSS design system, demo-first.
- **Demo data generator:** `scripts/build_demo_data.py` is the single source of truth for
  the web fixture, the local JSON store and the v7/v8 adapter fixtures.
- **Shared contract:** the API `/api/bootstrap` returns exactly the shape the web app uses
  in demo mode (`data/demo.json`).

## Quickstart (demo mode)

Requirements: Python 3.13, Node 18+.

### 1. Worker (optional for the web demo)

```powershell
cd worker
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8765
```

Check it:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/healthz
Invoke-RestMethod http://127.0.0.1:8765/api/bootstrap
```

The worker defaults to demo mode, the local JSON store at `worker/.data/store.json` and the
bundled sandbox. This store starts at v7.

### 2. Web

```powershell
cd web
npm install
npm run dev
```

Open the printed URL. With no `VITE_API_URL`, the app runs entirely from
`data/demo.json` and auto-signs in as **Demo Hunter**. Vite usually uses port 5173; if that
port is busy it prints the actual port.

### 3. Production build

```powershell
cd web
npm run build
```

## Live worker mode

Set `web/.env.local`:

```dotenv
VITE_API_URL=http://127.0.0.1:8765
```

Restart Vite. The header switches to **Live worker** and the app loads `/api/bootstrap`.

Live mode expects Firebase Auth for the authenticated feed. For local-only inspection
without Firebase credentials, also set:

```dotenv
VITE_ALLOW_LOCAL_SESSION=1
```

This shows an explicit **Continue with local preview** button. Never enable it in
production.

### Worker environment

Copy `.env.example` to `.env` at the repo root. Common values:

```dotenv
SCOPEDIFF_DEMO=true
SCOPEDIFF_STORE=json
SCOPEDIFF_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174
SCOPEDIFF_INTERNAL_TOKEN=change-me
SLACK_WEBHOOK_URL=
SCOPEDIFF_SLACK_MIN_SCORE=25
H1_API_USER=
H1_API_TOKEN=
```

For production persistence:

```dotenv
SCOPEDIFF_DEMO=false
SCOPEDIFF_STORE=firestore
GOOGLE_CLOUD_PROJECT=your-project
SCOPEDIFF_SNAPSHOT_BUCKET=your-snapshot-bucket
```

The Firestore store writes snapshots inline when the JSON is under 900 KB and to Cloud
Storage above that. The Firestore implementation is included but not exercised in local CI;
the JSON store is the tested path.

## Sources

| Source | Directory | Scope detail | Credentials |
| --- | --- | --- | --- |
| Bugcrowd | Public `engagements.json` | `changelog.json` revisions with scope groups/targets | None |
| Intigriti | Public program API | `assetsCollection` with type IDs | None |
| HackerOne | Hacker API | Structured scopes, 50 req/min, 10,000-scope pagination cap | `H1_API_USER` + `H1_API_TOKEN` |
| Sandbox | `FixtureAdapter` | Reserved-domain v7/v8 fixture | None |

HackerOne is deliberately token-gated. Without both credentials the adapter reports
`AdapterNotConfigured` instead of failing the whole worker. No token ships with this repo.

## Diff engine

The engine compares two canonical snapshots, not raw API payloads.

- Canonicalises URLs, hosts, wildcards, IPs, CIDRs, mobile packages and source repos.
- Merges duplicate targets per family and keeps source IDs for provenance.
- Detects `added`, `removed`, `reintroduced`, `modified`, `moved_in` and `moved_out`.
- Rescues renames when a source ID survives but the target string changes.
- Diffs group membership, bounty eligibility, reward tier, max bounty, currency, severity
  and instructions.
- Scores materiality from new bounty-eligible scope, wildcard coverage, reward tier, max
  bounty, removals and group changes.
- Matches the viewer's testing targets, including wildcard semantics.

### False-positive gates

- A zero-target snapshot is refused, never stored as a change.
- A scope collapse below 40% of the previous target count, or 50%+ removals, is held as
  pending until a second identical fetch confirms it.
- Incomplete revisions are low confidence and do not alert until the worker can confirm
  them.
- The internal simulation can bypass the hold only when explicitly requested.
- Slack webhooks are restricted to `hooks.slack.com` and `hooks.slack-gov.com`; the
  `SCOPEDIFF_ALLOW_ANY_WEBHOOK=1` escape hatch is test-only.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Liveness and configuration summary |
| GET | `/api/bootstrap` | One-shot demo/global web payload |
| GET | `/api/me/profile` | Signed-in user profile and preferences |
| PUT | `/api/me/preferences` | Save wizard preferences |
| GET | `/api/me/bootstrap` | Personalized programs, changes and watches |
| GET | `/api/me/watches` | Watched programs and intervals |
| POST | `/api/me/watches` | Add a program by supported URL and capture its baseline |
| PATCH | `/api/me/watches/{program_id}` | Change interval, alert mode or active state |
| DELETE | `/api/me/watches/{program_id}` | Stop watching |
| POST | `/api/me/alerts/test` | Test the signed-in user's Slack webhook |
| GET | `/api/platforms` | Source status |
| GET | `/api/programs?platform=&q=` | Program list |
| GET | `/api/programs/{id}` | Program detail |
| GET | `/api/programs/{id}/assets` | Current scope assets |
| GET | `/api/programs/{id}/versions` | Version history |
| GET | `/api/changes?limit=&offset=&program_id=&platform=&impact=&confidence=&status=&q=` | Change feed |
| GET | `/api/changes/{id}` | Change metadata |
| GET | `/api/changes/{id}/items` | Target-level diff items |
| GET | `/api/changes/{id}/diff` | Change plus items |
| GET | `/api/runs?limit=` | Source runs |
| GET | `/api/admin/overview` | Admin summary |
| POST | `/internal/sync` | Sync a handle/platform or directory (token-guarded) |
| POST | `/internal/cron` | Process due watches; called every minute by Cloud Scheduler |
| POST | `/internal/simulate` | Publish the sandbox v8 scenario (token-guarded) |
| POST | `/internal/seed` | Ensure the sandbox baseline exists (token-guarded) |
| POST | `/internal/alerts/test` | Send a Slack test (token-guarded) |

`/internal/*` requires `X-ScopeDiff-Token` when `SCOPEDIFF_INTERNAL_TOKEN` is set.

Example simulation:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8765/internal/simulate `
  -ContentType 'application/json' `
  -Body '{"scenario":"acme-v8"}'
```

## Data model

- `Program` — platform, handle, status, industry, bounty range, current version/hash, scope
  counts, source reference.
- `Snapshot` — program/version/hash, capture and publish timestamps, revision ID, complete
  flag, confidence, assets.
- `Asset` — canonical target, display name, family, in/out/conflict, source IDs, groups,
  bounty attributes, tags.
- `Version` — append-only pointer to a snapshot; links to the change that created it.
- `Change` — from/to version, detected/published time, impact, magnitude, materiality score,
  reasons, counts, alert status.
- `ChangeItem` — per-target before/after, changed fields, impact, score and reasons.
- `SourceRun` — platform, target, timing, status, counts, latency, error and notes.

## Deployment status

- **Firebase Hosting:** deployed to project `scopediff`.
- **Public URL:** [https://scopediff.web.app](https://scopediff.web.app)
- **Auth:** email/password + Google enabled.
- **Firestore:** database, rules and indexes deployed.
- **Hybrid AI:** Firebase AI Logic enabled; Gemini Developer API cloud fallback verified; on-device preference configured.
- **Live data:** browser reads/writes Firestore directly; no paid worker API.
- **Cron:** public GitHub repo with a 30-minute Actions workflow.
- **Repo:** [OdigieDavidIdemudia/scopediff](https://github.com/OdigieDavidIdemudia/scopediff) (public).
- **Security assessment:** [OWASP_ASSESSMENT.md](OWASP_ASSESSMENT.md) — 6 pass, 3 partial, 1 fail.
- **Submission story:** [SUBMISSION.md](SUBMISSION.md).
- **Not deployed:** Cloud Run / Cloud Scheduler. Those require Blaze billing and are
  intentionally left out of the free-plan build.

## Deploying the free-plan build

The checked-in `.firebaserc` points at `scopediff`.

### Web app

```powershell
cd web
npm run build
cd ..
npx firebase-tools deploy --only hosting --project scopediff
```

Firebase Auth and Firestore config live in `web/.env.local`. The production build does
**not** need `VITE_API_URL`; live mode talks to Firestore directly.

### Auth + Firestore

```powershell
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project scopediff
npx firebase-tools deploy --only auth --project scopediff
```

`firebase.json` contains the email/password and Google provider configuration.

### Cron

The cron is a public GitHub Actions workflow (secrets stay private):

```text
.github/workflows/scopediff-cron.yml
```

It runs every 30 minutes and can be triggered manually from the Actions tab. Required
repository secrets:

- `FIREBASE_SERVICE_ACCOUNT` — JSON for a service account with `roles/datastore.user`
- `H1_API_USER`
- `H1_API_TOKEN`

The cron script is `scripts/firestore_cron.py`. It:

1. scans each user's watches for `status == "pending"`
2. resolves the supported URL, captures the first baseline and creates an active watch
3. checks due active watches, stores diffs and updates `next_check_at`
4. sends Slack alerts when the user's alert mode and materiality floor match

### Optional future Cloud Run deployment

The FastAPI worker remains in `worker/` and can be deployed to Cloud Run if billing is
enabled later. The web app does not depend on it in the free-plan build. If you do deploy it,
set `VITE_API_URL` and rebuild, then point Cloud Scheduler at `/internal/cron`.

## Tests

```powershell
cd worker
python -m pytest
```

The suite covers canonicalisation, diff kinds, rename rescue, group/bounty changes,
reintroduction, truncation and removal gates, partial-fetch confidence, API routes,
simulation, adapters and demo-data invariants.

Current status: **51 passing tests**.

Build check:

```powershell
cd web
npm run build
```

## Project layout

```
ScopeDiff/
  data/demo.json              Web demo dataset (generated)
  design/                     Project design standard and rationale
  docs/screenshots/           Verified UI screenshots
  firebase.json               Hosting, Firestore, Storage rules/indexes
  firestore.rules
  firestore.indexes.json
  storage.rules
  scripts/build_demo_data.py  Demo fixture generator
  scripts/firestore_cron.py   Free-plan Firestore cron runner
  .github/workflows/          GitHub Actions 30-minute cron
  standards/                  Personal design standards (reference)
  worker/
    app/
      adapters/               Bugcrowd, HackerOne, Intigriti, fixture, HTTP
      diff/                   Diff engine and materiality
      normalize/              Canonicalisation and snapshot building
      pipeline/               Store, sync, alerts, simulation
      config.py
      main.py
      models.py
    tests/                    41 pytest tests and fixtures
    Dockerfile
  web/
    src/
      components/             App shell, cards, filters, scope table, timeline
      lib/                    Firestore live loader, auth, formatting, matching, selectors
      pages/                  Feed, programs, program, diff, watchlist, admin, login
      state/AppStore.tsx      Demo/live state, simulation, settings, auth
      styles/                 Tokens and component CSS
      types.ts                Shared data contract
    index.html
```

## Demo data regeneration

```powershell
python scripts/build_demo_data.py
```

This rewrites `data/demo.json`, `worker/.data/store.json` and the v7/v8 fixtures. It is
deterministic.

## Limitations

- Free plan uses GitHub Actions every **30 minutes**; 1/5/15-minute cadences are not
  available without a paid scheduler.
- Queued baselines wait for the next cron run. There is no immediate fetch on the public
  free build.
- The Slack “test alert” button is disabled on the free build; real alerts are sent by the
  cron after a detected change.
- Email digest is stored as a preference only.
- HackerOne requires user-supplied credentials; they live in GitHub Actions secrets.
- The FastAPI worker is not hosted on the free plan. Cloud Run/Scheduler would require Blaze.
- The free-plan cron scans user watch subcollections directly, which is fine for an MVP but
  would need a collection-group index and pagination at scale.
- The sandbox simulator is a demo tool, not a production admin surface.
- Firestore client persistence can take several seconds on the first live paint.
- On-device web inference is Chrome-on-Desktop only; other browsers use cloud fallback.
- Firebase App Check and API-key restrictions are not yet enforced for the AI endpoint.

## Safety and ethics

ScopeDiff only reads published program metadata. It does not scan, resolve, fuzz, exploit or
otherwise touch a target. Slack webhooks are host-restricted. Demo data is fictional and
uses reserved domains and test ranges. The project is a scope-change communication tool, not
an attack tool.

## Security

The OWASP Top 10 (2021) assessment is in [`OWASP_ASSESSMENT.md`](OWASP_ASSESSMENT.md).
Result: **5 pass, 4 partial, 1 fail**. The failed category is operational
logging/monitoring. Dependency audit is clean after the React Router and gRPC upgrades.
Production security headers, Firestore access-control tests and secret-scan evidence are
recorded in that document.

## Demo video

A 2:39 narrated demo video is generated at `scopediff-demo.mp4` (not committed). The
three-minute script and shot list live in [`SUBMISSION.md`](SUBMISSION.md). Upload the MP4
to YouTube or Vimeo and paste the URL into the submission form and `SUBMISSION.md`.

## Design

The visual system is documented in [`design/README.md`](design/README.md) and
[`design/standard.json`](design/standard.json): neobrutalism with minimalism restraint, a
single amber accent, Space Grotesk / Inter / JetBrains Mono, and hand-tuned light and dark
themes. Implementation tokens live in `web/src/styles/tokens.css`.

## License

Hackathon project. Add a license before distributing.
