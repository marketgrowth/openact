import type { AppConfig } from "../../shared/types";
import { Link } from "../router";
import { Logo, ThemeSwitch } from "../ui";

/*
 * Colophon: how OpenAct is made. Public page at /colophon.
 * Keep it in step with docs/COLOPHON.md and package.json.
 */

interface Row {
  name: string;
  detail: string;
  href?: string;
}

const REPO = "https://github.com/marketgrowth/openact";

/** What OpenAct does today. Keep in step with the Features list in README.md. */
const FEATURES: Row[] = [
  { name: "Kanban board", detail: "Drag cards between columns. Each project has its own columns, and each column says what it means, so progress and late checks keep working." },
  { name: "Gantt timeline", detail: "Drag a bar to move a task, or an edge to change its length. Tasks group by phase, and a line marks today." },
  { name: "Calendar", detail: "A month view with start cards and deadline pills. Drag either to change the date. Phones get an agenda list." },
  { name: "Tasks", detail: "Dates, phase, assignee, notes and files up to 25 MB. Web addresses in notes and descriptions show as links that open in a new tab." },
  { name: "Companies", detail: "One install holds many companies. Switch from the top of the side panel. Each company has its own name, logo, people, email domain and AI defaults." },
  { name: "Access", detail: "Project roles (owner, editor, viewer) and company roles (owner, admin, member, guest). Owners can make a project secret. People without access can ask for it." },
  { name: "Search", detail: "Ctrl+K or Cmd+K searches every project you can see, by words and by meaning. The task drawer shows related tasks." },
  { name: "Live updates", detail: "A change shows on every open page at once, including changes from the AI agent. The header shows who else is viewing." },
  { name: "AI agent", detail: "Tell it what to do in plain words. It acts for you, never with more power than your role. Risky changes wait for your approval, and every action is logged." },
  { name: "Topic check", detail: "A quick check reads each new request. Requests for another project get a link to it. New work gets an offer to start a project. Anything else gets a short decline." },
  { name: "Note search", detail: "Owners can let the agent search task notes. It gets only short parts, with email addresses and phone numbers hidden." },
  { name: "Sign-in", detail: "No passwords. People sign in with a 6-digit email code." },
  { name: "Themes and phones", detail: "Light, dark, or follow the system. On a phone, the side panel opens as a drawer." }
];

/** Milestones in the order they shipped. Each links to its commit. */
const LOG: Array<{ title: string; detail: string; commit: string }> = [
  { title: "Board and timeline", detail: "Projects, a Kanban board, a Gantt timeline, email code sign-in, project roles, file attachments, and AI task drafts and status summaries.", commit: "35dbe6d" },
  { title: "Calendar and AG-UI", detail: "A month calendar with an agenda list on phones. The assistant starts to speak the AG-UI protocol.", commit: "dd620a6" },
  { title: "Colophon", detail: "This page, and docs/COLOPHON.md.", commit: "7e91cc8" },
  { title: "Agent access and custom columns", detail: "The agent acts with the person's role. Owners set a policy per role. Approvals, an activity log, and board columns that each project names itself.", commit: "3e0d2f7" },
  { title: "Topic check", detail: "A small model reads each new request and keeps the agent on its project.", commit: "db30e51" },
  { title: "Jev decision model", detail: "With a TypeSafe key, Jev answers typed questions about each request, and a truth table in code picks the route.", commit: "cc0dff8" },
  { title: "Note search", detail: "An owner setting lets the agent search task notes, with private details hidden. The board filter also searches notes.", commit: "7bfb109" },
  { title: "Clickable links", detail: "Web addresses in descriptions and notes open in a new tab. OpenAct never fetches them.", commit: "891540f" },
  { title: "Companies", detail: "Multi-tenant companies, a collapsible side panel with a company switcher, secret projects, access requests and email domain auto-join.", commit: "61c310a" },
  { title: "Search by meaning", detail: "Vectorize and Workers AI embeddings, merged with word search. Results are checked against what each person can see.", commit: "f78f471" },
  { title: "Live updates", detail: "A Durable Object per project holds hibernating WebSockets. Pages check for changes only when the connection is down.", commit: "ce7e4e4" }
];

