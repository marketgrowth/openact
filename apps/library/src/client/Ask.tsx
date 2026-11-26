import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentState, Icon, Link, PageBody, SiteHeader, navigate } from "@openact/ui";
import { Textarea } from "@openact/ui/components/textarea";
import { Button } from "@openact/ui/components/button";
import { COMPANY_AI_PROVIDER_LABELS, runAguiAgent, type AguiEvent } from "@openact/core/shared";

const newIdLike = () => crypto.randomUUID();
import {
  API,
  ASK_EVENT,
  FORMAT_LABEL,
  HOME,
  MAX_HISTORY,
  MAX_QUESTION,
  type AiChoice,
  type AskCitation,
  type AskCitations,
  type AskSearched,
  type LibraryConfig
} from "../shared/rules";
import { FORMAT_ICON, resourcePath, useLibrary } from "./state";

/*
 * Ask: the library's AI chat, over AG-UI. Each answer comes from the published resources only, with numbered links to them.
 * The server ranks the resources' text (keyword search), asks the model with the person's own AI rules,
 * and streams AG-UI events: the search step, the answer, and the resources it cites.
 */

const providerLabel = (p: string) =>
  (COMPANY_AI_PROVIDER_LABELS as Record<string, string>)[p] ?? (p === "workers-ai" ? "Cloudflare Workers AI" : p === "dev-scripted" ? "test answers" : p);

/** Whose AI answers, in plain words. */
export function aiLine(ai: AiChoice | null): string {
  if (!ai) return "";
  if (ai.source === "none") return "Your company needs an AI key before Ask can answer. A company owner adds it in Company settings, under AI provider.";
  const who =
    ai.source === "user" ? "your own AI key, which bills your account" : ai.source === "company" ? "your company's AI key" : ai.source === "partner" ? "your partner's AI key" : "the site's default AI";
  return `Answers use ${providerLabel(ai.provider)}, through ${who}.`;
}

/** The question box. On the home page it opens the Ask page. On the Ask page it asks a follow-up. */
export function AskBox({ config, onAsk, followUp = false, resourceTitle }: { config: LibraryConfig; onAsk: (q: string) => void; followUp?: boolean; resourceTitle?: string }) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const s = config.settings;
  const submit = (text = q) => {
    const question = text.trim();
    if (!question) return;
    setQ("");
    onAsk(question);
  };
  return (
    <form
      className="grid gap-2.5"
      aria-label="Ask"
      data-library-ask=""
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2 rounded-xl border bg-card p-2 pl-3 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
        <Textarea
          ref={box}
          aria-label={followUp ? "Ask a follow-up" : resourceTitle ? `Ask about ${resourceTitle}` : "Ask the library"}
          value={q}
          rows={followUp ? 1 : 2}
          maxLength={MAX_QUESTION}
          placeholder={resourceTitle ? "Ask about this resource" : "Ask about any resource in the library"}
          className="min-h-0 flex-1 resize-none border-0 bg-transparent px-0 text-[0.95rem] shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button type="submit" size="icon" aria-label="Ask" disabled={!q.trim()}>
          <Icon name="send" />
        </Button>
      </div>
      {!followUp && s.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {s.suggestions.map((sq) => (
            <Button key={sq} type="button" variant="outline" size="sm" className="rounded-full font-normal" onClick={() => submit(sq)}>
              {sq}
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Answers come only from the company library and your My Library, with a link to each one. {aiLine(config.ai)} AI answers can be wrong.
      </p>
    </form>
  );
}

/** The answer text, with each [n] as a link to its resource. */
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
          to={resourcePath(c.id)}
          className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded bg-muted px-1 align-super text-[0.7rem] font-semibold text-foreground no-underline hover:bg-accent"
          aria-label={`Source ${c.n}: ${c.title}`}
        >
          {c.n}
        </Link>
      );
    });
  return <p className="whitespace-pre-line text-[0.95rem] leading-relaxed">{parts}</p>;
}

