import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../state/AppStore";
import { Callout, LoadingScreen } from "../components/ui";
import {
  ArrowRightIcon,
  CheckIcon,
  LockIcon,
  LogOutIcon,
  ShieldIcon,
  ZapIcon,
} from "../components/Icons";
import { initials } from "../lib/format";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function LoginPage() {
  const {
    user,
    authLoading,
    mode,
    firebaseEnabled,
    localSessionEnabled,
    signInEmail,
    signInGoogle,
    signInDemo,
    signInLocalLive,
    signOut,
    resetPassword,
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInEmail(email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (exc) {
      setError(errorText(exc));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError(null);
    try {
      await signInGoogle();
      navigate(redirectTo, { replace: true });
    } catch (exc) {
      setError(errorText(exc));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) {
      setError("Enter your email first, then request a reset link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim());
    } catch (exc) {
      setError(errorText(exc));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) {
    return <LoadingScreen label="Checking your session…" />;
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div>
          <div className="page-header__eyebrow">Private change feed</div>
          <h1>The diff your recon tab was missing.</h1>
          <p>
            ScopeDiff stores every published scope revision, compares it to the last one and
            tells you exactly which targets moved, disappeared or changed terms — before you
            spend the weekend on stale scope.
          </p>
          <ul className="login-hero__list">
            <li>Versioned snapshots, not screenshots</li>
            <li>Materiality scored against your targets</li>
            <li>Free 30-minute scheduled checks</li>
          </ul>
        </div>

        <div className="login-diff" aria-hidden="true">
          <div className="login-diff__row">
            <span className="glyph--added">+</span>
            <span>*.staging.acme.example</span>
            <span className="chip chip--green">new</span>
          </div>
          <div className="login-diff__row">
            <span className="glyph--modified">~</span>
            <span>*.acme.example</span>
            <span className="chip chip--red">Tier 1 → 3</span>
          </div>
          <div className="login-diff__row">
            <span className="glyph--removed">−</span>
            <span>legacy.acme.example</span>
            <span className="chip chip--red">removed</span>
          </div>
          <div className="login-diff__row" style={{ borderBottom: 0, paddingBottom: 0 }}>
            <span className="glyph--added">+</span>
            <span>api.staging.acme.example</span>
            <span className="chip chip--green">new</span>
          </div>
        </div>

        <div className="field-note">
          Demo targets use RFC 2606 reserved domains. Nothing is scanned or exploited.
        </div>
      </section>

      <section className="login-card">
        {user ? (
          <>
            <div className="user-avatar" aria-hidden="true">
              {initials(user.name)}
            </div>
            <div>
              <div className="page-header__eyebrow">Signed in</div>
              <h2>You're in, {user.name}.</h2>
              <p>
                The feed and watchlist are unlocked. Your preferences and watches are stored
                against your account.
              </p>
            </div>
            <div className="pref-inline">
              <span className="chip chip--green">
                <CheckIcon size={10} /> {user.provider} session
              </span>
              <span className="chip">{mode === "demo" ? "demo data" : "live worker"}</span>
            </div>
            <div className="kv">
              <div className="kv__row">
                <span className="kv__key">Name</span>
                <span className="kv__value">{user.name}</span>
              </div>
              <div className="kv__row">
                <span className="kv__key">Email</span>
                <span className="kv__value">{user.email || "—"}</span>
              </div>
            </div>
            <div className="pref-inline">
              <Link className="button button--primary" to="/">
                Continue to feed
                <ArrowRightIcon size={13} />
              </Link>
              <button type="button" className="button" onClick={() => void signOut()}>
                <LogOutIcon size={13} />
                Sign out
              </button>
            </div>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                signInDemo();
                navigate("/");
              }}
            >
              Or explore the bundled demo instead →
            </button>
          </>
        ) : (
          <>
            <div className="user-avatar" aria-hidden="true">
              <LockIcon size={18} />
            </div>
            <div>
              <h2>Sign in to your feed</h2>
              <p>
                Sign in to keep your testing targets, watched programs and alert routing
                together. New accounts go through a short preference wizard.
              </p>
            </div>

            {firebaseEnabled ? (
              <>
                <button
                  type="button"
                  className="button button--primary button--block"
                  onClick={() => void google()}
                  disabled={busy}
                >
                  <ShieldIcon size={14} />
                  Continue with Google
                </button>
                <div className="auth-divider">or use email</div>
                <form className="auth-form" onSubmit={submit}>
                  <label className="label" htmlFor="login-email">
                    Email
                  </label>
                  <input
                    id="login-email"
                    className="input"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                  <label className="label" htmlFor="login-password">
                    Password
                  </label>
                  <input
                    id="login-password"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                  {error && (
                    <div className="auth-error" role="alert">
                      {error}
                    </div>
                  )}
                  <button type="submit" className="button button--primary button--block" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                  </button>
                </form>
                <div className="auth-links">
                  <button type="button" className="link-button" onClick={() => void forgot()}>
                    Forgot password?
                  </button>
                  <Link className="link-button" to="/register">
                    Create an account →
                  </Link>
                </div>
              </>
            ) : (
              <Callout tone="accent" icon={<LockIcon size={13} />}>
                Firebase Auth is not configured in this build. Add the{" "}
                <span className="mono">VITE_FIREBASE_*</span> variables to enable email and
                Google sign-in.
              </Callout>
            )}

            {localSessionEnabled && (
              <button
                type="button"
                className="button button--secondary button--block"
                onClick={() => {
                  signInLocalLive();
                  navigate("/");
                }}
              >
                <ZapIcon size={14} />
                Continue to local live preview
              </button>
            )}

            <button
              type="button"
              className="button button--ghost button--block"
              onClick={() => {
                signInDemo();
                navigate("/");
              }}
            >
              <ZapIcon size={14} />
              Explore the demo without an account
            </button>

            {localSessionEnabled && (
              <p className="login-note">
                Local live preview is enabled. It is for development only.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
