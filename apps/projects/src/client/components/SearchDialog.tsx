import { useEffect, useRef, useState } from "react";
import type { ProjectColor } from "../../shared/types";
import { api, errorText } from "@openact/ui";
import { fmtRange } from "@openact/ui";
import { requestOpenTask } from "../openTask";
import { Icon } from "@openact/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@openact/ui/components/dialog";
import { Kbd } from "@openact/ui/components/kbd";

interface Result {
  taskId: string;
  projectId: string;
  projectName: string;
  projectColor: ProjectColor;
  title: string;
  phase: string;
  column: string | null;
  start: string | null;
  end: string | null;
  snippet: string;
  match: "word" | "meaning" | "both";
}

/** Search every project you can see in the current company, by words and by meaning. Opens with Ctrl+K or Cmd+K. */
export function SearchDialog({ companyId, companyName, onClose }: { companyId: string; companyName: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [semantic, setSemantic] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults(null);
      return;
    }
    const n = ++seq.current;
    const t = window.setTimeout(async () => {
      try {
        const r = await api<{ results: Result[]; semantic: boolean }>(`/api/search?q=${encodeURIComponent(text)}&company=${encodeURIComponent(companyId)}`);
        if (n !== seq.current) return;
        setResults(r.results);
        setSemantic(r.semantic);
        setActive(0);
        setError(null);
      } catch (e) {
        if (n === seq.current) setError(errorText(e));
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, companyId]);

  const open = (r: Result) => {
    onClose();
    requestOpenTask(r.projectId, r.taskId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!results?.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(results[active]!);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
        aria-label={`Search ${companyName}`}
        data-search=""
      >
        <DialogTitle className="sr-only">Search {companyName}</DialogTitle>
        <DialogDescription className="sr-only">Search tasks by words and by meaning.</DialogDescription>
        <div className="flex h-12 items-center gap-2 border-b px-3">
          <Icon name="search" className="shrink-0 opacity-50" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Search tasks in ${companyName}`}
            aria-label="Search tasks"
            role="combobox"
            aria-expanded={!!results?.length}
            aria-controls="search-results"
            aria-activedescendant={results?.length ? `sr-${active}` : undefined}
            className="flex h-10 w-full bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground"
          />
          <Kbd>Esc</Kbd>
        </div>
        {error && <p className="px-4 py-6 text-center text-sm text-destructive">{error}</p>}
        {results && !results.length && !error && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No tasks match. Try other words.</p>}
        {results && results.length > 0 && (
          <ul className="max-h-[min(60dvh,420px)] overflow-y-auto p-1" id="search-results" role="listbox">
            {results.map((r, i) => (
              <li
                key={r.taskId}
                id={`sr-${i}`}
                role="option"
                aria-selected={i === active}
                className="flex cursor-default items-start gap-3 rounded-sm px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                onMouseEnter={() => setActive(i)}
                onClick={() => open(r)}
              >
                <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: `var(--pc-${r.projectColor})` }} aria-hidden="true" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">{r.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {r.projectName}
                    {r.column ? ` · ${r.column}` : ""}
                    {r.start || r.end ? ` · ${fmtRange(r.start, r.end)}` : ""}
                  </span>
                  {r.snippet && <span className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</span>}
                </span>
                {r.match !== "word" && (
                  <span
                    className="mt-0.5 text-muted-foreground"
                    title={r.match === "both" ? "Matches your words and their meaning" : "Matches the meaning of your words"}
                  >
                    <Icon name="sparkle" size={14} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          {semantic === false ? "Search by words. Search by meaning turns on when Vectorize is set up." : "Search by words and by meaning."} Only projects you
          can see are searched.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Tasks with a similar meaning, shown in the task drawer. Hidden when search by meaning is not set up. */
export function RelatedTasks({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<Array<{
    taskId: string;
    projectId: string;
    projectName: string;
    projectColor: ProjectColor;
    title: string;
    column: string | null;
  }> | null>(null);
  useEffect(() => {
    let live = true;
    api<{ available: boolean; results: NonNullable<typeof items> }>(`/api/search/related/${taskId}`)
      .then((r) => live && setItems(r.available ? r.results : null))
      .catch(() => live && setItems(null));
    return () => {
      live = false;
    };
  }, [taskId]);
  if (!items?.length) return null;
  return (
    <section className="grid gap-2" aria-label="Related tasks">
      <h3 className="text-sm font-medium">Related tasks</h3>
      <ul className="grid gap-0.5">
        {items.map((r) => (
          <li key={r.taskId}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => requestOpenTask(r.projectId, r.taskId)}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--pc-${r.projectColor})` }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="shrink-0 truncate text-xs text-muted-foreground">
                {r.projectName}
                {r.column ? ` · ${r.column}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
