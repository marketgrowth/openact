import { Link, Logo, ThemeSwitch, useShell } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import type { ReactNode } from "react";

/*
 * Colophon: how OpenAct is made. Public page at /colophon.
 * Keep it in step with docs/colophon.md and package.json.
 */

interface Row {
  name: string;
  detail: string;
  href?: string;
}

const REPO = "https://github.com/marketgrowth/openact";

/** What OpenAct does today. Keep in step with the Features list in README.md. */
const FEATURES: Row[] = [
  {
    name: "Kanban board",
    detail: "Drag cards between columns. Each project has its own columns, and each column says what it means, so progress and late checks keep working."
  },
  { name: "Gantt timeline", detail: "Drag a bar to move a task, or an edge to change its length. Tasks group by phase, and a line marks today." },
  { name: "Calendar", detail: "A month view with start cards and deadline pills. Drag either to change the date. Phones get an agenda list." },
  {
    name: "Tasks",
    detail: "Dates, phase, assignee, notes and files up to 25 MB. Web addresses in notes and descriptions show as links that open in a new tab."
  },
  {
    name: "Apps",
    detail: "OpenAct is a core plus apps. Project management is the first app. Add more from GitHub with one command, and each app gets sign-in, companies and the shell."
  },
  {
    name: "App rail",
    detail: "A narrow column on the left shows the company, one icon for each app, settings and your menu. The panel beside it shows the active app."
  },
  {
    name: "Permissions",
    detail: "Owners and admins turn apps on or off for their company, and choose what each role can do in each app. Apps declare their permissions, and the core checks them."
  },
  {
    name: "Pinned and Recent",
    detail: "Pin projects to the top of the panel. Recent shows the tasks you opened lately, and one click opens a task again. Both are yours only."
  },
  {
    name: "Companies",
    detail:
      "One install holds many companies. Switch from the company mark at the top of the app rail. Each company has its own name, logo, people, email domain and AI defaults."
  },
  {
    name: "Access",
    detail:
      "Project roles (owner, editor, viewer) and company roles (owner, admin, member, guest). Owners can make a project secret. People without access can ask for it."
  },
  { name: "Search", detail: "Ctrl+K or Cmd+K searches every project you can see, by words and by meaning. The task drawer shows related tasks." },
  { name: "Live updates", detail: "A change shows on every open page at once, including changes from the AI agent. The header shows who else is viewing." },
  {
    name: "AI agent",
    detail:
      "Tell it what to do in plain words. It acts for you, never with more power than your role. Risky changes wait for your approval, and every action is logged."
  },
  {
    name: "Topic check",
    detail:
      "A quick check reads each new request. Requests for another project get a link to it. New work gets an offer to start a project. Anything else gets a short decline."
  },
  { name: "Note search", detail: "Owners can let the agent search task notes. It gets only short parts, with email addresses and phone numbers hidden." },
  { name: "Sign-in", detail: "No passwords. People sign in with a 6-digit email code." },
  { name: "Themes and phones", detail: "Light, dark, or follow the system. On a phone, the rail and the panel open as one sheet." },
  { name: "Keyboard", detail: "Ctrl+K or Cmd+K opens search. Ctrl+B or Cmd+B opens and closes the app panel." }
];

