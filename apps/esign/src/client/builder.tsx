import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  api,
  ApiError,
  ConfirmButton,
  errorText,
  Field as FormField,
  Icon,
  Modal,
  navigate,
  Notice,
  PageBody,
  SiteHeader,
  cn,
  useShell,
  useToast
} from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@openact/ui/components/dropdown-menu";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Switch } from "@openact/ui/components/switch";
import { Textarea } from "@openact/ui/components/textarea";
import {
  API,
  ESIGN_HOME,
  FIELD_LABELS,
  FIELD_SIZES,
  FIELD_TYPES,
  LIMITS,
  sendProblems,
  shortId,
  type Field,
  type FieldType,
  type Role,
  type Template
} from "../shared/types";
import { FIELD_ICONS, RoleDot } from "./bits";
import { PdfPages, usePdf } from "./pdf-view";
import { roleColor, roleFill, useLoad } from "./state";

/*
 * The template editor: signer roles on the left, the PDF pages in the middle, and the selected field on the right.
 *   Add a field: choose a type, then click on a page.
 *   Move a field: drag it. Resize it: drag the corner. Arrow keys nudge it. Delete removes it.
 *   Ctrl+S or Cmd+S saves. Ctrl+D or Cmd+D copies the selected field.
 */

export function BuilderPage({ templateId, sendOpen }: { templateId: string; sendOpen?: boolean }) {
  const { data, error } = useLoad<Template>(`${API}/templates/${templateId}`);
  if (!data)
    return (
      <>
        <SiteHeader title="Template" />
        <PageBody>{error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-muted-foreground">Loading the template…</p>}</PageBody>
      </>
    );
  return <Builder key={data.id} initial={data} startSend={!!sendOpen} />;
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

function Builder({ initial, startSend }: { initial: Template; startSend: boolean }) {
  const toast = useToast();
  const [name, setName] = useState(initial.name);
  const [roles, setRoles] = useState<Role[]>(initial.roles);
  const [fields, setFields] = useState<Field[]>(initial.fields);
  const [rev, setRev] = useState(initial.rev);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState(initial.roles[0]?.id ?? "");
  const [placing, setPlacing] = useState<FieldType | null>(null);
  const [dialog, setDialog] = useState<null | "send" | "delete">(startSend ? "send" : null);
  const [archived, setArchived] = useState(initial.archived);
  const { doc, error: pdfError } = usePdf(`${API}/templates/${initial.id}/file`);
  const canEdit = initial.canEdit && !archived;
  const roleIndex = useMemo(() => new Map(roles.map((r, i) => [r.id, i])), [roles]);
  const sel = fields.find((f) => f.id === selected) ?? null;
  const problems = sendProblems(roles, fields);

  const change = useCallback((fn: (f: Field[]) => Field[]) => {
    setFields(fn);
    setDirty(true);
  }, []);
  const patch = useCallback((id: string, p: Partial<Field>) => change((all) => all.map((f) => (f.id === id ? { ...f, ...p } : f))), [change]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!canEdit) return true;
    setSaving(true);
    setProblem(null);
    try {
      const r = await api<{ rev: number; fields: Field[]; roles: Role[]; name: string }>(`${API}/templates/${initial.id}`, {
        method: "PATCH",
        body: { rev, name, roles, fields }
      });
      setRev(r.rev);
      setFields(r.fields);
      setDirty(false);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict") setConflict(true);
      setProblem(errorText(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [canEdit, initial.id, rev, name, roles, fields]);

  // Warn before leaving with changes that are not saved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) void save();
        return;
      }
      if (isTyping(e.target) || dialog) return;
      if (e.key === "Escape") {
        setPlacing(null);
        setSelected(null);
        return;
      }
      if (!sel || !canEdit) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        change((all) => all.filter((f) => f.id !== sel.id));
        setSelected(null);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const copy = { ...sel, id: shortId(), y: Math.min(sel.y + sel.h + 0.01, 1 - sel.h) };
        change((all) => [...all, copy]);
        setSelected(copy.id);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        patch(sel.id, { x: clamp(sel.x + dx, 0, 1 - sel.w), y: clamp(sel.y + dy, 0, 1 - sel.h) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, canEdit, dirty, dialog, save, change, patch]);

  const place = (page: number, e: ReactPointerEvent<HTMLDivElement>) => {
    if (!placing || !canEdit) {
      if (e.target === e.currentTarget) setSelected(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const size = FIELD_SIZES[placing];
    const pages = initial.pages;
    // Sizes are for a Letter page. Keep the same size in points on other page sizes.
    const w = Math.min((size.w * 612) / pages[page]!.w, 1);
    const h = Math.min((size.h * 792) / pages[page]!.h, 1);
    const x = clamp((e.clientX - rect.left) / rect.width - w / 2, 0, 1 - w);
    const y = clamp((e.clientY - rect.top) / rect.height - h / 2, 0, 1 - h);
    const f: Field = {
      id: shortId(),
      roleId: activeRole,
      type: placing,
      page,
      x,
      y,
      w,
      h,
      label: "",
      required: placing !== "checkbox",
      ...(placing === "select" ? { options: ["Yes", "No"] } : {})
    };
    change((all) => [...all, f]);
    setSelected(f.id);
    if (!e.shiftKey) setPlacing(null);
  };

  const addRole = () => {
    if (roles.length >= LIMITS.roles) return;
    const r = { id: shortId(), name: `Signer ${roles.length + 1}` };
    setRoles([...roles, r]);
    setActiveRole(r.id);
    setDirty(true);
  };
  const removeRole = (id: string) => {
    if (roles.length <= 1) return;
    setRoles(roles.filter((r) => r.id !== id));
    change((all) => all.filter((f) => f.roleId !== id));
    if (activeRole === id) setActiveRole(roles.find((r) => r.id !== id)!.id);
    setDirty(true);
  };

  const archive = async (next: boolean) => {
    try {
      await api(`${API}/templates/${initial.id}/archive`, { method: "POST", body: { archived: next } });
      setArchived(next);
      toast(next ? "The template is archived." : "The template is restored.");
    } catch (e) {
      toast(errorText(e));
    }
  };
  const duplicate = async () => {
    try {
      const { id } = await api<{ id: string }>(`${API}/templates/${initial.id}/duplicate`, { method: "POST" });
      toast("The template is copied.");
      navigate(`${ESIGN_HOME}/t/${id}`);
    } catch (e) {
      toast(errorText(e));
    }
  };
  const openSend = async () => {
    if (dirty && !(await save())) return;
    setDialog("send");
  };

  return (
    <>
      <SiteHeader title={name || "Template"}>
        {canEdit && (
          <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => void save()} data-esign-save="">
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
        )}
        <Button size="sm" disabled={archived} onClick={() => void openSend()} data-esign-send="">
          <Icon name="send" /> <span className="hidden sm:inline">Send for signature</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" aria-label="More actions">
              <Icon name="dots" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void duplicate()}>
              <Icon name="copy" /> Make a copy
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                const res = await fetch(`${API}/templates/${initial.id}/file?download=1`, { credentials: "same-origin" });
                if (res.ok) {
                  const { saveBlob } = await import("./bits");
                  await saveBlob(res, initial.fileName);
                }
              }}
            >
              <Icon name="download" /> Download the PDF
            </DropdownMenuItem>
            {initial.canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void archive(!archived)}>
                  <Icon name={archived ? "unarchive" : "archive"} /> {archived ? "Restore" : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                  <Icon name="trash" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SiteHeader>
      <PageBody className="gap-4 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)_16rem] lg:items-start">
        <aside className="grid gap-4 lg:sticky lg:top-[calc(var(--header-height)+1rem)]" data-esign-roles="">
          {archived && <Notice tone="info">This template is archived. Restore it to change it or send it.</Notice>}
          {!initial.canEdit && (
            <Notice tone="info">Only the person who made this template, or a company owner or admin, can change it. You can send it.</Notice>
          )}
          <FormField label="Template name" htmlFor="esign-name">
            <Input
              id="esign-name"
              value={name}
              maxLength={LIMITS.name}
              disabled={!canEdit}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </FormField>
          <div className="grid gap-2">
            <p className="text-sm font-medium">Signers</p>
            <ul className="grid gap-1">
              {roles.map((r, i) => (
                <li
                  key={r.id}
                  className={cn("flex items-center gap-2 rounded-lg border px-2 py-1", activeRole === r.id && "border-ring bg-accent/50")}
                  onClick={() => setActiveRole(r.id)}
                  data-esign-role={r.name}
                >
                  <RoleDot color={roleColor(i)} />
                  <Input
                    value={r.name}
                    aria-label={`Name of signer ${i + 1}`}
                    maxLength={LIMITS.roleName}
                    disabled={!canEdit}
                    className="h-7 border-0 bg-transparent px-1 shadow-none focus-visible:ring-1"
                    onFocus={() => setActiveRole(r.id)}
                    onChange={(e) => {
                      setRoles(roles.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)));
                      setDirty(true);
                    }}
                  />
                  <span className="text-xs text-muted-foreground tabular">{fields.filter((f) => f.roleId === r.id).length}</span>
                  {canEdit && roles.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Remove ${r.name} and its fields`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRole(r.id);
                      }}
                    >
                      <Icon name="x" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && roles.length < LIMITS.roles && (
              <Button size="sm" variant="outline" onClick={addRole} data-esign-add-role="">
                <Icon name="plus" /> Add a signer
              </Button>
            )}
          </div>
          {canEdit && (
            <div className="grid gap-2">
              <p className="text-sm font-medium">Add a field for {roles.find((r) => r.id === activeRole)?.name ?? "the signer"}</p>
              <div className="grid grid-cols-2 gap-1" data-esign-palette="">
                {FIELD_TYPES.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={placing === t ? "default" : "outline"}
                    className="justify-start"
                    onClick={() => setPlacing(placing === t ? null : t)}
                    data-esign-field-type={t}
                  >
                    <Icon name={FIELD_ICONS[t]!} /> {FIELD_LABELS[t]}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="grid min-w-0 gap-3" aria-label="Pages">
          {problem && (
            <Notice tone="error">
              {problem}{" "}
              {conflict && (
                <Button size="sm" variant="outline" className="ml-2" onClick={() => location.reload()}>
                  Load again
                </Button>
              )}
            </Notice>
          )}
          {pdfError && <Notice tone="error">{pdfError}</Notice>}
          {placing && (
            <Notice tone="info">
              Click on a page to place a {FIELD_LABELS[placing].toLowerCase()} field for {roles.find((r) => r.id === activeRole)?.name}. Hold Shift to place
              more than one. Press Escape to stop.
            </Notice>
          )}
          <div className={cn("rounded-xl bg-desk p-3 sm:p-6", placing && "cursor-crosshair")}>
            <PdfPages
              doc={doc}
              pages={initial.pages}
              overlay={(page) => (
                <div className="absolute inset-0" onPointerDown={(e) => place(page, e)} data-esign-overlay={page}>
                  {fields
                    .filter((f) => f.page === page)
                    .map((f) => (
                      <FieldBox
                        key={f.id}
                        field={f}
                        roleName={roles.find((r) => r.id === f.roleId)?.name ?? ""}
                        index={roleIndex.get(f.roleId) ?? 0}
                        selected={f.id === selected}
                        editable={canEdit && !placing}
                        onSelect={() => {
                          setSelected(f.id);
                          setActiveRole(f.roleId);
                        }}
                        onChange={(p) => patch(f.id, p)}
                      />
                    ))}
                </div>
              )}
            />
          </div>
        </section>

        <aside className="grid gap-4 lg:sticky lg:top-[calc(var(--header-height)+1rem)]" data-esign-props="">
          {sel && canEdit ? (
            <FieldProps
              field={sel}
              roles={roles}
              pageCount={initial.pages.length}
              onChange={(p) => patch(sel.id, p)}
              onDelete={() => {
                change((all) => all.filter((f) => f.id !== sel.id));
                setSelected(null);
              }}
            />
          ) : (
            <div className="grid gap-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">How to build it</p>
              <p>1. Name each signer, such as Client and Company.</p>
              <p>2. Choose a signer, then a field type, then click on a page.</p>
              <p>3. Drag a field to move it. Drag its corner to resize it.</p>
              <p>4. Save, then send it for signature.</p>
            </div>
          )}
          {problems.length > 0 && (
            <div className="grid gap-1 rounded-lg border p-3 text-sm" data-esign-problems="">
              <p className="font-medium">Before you send</p>
              {problems.map((p) => (
                <p key={p} className="text-muted-foreground">
                  {p}
                </p>
              ))}
            </div>
          )}
        </aside>
      </PageBody>

      {dialog === "send" && <SendDialog template={{ ...initial, name, roles, fields }} problems={problems} onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <Modal title="Delete this template?" onClose={() => setDialog(null)}>
          <p className="text-sm text-muted-foreground">
            This deletes the template and its PDF. A template that was sent cannot be deleted. Archive it instead.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await api(`${API}/templates/${initial.id}`, { method: "DELETE" });
                  setDirty(false);
                  toast("The template is deleted.");
                  navigate(`${ESIGN_HOME}/templates`);
                } catch (e) {
                  toast(errorText(e));
                  setDialog(null);
                }
              }}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

function FieldBox({
  field: f,
  roleName,
  index,
  selected,
  editable,
  onSelect,
  onChange
}: {
  field: Field;
  roleName: string;
  index: number;
  selected: boolean;
  editable: boolean;
  onSelect: () => void;
  onChange: (p: Partial<Field>) => void;
}) {
  const drag = useRef<{ mode: "move" | "size"; sx: number; sy: number; f: Field; w: number; h: number } | null>(null);

  const start = (mode: "move" | "size") => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    onSelect();
    if (!editable) return;
    const page = (e.currentTarget.closest("[data-esign-overlay]") as HTMLElement | null)?.getBoundingClientRect();
    if (!page) return;
    drag.current = { mode, sx: e.clientX, sy: e.clientY, f, w: page.width, h: page.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.w;
    const dy = (e.clientY - d.sy) / d.h;
    if (d.mode === "move") onChange({ x: clamp(d.f.x + dx, 0, 1 - d.f.w), y: clamp(d.f.y + dy, 0, 1 - d.f.h) });
    else onChange({ w: clamp(d.f.w + dx, LIMITS.minFieldSize, 1 - d.f.x), h: clamp(d.f.h + dy, LIMITS.minFieldSize, 1 - d.f.y) });
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${FIELD_LABELS[f.type]} for ${roleName}${f.label ? `: ${f.label}` : ""}`}
      aria-pressed={selected}
      className={cn(
        "absolute flex touch-none items-center gap-1 overflow-hidden rounded-sm border-2 px-1 text-[11px] leading-none text-foreground select-none",
        editable ? "cursor-move" : "cursor-pointer",
        selected && "ring-2 ring-ring ring-offset-1"
      )}
      style={{
        left: `${f.x * 100}%`,
        top: `${f.y * 100}%`,
        width: `${f.w * 100}%`,
        height: `${f.h * 100}%`,
        borderColor: roleColor(index),
        background: roleFill(index)
      }}
      onPointerDown={start("move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
      data-esign-field={f.type}
    >
      <Icon name={FIELD_ICONS[f.type]!} size={12} className="shrink-0" />
      <span className="truncate">{f.label || FIELD_LABELS[f.type]}</span>
      {selected && editable && (
        <span
          className="absolute right-0 bottom-0 size-3 cursor-se-resize rounded-tl-sm"
          style={{ background: roleColor(index) }}
          onPointerDown={start("size")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-hidden="true"
          data-esign-resize=""
        />
      )}
    </div>
  );
}

function FieldProps({
  field: f,
  roles,
  pageCount,
  onChange,
  onDelete
}: {
  field: Field;
  roles: Role[];
  pageCount: number;
  onChange: (p: Partial<Field>) => void;
  onDelete: () => void;
}) {
  const auto = f.type === "date" || f.type === "email";
  return (
    <div className="grid gap-3" data-esign-field-props={f.type}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon name={FIELD_ICONS[f.type]!} /> {FIELD_LABELS[f.type]}
      </p>
      <FormField label="Signer" htmlFor="esign-f-role">
        <NativeSelect id="esign-f-role" value={f.roleId} onChange={(e) => onChange({ roleId: e.target.value })}>
          {roles.map((r) => (
            <NativeSelectOption key={r.id} value={r.id}>
              {r.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Type" htmlFor="esign-f-type">
        <NativeSelect
          id="esign-f-type"
          value={f.type}
          onChange={(e) => {
            const type = e.target.value as FieldType;
            onChange({
              type,
              required: type !== "checkbox",
              ...(type === "select" ? { options: f.options?.length ? f.options : ["Yes", "No"] } : { options: undefined })
            });
          }}
        >
          {FIELD_TYPES.map((t) => (
            <NativeSelectOption key={t} value={t}>
              {FIELD_LABELS[t]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Label" htmlFor="esign-f-label" help="The signer sees it on the field. Optional.">
        <Input
          id="esign-f-label"
          value={f.label}
          maxLength={LIMITS.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={FIELD_LABELS[f.type]}
        />
      </FormField>
      {f.type === "select" && (
        <FormField label="Choices" htmlFor="esign-f-options" help="One choice on each line.">
          <Textarea
            id="esign-f-options"
            rows={4}
            value={(f.options ?? []).join("\n")}
            onChange={(e) => onChange({ options: e.target.value.split("\n").slice(0, LIMITS.options) })}
          />
        </FormField>
      )}
      {auto ? (
        <p className="text-xs text-muted-foreground">{f.type === "date" ? "eSign fills in the date of signing." : "eSign fills in the signer's email."}</p>
      ) : (
        <label className="flex items-center justify-between gap-3 text-sm">
          Required
          <Switch checked={f.required} onCheckedChange={(v) => onChange({ required: v })} aria-label="Required" />
        </label>
      )}
      {pageCount > 1 && (
        <FormField label="Page" htmlFor="esign-f-page">
          <NativeSelect id="esign-f-page" value={String(f.page)} onChange={(e) => onChange({ page: Number(e.target.value) })}>
            {Array.from({ length: pageCount }, (_, i) => (
              <NativeSelectOption key={i} value={String(i)}>
                Page {i + 1}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      )}
      <ConfirmButton
        label={
          <>
            <Icon name="trash" /> Remove the field
          </>
        }
        confirmLabel="Click again to remove"
        onConfirm={onDelete}
      />
    </div>
  );
}

/** Sends the template: a name and an email for each signer, the order, and a note. */
function SendDialog({ template, problems, onClose }: { template: Template; problems: string[]; onClose: () => void }) {
  const { me } = useShell();
  const toast = useToast();
  const [people, setPeople] = useState<Record<string, { name: string; email: string }>>(() =>
    Object.fromEntries(template.roles.map((r) => [r.id, { name: "", email: "" }]))
  );
  const [ordered, setOrdered] = useState(false);
  const [docName, setDocName] = useState(template.name);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { id } = await api<{ id: string }>(`${API}/templates/${template.id}/send`, {
        method: "POST",
        body: { name: docName, ordered, message, signers: template.roles.map((r) => ({ roleId: r.id, ...people[r.id] })) }
      });
      onClose();
      toast("Sent. Each signer gets an email with a link.");
      navigate(`${ESIGN_HOME}/s/${id}`);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Send for signature" description="Each signer gets an email with their own link. They do not need an account." onClose={onClose} wide>
      {problems.length > 0 ? (
        <>
          <Notice tone="warn">{problems[0]}</Notice>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Back to the template
            </Button>
          </div>
        </>
      ) : (
        <form className="grid gap-4" onSubmit={submit} data-esign-send-form="">
          {problem && <Notice tone="error">{problem}</Notice>}
          <FormField label="Document name" htmlFor="esign-doc-name" help="Signers see this name.">
            <Input id="esign-doc-name" value={docName} maxLength={LIMITS.name} onChange={(e) => setDocName(e.target.value)} />
          </FormField>
          {template.roles.map((r, i) => (
            <fieldset key={r.id} className="grid gap-2 rounded-lg border p-3" data-esign-signer={r.name}>
              <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                <RoleDot color={roleColor(i)} /> {ordered ? `${i + 1}. ` : ""}
                {r.name}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={people[r.id]!.name}
                  onChange={(e) => setPeople({ ...people, [r.id]: { ...people[r.id]!, name: e.target.value } })}
                  placeholder="Full name"
                  aria-label={`${r.name}: full name`}
                  required
                  maxLength={120}
                />
                <Input
                  type="email"
                  value={people[r.id]!.email}
                  onChange={(e) => setPeople({ ...people, [r.id]: { ...people[r.id]!, email: e.target.value } })}
                  placeholder="Email"
                  aria-label={`${r.name}: email`}
                  required
                  maxLength={254}
                />
              </div>
              {me && (
                <button
                  type="button"
                  className="w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setPeople({ ...people, [r.id]: { name: me.name || me.email.split("@")[0]!, email: me.email } })}
                >
                  I am this signer
                </button>
              )}
            </fieldset>
          ))}
          {template.roles.length > 1 && (
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <span className="grid gap-1">
                <span className="font-medium">Sign in order</span>
                <span className="text-muted-foreground">On: the next signer gets the email after the one before signs. Off: everyone gets it now.</span>
              </span>
              <Switch checked={ordered} onCheckedChange={setOrdered} aria-label="Sign in order" />
            </label>
          )}
          <FormField label="Note to the signers" htmlFor="esign-message" help="Optional. It goes in the email.">
            <Textarea id="esign-message" rows={3} maxLength={LIMITS.message} value={message} onChange={(e) => setMessage(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} data-esign-send-submit="">
              <Icon name="send" /> {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