const SECTIONS: Array<{ title: string; intro: string; rows: Row[] }> = [
  {
    title: "Platform",
    intro: "OpenAct runs on Cloudflare. One Worker serves the API and the web app.",
    rows: [
      { name: "Cloudflare Workers", detail: "Runs the API and serves the web app as static assets. Compatibility date 2026-10-01, with nodejs_compat.", href: "https://developers.cloudflare.com/workers/" },
      { name: "Cloudflare D1", detail: "SQLite database for companies, people, projects, members, tasks and sessions. SQL migrations run on every deploy.", href: "https://developers.cloudflare.com/d1/" },
      { name: "Cloudflare R2", detail: "Object storage for task attachments (up to 25 MB per file) and company logos.", href: "https://developers.cloudflare.com/r2/" },
      { name: "Durable Objects", detail: "Live updates. One object per project holds its WebSockets, with the Hibernation API.", href: "https://developers.cloudflare.com/durable-objects/" },
      { name: "Cloudflare Vectorize", detail: "Search by meaning, with one namespace per company. Embeddings come from Workers AI (bge-base-en-v1.5).", href: "https://developers.cloudflare.com/vectorize/" },
      { name: "Cron Triggers", detail: "A daily job deletes expired sign-in codes and sessions, and expires agent approvals that nobody answered. Another job indexes changed tasks for search every 10 minutes.", href: "https://developers.cloudflare.com/workers/configuration/cron-triggers/" },
      { name: "Deploy to Cloudflare", detail: "One-click deploy. It creates the database and the bucket, then asks for the secrets.", href: "https://developers.cloudflare.com/workers/platform/deploy-buttons/" }
    ]
  },
  {
    title: "AI",
    intro: "AI features are optional helpers. Every request goes through one gateway.",
    rows: [
      { name: "Cloudflare AI Gateway", detail: "Logs, caching, rate limits and spend control for every AI request.", href: "https://developers.cloudflare.com/ai-gateway/" },
      { name: "Workers AI", detail: "The default provider. No extra API key. Default model: Llama 3.3 70B Instruct.", href: "https://developers.cloudflare.com/workers-ai/" },
      { name: "Anthropic or OpenAI", detail: "Optional providers through AI Gateway, with your own API key." },
      { name: "AG-UI 1.0", detail: "The Agent-User Interaction protocol. The agent streams AG-UI events over Server-Sent Events, and approvals use AG-UI interrupts. Types come from @ag-ui/core 1.0.4.", href: "https://docs.ag-ui.com" },
      { name: "Role-based agent access", detail: "The agent acts for the person and never exceeds their role. Owners set a per-role AI policy. Risky changes wait for approval, and every action is logged." },
      { name: "Jev by TypeSafe", detail: "Optional decision model for the topic check. It answers typed yes-or-no and choice questions about each request, and a truth table in code decides the route.", href: "https://typesafe.ai/" },
      { name: "Topic scope", detail: "A small, fast model checks each new request. It sends requests for other projects or new work to the right place and declines anything else. Default model: Llama 3.1 8B Instruct." }
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
      { name: "React 19.3", detail: "The web app. No UI framework and no state library.", href: "https://react.dev" },
      { name: "Vite 8.3", detail: "Builds the web app.", href: "https://vite.dev" },
      { name: "Wrangler 4.158", detail: "Local development, migrations and deploys.", href: "https://developers.cloudflare.com/workers/wrangler/" },
      { name: "Node test runner", detail: "64 unit tests for dates, the AI planner, the AG-UI client, agent access, company access, links, search ranking and the topic check." },
      { name: "Search pipeline test", detail: "20 checks that run the real search code and migrations on Node's built-in SQLite, with a stand-in for Vectorize." },
      { name: "GitHub Actions", detail: "Type checks, tests, a build and a deploy dry run on every push." }
    ]
  },
  {
    title: "Design",
    intro: "One stylesheet with color tokens for light and dark themes.",
    rows: [
      { name: "Archivo", detail: "Headings. A variable font with width and weight axes.", href: "https://fonts.google.com/specimen/Archivo" },
      { name: "IBM Plex Sans", detail: "Body text and controls.", href: "https://fonts.google.com/specimen/IBM+Plex+Sans" },
      { name: "IBM Plex Mono", detail: "Dates, counts and labels, so numbers line up.", href: "https://fonts.google.com/specimen/IBM+Plex+Mono" },
      { name: "Themes", detail: "Light, dark, or follow the system setting." },
      { name: "Icons and logo", detail: "Drawn for OpenAct as inline SVG. No icon library." },
      { name: "Writing", detail: "Short, simple sentences in active voice, based on ASD-STE100 Simplified Technical English. American spelling." }
    ]
  }
];

