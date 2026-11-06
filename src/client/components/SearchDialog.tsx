import { useEffect, useRef, useState } from "react";
import type { ProjectColor } from "../../shared/types";
import { api, errorText } from "../api";
import { fmtRange } from "../dates";
import { requestOpenTask } from "../openTask";
import { Icon } from "../ui";

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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <>
      <div className="scrim" onClick={onClose} />
      <div className="search-dlg" role="dialog" aria-modal="true" aria-label={`Search ${companyName}`}>
        <div className="search-bar">
          <Icon name="search" size={18} />
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
          />
          <kbd>Esc</kbd>
        </div>
        {error && <p className="error search-msg">{error}</p>}
        {results && !results.length && !error && <p className="search-msg muted">No tasks match. Try other words.</p>}
        {results && results.length > 0 && (
          <ul className="search-results" id="search-results" role="listbox">
            {results.map((r, i) => (
              <li key={r.taskId} id={`sr-${i}`} role="option" aria-selected={i === active} className={i === active ? "is-active" : undefined} onMouseEnter={() => setActive(i)} onClick={() => open(r)}>
                <span className={`sp-dot pc-${r.projectColor}`} aria-hidden="true" />
                <span className="sr-main">
                  <span className="sr-title">{r.title}</span>
                  <span className="sr-meta">
                    {r.projectName}
                    {r.column ? ` · ${r.column}` : ""}
                    {r.start || r.end ? ` · ${fmtRange(r.start, r.end)}` : ""}
                  </span>
                  {r.snippet && <span className="sr-snip">{r.snippet}</span>}
                </span>
                {r.match !== "word" && (
                  <span className="sr-why" title={r.match === "both" ? "Matches your words and their meaning" : "Matches the meaning of your words"}>
                    <Icon name="sparkle" size={13} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="search-foot">
          {semantic === false ? "Search by words. Search by meaning turns on when Vectorize is set up." : "Search by words and by meaning."} Only projects you can see are searched.
        </p>
      </div>
    </>
  );
}

/** Tasks with a similar meaning, shown in the task drawer. Hidden when search by meaning is not set up. */
export function RelatedTasks({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<Array<{ taskId: string; projectId: string; projectName: string; projectColor: ProjectColor; title: string; column: string | null }> | null>(null);
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
    <section className="related" aria-label="Related tasks">
      <h3 className="sub-h">Related tasks</h3>
      <ul>
        {items.map((r) => (
          <li key={r.taskId}>
            <button type="button" onClick={() => requestOpenTask(r.projectId, r.taskId)}>
              <span className={`sp-dot pc-${r.projectColor}`} aria-hidden="true" />
              <span className="sr-title">{r.title}</span>
              <span className="sr-meta">
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
