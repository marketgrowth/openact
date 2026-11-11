import { Avatar, cn } from "@openact/ui";
import { Badge } from "@openact/ui/components/badge";
import { formatPrice } from "../shared/rules";
import { OFFER_KIND_LABELS, REQUEST_STATUS_LABELS, type AdvisorStatus, type Money, type OfferKind, type RequestStatus } from "../shared/types";

/** The advisor's photo, or their initials. */
export function Portrait({ id, name, url, size = 40, className }: { id: string; name: string; url: string | null; size?: number; className?: string }) {
  if (url)
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full border object-cover", className)}
        style={{ width: size, height: size }}
        data-portrait=""
      />
    );
  return <Avatar id={id} name={name} size={size} className={className} />;
}

export function Price({ price, kind, className }: { price: Money; kind: OfferKind; className?: string }) {
  return <span className={cn("tabular font-medium", className)}>{formatPrice(price, kind)}</span>;
}

export function KindBadge({ kind }: { kind: OfferKind }) {
  return <Badge variant="outline">{OFFER_KIND_LABELS[kind]}</Badge>;
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge variant={status === "paid" ? "default" : status === "pending" || status === "accepted" ? "secondary" : "outline"} data-request-status={status}>
      {REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}

const ADVISOR_STATUS_LABELS: Record<AdvisorStatus, string> = {
  draft: "Draft",
  pending: "Waiting for review",
  approved: "Live",
  paused: "Paused",
  declined: "Not approved"
};

export function AdvisorBadge({ status }: { status: AdvisorStatus }) {
  return (
    <Badge variant={status === "approved" ? "default" : status === "pending" ? "secondary" : "outline"} data-advisor-status={status}>
      {ADVISOR_STATUS_LABELS[status]}
    </Badge>
  );
}

/** A small empty state with a line of help. */
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
