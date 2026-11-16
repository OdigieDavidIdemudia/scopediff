import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../state/AppStore";
import { LoadingScreen } from "../components/ui";
import { ArrowRightIcon, ShieldIcon, UserPlusIcon } from "../components/Icons";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function RegisterPage() {
  const {
    user,
    authLoading,
    firebaseEnabled,
    signUpEmail,
    signInGoogle,
  } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await signUpEmail(email.trim(), password, name.trim());
      navigate("/onboarding", { replace: true });
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
      navigate("/onboarding", { replace: true });
    } catch (exc) {
      setError(errorText(exc));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) {
    return <LoadingScreen label="Preparing your account…" />;
  }

  if (user) {
    return (
      <div className="login-page">
        <section className="login-card" style={{ maxWidth: 560, margin: "48px auto" }}>
          <div className="user-avatar" aria-hidden="true">
            {user.name.slice(0, 2).toUpperCase()}
          </div>
          <h2>You already have a session</h2>
          <p>Continue to the feed, or finish your preference setup.</p>
          <div className="pref-inline">
            <Link className="button button--primary" to="/">
              Continue
              <ArrowRightIcon size={13} />
            </Link>
            <Link className="button" to="/onboarding">
              Open preferences
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div>
          <div className="page-header__eyebrow">Create an account</div>
          <h1>Build a watchlist that knows your targets.</h1>
          <p>
            Register once, answer a short preference wizard, then paste the public URL of a
            bug bounty program you want to watch. ScopeDiff stores its first version and checks
            it on your schedule.
          </p>
          <ul className="login-hero__list">
            <li>Google SSO or email/password</li>
            <li>Manual testing targets, not guesswork</li>
            <li>Per-program check intervals from 1 to 60 minutes</li>
          </ul>
        </div>
        <div className="login-diff" aria-hidden="true">
          <div className="login-diff__row">
            <span className="glyph--added">1</span>
            <span>Pick a platform link</span>
            <span className="chip chip--green">baseline</span>
          </div>
          <div className="login-diff__row">
            <span className="glyph--modified">2</span>
            <span>Add your testing targets</span>
            <span className="chip chip--green">match</span>
          </div>
          <div className="login-diff__row" style={{ borderBottom: 0, paddingBottom: 0 }}>
            <span className="glyph--added">3</span>
            <span>Get the exact diff</span>
            <span className="chip chip--green">alert</span>
          </div>
        </div>
      </section>

      <section className="login-card">
        <div className="user-avatar" aria-hidden="true">
          <UserPlusIcon size={18} />
        </div>
        <div>
          <h2>Create your ScopeDiff account</h2>
          <p>One account keeps your preferences, targets and watched programs together.</p>
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
              <label className="label" htmlFor="register-name">
                Name
              </label>
              <input
                id="register-name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                autoComplete="name"
                required
              />
              <label className="label" htmlFor="register-email">
                Email
              </label>
              <input
                id="register-email"
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
              <label className="label" htmlFor="register-password">
                Password
              </label>
              <input
                id="register-password"
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                required
              />
              <label className="label" htmlFor="register-confirm">
                Confirm password
              </label>
              <input
                id="register-confirm"
                className="input"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
                required
              />
              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}
              <button type="submit" className="button button--primary button--block" disabled={busy}>
                {busy ? "Creating account…" : "Create account"}
              </button>
            </form>
            <div className="auth-links">
              <Link className="link-button" to="/login">
                Already have an account? Sign in
              </Link>
            </div>
          </>
        ) : (
          <p className="auth-error">
            Firebase Auth is not configured in this build. Add VITE_FIREBASE_* and rebuild.
          </p>
        )}
      </section>
    </div>
  );
}
