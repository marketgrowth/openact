import { useState } from "react";
import type { AppConfig, User } from "../../shared/types";
import { api, errorText } from "../api";
import { Logo, ThemeSwitch } from "../ui";
import { Link } from "../router";

/** Passwordless sign-in: email first, then the 6-digit code from the inbox. */
export function SignIn({ config, onSignedIn }: { config: AppConfig; onSignedIn: (u: User) => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/request-code", { body: { email } });
      setStep("code");
      setCode("");
      setNotice(
        config.emailEnabled
          ? `We sent a 6-digit code to ${email.trim()}. It expires in 10 minutes.`
          : "Email is not set up on this server. The code is in the server log."
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/api/auth/verify", { body: { email, code } });
      onSignedIn(r.user);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="signin-top">
        <ThemeSwitch />
      </div>
      <main className="signin-card">
        <div className="brand">
          <Logo />
          <span>{config.appName}</span>
        </div>
        {step === "email" ? (
          <form className="stack" onSubmit={sendCode}>
            <h1>Sign in</h1>
            <p className="muted">Type your email. We send you a sign-in code. You do not need a password.</p>
            <div className="field">
              <label htmlFor="si-email">Email</label>
              <input id="si-email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn primary block" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send sign-in code"}
            </button>
            <p className="hint">
              {config.signupMode === "invite"
                ? "No account? Ask a project owner to invite you."
                : "New here? Type your email to make an account."}
            </p>
          </form>
        ) : (
          <form className="stack" onSubmit={verify}>
            <h1>Check your email</h1>
            {notice && <p className="muted">{notice}</p>}
            <div className="field">
              <label htmlFor="si-code">Sign-in code</label>
              <input
                id="si-code"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
              />
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn primary block" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            <div className="row-wrap">
              <button type="button" className="btn ghost sm" onClick={() => sendCode()} disabled={busy}>
                Send a new code
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setStep("email");
                  setError(null);
                }}
              >
                Use a different email
              </button>
            </div>
          </form>
        )}
      </main>
      <p className="signin-foot">
        Open source by MarketGrowth.{" "}
        <a href="https://github.com/marketgrowth/openact" target="_blank" rel="noreferrer">
          View on GitHub
        </a>{" "}
        ·{" "}
        <Link to="/colophon">Colophon</Link>
      </p>
    </div>
  );
}
