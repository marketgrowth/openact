import type { ReactNode } from "react";
import { Icon, cn } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { SIGNER_LABELS, STATUS_LABELS, type SignerStatus, type SubmissionStatus } from "../shared/types";

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  return (
    <Badge variant={status === "completed" ? "default" : status === "pending" ? "secondary" : "outline"} data-esign-status={status}>
      {status === "completed" && <Icon name="circle-check" />}
      {status === "voided" && <Icon name="ban" />}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function SignerBadge({ status }: { status: SignerStatus }) {
  return (
    <Badge variant={status === "completed" ? "default" : status === "declined" ? "outline" : "secondary"} data-signer-status={status}>
      {SIGNER_LABELS[status]}
    </Badge>
  );
}

/** A small empty state with a line of help. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center" data-empty="">
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A colored dot for a signer role. */
export function RoleDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} aria-hidden="true" />;
}

/** The icon for each field type. */
export const FIELD_ICONS: Record<string, string> = {
  signature: "signature",
  initials: "pencil",
  name: "user",
  email: "at",
  date: "calendar-check",
  text: "type",
  checkbox: "square-check",
  select: "chevron"
};

/** Reads an error message from a fetch response that failed. */
export async function responseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error || `The request failed (${res.status}).`;
}

/** Saves a response body as a file. */
export async function saveBlob(res: Response, fallbackName: string): Promise<void> {
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const name = m ? decodeURIComponent(m[1]!) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
