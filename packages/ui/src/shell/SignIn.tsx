import { useState } from "react";
import type { AppConfig, SignInPage, User } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Icon, Logo, Notice, ThemeSwitch } from "../ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Label } from "@openact/ui/components/label";
import { cn } from "../lib/utils";

/** Passwordless sign-in: email first, then the 6-digit code from the inbox.
 *  Split layout: a dark stage with the heading on the left, the form on the right.
 *  On small screens the stage becomes a short band above the form.
 *  A super admin sets the heading, credit, background and legal links in Site settings. */
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
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-2">
      <Stage page={config.signIn} />

      <div className="relative flex flex-1 flex-col bg-background px-6 py-10 md:px-10">
        <div className="absolute top-4 right-4 lg:top-[max(1rem,env(safe-area-inset-top))]">
          <ThemeSwitch />
        </div>
        <main className="mx-auto flex w-full max-w-sm flex-col gap-8 pt-10 lg:my-auto lg:pt-0">
          <div className="flex items-center gap-2.5 text-lg font-semibold">
            <Logo src={config.logoUrl} size={32} />
            <span>{config.appName}</span>
          </div>

          {step === "email" ? (
            <form className="grid gap-5" onSubmit={sendCode}>
              <div className="flex items-baseline justify-between gap-4">
                <h1 className="text-xl font-semibold">Sign in</h1>
                {config.signupMode === "open" && <span className="text-sm text-muted-foreground">New here? Use your email.</span>}
              </div>
              <p className="-mt-2 text-sm text-muted-foreground">Type your email. We send you a sign-in code. You do not need a password.</p>
              <div className="grid gap-2">
                <Label htmlFor="si-email" className="sr-only">
                  Email
                </Label>
                <div className="relative">
                  <Icon name="mail" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="si-email"
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    placeholder="Email address"
                    className="h-11 bg-card pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              {error && <Notice tone="error">{error}</Notice>}
              <Button type="submit" className="h-11 w-full" disabled={busy || !email.trim()}>
                {busy ? "Sending…" : "Send sign-in code"}
              </Button>
              {config.signupMode === "invite" && (
                <p className="text-center text-sm text-muted-foreground">No account? Ask a project owner to invite you.</p>
              )}
            </form>
          ) : (
            <form className="grid gap-5" onSubmit={verify}>
              <h1 className="text-xl font-semibold">Check your email</h1>
              {notice && <p className="-mt-2 text-sm text-muted-foreground">{notice}</p>}
              <div className="grid gap-2">
                <Label htmlFor="si-code">Sign-in code</Label>
                <Input
                  id="si-code"
                  className="h-12 bg-card text-center font-mono text-2xl tracking-[0.4em]"
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
              <Button type="submit" className="h-11 w-full" disabled={busy || code.length !== 6}>
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
          )}
          <LegalNotice page={config.signIn} />
        </main>
      </div>
    </div>
  );
}

/** "By signing in, you agree to..." Each name links to its page when a super admin set the link. */
function LegalNotice({ page }: { page: SignInPage }) {
  const link = (url: string | null, text: string) =>
    url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">
        {text}
      </a>
    ) : (
      <span className="font-medium text-foreground">{text}</span>
    );
  return (
    <p className="text-center text-xs text-muted-foreground" data-sign-in-legal="">
      By signing in, you agree to the {link(page.termsUrl, "Terms of Use")} and {link(page.privacyUrl, "Privacy Policy")}.
    </p>
  );
}

/* The stage: a tilted wall of sample task cards behind a heading. Decoration only. */

type Status = "backlog" | "todo" | "doing" | "review" | "done";

const STATUS: Record<Status, { label: string; dot: string }> = {
  backlog: { label: "Backlog", dot: "bg-status-backlog" },
  todo: { label: "To do", dot: "bg-status-todo" },
  doing: { label: "Doing", dot: "bg-status-doing" },
  review: { label: "Review", dot: "bg-status-review" },
  done: { label: "Done", dot: "bg-status-done" }
};

const AVATARS = ["bg-[var(--av-0)]", "bg-[var(--av-1)]", "bg-[var(--av-2)]", "bg-[var(--av-3)]", "bg-[var(--av-4)]", "bg-[var(--av-5)]"];