function CiteCards({ cites, label }: { cites: AskCitation[]; label: string }) {
  if (!cites.length) return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={label}>
      {cites.map((c) => (
        <li key={`${c.n}-${c.id}`}>
          <Link to={resourcePath(c.id)} className="flex h-full items-center gap-3 rounded-lg border p-2.5 text-foreground no-underline hover:bg-accent">
            <span className="rounded bg-muted px-1.5 text-xs font-semibold">{c.n}</span>
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-sm font-medium">{c.title}</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Icon name={FORMAT_ICON[c.format]} size={12} />
                {FORMAT_LABEL[c.format]}
                {c.personal && (
                  <>
                    <span aria-hidden="true">·</span>
                    <Icon name="lock" size={12} />
                    Only you
                  </>
                )}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

type Turn = {
  q: string;
  status: "search" | "answer" | "done" | "fail";
  searched: AskSearched | null;
  text: string;
  cites: AskCitations | null;
  error: string;
};

/** The Ask page: a thread of questions and answers. It starts with ?q= and, for one resource, ?r=. */
export function AskPage() {
  const { config, companyId } = useLibrary();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const thread = useRef(newIdLike());
  const started = useRef(false);
  const params = new URLSearchParams(location.search);
  const resourceId = params.get("r");
  const resourceTitle = params.get("t") ?? undefined;

  const ask = async (question: string) => {
    if (!companyId || busy) return;
    const history = turns
      .filter((t) => t.status === "done")
      .flatMap((t) => [
        { id: newIdLike(), role: "user" as const, content: t.q },
        { id: newIdLike(), role: "assistant" as const, content: t.text }
      ])
      .slice(-MAX_HISTORY);
    const at = turns.length;
    setTurns((all) => [...all, { q: question, status: "search", searched: null, text: "", cites: null, error: "" }]);
    setBusy(true);
    const patch = (p: Partial<Turn>) => setTurns((all) => all.map((t, i) => (i === at ? { ...t, ...p } : t)));
    const onEvent = (e: AguiEvent) => {
      if (e.type === "STEP_STARTED" && e.stepName === "answer") patch({ status: "answer" });
      else if (e.type === "CUSTOM" && e.name === ASK_EVENT.searched) patch({ searched: e.value as AskSearched });
      else if (e.type === "TEXT_MESSAGE_CONTENT") setTurns((all) => all.map((t, i) => (i === at ? { ...t, text: t.text + e.delta } : t)));
      else if (e.type === "CUSTOM" && e.name === ASK_EVENT.citations) patch({ cites: e.value as AskCitations });
      else if (e.type === "RUN_FINISHED") patch({ status: "done" });
      else if (e.type === "RUN_ERROR") patch({ status: "fail", error: e.message });
    };
    await runAguiAgent(
      `${API}/companies/${companyId}/ask`,
      {
        threadId: thread.current,
        runId: newIdLike(),
        state: {},
        tools: [],
        context: [],
        forwardedProps: resourceId ? { resourceId } : {},
        messages: [...history, { id: newIdLike(), role: "user", content: question }]
      },
      onEvent
    );
    setBusy(false);
  };

  useEffect(() => {
    const q = params.get("q");
    if (q && companyId && config && !started.current) {
      started.current = true;
      void ask(q);
    }
    // Start once, with the question in the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, config]);

  if (!config) return null;
  return (
    <>
      <SiteHeader
        title={
          <span className="flex items-center gap-2">
            <Link to={HOME} className="text-muted-foreground no-underline hover:text-foreground">
              {config.settings.title}
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
            <span>Search</span>
          </span>
        }
      >
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => {
            setTurns([]);
            thread.current = newIdLike();
            navigate(`${HOME}/ask`, true);
            started.current = true;
          }}
          disabled={busy}
        >
          New question
        </Button>
      </SiteHeader>
      <PageBody className="max-w-4xl">
        {!config.canAsk && <AgentState state="fail">Ask is off for you. Your company or the site turned it off. Use the search on the library page.</AgentState>}
        <div className="grid gap-6" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className="grid gap-3" data-ask-turn={i}>
              <p className="w-fit max-w-[85%] justify-self-end rounded-xl bg-muted px-3.5 py-2.5 text-[0.95rem]">{t.q}</p>
              {t.searched && (
                <AgentState state={t.status === "search" ? "act" : "done"}>
                  Searched {t.searched.searched} resource{t.searched.searched === 1 ? "" : "s"}. Read {t.searched.read}.
                </AgentState>
              )}
              {t.status === "search" && !t.searched && <AgentState state="act">Searching the library…</AgentState>}
              {t.status === "answer" && <AgentState state="think">Writing the answer…</AgentState>}
              {t.status === "fail" && <AgentState state="fail">{t.error}</AgentState>}
              {t.text && (
                <div className="grid gap-3" data-ask-answer="">
                  <AnswerText text={t.text} cites={t.cites?.citations ?? []} />
                  <CiteCards cites={t.cites?.citations ?? []} label="Sources for this answer" />
                  {t.cites && t.cites.related.length > 0 && (
                    <>
                      <span className="text-xs font-medium text-muted-foreground">{t.cites.citations.length ? "Also related" : "Related resources"}</span>
                      <CiteCards cites={t.cites.related} label="Related resources" />
                    </>
                  )}
                  {config.settings.notice && t.status === "done" && <p className="text-xs text-muted-foreground">{config.settings.notice}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
        {config.canAsk && <AskBox config={config} followUp={turns.length > 0} resourceTitle={turns.length ? undefined : resourceTitle} onAsk={(q) => void ask(q)} />}
      </PageBody>
    </>
  );
}

