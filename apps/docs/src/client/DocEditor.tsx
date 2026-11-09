import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import { ApiError, api, errorText, fmtDateTime, Icon, Link, navigate, Notice, PageBody, SiteHeader, useLive, useShell, useToast } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Badge } from "@openact/ui/components/badge";
import { Toggle } from "@openact/ui/components/toggle";
import { Separator } from "@openact/ui/components/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openact/ui/components/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@openact/ui/components/dropdown-menu";
import { PageBreak } from "./page-break";
import { DeleteDialog, LinkDialog, ShareDialog } from "./dialogs";
import { CategorySelect, FolderSelect, TagInput } from "./library-dialogs";
import { AiDialog, AiMenu, type AiChoice } from "./ai";
import { CommentMark } from "./comment-mark";
import { CommentsPanel, NewThreadDialog, commentCss, useComments } from "./comments";
import { DOCS_HOME, useDocs } from "./state";
import { contentCss, MARGIN_LABELS, PAGE_SIZE_LABELS, pageBox, paginate } from "../shared/page";
import {
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  MARGINS,
  ORIENTATIONS,
  PAGE_SIZES,
  TITLE_MAX,
  type DocDetail,
  type Margin,
  type Orientation,
  type PageSettings,
  type PageSize
} from "../shared/types";

/*
 * The doc editor: a Tiptap editor on a sheet of the page size.
 * Changes save on their own after a short pause. Each save sends the rev it started from,
 * so a save never replaces someone else's newer version. Dashed lines show where each printed page starts.
 */

const SAVE_DELAY_MS = 1000;
const POLL_MS = 8000;

type Status = "saved" | "dirty" | "saving" | "error" | "conflict";