const CARDS: Array<Array<{ title: string; project: string; status: Status; tags: string[]; people: number[]; agent?: boolean }>> = [
  [
    { title: "Launch plan", project: "Spring campaign", status: "doing", tags: ["Plan", "Budget"], people: [0, 2] },
    { title: "Press kit", project: "Spring campaign", status: "review", tags: ["Copy"], people: [3], agent: true },
    { title: "Venue contract", project: "Annual gala", status: "todo", tags: ["Legal"], people: [1] },
    { title: "Partner call notes", project: "Sales", status: "done", tags: ["Notes"], people: [4, 5] }
  ],
  [
    { title: "Q1 roadmap", project: "Product", status: "review", tags: ["Roadmap", "Goals"], people: [5, 1, 0] },
    { title: "Onboarding guide", project: "People", status: "doing", tags: ["Docs"], people: [2], agent: true },
    { title: "Stage design", project: "Annual gala", status: "backlog", tags: ["Design"], people: [3, 4] },
    { title: "Release notes", project: "Product", status: "todo", tags: ["Copy"], people: [0] }
  ],
  [
    { title: "Weekly report", project: "Operations", status: "done", tags: ["Report"], people: [1], agent: true },
    { title: "Hiring plan", project: "People", status: "todo", tags: ["Plan"], people: [4, 2] },
    { title: "Email sequence", project: "Spring campaign", status: "doing", tags: ["Email", "Copy"], people: [5] },
    { title: "Budget review", project: "Operations", status: "review", tags: ["Finance"], people: [0, 3] }
  ]
];

function Stage({ page }: { page: SignInPage }) {
  return (
    <aside className="relative overflow-hidden bg-stage text-stage-foreground" data-sign-in-stage="">
      <div aria-hidden="true" className="absolute inset-0 select-none">
        {page.backgroundUrl ? (
          <>
            <img src={page.backgroundUrl} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-stage/55" />
            <div className="absolute inset-0 bg-gradient-to-t from-stage via-stage/40 to-transparent" />
          </>
        ) : (
          <>
            <div className="absolute -top-24 -left-40 flex w-[150%] -rotate-12 gap-6 opacity-75">
              {CARDS.concat(CARDS).map((col, i) => (
                <div key={i} className={cn("flex w-64 shrink-0 flex-col gap-6", i % 2 === 1 && "mt-28")}>
                  {col.concat(col).map((c, j) => (
                    <SampleCard key={j} {...c} />
                  ))}
                </div>
              ))}
            </div>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_25%_50%,var(--stage)_10%,transparent_65%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_90%_5%,color-mix(in_oklab,var(--stage-glow)_22%,transparent),transparent_45%)]" />
            <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-stage to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-stage to-transparent" />
          </>
        )}
      </div>

      <div className="relative flex h-full items-end px-6 pt-16 pb-6 lg:items-center lg:px-12 lg:py-0 xl:px-20">
        {page.heading && (
          <figure className="max-w-md animate-in fade-in duration-500">
            <blockquote className="text-xl font-bold tracking-tight text-balance lg:text-4xl lg:leading-tight">{page.heading}</blockquote>
            {page.credit && (
              <figcaption className="mt-3 flex items-center gap-3 text-sm text-stage-muted lg:mt-5 lg:text-base">
                <span className="h-px w-8 bg-stage-glow" aria-hidden="true" />
                {page.credit}
              </figcaption>
            )}
          </figure>
        )}
      </div>
    </aside>
  );
}

function SampleCard({ title, project, status, tags, people, agent }: (typeof CARDS)[number][number]) {
  const s = STATUS[status];
  return (
    <div className="rounded-xl border border-stage-border bg-stage-card p-4 shadow-lg">
      <div className="flex items-center gap-2 text-xs text-stage-muted">
        <span className={cn("size-2 rounded-full", s.dot)} />
        {s.label}
      </div>
      <div className="mt-2 font-semibold">{title}</div>
      <div className="text-xs text-stage-muted">{project}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="rounded-full border border-stage-border px-2 py-0.5 text-[11px] text-stage-muted">
            {t}
          </span>
        ))}
      </div>
      <div className="mt-3 grid gap-1.5">
        <div className="h-1.5 w-full rounded-full bg-stage-line" />
        <div className="h-1.5 w-2/3 rounded-full bg-stage-line" />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex -space-x-1.5">
          {people.map((p) => (
            <span key={p} className={cn("size-6 rounded-full border-2 border-stage-card", AVATARS[p % AVATARS.length])} />
          ))}
        </div>
        {agent && (
          <span className="flex items-center gap-1 rounded-full border border-stage-glow/40 px-2 py-0.5 text-[11px] text-stage-glow">
            <Icon name="sparkle" size={11} />
            Agent
          </span>
        )}
      </div>
    </div>
  );
}
