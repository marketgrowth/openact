import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon, Logo, Notice, ThemeSwitch, cn, useShell } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Textarea } from "@openact/ui/components/textarea";
import { API, CONSENT_TEXT, FIELD_LABELS, signedDate, type Field, type FieldValue, type SignView } from "../shared/types";
import { FIELD_ICONS, responseError, saveBlob } from "./bits";
import { PdfPages, usePdf } from "./pdf-view";
import { SignatureDialog } from "./signature";

/*
 * The public signing page at /esign/sign#<token>. A signer needs no account.
 * The token stays in the address hash, so the browser never sends it in a URL.
 * It goes to the API in the X-Esign-Token header.
 */

const tokenFromHash = () => (typeof location === "undefined" ? "" : decodeURIComponent(location.hash.slice(1)));

async function call<T>(path: string, token: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Esign-Token": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error("The server cannot be reached. Check your connection.");
  }
  if (!res.ok) throw new Error(await responseError(res));
  return (await res.json()) as T;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 4);
}

export function SignPage() {
  const { config } = useShell();
  const [token] = useState(tokenFromHash);
  const [view, setView] = useState<SignView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return setError("This signing link is not complete. Open the link from the email again.");
    try {
      setView(await call<SignView>("/public/view", token, {}));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This signing link does not work.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.title = view ? `Sign: ${view.document.name}` : "Sign a document";
  }, [view]);

  return (
    <div className="flex min-h-dvh flex-col bg-desk" data-esign-sign-page="">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <Logo size={24} src={config.logoUrl} />
        <div className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{view?.document.name ?? "Sign a document"}</span>
          {view && (
            <span className="truncate text-xs text-muted-foreground">
              {view.document.sender ? `From ${view.document.sender}` : "From"}
              {view.document.company ? ` at ${view.document.company}` : ""}
            </span>
          )}
        </div>
        <ThemeSwitch className="hidden sm:flex" />
      </header>
      {error && (
        <div className="mx-auto w-full max-w-xl p-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {!error && !view && <p className="p-6 text-center text-sm text-muted-foreground">Loading the document…</p>}
      {view && <Signing key={view.signer.status} token={token} view={view} onChanged={load} />}
    </div>
  );
}

function Signing({ token, view, onChanged }: { token: string; view: SignView; onChanged: () => Promise<void> }) {
  const headers = useMemo(() => ({ "X-Esign-Token": token }), [token]);
  const closed = view.document.status === "voided";
  const { doc, error: pdfError } = usePdf(closed ? null : `${API}/public/file`, headers);
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const v: Record<string, FieldValue> = { ...view.values };
    for (const f of view.fields) if (f.type === "name" && v[f.id] === undefined) v[f.id] = view.signer.name;
    return v;
  });
  const [signature, setSignature] = useState<string | null>(null);
  const [initials, setInitials] = useState<string | null>(null);
  const [pad, setPad] = useState<null | "signature" | "initials">(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<null | "signed" | "declined">(null);
  const today = signedDate(new Date().toISOString());

  const filled = (f: Field): boolean => {
    if (f.type === "signature") return !!signature;
    if (f.type === "initials") return !!initials;
    if (f.type === "date" || f.type === "email") return true;
    const v = values[f.id];
    if (f.type === "checkbox") return v === true;
    return typeof v === "string" && v.trim() !== "";
  };
  const required = view.fields.filter((f) => f.required || f.type === "signature" || f.type === "initials");
  const left = required.filter((f) => !filled(f));

  // While the signed PDF is being made, check again every few seconds.
  useEffect(() => {
    if (view.signedReady || view.document.status !== "pending" || view.signer.status !== "completed") return;
    const t = setInterval(() => void onChanged(), 5000);
    const stop = setTimeout(() => clearInterval(t), 120_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [view, onChanged]);

  const next = () => {
    const f = left[0];
    if (!f) return;
    document.querySelector(`[data-esign-input="${f.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    (document.querySelector(`[data-esign-input="${f.id}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  };

  const sign = async () => {
    setProblem(null);
    if (left.length) {
      setProblem(`Fill in ${left.length === 1 ? "1 more field" : `${left.length} more fields`}. Use Next field to find them.`);
      return next();
    }
    if (!consent) return setProblem("Check the box to agree to sign electronically.");
    setBusy(true);
    try {
      await call("/public/sign", token, { consent: true, values, signature, initials });
      setDone("signed");
      await onChanged();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The signature could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await call("/public/decline", token, { reason });
      setDone("declined");
      setDeclining(false);
      await onChanged();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The answer could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const downloadSigned = async () => {
    const res = await fetch(`${API}/public/signed`, { headers });
    if (!res.ok) return setProblem(await responseError(res));
    await saveBlob(res, `${view.document.name} (signed).pdf`);
  };

  const status = view.signer.status;
  const message =
    view.document.status === "voided"
      ? "The sender canceled this document. You do not need to sign it."
      : status === "declined" || done === "declined"
        ? "You declined to sign this document. The sender knows."
        : view.document.status === "declined"
          ? "Another signer declined, so this document is closed."
          : status === "completed"
            ? view.signedReady
              ? "Everyone signed. Download the signed PDF below. It has a signing certificate at the end."
              : "You signed. You get an email with the signed PDF when everyone has signed."
            : view.waiting
              ? "It is not your turn to sign yet. You get an email when it is."
              : null;

  return (
    <>
      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-4 p-3 pb-40 sm:p-6 sm:pb-40">
        {message && (
          <div className="grid gap-3 rounded-xl border bg-background p-4" data-esign-sign-status={status}>
            <p className="flex items-center gap-2 font-medium">
              <Icon name={status === "completed" ? "circle-check" : "file-pen"} /> {message}
            </p>
            {view.signedReady && (
              <Button className="w-fit" onClick={() => void downloadSigned()} data-esign-sign-download="">
                <Icon name="download" /> Download the signed PDF
              </Button>
            )}
          </div>
        )}
        {view.canSign && view.document.message && (
          <div className="rounded-xl border bg-background p-4 text-sm">
            <p className="font-medium">A note from {view.document.sender ?? "the sender"}</p>
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{view.document.message}</p>
          </div>
        )}
        {pdfError && <Notice tone="error">{pdfError}</Notice>}
        {!closed && (
          <PdfPages
            doc={doc}
            pages={view.document.pages}
            maxWidth={900}
            overlay={(page) => (
              <div className="absolute inset-0" style={{ containerType: "size" }}>
                {view.others
                  .filter((f) => f.page === page)
                  .map((f) => (
                    <div
                      key={f.id}
                      className="absolute flex items-center overflow-hidden rounded-sm border border-dashed border-paper-border px-1 text-[10px] text-paper-muted"
                      style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                      aria-hidden="true"
                    >
                      <span className="truncate">{f.roleName}</span>
                    </div>
                  ))}
                {view.canSign &&
                  done !== "signed" &&
                  view.fields
                    .filter((f) => f.page === page)
                    .map((f) => (
                      <SignField
                        key={f.id}
                        field={f}
                        active
                        value={values[f.id]}
                        email={view.signer.email}
                        today={today}
                        image={f.type === "signature" ? signature : f.type === "initials" ? initials : null}
                        done={filled(f)}
                        onValue={(v) => setValues((all) => ({ ...all, [f.id]: v }))}
                        onPad={() => setPad(f.type === "initials" ? "initials" : "signature")}
                      />
                    ))}
              </div>
            )}
          />
        )}
      </main>

      {view.canSign && done !== "signed" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur" data-esign-sign-bar="">
          <div className="mx-auto grid w-full max-w-5xl gap-3 p-3 sm:p-4">
            {problem && <Notice tone="error">{problem}</Notice>}
            {declining ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium">Decline to sign</p>
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="Tell the sender why (optional)"
                  aria-label="Reason"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDeclining(false)}>
                    Back
                  </Button>
                  <Button variant="destructive" disabled={busy} onClick={() => void decline()} data-esign-decline-confirm="">
                    Decline to sign
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={consent}
                    onCheckedChange={(v) => setConsent(v === true)}
                    className="mt-0.5"
                    aria-label="I agree to sign electronically"
                    data-esign-consent=""
                  />
                  <span>{CONSENT_TEXT}</span>
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground tabular" data-esign-left={left.length}>
                      {left.length ? `${required.length - left.length} of ${required.length} required fields done` : "All required fields are done"}
                    </span>
                    {left.length > 0 && (
                      <Button size="sm" variant="outline" onClick={next}>
                        Next field
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setDeclining(true)}>
                      Decline
                    </Button>
                    <Button disabled={busy} onClick={() => void sign()} data-esign-finish="">
                      <Icon name="signature" /> {busy ? "Signing…" : "Finish and sign"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {pad && (
        <SignatureDialog
          kind={pad}
          defaultText={pad === "signature" ? view.signer.name : initialsOf(view.signer.name)}
          onClose={() => setPad(null)}
          onDone={(png) => {
            if (pad === "signature") setSignature(png);
            else setInitials(png);
            setPad(null);
          }}
        />
      )}
    </>
  );
}

function SignField({
  field: f,
  active,
  value,
  email,
  today,
  image,
  done,
  onValue,
  onPad
}: {
  field: Field;
  active: boolean;
  value: FieldValue | undefined;
  email: string;
  today: string;
  image: string | null;
  done: boolean;
  onValue: (v: FieldValue) => void;
  onPad: () => void;
}) {
  const label = f.label || FIELD_LABELS[f.type];
  const needed = (f.required || f.type === "signature" || f.type === "initials") && !done;
  const box = cn(
    "absolute flex items-center overflow-hidden rounded-sm text-paper-foreground",
    active && needed ? "bg-warn/70 ring-2 ring-warn-border" : active ? "bg-paper/60 ring-1 ring-paper-border" : ""
  );
  const style = {
    left: `${f.x * 100}%`,
    top: `${f.y * 100}%`,
    width: `${f.w * 100}%`,
    height: `${f.h * 100}%`,
    fontSize: `min(${(f.h * 62).toFixed(2)}cqh, 16px)`
  };
  const common = { "data-esign-input": f.id, title: label, "aria-label": label } as const;

  if (f.type === "signature" || f.type === "initials") {
    return (
      <button type="button" className={cn(box, "justify-start")} style={style} disabled={!active} onClick={onPad} {...common}>
        {image ? (
          <img src={image} alt="" className="h-full max-w-full object-contain object-left" />
        ) : active ? (
          <span className="flex items-center gap-1 px-1 font-medium">
            <Icon name={FIELD_ICONS[f.type]!} size={14} /> {f.type === "signature" ? "Sign here" : "Initials"}
          </span>
        ) : null}
      </button>
    );
  }
  if (f.type === "date" || f.type === "email") {
    return (
      <div className={cn(box, "px-1")} style={style} {...common} tabIndex={-1}>
        <span className="truncate">{f.type === "date" ? (typeof value === "string" ? value : today) : email}</span>
      </div>
    );
  }
  if (f.type === "checkbox") {
    return (
      <label className={cn(box, "justify-center")} style={style}>
        <input
          type="checkbox"
          className="size-[80%] max-h-full accent-primary"
          checked={value === true}
          disabled={!active}
          onChange={(e) => onValue(e.target.checked)}
          {...common}
        />
      </label>
    );
  }
  if (f.type === "select") {
    return (
      <select
        className={cn(box, "appearance-auto border-0 px-0.5")}
        style={style}
        value={typeof value === "string" ? value : ""}
        disabled={!active}
        onChange={(e) => onValue(e.target.value)}
        {...common}
      >
        <option value="">{label}</option>
        {(f.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className={cn(box, "border-0 px-1 outline-none placeholder:text-paper-muted focus:ring-2 focus:ring-ring")}
      style={style}
      value={typeof value === "string" ? value : ""}
      placeholder={label}
      disabled={!active}
      maxLength={f.type === "name" ? 120 : 1000}
      onChange={(e) => onValue(e.target.value)}
      {...common}
    />
  );
}
