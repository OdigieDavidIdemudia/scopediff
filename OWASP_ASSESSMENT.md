# ScopeDiff — OWASP Top 10 (2021) Assessment

**Assessment date:** 2026-11-16  
**Target:** https://scopediff.web.app  
**Source:** public GitHub repository `OdigieDavidIdemudia/scopediff`  
**Stack:** React 18 / Vite / TypeScript, Firebase Auth, Firestore, Firebase Hosting, Python diff engine, GitHub Actions cron  
**Scope:** Deployed free-plan web app, Firestore security rules, Firebase Auth configuration, repository secrets, dependency tree, and the optional FastAPI worker code.

## Verdict

| # | Category | Result |
|---|---|---|
| A01 | Broken Access Control | **PASS** |
| A02 | Cryptographic Failures | **PASS** |
| A03 | Injection | **PASS** |
| A04 | Insecure Design | **PARTIAL** |
| A05 | Security Misconfiguration | **PARTIAL** |
| A06 | Vulnerable and Outdated Components | **PASS** |
| A07 | Identification and Authentication Failures | **PARTIAL** |
| A08 | Software and Data Integrity Failures | **PARTIAL** |
| A09 | Security Logging and Monitoring Failures | **FAIL** |
| A10 | Server-Side Request Forgery | **PASS** |

**Overall:** no critical or high-severity exploitable finding was identified in the deployed free-plan attack surface. The failed category is operational logging/monitoring, not a direct data breach. The partials are hardening gaps that should be addressed before a large public launch. The hybrid-AI addition is covered in a separate LLM overlay below.

---

## A01 — Broken Access Control — PASS

**Evidence**

- Firestore rules require authentication for all data.
- A user can read/write only their own `users/{uid}` document and `users/{uid}/watches/*` subcollection.
- Global `programs`, `changes`, `items`, `versions` and `source_runs` are read-only to signed-in users.
- The client cannot escalate a queued watch to active:
  - A direct Firestore write with `status: "active"` returned **403**.
  - A valid queued watch with `status: "pending"` returned **200**.
- Cross-user profile read returned **403**.
- An unauthenticated program read returned **403**.
- Rules validate watch creation: owner UID, matching document ID, pending status, supported platform, 30/60-minute interval, and a supported HTTPS program URL.
- Internal FastAPI endpoints now refuse to run in non-demo mode unless `SCOPEDIFF_INTERNAL_TOKEN` is configured.

**Residual note:** the onboarding-complete flag is self-asserted by the client. It only gates UI state and does not grant access to another user's data.

## A02 — Cryptographic Failures — PASS

**Evidence**

- HTTPS only; Firebase Hosting sends `Strict-Transport-Security: max-age=31556926; includeSubDomains; preload`.
- Passwords are handled entirely by Firebase Auth; ScopeDiff never stores or hashes passwords.
- Firestore and Firebase Auth data are encrypted in transit and at rest by Google.
- The HackerOne token is stored in GitHub Actions secrets and never in the frontend bundle.
- The Firebase service account JSON is outside the repository; `.env` and `web/.env.local` are gitignored and not tracked.
- Repository secret scan found no private keys or HackerOne token in tracked files or git history.
- Slack webhooks are stored per user and protected by Firestore owner rules.

**Residual note:** the Slack webhook is stored as plaintext in Firestore. It is access-controlled, but a compromised admin/worker credential could read it. Use a secret manager if this becomes multi-tenant production.

## A03 — Injection — PASS

**Evidence**

- No SQL database is used. Firestore queries use the typed Firebase SDK with structured queries, not string concatenation.
- No `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`, or `new Function` exists in the frontend or worker source.
- React escapes all rendered target names, URLs, reasons and program metadata.
- External links use URLs produced by the server adapters, not arbitrary user input.
- The user-added program URL is rendered as text in the queued-baseline UI and re-parsed/validated by the cron.
- No shell execution, `subprocess`, `os.system`, pickle or unsafe YAML loading exists in the application path.
- Search/filter code operates on already-loaded values; no query language is constructed from user input.

## A04 — Insecure Design — PARTIAL

**Passing controls**

- New accounts are forced through onboarding before the live feed.
- At least one manually entered testing target is required.
- A queued program must use a supported platform URL.
- The cron caps a run at 30 pending items and 30 due programs.
- The cron writes an error and stops processing a user above 10 active/pending watches.
- Slack alerts obey materiality, confidence and personal-match preferences.
- The diff engine has zero-target refusal, collapse gates and partial-revision confidence gates.

**Gaps**

