import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { api, ApiError, Avatar, ConfirmButton, errorText, fmtDateTime, Icon, LinkedText, Modal, Notice, useLive, useShell, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Textarea } from "@openact/ui/components/textarea";
import { COMMENT_MAX, cleanQuote, type DocThread, type ThreadList } from "../shared/comments";
import { removeThreadMark, threadHasText } from "./comment-mark";

/*
 * Comments: the state of a doc's threads, the side panel, and the dialog that starts a thread on selected text.
 * Comments save at once through their own API. A live room tells open panels when someone comments.
 */

export interface CommentsState {
  list: ThreadList | null;
  error: string | null;
  reload: () => Promise<void>;
}

export function useComments(docId: string, enabled: boolean): CommentsState {
  const [list, setList] = useState<ThreadList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revRef = useRef(-1);
  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const l = await api<ThreadList>(`/api/apps/docs/docs/${docId}/threads`);
      revRef.current = l.rev;
      setList(l);
      setError(null);
    } catch (e) {
      // People without the comment permission see no comments, and no error.
      if (e instanceof ApiError && e.code === "no_permission") setList(null);
      else setError(errorText(e));
    }
  }, [docId, enabled]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const live = useLive(`/api/apps/docs/docs/${encodeURIComponent(docId)}/comments/live`, enabled, (rev) => {
    if (rev !== revRef.current) void reload();
  });
  useEffect(() => {
    if (!enabled || live.connected) return;
    const t = window.setInterval(() => document.visibilityState === "visible" && void reload(), 15000);
    return () => window.clearInterval(t);
  }, [enabled, live.connected, reload]);
  return { list, error, reload };
}

/** CSS for comment marks: highlight open threads, hide resolved ones, and mark the active thread. */
export function commentCss(list: ThreadList | null, active: string | null): string {
  const resolved = (list?.threads ?? []).filter((t) => t.status === "resolved").map((t) => t.id);
  const sel = (id: string) => `.doc-paper .ProseMirror span[data-comment-thread="${id}"]`;
  return [
    `.doc-paper .ProseMirror span[data-comment-thread]{background:color-mix(in oklab,var(--pc-amber) 20%,transparent);border-bottom:2px solid color-mix(in oklab,var(--pc-amber) 65%,transparent);cursor:pointer}`,
    ...resolved.map((id) => `${sel(id)}{background:none;border-bottom:0;cursor:text}`),
    active ? `${sel(active)}{background:color-mix(in oklab,var(--pc-amber) 40%,transparent)}` : ""
  ].join("\n");
}

/* A text box with @mentions. Typing @ shows the people who can see docs. */

