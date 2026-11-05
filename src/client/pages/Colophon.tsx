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

const SECTIONS: Array<{ title: string; intro: string; rows: Row[] }> = [
  {
    title: "Platform",
    intro: "OpenAct runs on Cloudflare. One Worker serves the API and the web app.",
    rows: [
      { name: "Cloudflare Workers", detail: "Runs the API and serves the web app as static assets. Compatibility date 2026-10-01, with nodejs_compat.", href: "https://developers.cloudflare.com/workers/" },
      { name: "Cloudflare D1", detail: "SQLite database for people, projects, members, tasks and sessions. SQL migrations run on every deploy.", href: "https://developers.cloudflare.com/d1/" },
      { name: "Cloudflare R2", detail: "Object storage for task attachments, up to 25 MB per file.", href: "https://developers.cloudflare.com/r2/" },
      { name: "Cron Triggers", detail: "A daily job deletes expired sign-in codes and sessions, and expires agent approvals that nobody answered.", href: "https://developers.cloudflare.com/workers/configuration/cron-triggers/" },
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
      { name: "Node test runner", detail: "Unit tests for dates, the AI planner, the AG-UI client, agent access rules and the topic check. GitHub Actions runs type checks, tests and a build on every push." }
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
          tools and services behind it.
        </p>

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