- The 10-watch limit is enforced by the client and the cron, not atomically by Firestore rules. A malicious user can create many queued documents directly; the cron will reject them but Firestore storage/abuse is still possible.
- `onboarding_complete` can be set by the user on their own profile. This is a UX gate, not a security boundary.
- There is no per-IP/per-account rate limit on account creation or program queueing beyond Firebase/platform quotas.
- Free-plan cron cadence is 30 minutes, so "freshness" is best-effort.

**Recommendation:** enforce a per-user watch counter document in a transaction, add App Check or a small rate-limit layer, and add a server-side onboarding claim if onboarding must be a security boundary.

## A05 — Security Misconfiguration — PARTIAL

**Passing controls**

- Production response headers verified:
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Strict-Transport-Security`
- CSP permits Firebase Auth, Firestore, Firebase AI Logic, Google Sign-In and Google Fonts while denying object embeds and framing.
- Google Sign-In popup was verified to open the Firebase auth handler under the deployed CSP.
- Firestore rules are deployed and compiled successfully.
- Email/password and Google providers are enabled; anonymous auth is not used.
- The production build does not enable the local insecure-auth preview.
- The free-plan deployment does not expose the FastAPI worker or internal endpoints.

**Gaps**

- Firebase App Check initialization is wired in the client (`web/src/lib/firebase.ts`) but enforcement is not enabled and no production reCAPTCHA key is registered. The Firebase web API key can be used to call the AI Logic endpoint from outside the app until App Check and API-key restrictions are added.
- The web API key's API restrictions have not been narrowed to only the APIs ScopeDiff uses.
- Firebase Auth currently includes localhost in its authorized domains for local development. This is normal for a Firebase project, but should be reviewed if the project is shared with untrusted collaborators.

**Recommendation:** register a reCAPTCHA v3 key, enforce App Check for AI Logic, restrict the API key to the required APIs and HTTP referrers, and add budget/rate alerts for the Gemini Developer API.

## A06 — Vulnerable and Outdated Components — PASS

**Evidence**

- `npm audit --omit=dev`: **0 vulnerabilities** after upgrading React Router and forcing a patched `@grpc/grpc-js` override.
- `pip-audit -r worker/requirements.txt`: **no known vulnerabilities**.
- React Router was upgraded from 6.30.6 to 7.18.5 to address the open-redirect and SSR hydration advisories.
- Firebase was upgraded to 13.3.0 and the transitive gRPC package was pinned to a patched 1.14.x release.
- GitHub Actions dependencies are present and the workflow is green.

**Residual note:** Python requirements use minimum-version ranges rather than hash-pinned lock files. For production, generate a lock file with hashes.

## A07 — Identification and Authentication Failures — PARTIAL

**Passing controls**

- Firebase Auth handles password storage, hashing and resets.
- Google SSO and email/password are both enabled.
- Session state is resolved through `onAuthStateChanged`; protected routes redirect to login.
- Password reset flow exists.
- No custom session tokens or homemade password storage.
- The deleted-user stale-session case fails safely to the login page.

**Gaps**

- Email verification is not required before using the app.
- The 8-character password rule is enforced only in the client; Firebase's project-level password policy is not configured more strictly.
- MFA is not enabled.
- Firebase's default auth error messages can reveal whether an email exists.
- No account lockout/rate-limit layer beyond Firebase's built-in protections.

**Recommendation:** require `emailVerified` for email/password accounts, configure a Firebase password policy, enable MFA for team accounts, and enable email enumeration protection.

## A08 — Software and Data Integrity Failures — PARTIAL

**Passing controls**

- Clients cannot write global program, scope, diff or source-run documents.
- Firestore rules validate watch ownership, status, interval, supported platform and URL shape.
- The worker stores immutable versioned snapshots and content hashes.
- The HackerOne token and service account are stored as GitHub Actions secrets.
- The GitHub repository has no tracked `.env` files or runtime credentials.

**Gaps**

- GitHub Actions are pinned to mutable major tags (`actions/checkout@v4`, `actions/setup-python@v5`) rather than commit SHAs.
- Python dependencies are not hash-pinned.
- Google Fonts are loaded from a third-party origin without Subresource Integrity (the CSP limits the origin, but SRI is not available for Google's dynamic font CSS).
- No automated dependency-update or secret-scanning policy is documented in the repo.

**Recommendation:** pin Actions to commit SHAs, add Dependabot/Renovate, generate a hashed Python lock file, and add a secret-scanning pre-commit hook.

## A09 — Security Logging and Monitoring Failures — FAIL

**Evidence**

- GitHub Actions writes a JSON summary (`pending`, `activated`, `checked`, `changed`, `notified`, `errors`) to the run log.
- The worker stores `source_runs` in Firestore, which provides an audit trail of fetches.
- Firebase Auth and Firestore provide platform-level logs in the Google Cloud console.

**Gap**

- No alert is sent when the cron fails, when a baseline repeatedly fails, or when an unexpected volume of changes/errors occurs.
- No centralized error tracker (Sentry, etc.) or uptime monitor is configured.
- Firestore audit logs and security-event alerting are not enabled.
- A compromised account or abusive watch creation would not trigger an operational alert.

**Recommendation:** add a health-check workflow that fails loudly, send a Slack/email alert on cron failure, enable Cloud Audit Logs for Firestore/Auth, and add Sentry or an equivalent for the frontend/worker.

## A10 — Server-Side Request Forgery — PASS

**Evidence**

- The client only accepts `bugcrowd.com`, `hackerone.com`, `app.intigriti.com` and `www.intigriti.com` program URLs.
- The cron re-parses every queued URL through `parse_program_url`; unknown hosts are rejected before any adapter is chosen.
- Adapters use fixed HTTPS base URLs with fixed path templates. The user does not supply an arbitrary fetch URL.
- The direct watch schema is validated by Firestore rules to the supported platforms and HTTPS hosts.
- The optional FastAPI worker's `/internal/sync` takes a platform and handle, not a URL.
- The free-plan cron rejects the optional `sandbox` adapter; fixture path traversal is not reachable from the public flow.

**Residual note:** if the FastAPI worker is deployed later with the sandbox adapter, validate the sandbox handle and fixture path to prevent local file traversal.

---

## AI-specific risk overlay (OWASP LLM Top 10)

The hybrid AI feature adds a model-backed analyst. It does not execute model output or call tools.

| Risk | Result | Notes |
|---|---|---|
| LLM01 Prompt injection | **PARTIAL** | Scope metadata is untrusted public content. A malicious program could embed instruction-like text. The prompt is constrained, the output is structured JSON, and the model has no tools or write access. |
| LLM02 Insecure output handling | **PASS** | Output is parsed as JSON, validated into fixed fields, and rendered as React text. No HTML or tool execution. |
| LLM04 Model DoS / abuse | **PARTIAL** | No App Check or per-user AI quota yet. Gemini free-tier quotas and browser execution limits reduce but do not remove abuse risk. |
| LLM05 Supply-chain | **PASS** | Official Firebase AI Logic SDK, no third-party model gateway, no custom model weights. |
| LLM06 Sensitive information disclosure | **PASS** | Prompt excludes email, Slack webhook, UID and private testing targets. Only public scope-diff metadata is sent. |
| LLM07 Insecure plugin design | **PASS** | No plugins, tools or function-calling are exposed to the model. |
| LLM09 Misinformation | **PARTIAL** | UI labels the output as AI-generated, includes caveats and tells the user to verify the published revision. |
| LLM10 Model theft | **N/A** | No model is hosted or distributed by ScopeDiff. |

**Privacy design:** when Chrome supports the on-device model, the prompt runs locally. Otherwise the SDK automatically falls back to Gemini in the cloud. The UI reports whether the response came from `ON_DEVICE` or `IN_CLOUD`.

## Security test evidence

| Test | Result |
|---|---|
| Unauthenticated Firestore `programs` read | **403** |
| User A reads User B profile | **403** |
| User writes an active watch directly | **403** |
| User writes a valid pending watch | **200** |
| Google Sign-In popup under CSP | Opens Firebase auth handler |
| Production security headers | Present |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `pip-audit` on worker requirements | **No known vulnerabilities** |
| Secret scan of tracked files/history | No HackerOne token or private key tracked |
| Hybrid AI cloud fallback | **Success — response source `in_cloud`** |
| Hybrid AI on-device preference | `InferenceMode.PREFER_ON_DEVICE` configured |
| AI prompt data minimisation | No email, UID, Slack webhook or private testing targets sent |
| AI output handling | Structured JSON parsed and React-escaped; no tools |
| Backend tests | **51 passed** |
| Production web build | Passes |

## Bottom line

**Submission-ready free-plan build:** yes, with the caveats above. The public surface has no identified critical/high exploitable access-control, injection, SSRF or dependency issue. The main missing operational control is monitoring/alerting (A09). The main hardening gaps are App Check/API-key restrictions for AI usage (A05), account verification/password policy (A07), and supply-chain pinning (A08). The hybrid AI path is functional and reports whether the response came from on-device or cloud inference; prompt injection remains a bounded partial risk because scope metadata is untrusted public content.

