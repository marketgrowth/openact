/*
 * eSign types and rules, shared by the Worker and the web app. No server or browser code here.
 *
 * Field positions are fractions of the page (0 to 1) from the top-left corner,
 * so they do not depend on the zoom or the screen. The Worker turns them into PDF points.
 */

export const ESIGN_HOME = "/a/esign";
export const API = "/api/apps/esign";
/** The public signing page. The token is in the hash (#token), so it never reaches a server log. */
export const SIGN_PATH = "/esign/sign";

export const FIELD_TYPES = ["signature", "initials", "name", "email", "date", "text", "checkbox", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_LABELS: Record<FieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  name: "Full name",
  email: "Email",
  date: "Date signed",
  text: "Text",
  checkbox: "Checkbox",
  select: "Choice"
};

/** The default size of a new field, as a fraction of a Letter page. */
export const FIELD_SIZES: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 0.28, h: 0.06 },
  initials: { w: 0.1, h: 0.05 },
  name: { w: 0.28, h: 0.03 },
  email: { w: 0.28, h: 0.03 },
  date: { w: 0.16, h: 0.03 },
  text: { w: 0.28, h: 0.03 },
  checkbox: { w: 0.03, h: 0.023 },
  select: { w: 0.2, h: 0.03 }
};

export const LIMITS = {
  name: 200,
  roles: 10,
  roleName: 40,
  fields: 500,
  label: 80,
  options: 30,
  option: 80,
  text: 1000,
  signers: 10,
  message: 2000,
  pages: 300,
  /** The largest PDF, in bytes. */
  pdfBytes: 25 * 1024 * 1024,
  /** The largest signature or initials image, as a data URL. */
  imageChars: 400_000,
  minFieldSize: 0.008
} as const;

export const PDF_MAX_LABEL = "25 MB";

export const SUBMISSION_STATUSES = ["pending", "completed", "declined", "voided"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SIGNER_STATUSES = ["waiting", "sent", "opened", "completed", "declined"] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];