/** Milestones in the order they shipped. Each links to its commit. */
const LOG: Array<{ title: string; detail: string; commit?: string }> = [
  {
    title: "Board and timeline",
    detail: "Projects, a Kanban board, a Gantt timeline, email code sign-in, project roles, file attachments, and AI task drafts and status summaries.",
    commit: "35dbe6d"
  },
  {
    title: "Calendar and AG-UI",
    detail: "A month calendar with an agenda list on phones. The assistant starts to speak the AG-UI protocol.",
    commit: "dd620a6"
  },
  { title: "Colophon", detail: "This page, and docs/colophon.md.", commit: "7e91cc8" },
  {
    title: "Agent access and custom columns",
    detail:
      "The agent acts with the person's role. Owners set a policy per role. Approvals, an activity log, and board columns that each project names itself.",
    commit: "3e0d2f7"
  },
  { title: "Topic check", detail: "A small model reads each new request and keeps the agent on its project.", commit: "db30e51" },
  {
    title: "Jev decision model",
    detail: "With a TypeSafe key, Jev answers typed questions about each request, and a truth table in code picks the route.",
    commit: "cc0dff8"
  },
  {
    title: "Note search",
    detail: "An owner setting lets the agent search task notes, with private details hidden. The board filter also searches notes.",
    commit: "7bfb109"
  },
  { title: "Clickable links", detail: "Web addresses in descriptions and notes open in a new tab. OpenAct never fetches them.", commit: "891540f" },
  {
    title: "Companies",
    detail: "Multi-tenant companies, a collapsible side panel with a company switcher, secret projects, access requests and email domain auto-join.",
    commit: "61c310a"
  },
  {
    title: "Search by meaning",
    detail: "Vectorize and Workers AI embeddings, merged with word search. Results are checked against what each person can see.",
    commit: "f78f471"
  },
  {
    title: "Live updates",
    detail: "A Durable Object per project holds hibernating WebSockets. Pages check for changes only when the connection is down.",
    commit: "ce7e4e4"
  },
  { title: "Features and build log", detail: "This page lists what OpenAct does and how it was built.", commit: "c01bf9a" },
  {
    title: "shadcn/ui",
    detail: "The whole web app moves to shadcn/ui, Tailwind CSS and Lucide icons, with the dashboard-01 layout. The chat keeps your place when you scroll up.",
    commit: "07ea4d1"
  },
  {
    title: "Core and apps",
    detail: "OpenAct splits into a core, a UI kit and apps. Project management becomes the first app. New apps install from GitHub with npm run openact -- add.",
    commit: "eb5ffe7"
  },
  {
    title: "App rail",
    detail: "An app rail with one icon per app, Pinned and Recent in the projects panel, and an Orbytt mockup as the second app.",
    commit: "f538239"
  },
  {
    title: "Permissions",
    detail: "Companies turn apps on or off, and choose what each role can do in each app. Apps declare their permissions, and the core checks them.",
    commit: "66c782f"
  }
];

