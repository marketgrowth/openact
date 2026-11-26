import { useEffect, useRef, useState } from "react";
import { Icon, navigate } from "@openact/ui";
import { HOME, MAX_QUESTION } from "../shared/rules";
import { useLibrary } from "./state";

/**
 * The search field at the top of the side panel. It takes a question in plain words and opens the Search page,
 * where AI answers from the company library and My Library. The "/" key puts the cursor in it.
 */
export function SearchField({ onDone }: { onDone?: () => void }) {
  const { config } = useLibrary();
  const box = useRef<HTMLInputElement>(null);
  const onAsk = location.pathname === `${HOME}/ask`;
  const [q, setQ] = useState(() => (onAsk ? (new URLSearchParams(location.search).get("q") ?? "") : ""));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      box.current?.focus();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!config?.canAsk) return null;
  return (
    <form
      role="search"
      className="mx-2 mb-1 flex min-h-10 items-center gap-2 rounded-lg border bg-background px-2 focus-within:ring-2 focus-within:ring-ring/40"
      onSubmit={(e) => {
        e.preventDefault();
        const question = q.trim();
        if (!question) return;
        navigate(`${HOME}/ask?q=${encodeURIComponent(question)}`);
        onDone?.();
      }}
      data-library-search=""
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-primary" aria-hidden="true">
        <Icon name="bot" size={15} />
      </span>
      <input
        ref={box}
        type="search"
        value={q}
        maxLength={MAX_QUESTION}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search the library with AI. Type a question in plain words."
        placeholder="Search the library"
        className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
      />
      <kbd className="hidden rounded border px-1.5 text-[0.7rem] text-muted-foreground sm:inline">/</kbd>
    </form>
  );
}