export function Colophon({ config, signedIn }: { config: AppConfig; signedIn: boolean }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap topbar-in">
          <Link to="/" className="brand" aria-label={`${config.appName} home`}>
            <Logo />
            <span>{config.appName}</span>
          </Link>
          <span className="grow" />
          <ThemeSwitch />
        </div>
      </header>
      <main className="wrap page colophon">
        <p className="eyebrow">Colophon</p>
        <h1>How {config.appName} is made</h1>
        <p className="lead muted">
          OpenAct is open source project management with a board, a timeline and a calendar. MarketGrowth makes it and shares it under the MIT license. This page lists the
          features, how they were built, and the tools and services behind them.
        </p>

        <section className="colo-section" aria-labelledby="colo-features">
          <div className="colo-head">
            <h2 id="colo-features">What it does</h2>
            <p className="muted">The features in OpenAct today.</p>
          </div>
          <dl className="colo-list">
            {FEATURES.map((r) => (
              <div key={r.name} className="colo-row">
                <dt>{r.name}</dt>
                <dd>{r.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="colo-section" aria-labelledby="colo-log">
          <div className="colo-head">
            <h2 id="colo-log">Build log</h2>
            <p className="muted">
              {LOG.length} milestones, oldest first. Each one links to its change on GitHub.
            </p>
          </div>
          <ol className="colo-log">
            {LOG.map((m, i) => (
              <li key={m.commit}>
                <span className="colo-step" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="colo-log-body">
                  <p className="colo-log-title">
                    {m.title}
                    <a className="colo-commit" href={`${REPO}/commit/${m.commit}`} target="_blank" rel="noreferrer" aria-label={`Commit ${m.commit} on GitHub`}>
                      {m.commit}
                    </a>
                  </p>
                  <p className="muted">{m.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {SECTIONS.map((s) => (
          <section key={s.title} className="colo-section" aria-labelledby={`colo-${s.title}`}>
            <div className="colo-head">
              <h2 id={`colo-${s.title}`}>{s.title}</h2>
              <p className="muted">{s.intro}</p>
            </div>
            <dl className="colo-list">
              {s.rows.map((r) => (
                <div key={r.name} className="colo-row">
                  <dt>
                    {r.href ? (
                      <a href={r.href} target="_blank" rel="noreferrer">
                        {r.name}
                      </a>
                    ) : (
                      r.name
                    )}
                  </dt>
                  <dd>{r.detail}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <section className="colo-section" aria-labelledby="colo-source">
          <div className="colo-head">
            <h2 id="colo-source">Source and license</h2>
            <p className="muted">Read the code, report an issue, or deploy your own copy.</p>
          </div>
          <dl className="colo-list">
            <div className="colo-row">
              <dt>
                <a href="https://github.com/marketgrowth/openact" target="_blank" rel="noreferrer">
                  github.com/marketgrowth/openact
                </a>
              </dt>
              <dd>The source code, the deploy guide and the AG-UI guide.</dd>
            </div>
            <div className="colo-row">
              <dt>MIT License</dt>
              <dd>Copyright (c) 2026 MarketGrowth.</dd>
            </div>
            <div className="colo-row">
              <dt>
                <a href="https://marketgrowth.io" target="_blank" rel="noreferrer">
                  MarketGrowth
                </a>
              </dt>
              <dd>Makes and maintains OpenAct.</dd>
            </div>
          </dl>
        </section>

        <p>
          <Link to="/" className="btn">
            {signedIn ? "Back to your projects" : "Sign in"}
          </Link>
        </p>
      </main>
    </div>
  );
}