/** The doc page: the editor, with the doc's folder, category and tags. */
export function DocPage({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDoc(await api<DocDetail>(`/api/apps/docs/docs/${docId}`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [docId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error || !doc)
    return (
      <>
        <SiteHeader title="Doc" />
        <PageBody>{error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-muted-foreground">Loading the doc…</p>}</PageBody>
      </>
    );
  return <LoadedDoc initial={doc} />;
}

/** The folder path of a doc, as links, for the page header. */
function Trail({ folderId }: { folderId: string | null }) {
  const { folderTrail } = useDocs();
  const trail = folderTrail(folderId);
  return (
    <span className="flex min-w-0 items-center gap-1 text-sm" data-doc-trail="">
      <Link to={DOCS_HOME} className="shrink-0 text-muted-foreground hover:text-foreground">
        Docs
      </Link>
      {trail.map((f) => (
        <span key={f.id} className="flex min-w-0 items-center gap-1">
          <Icon name="right" size={14} className="shrink-0 text-muted-foreground" />
          <Link to={`${DOCS_HOME}/f/${f.id}`} className="truncate text-muted-foreground hover:text-foreground">
            {f.name}
          </Link>
        </span>
      ))}
    </span>
  );
}

/** Folder, category and tags. They save at once, apart from the content, so they never clash with someone who is writing. */
function MetaBar({ doc, canEdit }: { doc: DocDetail; canEdit: boolean }) {
  const toast = useToast();
  const { library, tag, reload } = useDocs();
  const [folderId, setFolderId] = useState(doc.folderId);
  const [categoryId, setCategoryId] = useState(doc.categoryId);
  const [tags, setTags] = useState<string[] | null>(null);
  const tagNames = tags ?? doc.tagIds.map((id) => tag(id)?.name).filter((n): n is string => !!n);

  const save = async (body: Record<string, unknown>, done: string) => {
    try {
      await api(`/api/apps/docs/docs/${doc.id}/meta`, { method: "PATCH", body });
      await reload();
      toast(done);
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]" data-doc-meta="">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Folder
        <FolderSelect
          value={folderId}
          disabled={!canEdit}
          onChange={(v) => {
            setFolderId(v);
            void save({ folderId: v }, "The doc moved.");
          }}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Category
        <CategorySelect
          value={categoryId}
          disabled={!canEdit}
          onChange={(v) => {
            setCategoryId(v);
            void save({ categoryId: v }, "The category is saved.");
          }}
        />
      </label>
      <div className="grid gap-1 text-xs font-medium text-muted-foreground">
        <span>Tags</span>
        <TagInput
          id={`doc-tags-${doc.id}`}
          value={tagNames}
          disabled={!canEdit}
          known={library?.tags ?? []}
          onChange={(names) => {
            setTags(names);
            void save({ tags: names }, "The tags are saved.");
          }}
        />
      </div>
    </div>
  );
}

function LoadedDoc({ initial }: { initial: DocDetail }) {
  const toast = useToast();
  const { me } = useShell();
  const id = initial.id;
  const [title, setTitle] = useState(initial.title);
  const [settings, setSettings] = useState<PageSettings>({ pageSize: initial.pageSize, orientation: initial.orientation, margin: initial.margin });
  const [shareUrl, setShareUrl] = useState(initial.shareUrl);
  const [shared, setShared] = useState(initial.shared);
  const [status, setStatus] = useState<Status>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(initial.updatedAt);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [gone, setGone] = useState(false);
  const [dialog, setDialog] = useState<null | "share" | "link" | "delete">(null);
  const [aiChoice, setAiChoice] = useState<AiChoice | null>(null);
  const comments = useComments(initial.id, initial.canComment);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [newThread, setNewThread] = useState(false);
  const openThreads = (comments.list?.threads ?? []).filter((t) => t.status === "open").length;
  const [layout, setLayout] = useState<{ pages: number; words: number; markers: Array<{ top: number; page: number }> }>({ pages: 1, words: 0, markers: [] });
  const canEdit = initial.canEdit && !gone;
  const box = useMemo(() => pageBox(settings), [settings]);

  /* Saving */

  const revRef = useRef(initial.rev);
  const seenRev = useRef(initial.rev);
  const pending = useRef<Record<string, unknown>>({});
  const contentDirty = useRef(false);
  const inflight = useRef(false);
  const blocked = useRef(false); // true after a conflict, until the person loads the latest version
  const timer = useRef<number | undefined>(undefined);
  const editorRef = useRef<Editor | null>(null);
  // The content as last loaded or saved. The editor can tidy a doc when it opens, such as a trailing paragraph
  // after a table. Comparing against this keeps opening a doc from saving it, which could clash with other editors.
  const baseline = useRef<string | null>(null);
  const canEditRef = useRef(initial.canEdit);

  const hasPending = () => contentDirty.current || Object.keys(pending.current).length > 0;

  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (inflight.current || blocked.current || !hasPending()) return !hasPending();
    const body: Record<string, unknown> = { ...pending.current };
    pending.current = {};
    let sentJson: string | null = null;
    if (contentDirty.current && editorRef.current) {
      contentDirty.current = false;
      const json = editorRef.current.getJSON();
      const str = JSON.stringify(json);
      if (str !== baseline.current) {
        body.content = json;
        sentJson = str;
      }
    }
    const sendContent = sentJson !== null;
    if (!Object.keys(body).length) {
      setStatus("saved");
      return true;
    }
    inflight.current = true;
    setStatus("saving");
    try {
      const r = await api<{ rev: number; updatedAt: string }>(`/api/apps/docs/docs/${id}`, { method: "PATCH", body: { ...body, baseRev: revRef.current } });
      revRef.current = r.rev;
      seenRev.current = Math.max(seenRev.current, r.rev);
      if (sentJson !== null) baseline.current = sentJson;
      setSavedAt(r.updatedAt);
      setSaveError(null);
      inflight.current = false;
      if (hasPending()) return flush();
      setStatus("saved");
      return true;
    } catch (e) {
      inflight.current = false;
      // Keep the changes, so a retry sends them again.
      delete body.content;
      pending.current = { ...body, ...pending.current };
      if (sendContent) contentDirty.current = true;
      if (e instanceof ApiError && e.code === "conflict") {
        blocked.current = true;
        setStatus("conflict");
      } else if (e instanceof ApiError && e.status === 404) {
        setGone(true);
        setStatus("error");
        setSaveError(e.message);
      } else {
        setStatus("error");
        setSaveError(errorText(e));
      }
      return false;
    }
  }, [id]);

  const queue = useCallback(
    (patch: Record<string, unknown> | null, delay = SAVE_DELAY_MS) => {
      if (!canEditRef.current) return; // Viewers never save.
      if (!patch && baseline.current === null) return; // The editor is still opening the doc.
      if (patch) Object.assign(pending.current, patch);
      else contentDirty.current = true;
      if (blocked.current) return;
      setStatus("dirty");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), delay);
    },
    [flush]
  );

  // Warn before the tab closes with unsaved changes. Save when the person leaves the doc in the app.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (hasPending() || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void flush();
    };
  }, [flush]);

  /* The editor */

  const editor = useEditor({
    editable: initial.canEdit,
    shouldRerenderOnTransaction: false,
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      Image.configure({ allowBase64: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: initial.canEdit ? "Start writing…" : "" }),
      PageBreak,
      CommentMark
    ],
    content: initial.content,
    onUpdate: () => queue(null),
    editorProps: {
      // A click on commented text opens its thread.
      handleClick: (_view, _pos, event) => {
        const el = (event.target as HTMLElement | null)?.closest?.("[data-comment-thread]");
        const id = el?.getAttribute("data-comment-thread");
        if (id) {
          setActiveThread(id);
          setCommentsOpen(true);
        }
        return false;
      }
    }
  });
  editorRef.current = editor;

  // Take the baseline after the editor has tidied the doc it opened.
  useEffect(() => {
    if (!editor) return;
    const t = window.setTimeout(() => {
      baseline.current = JSON.stringify(editor.getJSON());
    }, 50);
    return () => window.clearTimeout(t);
  }, [editor]);

  useEffect(() => {
    canEditRef.current = canEdit;
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  /* Page lines: where each printed page starts, with the same splitter as the share page */

  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const dom = editor.view.dom as HTMLElement;
        const kids = Array.from(dom.children) as HTMLElement[];
        const blocks = kids.map((el) => ({ top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight, forced: el.hasAttribute("data-page-break") }));
        const starts = paginate(blocks, box.contentHeight);
        const markers = starts
          .map((i, k) => ({ i, page: k + 1 }))
          .filter(({ i, page }) => page > 1 && !kids[i - 1]?.hasAttribute("data-page-break"))
          .map(({ i, page }) => ({ top: kids[i]!.offsetTop, page }));
        const words = (editor.getText({ blockSeparator: " " }).match(/\S+/g) ?? []).length;
        setLayout({ pages: starts.length, words, markers });
      });
    };
    measure();
    editor.on("update", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(editor.view.dom);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("update", measure);
      ro.disconnect();
    };
  }, [editor, box.contentHeight]);

  /* Other people's changes */

  const reload = useCallback(async () => {
    try {
      const d = await api<DocDetail>(`/api/apps/docs/docs/${id}`);
      window.clearTimeout(timer.current);
      pending.current = {};
      contentDirty.current = false;
      blocked.current = false;
      revRef.current = d.rev;
      seenRev.current = Math.max(seenRev.current, d.rev);
      editor?.commands.setContent(d.content, { emitUpdate: false });
      if (editor) baseline.current = JSON.stringify(editor.getJSON());
      setTitle(d.title);
      setSettings({ pageSize: d.pageSize, orientation: d.orientation, margin: d.margin });
      setShared(d.shared);
      setShareUrl(d.shareUrl);
      setSavedAt(d.updatedAt);
      setRemoteChanged(false);
      setSaveError(null);
      setStatus("saved");
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setGone(true);
        setSaveError(e.message);
      } else toast(errorText(e));
    }
  }, [id, editor, toast]);

  const onRev = useCallback(
    (rev: number) => {
      if (rev === 0) {
        setGone(true);
        setSaveError("Someone deleted this doc.");
        return;
      }
      seenRev.current = Math.max(seenRev.current, rev);
      if (rev <= revRef.current || inflight.current) return;
      if (hasPending()) setRemoteChanged(true);
      else void reload();
    },
    [reload]
  );
  const live = useLive(`/api/apps/docs/docs/${encodeURIComponent(id)}/live`, !gone, onRev);

  // After our own save, a newer rev from the room means someone else saved too.
  useEffect(() => {
    if (status === "saved" && seenRev.current > revRef.current) setRemoteChanged(true);
  }, [status]);

  // Without live updates, check the rev now and then.
  useEffect(() => {
    if (live.connected || gone) return;
    const t = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        onRev((await api<{ rev: number }>(`/api/apps/docs/docs/${id}/rev`)).rev);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) onRev(0);
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [live.connected, gone, id, onRev]);

  /* Actions */

  const fileInput = useRef<HTMLInputElement>(null);
  const uploadImage = async (file: File | undefined) => {
    if (!file || !editor) return;
    try {
      if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error("Use a PNG, JPEG, WebP or GIF image.");
      if (file.size > IMAGE_MAX_BYTES) throw new Error("The image is too large. The limit is 5 MB.");
      const form = new FormData();
      form.append("file", file);
      toast("Uploading the image…");
      const r = await api<{ src: string }>(`/api/apps/docs/docs/${id}/files`, { method: "POST", form });
      editor
        .chain()
        .focus()
        .setImage({ src: r.src, alt: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 200) })
        .run();
    } catch (e) {
      toast(errorText(e));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const print = async () => {
    // Open the tab now, while the click still counts, then point it at the print page after the save.
    const w = window.open("", "_blank");
    const ok = await flush();
    if (!ok && hasPending()) toast("Some changes are not saved yet. The print shows the last saved version.");
    const url = `/api/apps/docs/docs/${id}/print`;
    if (w) {
      w.opener = null;
      w.location.href = url;
    } else window.location.href = url;
  };

  const changeSettings = (patch: Partial<PageSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    queue(patch, 0);
  };

  const remove = async () => {
    try {
      window.clearTimeout(timer.current);
      pending.current = {};
      contentDirty.current = false;
      await api(`/api/apps/docs/docs/${id}`, { method: "DELETE" });
      toast("The doc is deleted.");
      navigate(initial.folderId ? `${DOCS_HOME}/f/${initial.folderId}` : DOCS_HOME);
    } catch (e) {
      toast(errorText(e));
    }
  };

  const others = live.viewers.filter((v) => v.userId !== me?.id);

  /* Styles for the sheet. Colors come from theme tokens. */
  const css = useMemo(
    () => `
.doc-paper{--doc-fg:var(--paper-foreground);--doc-muted:var(--paper-muted);--doc-border:var(--paper-border);--doc-soft:var(--paper-soft);--doc-link:var(--paper-link)}
${contentCss(".doc-paper .ProseMirror")}
.doc-paper .ProseMirror{outline:none;position:relative;min-height:${box.contentHeight}px}
.doc-paper .ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:var(--doc-muted);float:left;height:0;pointer-events:none}
.doc-paper .doc-page-break{display:flex;align-items:center;justify-content:center;height:28px;margin:16px -${box.margin}px;background:var(--desk);color:var(--muted-foreground);font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;user-select:none}
.doc-paper .doc-page-break.ProseMirror-selectednode{outline:2px solid var(--ring)}
.doc-paper .ProseMirror img.ProseMirror-selectednode{outline:2px solid var(--doc-link);outline-offset:2px}
.doc-paper .ProseMirror td,.doc-paper .ProseMirror th{position:relative}
.doc-paper .ProseMirror .selectedCell{background:var(--doc-soft)}
.doc-paper .ProseMirror .column-resize-handle{position:absolute;right:-2px;top:0;bottom:-2px;width:4px;background:var(--doc-link);pointer-events:none}
.doc-paper .ProseMirror.resize-cursor{cursor:col-resize}
.doc-paper [data-type="details"]{display:flex;gap:.4em;border:1px solid var(--doc-border);border-radius:6px;padding:.4em .8em;margin:0 0 .65em}
.doc-paper [data-type="details"] > button{flex:none;width:1.2em;height:1.5em;padding:0;border:0;background:none;color:var(--doc-muted);cursor:pointer}
.doc-paper [data-type="details"] > button::before{content:"\\25B8"}
.doc-paper [data-type="details"].is-open > button::before{content:"\\25BE"}
.doc-paper [data-type="details"] > div{flex:1;min-width:0}
.doc-paper [data-type="details"] summary{display:block;font-weight:600;list-style:none}
.doc-paper [data-type="detailsContent"]{margin-top:.4em}
`,
    [box.contentHeight, box.margin]
  );

  return (
    <>
      <SiteHeader title={<Trail folderId={initial.folderId} />}>
        <SaveStatus status={status} savedAt={savedAt} error={saveError} canEdit={canEdit} onRetry={() => void flush()} />
        {others.length > 0 && (
          <Badge variant="outline" className="hidden md:inline-flex" title={others.map((v) => v.name).join(", ")}>
            {others.length === 1 ? `${others[0]!.name} is here` : `${others.length} others are here`}
          </Badge>
        )}
        {canEdit && <PageMenu settings={settings} onChange={changeSettings} />}
        <Button variant="outline" size="sm" onClick={print} data-doc-print="">
          <Icon name="print" /> <span className="hidden sm:inline">Print or PDF</span>
        </Button>
        {initial.canComment && (
          <Button
            variant={commentsOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => setCommentsOpen((v) => !v)}
            aria-pressed={commentsOpen}
            data-comments-toggle=""
          >
            <Icon name="chat" /> <span className="hidden sm:inline">Comments</span>
            {openThreads > 0 && <span className="tabular rounded-full bg-muted px-1.5 text-xs">{openThreads}</span>}
          </Button>
        )}
        {initial.canShare ? (
          <Button size="sm" onClick={() => setDialog("share")} data-doc-share="">
            <Icon name="share" /> <span className="hidden sm:inline">{shared ? "Shared" : "Share"}</span>
          </Button>
        ) : (
          shared && <Badge variant="secondary">Shared with a link</Badge>
        )}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="More doc actions">
                <Icon name="dots" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDialog("delete")}>
                <Icon name="trash" /> Delete doc
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SiteHeader>
      <PageBody>
        <div className="grid min-w-0 gap-3" data-doc-editor={id}>
          <style>{css}</style>
          <style>{commentCss(comments.list, activeThread)}</style>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-semibold tracking-tight outline-none hover:border-input focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-100"
              value={title}
              maxLength={TITLE_MAX}
              disabled={!canEdit}
              aria-label="Doc title"
              placeholder="Untitled doc"
              onChange={(e) => {
                setTitle(e.target.value);
                queue({ title: e.target.value });
              }}
              data-doc-title=""
            />
          </div>
          <MetaBar doc={initial} canEdit={canEdit} />

          {gone && <Notice tone="error">{saveError ?? "This doc is no longer available."}</Notice>}
          {status === "conflict" && (
            <Notice tone="warn">
              <span>Someone else saved this doc after you opened it. Your last changes are not saved. Load their version, then make your change again.</span>{" "}
              <Button size="sm" variant="outline" className="ml-2" onClick={() => void reload()}>
                Load the latest version
              </Button>
            </Notice>
          )}
          {remoteChanged && status !== "conflict" && !gone && (
            <Notice tone="info">
              <span>Someone else changed this doc.</span>{" "}
              <Button size="sm" variant="outline" className="ml-2" onClick={() => void reload()}>
                Load their version
              </Button>
            </Notice>
          )}

          {canEdit && editor && (
            <Toolbar
              editor={editor}
              onLink={() => setDialog("link")}
              onImage={() => fileInput.current?.click()}
              ai={initial.ai === "no_permission" ? null : { status: initial.ai, onChoose: setAiChoice }}
              onComment={comments.list?.can.commentOnText ? () => setNewThread(true) : null}
            />
          )}
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => uploadImage(e.target.files?.[0])}
          />

          <div className={commentsOpen ? "grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]" : "grid"}>
            <div className="-mx-4 min-w-0 overflow-x-auto bg-desk px-4 py-6 md:rounded-xl lg:-mx-0 lg:px-6" data-doc-desk="">
              <div
                className="doc-paper mx-auto rounded-sm bg-paper text-paper-foreground shadow-md"
                style={{ width: box.width, minHeight: box.height, padding: box.margin }}
                data-page-size={settings.pageSize}
              >
                <div className="relative">
                  <EditorContent editor={editor} />
                  {layout.markers.map((m) => (
                    <div
                      key={m.page}
                      className="pointer-events-none absolute border-t border-dashed border-paper-border"
                      style={{ top: m.top - 8, left: -box.margin, right: -box.margin }}
                      aria-hidden="true"
                      data-page-marker={m.page}
                    >
                      <span className="absolute -top-2.5 right-2 bg-paper px-1.5 text-[10px] font-medium tracking-wide text-paper-muted uppercase">
                        Page {m.page}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {commentsOpen && (
              <div
                className="order-first max-h-[60vh] overflow-y-auto xl:sticky xl:top-[calc(var(--header-height)+4rem)] xl:order-none xl:max-h-[calc(100dvh-var(--header-height)-5rem)]"
                data-comments-scroll=""
              >
                <CommentsPanel
                  docId={id}
                  state={comments}
                  editor={editor}
                  canEditDoc={canEdit}
                  active={activeThread}
                  onActive={(tid) => {
                    setActiveThread(tid);
                    if (tid) document.querySelector(`.doc-paper [data-comment-thread="${tid}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
                  }}
                  onClose={() => {
                    setCommentsOpen(false);
                    setActiveThread(null);
                  }}
                />
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground" data-doc-footer="">
            {layout.pages} {layout.pages === 1 ? "page" : "pages"} · {layout.words} {layout.words === 1 ? "word" : "words"} ·{" "}
            {PAGE_SIZE_LABELS[settings.pageSize].split(" (")[0]}, {settings.orientation} · {MARGIN_LABELS[settings.margin].split(" (")[0]} margins. Pages may
            differ a little in print when a table or image is taller than a page.
          </p>

          {dialog === "share" && (
            <ShareDialog
              docId={id}
              url={shareUrl}
              onChanged={(u) => {
                setShareUrl(u);
                setShared(!!u);
              }}
              onClose={() => setDialog(null)}
            />
          )}
          {newThread && editor && comments.list && (
            <NewThreadDialog
              editor={editor}
              docId={id}
              people={comments.list.people}
              onCreated={(tid) => {
                void comments.reload();
                setActiveThread(tid);
                setCommentsOpen(true);
              }}
              onClose={() => setNewThread(false)}
            />
          )}
          {aiChoice && editor && <AiDialog editor={editor} docId={id} choice={aiChoice} onClose={() => setAiChoice(null)} />}
          {dialog === "link" && editor && (
            <LinkDialog
              current={(editor.getAttributes("link").href as string | undefined) ?? ""}
              onSave={(href) => {
                editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
                setDialog(null);
              }}
              onRemove={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setDialog(null);
              }}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog === "delete" && <DeleteDialog title={title || "Untitled doc"} onDelete={remove} onClose={() => setDialog(null)} />}
        </div>
      </PageBody>
    </>
  );
}

function SaveStatus({
  status,
  savedAt,
  error,
  canEdit,
  onRetry
}: {
  status: Status;
  savedAt: string;
  error: string | null;
  canEdit: boolean;
  onRetry: () => void;
}) {
  if (!canEdit) return <span className="text-xs text-muted-foreground">Edited {fmtDateTime(savedAt)}</span>;
  if (status === "error")
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" role="status">
        Not saved{error ? `: ${error}` : ""}
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onRetry}>
          Try again
        </Button>
      </span>
    );
  const text =
    status === "saving" ? "Saving…" : status === "dirty" ? "Changes not saved yet" : status === "conflict" ? "Not saved" : `Saved ${fmtDateTime(savedAt)}`;
  return (
    <span className="text-xs text-muted-foreground" role="status" aria-live="polite" data-save-status={status}>
      {text}
    </span>
  );
}

function PageMenu({ settings, onChange }: { settings: PageSettings; onChange: (p: Partial<PageSettings>) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-page-menu="">
          <Icon name="doc" /> <span className="hidden sm:inline">Page</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Paper size</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={settings.pageSize} onValueChange={(v) => onChange({ pageSize: v as PageSize })}>
          {PAGE_SIZES.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {PAGE_SIZE_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Orientation</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={settings.orientation} onValueChange={(v) => onChange({ orientation: v as Orientation })}>
          {ORIENTATIONS.map((o) => (
            <DropdownMenuRadioItem key={o} value={o}>
              {o === "portrait" ? "Portrait" : "Landscape"}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Margins</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={settings.margin} onValueChange={(v) => onChange({ margin: v as Margin })}>
          {MARGINS.map((m) => (
            <DropdownMenuRadioItem key={m} value={m}>
              {MARGIN_LABELS[m]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* The toolbar */

function Tool({
  label,
  icon,
  active,
  disabled,
  onClick,
  shortcut
}: {
  label: string;
  icon: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle size="sm" pressed={!!active} disabled={disabled} onPressedChange={() => onClick()} aria-label={label} data-tool={icon}>
          <Icon name={icon} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? ` (${shortcut})` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

const Group = ({ children }: { children: ReactNode }) => <div className="flex items-center gap-0.5">{children}</div>;
const Divider = () => <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />;

function Toolbar({
  editor,
  onLink,
  onImage,
  ai,
  onComment
}: {
  editor: Editor;
  onLink: () => void;
  onImage: () => void;
  ai: { status: "on" | "off"; onChoose: (c: AiChoice) => void } | null;
  onComment: (() => void) | null;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      tasks: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      hasSelection: !e.state.selection.empty
    })
  });
  const c = () => editor.chain().focus();
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

  return (
    <div
      className="sticky top-(--header-height) z-10 flex flex-wrap items-center gap-y-1 rounded-lg border bg-background/95 p-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      role="toolbar"
      aria-label="Formatting"
      data-doc-toolbar=""
    >
      <Group>
        <Tool label="Undo" icon="undo" disabled={!s.canUndo} onClick={() => c().undo().run()} shortcut={`${mod}Z`} />
        <Tool label="Redo" icon="redo" disabled={!s.canRedo} onClick={() => c().redo().run()} shortcut={`${mod}Shift+Z`} />
      </Group>
      <Divider />
      <Group>
        <Tool label="Heading 1" icon="h1" active={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()} />
        <Tool label="Heading 2" icon="h2" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()} />
        <Tool label="Heading 3" icon="h3" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()} />
      </Group>
      <Divider />
      <Group>
        <Tool label="Bold" icon="bold" active={s.bold} onClick={() => c().toggleBold().run()} shortcut={`${mod}B`} />
        <Tool label="Italic" icon="italic" active={s.italic} onClick={() => c().toggleItalic().run()} shortcut={`${mod}I`} />
        <Tool label="Underline" icon="underline" active={s.underline} onClick={() => c().toggleUnderline().run()} shortcut={`${mod}U`} />
        <Tool label="Strikethrough" icon="strike" active={s.strike} onClick={() => c().toggleStrike().run()} />
        <Tool label="Link" icon="link" active={s.link} onClick={onLink} />
        {onComment && <Tool label="Comment on the selected text" icon="chat" disabled={!s.hasSelection} onClick={onComment} />}
      </Group>
      <Divider />
      <Group>
        <Tool label="Bulleted list" icon="bullets" active={s.bullets} onClick={() => c().toggleBulletList().run()} />
        <Tool label="Numbered list" icon="numbers" active={s.numbers} onClick={() => c().toggleOrderedList().run()} />
        <Tool label="Checklist" icon="checklist" active={s.tasks} onClick={() => c().toggleTaskList().run()} />
        <Tool label="Quote" icon="quote" active={s.quote} onClick={() => c().toggleBlockquote().run()} />
        <Tool label="Code block" icon="codeblock" active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()} />
        <Tool label="Section that opens and closes" icon="collapse" onClick={() => c().setDetails().run()} />
      </Group>
      <Divider />
      <Group>
        <Tool label="Align left" icon="align-left" active={s.align === "left"} onClick={() => c().unsetTextAlign().run()} />
        <Tool label="Center" icon="align-center" active={s.align === "center"} onClick={() => c().setTextAlign("center").run()} />
        <Tool label="Align right" icon="align-right" active={s.align === "right"} onClick={() => c().setTextAlign("right").run()} />
        <Tool label="Justify" icon="align-justify" active={s.align === "justify"} onClick={() => c().setTextAlign("justify").run()} />
      </Group>
      <Divider />
      <Group>
        <Tool label="Image" icon="image" onClick={onImage} />
        <TableMenu editor={editor} inTable={s.table} />
        <Tool label="Line" icon="rule" onClick={() => c().setHorizontalRule().run()} />
        <Tool label="Page break" icon="pagebreak" onClick={() => c().setPageBreak().run()} shortcut={`${mod}Enter`} />
      </Group>
      {ai && (
        <>
          <Divider />
          <AiMenu editor={editor} status={ai.status} onChoose={ai.onChoose} />
        </>
      )}
    </div>
  );
}

function TableMenu({ editor, inTable }: { editor: Editor; inTable: boolean }) {
  const c = () => editor.chain().focus();
  if (!inTable) return <Tool label="Table" icon="table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Toggle size="sm" pressed aria-label="Table" data-tool="table">
              <Icon name="table" />
            </Toggle>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Table</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => c().addRowAfter().run()}>Add a row below</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => c().addColumnAfter().run()}>Add a column to the right</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => c().toggleHeaderRow().run()}>Header row on or off</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => c().deleteRow().run()}>Delete this row</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => c().deleteColumn().run()}>Delete this column</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => c().deleteTable().run()}>
          Delete the table
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
