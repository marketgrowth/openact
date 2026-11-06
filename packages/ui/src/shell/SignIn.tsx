import { useState } from "react";
import type { AppConfig, User } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Logo, Notice, ThemeSwitch } from "../ui";
import { Link } from "../router";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Label } from "@openact/ui/components/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@openact/ui/components/card";

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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted px-4 py-10 md:px-10">
      <div className="fixed top-[max(1rem,env(safe-area-inset-top))] right-4">
        <ThemeSwitch />
      </div>
      <main className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-semibold">
          <Logo />
          <span>{config.appName}</span>
        </div>
        <Card>
          {step === "email" ? (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-xl" role="heading" aria-level={1}>
                  Sign in
                </CardTitle>
                <CardDescription>Type your email. We send you a sign-in code. You do not need a password.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-5" onSubmit={sendCode}>
                  <div className="grid gap-2">
                    <Label htmlFor="si-email">Email</Label>
                    <Input
                      id="si-email"
                      type="email"
                      required
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {error && <Notice tone="error">{error}</Notice>}
                  <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
                    {busy ? "Sending…" : "Send sign-in code"}
                  </Button>
                  <p className="text-center text-sm text-muted-foreground">
                    {config.signupMode === "invite" ? "No account? Ask a project owner to invite you." : "New here? Type your email to make an account."}
                  </p>
                </form>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-xl" role="heading" aria-level={1}>
                  Check your email
                </CardTitle>
                {notice && <CardDescription>{notice}</CardDescription>}
              </CardHeader>
              <CardContent>
                <form className="grid gap-5" onSubmit={verify}>
                  <div className="grid gap-2">
                    <Label htmlFor="si-code">Sign-in code</Label>
                    <Input
                      id="si-code"
                      className="h-12 text-center font-mono text-2xl tracking-[0.4em]"
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
                  {error && <Notice tone="error">{error}</Notice>}
                  <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                    {busy ? "Checking…" : "Sign in"}
                  </Button>
                  <div className="flex flex-wrap justify-center gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => sendCode()} disabled={busy}>
                      Send a new code
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setStep("email");
                        setError(null);
                      }}
                    >
                      Use a different email
                    </Button>
                  </div>
                </form>
              </CardContent>
            </>
          )}
        </Card>
        <p className="text-center text-xs text-balance text-muted-foreground" data-signin-foot="">
          Open source by MarketGrowth.{" "}
          <a href="https://github.com/marketgrowth/openact" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
            View on GitHub
          </a>{" "}
          ·{" "}
          <Link to="/colophon" className="underline underline-offset-4 hover:text-foreground">
            Colophon
          </Link>
        </p>
      </main>
    </div>
  );
}
