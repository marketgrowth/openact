import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ApiError, Icon, Modal, Notice, errorText } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Textarea } from "@openact/ui/components/textarea";
import { Toggle } from "@openact/ui/components/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openact/ui/components/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@openact/ui/components/dropdown-menu";
import { AI_ACTION_LABELS, AI_LANGUAGES, AI_LIMITS, AI_TONES, aiParagraphs, tidyAiText, type AiAction, type AiLanguage, type AiTone } from "../shared/ai";

/*
 * AI writing help in the editor: a menu on the toolbar and a preview dialog.
 * The answer streams into the dialog. The doc changes only when the person chooses Replace or Insert.
 */

export interface AiChoice {
  action: AiAction;
  tone?: AiTone;
  language?: AiLanguage;
  prompt?: string;
}

type Status = "off" | "on" | "no_permission";

const TONE_LABELS: Record<AiTone, string> = { professional: "Professional", friendly: "Friendly", confident: "Confident", casual: "Casual", direct: "Direct" };

export function AiMenu({ editor, status, onChoose }: { editor: Editor; status: Status; onChoose: (c: AiChoice) => void }) {
  const [hasSelection, setHasSelection] = useState(!editor.state.selection.empty);
  useEffect(() => {
    const update = () => setHasSelection(!editor.state.selection.empty);
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const item = (action: AiAction) => (
    <DropdownMenuItem key={action} disabled={!hasSelection} onSelect={() => onChoose({ action })} data-ai-action={action}>
      {AI_ACTION_LABELS[action]}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Toggle size="sm" pressed={false} aria-label="AI writing help" data-tool="ai" className="gap-1 px-2">
              <Icon name="sparkle" />
              <span className="text-xs font-medium">AI</span>
            </Toggle>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>AI writing help</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64">
        {status === "off" ? (
          <p className="p-2 text-sm text-muted-foreground" data-ai-off="">
            AI writing help is off for this company. A company owner or admin can turn it on in Company settings, on the Docs tab.
          </p>
        ) : (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {hasSelection ? "For the selected text" : "Select text to edit it with AI"}
            </DropdownMenuLabel>
            {item("improve")}
            {item("fix")}
            {item("simplify")}
            {item("shorten")}
            {item("longer")}
            {item("summarize")}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!hasSelection}>Change tone</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {AI_TONES.map((t) => (
                  <DropdownMenuItem key={t} onSelect={() => onChoose({ action: "tone", tone: t })}>
                    {TONE_LABELS[t]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!hasSelection}>Translate</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {AI_LANGUAGES.map((l) => (
                  <DropdownMenuItem key={l} onSelect={() => onChoose({ action: "translate", language: l })}>
                    {l}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!hasSelection} onSelect={() => onChoose({ action: "custom" })} data-ai-action="custom">
              {AI_ACTION_LABELS.custom}…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onChoose({ action: "continue" })} data-ai-action="continue">
              {AI_ACTION_LABELS.continue}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The text the AI gets, read from the editor when the person chooses an action. */
function readSelection(editor: Editor, action: AiAction) {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const size = state.doc.content.size;
  const text = (a: number, b: number) => state.doc.textBetween(Math.max(0, a), Math.min(size, b), "\n\n", " ");
  if (action === "continue" || empty) {
    return { from: to, to, text: text(to - AI_LIMITS.text, to), before: "", after: text(to, to + AI_LIMITS.context) };
  }
  return { from, to, text: text(from, to), before: text(from - AI_LIMITS.context, from), after: text(to, to + AI_LIMITS.context) };
}

/** Reads the server-sent events of the AI route. Calls onText with the text so far. */
async function streamAi(url: string, body: unknown, signal: AbortSignal, onText: (t: string) => void): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ApiError(0, "The server cannot be reached. Check your connection.");
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(res.status, data?.error ?? `The request failed (${res.status}).`, data?.code);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  let event = "message";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        const data = JSON.parse(line.slice(5).trim() || "{}") as { t?: string; message?: string };
        if (event === "error") throw new Error(data.message ?? "The AI stopped before it finished. Try again.");
        if (event === "message" && data.t) {
          out += data.t;
          onText(out);
        }
      } else if (!line.trim()) event = "message";
    }
  }
  return out;
}

/** Puts AI text into the doc. One paragraph inside one paragraph stays inline. More becomes new paragraphs. */
function applyText(editor: Editor, text: string, from: number, to: number, mode: "replace" | "below") {
  const paras = aiParagraphs(text);
  if (!paras.length) return;
  const inline = (lines: string[]) => lines.flatMap((l, i) => [...(i > 0 ? [{ type: "hardBreak" }] : []), ...(l ? [{ type: "text", text: l }] : [])]);
  const { state } = editor;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (mode === "replace" && paras.length === 1 && $from.sameParent($to) && $from.parent.isTextblock && from !== to) {
    editor.chain().focus().insertContentAt({ from, to }, inline(paras[0]!)).run();
    return;
  }
  const blocks = paras.map((lines) => ({ type: "paragraph", content: inline(lines) }));
  if (mode === "below") {
    const at = $to.depth >= 1 ? $to.after(1) : state.doc.content.size;
    editor.chain().focus().insertContentAt(at, blocks).run();
    return;
  }
  editor.chain().focus().insertContentAt({ from, to }, blocks).run();
}

/** The preview dialog. It starts the request when it opens. */
export function AiDialog({ editor, docId, choice, onClose }: { editor: Editor; docId: string; choice: AiChoice; onClose: () => void }) {
  const [sel] = useState(() => readSelection(editor, choice.action));
  const [prompt, setPrompt] = useState(choice.prompt ?? "");
  const [text, setText] = useState("");
  const [state, setState] = useState<"ask" | "running" | "done" | "error">(choice.action === "custom" && !choice.prompt ? "ask" : "running");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(
    async (p?: string) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setText("");
      setError(null);
      setState("running");
      try {
        const out = await streamAi(
          `/api/apps/docs/docs/${docId}/ai`,
          { action: choice.action, tone: choice.tone, language: choice.language, prompt: p ?? prompt, text: sel.text, before: sel.before, after: sel.after },
          ctrl.signal,
          setText
        );
        if (ctrl.signal.aborted) return;
        if (!tidyAiText(out)) throw new Error("The AI returned no text. Try again, or choose another action.");
        setState("done");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(errorText(e));
        setState("error");
      }
    },
    [docId, choice, prompt, sel]
  );

  useEffect(() => {
    if (state === "running") void run();
    return () => abort.current?.abort();
    // Start once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = (mode: "replace" | "below") => {
    applyText(editor, text, sel.from, sel.to, mode);
    onClose();
  };

  const label =
    choice.action === "tone"
      ? `Change tone: ${choice.tone}`
      : choice.action === "translate"
        ? `Translate to ${choice.language}`
        : AI_ACTION_LABELS[choice.action];
  const continuing = choice.action === "continue";

  return (
    <Modal title={label} description="The AI writes a suggestion. Your doc does not change until you choose Replace or Insert." onClose={onClose} wide>
      {state === "ask" ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) void run(prompt.trim());
          }}
        >
          <Textarea
            autoFocus
            value={prompt}
            maxLength={AI_LIMITS.prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="For example: Turn this into a list of next steps."
            aria-label="What should the AI do with the selected text?"
            data-ai-prompt=""
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!prompt.trim()}>
              <Icon name="sparkle" /> Ask AI
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div
            className="max-h-[50vh] min-h-24 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap"
            aria-live="polite"
            aria-busy={state === "running"}
            data-ai-result=""
          >
            {text || (state === "running" ? <span className="text-muted-foreground">Writing…</span> : null)}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <p className="text-xs text-muted-foreground">AI can be wrong. Read the text before you use it.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Discard
            </Button>
            <Button type="button" variant="outline" disabled={state === "running"} onClick={() => void run()} data-ai-retry="">
              Try again
            </Button>
            {!continuing && (
              <Button type="button" variant="outline" disabled={state !== "done"} onClick={() => accept("below")} data-ai-below="">
                Insert below
              </Button>
            )}
            <Button type="button" disabled={state !== "done"} onClick={() => accept("replace")} data-ai-accept="">
              {continuing ? "Insert" : "Replace selection"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