const SECTIONS: Array<{ title: string; intro: string; rows: Row[] }> = [
  {
    title: "Platform",
    intro: "OpenAct runs on Cloudflare. One Worker serves the API and the web app.",
    rows: [
      {
        name: "Cloudflare Workers",
        detail: "Runs the API and serves the web app as static assets. Compatibility date 2026-10-01, with nodejs_compat.",
        href: "https://developers.cloudflare.com/workers/"
      },
      {
        name: "Cloudflare D1",
        detail: "SQLite database for companies, people, projects, members, tasks and sessions. SQL migrations run on every deploy.",
        href: "https://developers.cloudflare.com/d1/"
      },
      {
        name: "Cloudflare R2",
        detail: "Object storage for task attachments (up to 25 MB per file) and company logos.",
        href: "https://developers.cloudflare.com/r2/"
      },
      {
        name: "Durable Objects",
        detail: "Live updates. One object per project holds its WebSockets, with the Hibernation API.",
        href: "https://developers.cloudflare.com/durable-objects/"
      },
      {
        name: "Cloudflare Vectorize",
        detail: "Search by meaning, with one namespace per company. Embeddings come from Workers AI (bge-base-en-v1.5).",
        href: "https://developers.cloudflare.com/vectorize/"
      },
      {
        name: "Cron Triggers",
        detail:
          "A daily job deletes expired sign-in codes and sessions, and expires agent approvals that nobody answered. Another job indexes changed tasks for search every 10 minutes.",
        href: "https://developers.cloudflare.com/workers/configuration/cron-triggers/"
      },
      {
        name: "Deploy to Cloudflare",
        detail: "One-click deploy. It creates the database and the bucket, then asks for the secrets.",
        href: "https://developers.cloudflare.com/workers/platform/deploy-buttons/"
      }
    ]
  },
  {
    title: "AI",
    intro: "AI features are optional helpers. Every request goes through one gateway.",
    rows: [
      {
        name: "Cloudflare AI Gateway",
        detail: "Logs, caching, rate limits and spend control for every AI request.",
        href: "https://developers.cloudflare.com/ai-gateway/"
      },
      {
        name: "Workers AI",
        detail: "The default provider. No extra API key. Default model: Llama 3.3 70B Instruct.",
        href: "https://developers.cloudflare.com/workers-ai/"
      },
      { name: "Anthropic or OpenAI", detail: "Optional providers through AI Gateway, with your own API key." },
      {
        name: "AG-UI 1.0",
        detail:
          "The Agent-User Interaction protocol. The agent streams AG-UI events over Server-Sent Events, and approvals use AG-UI interrupts. Types come from @ag-ui/core 1.0.4.",
        href: "https://docs.ag-ui.com"
      },
      {
        name: "Role-based agent access",
        detail:
          "The agent acts for the person and never exceeds their role. Owners set a per-role AI policy. Risky changes wait for approval, and every action is logged."
      },
      {
        name: "Jev by TypeSafe",
        detail:
          "Optional decision model for the topic check. It answers typed yes-or-no and choice questions about each request, and a truth table in code decides the route.",
        href: "https://typesafe.ai/"
      },
      {
        name: "Topic scope",
        detail:
          "A small, fast model checks each new request. It sends requests for other projects or new work to the right place and declines anything else. Default model: Llama 3.1 8B Instruct."
      }
    ]
  },
  {
    title: "Sign-in and email",
    intro: "There are no passwords. People sign in with a one-time code.",
    rows: [
      { name: "Email codes", detail: "A 6-digit code works for 10 minutes and 5 tries. Codes and session tokens are stored only as SHA-256 hashes." },
      { name: "Resend", detail: "Sends sign-in codes and project invitations through its REST API.", href: "https://resend.com" },
      { name: "Sessions", detail: "An HttpOnly, SameSite=Lax cookie that lasts 30 days." }
    ]
  },
  {
    title: "Code",
    intro: "A small set of dependencies. The Worker has one runtime dependency.",
    rows: [
      { name: "TypeScript 5.9", detail: "Strict mode for the Worker and the web app.", href: "https://www.typescriptlang.org" },
      { name: "Hono 4.13", detail: "The API router on the Worker.", href: "https://hono.dev" },
      { name: "React 19.3", detail: "The web app. No state library.", href: "https://react.dev" },
      {
        name: "shadcn/ui",
        detail: "The UI components, copied into packages/ui/src/components and owned by this project. New York style, neutral colors.",
        href: "https://ui.shadcn.com"
      },
      { name: "Radix UI", detail: "Accessible parts under the components: dialogs, menus, tooltips, tabs and switches.", href: "https://www.radix-ui.com" },
      { name: "Tailwind CSS 4.3", detail: "Styles, with the theme as CSS variables in packages/ui/src/theme.css.", href: "https://tailwindcss.com" },
      { name: "Vite 8.3", detail: "Builds the web app.", href: "https://vite.dev" },
      { name: "VitePress 1.6", detail: "Builds the docs site at docs.openact.app from the Markdown files in docs/.", href: "https://vitepress.dev" },
      { name: "Wrangler 4.158", detail: "Local development, migrations and deploys.", href: "https://developers.cloudflare.com/workers/wrangler/" },
      {
        name: "Node test runner",
        detail: "74 unit tests for app paths, permissions, dates, the AI planner, the AG-UI client, agent access, company access, links, search ranking and the topic check."
      },
      {
        name: "Search pipeline test",
        detail: "20 checks that run the real search code and migrations on Node's built-in SQLite, with a stand-in for Vectorize."
      },
      { name: "GitHub Actions", detail: "Type checks, tests, a build and a deploy dry run on every push." }
    ]
  },
  {
    title: "Design",
    intro: "The shadcn/ui design system, with OpenAct's own colors for status, priority and projects.",
    rows: [
      { name: "Geist", detail: "Text and headings.", href: "https://fonts.google.com/specimen/Geist" },
      { name: "Geist Mono", detail: "Dates and the sign-in code.", href: "https://fonts.google.com/specimen/Geist+Mono" },
      { name: "Lucide", detail: "Icons. Outline style with a 2 px stroke, at 16 px in most places.", href: "https://lucide.dev" },
      {
        name: "Layout",
        detail: "An app rail and an inset app panel, as in shadcn's sidebar-09 block, and a 48 px page header with the panel toggle, as in dashboard-01."
      },
      { name: "Themes", detail: "Light, dark, or follow the system setting." },
      { name: "Writing", detail: "Short, simple sentences in active voice, based on ASD-STE100 Simplified Technical English. American spelling." }
    ]
  }
];

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t pt-6 md:grid-cols-[13rem_1fr] md:gap-8" aria-labelledby={id}>
      <div className="grid content-start gap-1">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </div>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid min-w-0">
      {rows.map((r) => (
        <div key={r.name} className="grid gap-1 border-b py-2.5 last:border-b-0 sm:grid-cols-[12rem_1fr] sm:gap-5">
          <dt className="text-sm font-medium break-words">
            {r.href ? (
              <a href={r.href} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:decoration-foreground">
                {r.name}
              </a>
            ) : (
              r.name
            )}
          </dt>
          <dd className="text-sm text-muted-foreground">{r.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Colophon() {
  const { config, me } = useShell();
  const signedIn = !!me;
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-2 px-4 lg:px-6">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold" aria-label={`${config.appName} home`}>
            <Logo />
            <span>{config.appName}</span>
          </Link>
          <span className="flex-1" />
          <ThemeSwitch />
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:px-6" data-colophon="">
        <div className="grid gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Colophon</p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">How {config.appName} is made</h1>
          <p className="max-w-2xl text-muted-foreground">
            OpenAct is open source project management with a board, a timeline and a calendar. MarketGrowth makes it and shares it under the MIT license. This
            page lists the features, how they were built, and the tools and services behind them.
          </p>
        </div>

        <Section id="colo-features" title="What it does" intro="The features in OpenAct today.">
          <Rows rows={FEATURES.map((f) => ({ name: f.name, detail: f.detail }))} />
        </Section>

        <Section id="colo-log" title="Build log" intro={`${LOG.length} milestones, oldest first. Each one links to its change on GitHub.`}>
          <ol className="grid min-w-0" data-colo-log="">
            {LOG.map((m, i) => (
              <li key={m.title} className="grid grid-cols-[2.25rem_1fr] gap-3 border-b py-2.5 last:border-b-0">
                <span className="pt-0.5 font-mono text-xs text-muted-foreground tabular" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="grid min-w-0 gap-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm font-medium">
                    {m.title}
                    {m.commit && (
                      <a
                        className="font-mono text-xs font-normal text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
                        href={`${REPO}/commit/${m.commit}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Commit ${m.commit} on GitHub`}
                        data-colo-commit=""
                      >
                        {m.commit}
                      </a>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">{m.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        {SECTIONS.map((s) => (
          <Section key={s.title} id={`colo-${s.title.replace(/\W+/g, "-").toLowerCase()}`} title={s.title} intro={s.intro}>
            <Rows rows={s.rows} />
          </Section>
        ))}

        <Section id="colo-source" title="Source and license" intro="Read the code, report an issue, or deploy your own copy.">
          <Rows
            rows={[
              { name: "github.com/marketgrowth/openact", href: REPO, detail: "The source code, the deploy guide and the AG-UI guide." },
              { name: "MIT License", detail: "Copyright (c) 2026 MarketGrowth." },
              { name: "MarketGrowth", href: "https://marketgrowth.io", detail: "Makes and maintains OpenAct." }
            ]}
          />
        </Section>

        <div className="border-t pt-6">
          <Button asChild>
            <Link to="/">{signedIn ? "Back to your projects" : "Sign in"}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
