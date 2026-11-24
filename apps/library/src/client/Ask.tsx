import { useRef, useState, type ReactNode } from "react";
import { AgentState, Icon, Link, api, errorText } from "@openact/ui";
import { Textarea } from "@openact/ui/arc/textarea";
import { Button } from "@openact/ui/components/button";
import { COMPANY_AI_PROVIDER_LABELS } from "@openact/core/shared";
import { API, HOME, KIND_PATH, MAX_HISTORY, MAX_QUESTION, siteOf, type AiChoice, type AskAnswer, type AskCitation, type AskTurn, type LibraryConfig } from "../shared/rules";

/*
 * Ask: the library's AI chat. Each answer comes from the published items only, with numbered links to them.
 * The server picks the items (keyword search) and asks the model with the person's own AI rules:
 * their own key, then the company key, then the site default.
 */

type Turn = { q: string; a: AskAnswer | null; error: string | null };

const providerLabel = (p: string) =>
  (COMPANY_AI_PROVIDER_LABELS as Record<string, string>)[p] ?? (p === "workers-ai" ? "Cloudflare Workers AI" : p === "dev-scripted" ? "test answers" : p);

/** Whose AI answers, in plain words. */
export function aiLine(ai: AiChoice | null): string {
  if (!ai) return "";
  const who =
    ai.source === "user"
      ? "your own AI key, which bills your account"
      : ai.source === "company"
        ? "your company's AI key"
        : "the site's default AI";
  return `Answers use ${providerLabel(ai.provider)}, through ${who}.`;
}

/** The answer text, with each [n] as a link to its item. */
function AnswerText({ text, cites }: { text: string; cites: AskCitation[] }) {
  const byN = new Map(cites.map((c) => [c.n, c]));
  const parts: ReactNode[] = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .split(/(\[\d{1,2}\])/)
    .map((part, i) => {
      const m = /^\[(\d{1,2})\]$/.exec(part);
      const c = m ? byN.get(Number(m[1])) : undefined;
      if (!c) return part;
      return (
        <Link
          key={i}
          to={`${HOME}/${KIND_PATH[c.kind]}/${c.id}`}
          className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded bg-muted px-1 align-super text-[0.7rem] font-semibold no-underline hover:bg-accent"
          aria-label={`Item ${c.n}: ${c.title}`}
        >
          {c.n}
        </Link>
      );
    });
  return <p className="whitespace-pre-line text-[0.95rem] leading-relaxed">{parts}</p>;
}

function CiteList({ title, cites, config }: { title: string; cites: AskCitation[]; config: LibraryConfig }) {
  if (!cites.length) return null;
  return (
    <div className="grid gap-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <ol className="grid gap-1.5">
        {cites.map((c) => (
          <li key={`${c.n}-${c.id}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="inline-flex min-w-5 justify-center rounded bg-muted px-1 text-xs font-semibold">{c.n}</span>
            <Link to={`${HOME}/${KIND_PATH[c.kind]}/${c.id}`} className="font-medium underline-offset-4 hover:underline">
              {c.title}
            </Link>
            <span className="text-xs text-muted-foreground">{c.kind === "source" ? config.settings.sourcesName : config.settings.updatesName}</span>
            {c.sourceUrl && (
              <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
                {siteOf(c.sourceUrl)}
                <Icon name="external" size={12} />
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AskPanel({ config, companyId }: { config: LibraryConfig; companyId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const s = config.settings;

  async function send() {
    const question = q.trim();
    if (!question || busy) return;
    const history: AskTurn[] = turns
      .filter((t) => t.a)
      .flatMap((t) => [
        { role: "user" as const, content: t.q },
        { role: "assistant" as const, content: t.a!.answer }
      ])
      .slice(-MAX_HISTORY);
    setTurns((all) => [...all, { q: question, a: null, error: null }]);
    setQ("");
    setBusy(true);
    try {
      const a = await api<AskAnswer>(`${API}/companies/${companyId}/ask`, { method: "POST", body: { question, history } });
      setTurns((all) => all.map((t, i) => (i === all.length - 1 ? { ...t, a } : t)));
    } catch (e) {
      setTurns((all) => all.map((t, i) => (i === all.length - 1 ? { ...t, error: errorText(e) } : t)));
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  return (
    <section aria-label="Ask" className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6" data-library-ask="">
      {turns.length > 0 && (
        <div className="grid gap-5" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className="grid gap-3" data-ask-turn={i}>
              <p className="w-fit max-w-full justify-self-end rounded-lg bg-muted px-3 py-2 text-sm">{t.q}</p>
              {!t.a && !t.error && <AgentState state="think">Reading the library…</AgentState>}
              {t.error && <AgentState state="fail">{t.error}</AgentState>}
              {t.a && (
                <div className="grid gap-3" data-ask-answer="">
                  <AnswerText text={t.a.answer} cites={t.a.citations} />
                  <CiteList title="From the library" cites={t.a.citations} config={config} />
                  <CiteList title={t.a.citations.length ? "Also related" : "Related items"} cites={t.a.related} config={config} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          ref={box}
          label={turns.length ? "Ask a follow-up question" : `Ask ${s.title}`}
          description={s.chatIntro}
          value={q}
          rows={turns.length ? 2 : 3}
          maxLength={MAX_QUESTION}
          placeholder={`For example: what changed in the ${s.updatesName.toLowerCase()} this month?`}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {aiLine(config.ai)} AI answers can be wrong. Always check the source.
          </p>
          <div className="flex gap-2">
            {turns.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setTurns([])} disabled={busy}>
                New question
              </Button>
            )}
            <Button type="submit" disabled={busy || !q.trim()}>
              <Icon name="sparkle" />
              Ask
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