export const EVENT_KINDS = ["created", "sent", "opened", "consented", "signed", "declined", "reminded", "completed", "voided"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface PageSize {
  /** Width in PDF points, as shown (after page rotation). */
  w: number;
  h: number;
}

export interface Role {
  id: string;
  name: string;
}

export interface Field {
  id: string;
  roleId: string;
  type: FieldType;
  /** The page, from 0. */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  required: boolean;
  /** For "select": the choices. */
  options?: string[];
}

/** A value a signer gives: text for text, name, email, date and select; true or false for a checkbox; true for a signed signature or initials field. */
export type FieldValue = string | boolean;

export interface TemplateSummary {
  id: string;
  name: string;
  fileName: string;
  pageCount: number;
  roles: Role[];
  fieldCount: number;
  sentCount: number;
  fromDocs: boolean;
  createdBy: string | null;
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  fileName: string;
  fileSize: number;
  pages: PageSize[];
  roles: Role[];
  fields: Field[];
  rev: number;
  updatedAt: string;
  canEdit: boolean;
  archived: boolean;
}

export interface SignerSummary {
  id: string;
  name: string;
  email: string;
  roleName: string;
  position: number;
  status: SignerStatus;
  completedAt: string | null;
}

export interface SubmissionSummary {
  id: string;
  name: string;
  status: SubmissionStatus;
  ordered: boolean;
  signers: SignerSummary[];
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AuditEvent {
  kind: EventKind;
  detail: string;
  signer: string | null;
  ip: string | null;
  at: string;
}

export interface Submission extends SubmissionSummary {
  templateId: string | null;
  message: string;
  fileName: string;
  fileHash: string;
  signed: { size: number; hash: string } | null;
  /** True when every signer signed, but the signed PDF is not built yet. */
  finishing: boolean;
  docsPath: string | null;
  events: AuditEvent[];
  canManage: boolean;
  signersDetail: Array<SignerSummary & { sentAt: string | null; openedAt: string | null; declineReason: string | null; remindedAt: string | null }>;
}

export interface EsignHome {
  can: { send: boolean; manage: boolean };
  docs: { on: boolean; canRead: boolean };
  counts: { pending: number; completed: number; templates: number };
}

export interface EsignSettings {
  saveToDocs: boolean;
  docsFolderId: string | null;
}

/** What the public signing page gets. Only this signer's fields have values to fill. */
export interface SignView {
  document: {
    name: string;
    company: string;
    sender: string | null;
    message: string;
    status: SubmissionStatus;
    pages: PageSize[];
  };
  signer: {
    name: string;
    email: string;
    roleName: string;
    status: SignerStatus;
  };
  /** This signer's fields. */
  fields: Field[];
  /** Other signers' fields, to show where they sign. No values. */
  others: Array<Pick<Field, "id" | "page" | "x" | "y" | "w" | "h" | "type"> & { roleName: string }>;
  /** The values this signer gave, after signing. */
  values: Record<string, FieldValue>;
  /** True when this signer can sign now (it is their turn and the document is open). */
  canSign: boolean;
  /** True when it is not this signer's turn yet. */
  waiting: boolean;
  /** True when the signed PDF is ready to download. */
  signedReady: boolean;
}

/** The text a signer agrees to before signing. It goes on the signing certificate. */
export const CONSENT_TEXT =
  "I agree to use electronic records and signatures for this document. My electronic signature has the same effect as my handwritten signature.";

/* Rules */

const ID = /^[A-Za-z0-9_-]{1,40}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Removes control characters and extra spaces. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

/** One line of text: no line breaks. */
export const cleanLine = (v: unknown, max: number) => cleanText(typeof v === "string" ? v.replace(/[\r\n]+/g, " ") : v, max);

export type Checked<T> = { ok: T } | { problem: string };

/** Checks the roles of a template. */
export function checkRoles(raw: unknown): Checked<Role[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { problem: "Add at least one signer role, such as Client." };
  if (raw.length > LIMITS.roles) return { problem: `A template can have up to ${LIMITS.roles} signer roles.` };
  const out: Role[] = [];
  const names = new Set<string>();
  for (const r of raw) {
    if (!isObj(r) || typeof r.id !== "string" || !ID.test(r.id)) return { problem: "A signer role is not valid. Load the page again." };
    const name = cleanLine(r.name, LIMITS.roleName);
    if (!name) return { problem: "Each signer role needs a name, such as Client." };
    if (names.has(name.toLowerCase())) return { problem: `Two signer roles are named "${name}". Give each role its own name.` };
    if (out.some((o) => o.id === r.id)) return { problem: "Two signer roles have the same id. Load the page again." };
    names.add(name.toLowerCase());
    out.push({ id: r.id, name });
  }
  return { ok: out };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const round = (n: number) => Math.round(n * 10000) / 10000;

/** Checks the fields of a template against its roles and pages. Positions are kept on the page. */
export function checkFields(raw: unknown, roles: Role[], pageCount: number): Checked<Field[]> {
  if (!Array.isArray(raw)) return { problem: "Send the fields as a list." };
  if (raw.length > LIMITS.fields) return { problem: `A template can have up to ${LIMITS.fields} fields.` };
  const roleIds = new Set(roles.map((r) => r.id));
  const ids = new Set<string>();
  const out: Field[] = [];
  for (const f of raw) {
    if (!isObj(f) || typeof f.id !== "string" || !ID.test(f.id) || ids.has(f.id)) return { problem: "A field is not valid. Load the page again." };
    if (typeof f.roleId !== "string" || !roleIds.has(f.roleId)) return { problem: "A field belongs to a signer role that is gone. Choose a role for it." };
    if (typeof f.type !== "string" || !(FIELD_TYPES as readonly string[]).includes(f.type)) return { problem: "A field has a type that eSign does not know." };
    const nums = [f.page, f.x, f.y, f.w, f.h];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return { problem: "A field has a position that is not valid." };
    const page = f.page as number;
    if (!Number.isInteger(page) || page < 0 || page >= pageCount) return { problem: "A field is on a page that is not in the PDF." };
    const w = clamp(f.w as number, LIMITS.minFieldSize, 1);
    const h = clamp(f.h as number, LIMITS.minFieldSize, 1);
    const x = clamp(f.x as number, 0, 1 - w);
    const y = clamp(f.y as number, 0, 1 - h);
    const type = f.type as FieldType;
    const field: Field = {
      id: f.id,
      roleId: f.roleId,
      type,
      page,
      x: round(x),
      y: round(y),
      w: round(w),
      h: round(h),
      label: cleanLine(f.label, LIMITS.label),
      required: type === "checkbox" ? f.required === true : f.required !== false
    };
    if (type === "select") {
      const opts = Array.isArray(f.options) ? f.options.map((o) => cleanLine(o, LIMITS.option)).filter(Boolean) : [];
      const unique = [...new Set(opts)];
      if (unique.length < 2) return { problem: "A choice field needs at least two choices." };
      if (unique.length > LIMITS.options) return { problem: `A choice field can have up to ${LIMITS.options} choices.` };
      field.options = unique;
    }
    ids.add(f.id);
    out.push(field);
  }
  return { ok: out };
}

/** Problems that stop a template from being sent, such as a role with no fields. */
export function sendProblems(roles: Role[], fields: Field[]): string[] {
  const problems: string[] = [];
  if (!fields.length) problems.push("Add at least one field before you send.");
  for (const r of roles) {
    const mine = fields.filter((f) => f.roleId === r.id);
    if (!mine.length) problems.push(`${r.name} has no fields. Add a field for ${r.name}, or remove the role.`);
    else if (!mine.some((f) => f.type === "signature" || f.type === "initials")) problems.push(`${r.name} has no signature or initials field.`);
  }
  return problems;
}

/** A date for the "Date signed" field, such as 11/17/2026, in UTC. */
export function signedDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

/**
 * Checks what a signer sent for their fields. Returns the values to store.
 * Name and email fields default to the signer's own. The date field is the signing date.
 */
export function checkValues(
  fields: Field[],
  raw: unknown,
  signer: { name: string; email: string },
  at: string,
  has: { signature: boolean; initials: boolean }
): Checked<Record<string, FieldValue>> {
  const values = isObj(raw) ? raw : {};
  const out: Record<string, FieldValue> = {};
  for (const f of fields) {
    const v = values[f.id];
    const label = f.label || FIELD_LABELS[f.type];
    switch (f.type) {
      case "signature":
      case "initials": {
        const ok = f.type === "signature" ? has.signature : has.initials;
        if (!ok) return { problem: f.type === "signature" ? "Add your signature." : "Add your initials." };
        out[f.id] = true;
        break;
      }
      case "date":
        out[f.id] = signedDate(at);
        break;
      case "email":
        out[f.id] = signer.email;
        break;
      case "name": {
        const s = cleanLine(v, LIMITS.roleName * 3) || signer.name;
        if (!s && f.required) return { problem: `Fill in "${label}".` };
        if (s) out[f.id] = s;
        break;
      }
      case "text": {
        const s = cleanText(v, LIMITS.text);
        if (!s && f.required) return { problem: `Fill in "${label}".` };
        if (s) out[f.id] = s;
        break;
      }
      case "checkbox": {
        if (v !== undefined && typeof v !== "boolean") return { problem: `"${label}" must be checked or not checked.` };
        if (f.required && v !== true) return { problem: `Check "${label}".` };
        out[f.id] = v === true;
        break;
      }
      case "select": {
        if (v === undefined || v === "" || v === null) {
          if (f.required) return { problem: `Choose an answer for "${label}".` };
          break;
        }
        if (typeof v !== "string" || !(f.options ?? []).includes(v)) return { problem: `Choose one of the answers for "${label}".` };
        out[f.id] = v;
        break;
      }
    }
  }
  return { ok: out };
}

/** True when a string is a PNG data URL of an allowed size. The Worker also checks the PNG bytes. */
export function isPngDataUrl(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("data:image/png;base64,") && v.length <= LIMITS.imageChars && /^[A-Za-z0-9+/=]+$/.test(v.slice(22));
}

export interface SignerInput {
  roleId: string;
  name: string;
  email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks the signers for a send: one per role, each with a name and an email. */
export function checkSigners(raw: unknown, roles: Role[]): Checked<SignerInput[]> {
  if (!Array.isArray(raw)) return { problem: "Add a signer for each role." };
  const out: SignerInput[] = [];
  for (const role of roles) {
    const s = raw.find((x) => isObj(x) && x.roleId === role.id) as Record<string, unknown> | undefined;
    if (!s) return { problem: `Add a signer for ${role.name}.` };
    const email = cleanLine(s.email, 254).toLowerCase();
    if (!EMAIL.test(email)) return { problem: `Type a valid email for ${role.name}.` };
    const name = cleanLine(s.name, 120);
    if (!name) return { problem: `Type a name for ${role.name}.` };
    out.push({ roleId: role.id, name, email });
  }
  return { ok: out };
}

/**
 * Which signers can sign now. In order: the first signer who has not signed.
 * At the same time: everyone who has not signed. Nobody when the document is closed.
 */
export function signersOpen<T extends { position: number; status: SignerStatus }>(signers: T[], ordered: boolean, status: SubmissionStatus): T[] {
  if (status !== "pending") return [];
  const left = signers.filter((s) => s.status !== "completed").sort((a, b) => a.position - b.position);
  if (left.some((s) => s.status === "declined")) return [];
  return ordered ? left.slice(0, 1) : left;
}

/** A short random id for a role or a field, made in the browser. */
export function shortId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  pending: "Waiting for signatures",
  completed: "Completed",
  declined: "Declined",
  voided: "Voided"
};

export const SIGNER_LABELS: Record<SignerStatus, string> = {
  waiting: "Not sent yet",
  sent: "Sent",
  opened: "Opened",
  completed: "Signed",
  declined: "Declined"
};

/** A file size for people: 820 KB, 4.2 MB. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