function MentionBox({
  value,
  onChange,
  people,
  mentions,
  onMentions,
  onSubmit,
  placeholder,
  autoFocus,
  label
}: {
  value: string;
  onChange: (v: string) => void;
  people: ThreadList["people"];
  mentions: string[];
  onMentions: (ids: string[]) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [people, query]);

  const detect = (text: string, caret: number) => {
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
    setQuery(m ? m[2]! : null);
    setIndex(0);
  };

  const pick = (p: { id: string; name: string }) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const start = value.slice(0, caret).lastIndexOf("@");
    const next = `${value.slice(0, start)}@${p.name} ${value.slice(caret)}`;
    onChange(next);
    onMentions([...new Set([...mentions, p.id])]);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = start + p.name.length + 2;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === "ArrowDown") return (e.preventDefault(), setIndex((i) => (i + 1) % matches.length));
      if (e.key === "ArrowUp") return (e.preventDefault(), setIndex((i) => (i - 1 + matches.length) % matches.length));
      if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), pick(matches[index]!));
      if (e.key === "Escape") return (e.preventDefault(), setQuery(null));
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        maxLength={COMMENT_MAX}
        rows={2}
        placeholder={placeholder}
        aria-label={label}
        className="min-h-16 text-sm"
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKey}
        onBlur={() => window.setTimeout(() => setQuery(null), 150)}
        data-comment-input=""
      />
      {matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-56 rounded-md border bg-popover p-1 text-sm shadow-md" role="listbox" aria-label="People to mention">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left aria-selected:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
              >
                <Avatar id={p.id} name={p.name} size={18} />
                <span className="truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Keeps only mentions whose @Name is still in the text. */
const keptMentions = (body: string, ids: string[], people: ThreadList["people"]) =>
  ids.filter((id) => {
    const p = people.find((x) => x.id === id);
    return !!p && body.includes(`@${p.name}`);
  });

/* Starting a thread on the selected text */

export function NewThreadDialog({
  editor,
  docId,
  people,
  onCreated,
  onClose
}: {
  editor: Editor;
  docId: string;
  people: ThreadList["people"];
  onCreated: (threadId: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [range] = useState(() => ({ from: editor.state.selection.from, to: editor.state.selection.to }));
  const quote = useMemo(() => cleanQuote(editor.state.doc.textBetween(range.from, range.to, " ", " ")), [editor, range]);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const id = crypto.randomUUID();
    try {
      await api(`/api/apps/docs/docs/${docId}/threads`, { body: { id, body, quote, onText: true, mentions: keptMentions(body, mentions, people) } });
      // Mark the text after the thread exists, so a failed request leaves no mark behind.
      editor.chain().focus().setTextSelection(range).setMark("comment", { threadId: id }).run();
      onCreated(id);
      onClose();
    } catch (e) {
      toast(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Comment" onClose={onClose}>
      {quote && <blockquote className="border-l-2 border-[color:var(--pc-amber)] pl-3 text-sm text-muted-foreground italic">{quote}</blockquote>}
      <MentionBox
        value={body}
        onChange={setBody}
        people={people}
        mentions={mentions}
        onMentions={setMentions}
        onSubmit={submit}
        placeholder="Add a comment. Type @ to mention someone."
        label="Comment"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={busy || !body.trim()} onClick={submit} data-comment-submit="">
          Comment
        </Button>
      </div>
    </Modal>
  );
}

/* The side panel */

export function CommentsPanel({
  docId,
  state,
  editor,
  canEditDoc,
  active,
  onActive,
  onClose
}: {
  docId: string;
  state: CommentsState;
  editor: Editor | null;
  canEditDoc: boolean;
  active: string | null;
  onActive: (id: string | null) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const { list, error, reload } = state;
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const open = (list?.threads ?? []).filter((t) => t.status === "open");
  const resolved = (list?.threads ?? []).filter((t) => t.status === "resolved");

  // Show the active thread, even when it is resolved.
  useEffect(() => {
    if (!active) return;
    if (resolved.some((t) => t.id === active)) setShowResolved(true);
    // Scroll the panel only, never the page, so the doc stays where it is.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-thread="${active}"]`);
      const box = el?.closest<HTMLElement>("[data-comments-scroll]");
      if (!el || !box) return;
      const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: top - 8, behavior: "smooth" });
    });
  }, [active, resolved.length]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      if (done) toast(done);
      return true;
    } catch (e) {
      toast(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addDocComment = async () => {
    if (!draft.trim() || !list) return;
    const ok = await run(() => api(`/api/apps/docs/docs/${docId}/threads`, { body: { body: draft, mentions: keptMentions(draft, mentions, list.people) } }));
    if (ok) {
      setDraft("");
      setMentions([]);
    }
  };

  const deleteThread = (t: DocThread) =>
    run(async () => {
      await api(`/api/apps/docs/threads/${t.id}`, { method: "DELETE" });
      if (editor && canEditDoc) removeThreadMark(editor, t.id);
      if (active === t.id) onActive(null);
    }, "The thread is deleted.");

  return (
    <aside className="flex min-h-0 flex-col gap-3 rounded-xl border bg-card p-3" aria-label="Comments" data-comments-panel="">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">Comments</h2>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Close comments" onClick={onClose}>
          <Icon name="x" />
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!list ? (
        <p className="text-sm text-muted-foreground">Loading comments…</p>
      ) : (
        <>
          <div className="grid gap-2">
            <MentionBox
              value={draft}
              onChange={setDraft}
              people={list.people}
              mentions={mentions}
              onMentions={setMentions}
              onSubmit={addDocComment}
              placeholder="Comment on the whole doc. Type @ to mention someone."
              label="Comment on the whole doc"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{list.can.commentOnText ? "To comment on text, select it, then choose Comment." : ""}</p>
              <Button size="sm" disabled={busy || !draft.trim()} onClick={addDocComment} data-doc-comment-submit="">
                Comment
              </Button>
            </div>
          </div>
          <div className="grid gap-2 overflow-y-auto" data-threads="">
            {!open.length && <p className="py-2 text-sm text-muted-foreground">No open comments.</p>}
            {open.map((t) => (
              <Thread
                key={t.id}
                thread={t}
                list={list}
                active={active === t.id}
                missingText={!!t.quote && !!editor && !threadHasText(editor, t.id)}
                busy={busy}
                run={run}
                onActive={onActive}
                onDelete={() => deleteThread(t)}
              />
            ))}
            {resolved.length > 0 && (
              <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setShowResolved((v) => !v)}>
                <Icon name={showResolved ? "chevron" : "right"} /> {resolved.length} resolved
              </Button>
            )}
            {showResolved &&
              resolved.map((t) => (
                <Thread
                  key={t.id}
                  thread={t}
                  list={list}
                  active={active === t.id}
                  missingText={false}
                  busy={busy}
                  run={run}
                  onActive={onActive}
                  onDelete={() => deleteThread(t)}
                />
              ))}
          </div>
        </>
      )}
    </aside>
  );
}

function Thread({
  thread: t,
  list,
  active,
  missingText,
  busy,
  run,
  onActive,
  onDelete
}: {
  thread: DocThread;
  list: ThreadList;
  active: boolean;
  missingText: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;
  onActive: (id: string | null) => void;
  onDelete: () => void;
}) {
  const { me } = useShell();
  const [reply, setReply] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const resolvedThread = t.status === "resolved";
  const canDeleteThread = t.createdBy === me?.id || list.can.moderate;

  const send = async () => {
    if (!reply.trim()) return;
    const ok = await run(() => api(`/api/apps/docs/threads/${t.id}/comments`, { body: { body: reply, mentions: keptMentions(reply, mentions, list.people) } }));
    if (ok) {
      setReply("");
      setMentions([]);
    }
  };

  return (
    <article
      className={`grid gap-2 rounded-lg border p-2.5 text-sm transition-colors ${active ? "border-[color:var(--pc-amber)] bg-muted/40" : ""} ${resolvedThread ? "opacity-75" : ""}`}
      data-thread={t.id}
      data-status={t.status}
      onClick={() => onActive(t.id)}
    >
      {t.quote ? (
        <blockquote className="line-clamp-2 border-l-2 border-[color:var(--pc-amber)] pl-2 text-xs text-muted-foreground italic">{t.quote}</blockquote>
      ) : (
        <p className="text-xs text-muted-foreground">On the whole doc</p>
      )}
      {missingText && <p className="text-xs text-muted-foreground">The text of this comment was deleted.</p>}
      {t.comments.map((cm) => (
        <div key={cm.id} className="grid gap-1" data-comment={cm.id}>
          <div className="flex items-center gap-1.5 text-xs">
            <Avatar id={cm.authorId ?? cm.id} name={cm.authorName} size={18} />
            <span className="font-medium">{cm.authorName}</span>
            <span className="text-muted-foreground">
              {fmtDateTime(cm.createdAt)}
              {cm.editedAt ? " (edited)" : ""}
            </span>
          </div>
          {editing === cm.id ? (
            <div className="grid gap-1.5">
              <Textarea
                value={editText}
                maxLength={COMMENT_MAX}
                onChange={(e) => setEditText(e.target.value)}
                className="min-h-14 text-sm"
                aria-label="Change comment"
              />
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !editText.trim()}
                  onClick={async () => {
                    if (await run(() => api(`/api/apps/docs/comments/${cm.id}`, { method: "PATCH", body: { body: editText } }))) setEditing(null);
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <p className="break-words whitespace-pre-wrap">
              <LinkedText text={cm.body} />
            </p>
          )}
          {editing !== cm.id && (cm.authorId === me?.id || list.can.moderate) && (
            <div className="flex gap-1">
              {cm.authorId === me?.id && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs text-muted-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(cm.id);
                    setEditText(cm.body);
                  }}
                >
                  Edit
                </Button>
              )}
              <ConfirmButton
                label="Delete"
                confirmLabel="Delete comment"
                className="h-6 px-1.5 text-xs"
                disabled={busy}
                onConfirm={() => run(() => api(`/api/apps/docs/comments/${cm.id}`, { method: "DELETE" }), "The comment is deleted.")}
              />
            </div>
          )}
        </div>
      ))}
      {!resolvedThread && (
        <div className="grid gap-1.5" onClick={(e) => e.stopPropagation()}>
          <MentionBox
            value={reply}
            onChange={setReply}
            people={list.people}
            mentions={mentions}
            onMentions={setMentions}
            onSubmit={send}
            placeholder="Reply"
            label="Reply"
          />
          {reply.trim() && (
            <div className="flex justify-end">
              <Button size="sm" disabled={busy} onClick={send} data-reply-submit="">
                Reply
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 border-t pt-1.5" onClick={(e) => e.stopPropagation()}>
        {resolvedThread ? (
          <>
            <span className="flex-1 text-xs text-muted-foreground">
              Resolved{t.resolvedByName ? ` by ${t.resolvedByName}` : ""}
              {t.resolvedAt ? `, ${fmtDateTime(t.resolvedAt)}` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => run(() => api(`/api/apps/docs/threads/${t.id}`, { method: "PATCH", body: { status: "open" } }))}
            >
              Reopen
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => run(() => api(`/api/apps/docs/threads/${t.id}`, { method: "PATCH", body: { status: "resolved" } }), "The thread is resolved.")}
            data-resolve=""
          >
            <Icon name="check" /> Resolve
          </Button>
        )}
        {canDeleteThread && (
          <ConfirmButton label="Delete thread" confirmLabel="Delete thread" className="ml-auto h-7 text-xs" disabled={busy} onConfirm={onDelete} />
        )}
      </div>
    </article>
  );
}
