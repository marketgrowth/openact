import { PDFDocument, StandardFonts, degrees, type PDFFont, type PDFImage, type PDFPage, type RGB, rgb } from "pdf-lib";
import { CONSENT_TEXT, type EventKind, type Field, type FieldValue, type PageSize } from "../shared/types.ts";

/*
 * PDF work for eSign, with pdf-lib. No Worker bindings here, so the unit tests can run it in Node.
 *
 *   inspectPdf      reads the page sizes of an upload and refuses PDFs that eSign cannot sign
 *   buildSignedPdf  draws every value on the pages, locks the PDF's own form fields,
 *                   and adds the signing certificate pages at the end
 */

export class PdfProblem extends Error {}

/** True when the bytes are a PDF. The browser's type for an upload is not trusted. */
export function sniffPdf(b: Uint8Array): boolean {
  const max = Math.min(b.length - 5, 1024);
  for (let i = 0; i <= max; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return true;
  }
  return false;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    // pdf-lib reads the page tree only when asked. Read it now, so a broken PDF fails here.
    pdf.getPages().forEach((p) => p.getCropBox());
    return pdf;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/encrypt/i.test(msg)) throw new PdfProblem("This PDF has a password or is locked. Remove the lock, then upload it again.");
    throw new PdfProblem("eSign cannot read this PDF. Save it again as a PDF, then upload it again.");
  }
}

const rotation = (page: PDFPage) => (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;

/** The size of a page as a viewer shows it: the crop box, turned by the page rotation. */
function shownSize(page: PDFPage): PageSize {
  const box = page.getCropBox();
  const r = rotation(page);
  return r === 90 || r === 270 ? { w: box.height, h: box.width } : { w: box.width, h: box.height };
}

/** Reads the pages of an uploaded PDF. Throws PdfProblem with a plain message when eSign cannot use it. */
export async function inspectPdf(bytes: Uint8Array, maxPages: number): Promise<PageSize[]> {
  if (!sniffPdf(bytes)) throw new PdfProblem("This file is not a PDF. Choose a PDF file.");
  const pdf = await load(bytes);
  const pages = pdf.getPages();
  if (!pages.length) throw new PdfProblem("This PDF has no pages.");
  if (pages.length > maxPages) throw new PdfProblem(`This PDF has ${pages.length} pages. eSign works with up to ${maxPages} pages.`);
  return pages.map((p) => {
    const s = shownSize(p);
    return { w: Math.round(s.w * 100) / 100, h: Math.round(s.h * 100) / 100 };
  });
}

/** PNG bytes from a data URL, or null when it is not a PNG. */
export function pngBytes(dataUrl: string | null | undefined): Uint8Array | null {
  if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) return null;
  let bin: string;
  try {
    bin = atob(dataUrl.slice(22));
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return magic.every((b, i) => out[i] === b) ? out : null;
}

/**
 * Turns a point on the page as a viewer shows it (from the top-left, in points)
 * into PDF user space (from the bottom-left of the unturned page).
 */
function toUser(page: PDFPage, u: number, v: number): { x: number; y: number } {
  const b = page.getCropBox();
  switch (rotation(page)) {
    case 90:
      return { x: b.x + v, y: b.y + u };
    case 180:
      return { x: b.x + b.width - u, y: b.y + v };
    case 270:
      return { x: b.x + b.width - v, y: b.y + b.height - u };
    default:
      return { x: b.x + u, y: b.y + b.height - v };
  }
}

/** Keeps only the characters that a standard PDF font can draw. Others become "?". */
function drawable(font: PDFFont, s: string): string {
  const set = new Set(font.getCharacterSet());
  return Array.from(s.normalize("NFC"))
    .map((ch) => (set.has(ch.codePointAt(0)!) ? ch : ch === "\n" || ch === "\t" ? " " : "?"))
    .join("");
}

const INK: RGB = rgb(0.05, 0.1, 0.3);
const TEXT: RGB = rgb(0.1, 0.1, 0.12);
const MUTED: RGB = rgb(0.38, 0.38, 0.42);
const RULE: RGB = rgb(0.82, 0.82, 0.85);

/** Draws one line of text inside a box, shrunk to fit. Box in shown points from the top-left. */
function textInBox(page: PDFPage, font: PDFFont, raw: string, box: { u: number; v: number; w: number; h: number }) {
  const s = drawable(font, raw);
  if (!s) return;
  let size = Math.min(box.h * 0.7, 11);
  const pad = Math.min(2, box.w * 0.05);
  while (size > 4 && font.widthOfTextAtSize(s, size) > box.w - pad * 2) size -= 0.25;
  // Cut the text when it still does not fit at the smallest size.
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > box.w - pad * 2) t = t.slice(0, -1);
  const base = box.v + box.h / 2 + size * 0.35;
  const at = toUser(page, box.u + pad, base);
  page.drawText(t, { x: at.x, y: at.y, size, font, color: TEXT, rotate: degrees(rotation(page)) });
}

/** Draws an image inside a box, keeping its shape, centered on the left of the box. */
function imageInBox(page: PDFPage, img: PDFImage, box: { u: number; v: number; w: number; h: number }) {
  const scale = Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const u = box.u;
  const v = box.v + (box.h - h) / 2;
  const at = toUser(page, u, v + h);
  page.drawImage(img, { x: at.x, y: at.y, width: w, height: h, rotate: degrees(rotation(page)) });
}

function checkInBox(page: PDFPage, box: { u: number; v: number; w: number; h: number }) {
  const s = Math.min(box.w, box.h);
  const u = box.u + (box.w - s) / 2;
  const v = box.v + (box.h - s) / 2;
  const pts: Array<[number, number]> = [
    [u + s * 0.15, v + s * 0.55],
    [u + s * 0.4, v + s * 0.8],
    [u + s * 0.85, v + s * 0.2]
  ];
  const thickness = Math.max(1, s * 0.12);
  for (let i = 0; i < pts.length - 1; i++) {
    page.drawLine({ start: toUser(page, ...pts[i]!), end: toUser(page, ...pts[i + 1]!), thickness, color: INK });
  }
}

export interface SignerForPdf {
  roleId: string;
  roleName: string;
  name: string;
  email: string;
  values: Record<string, FieldValue>;
  signature: Uint8Array | null;
  initials: Uint8Array | null;
  sentAt: string | null;
  openedAt: string | null;
  consentedAt: string | null;
  completedAt: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface SignedPdfInput {
  title: string;
  appName: string;
  documentId: string;
  sender: { name: string; email: string } | null;
  fileName: string;
  fileHash: string;
  completedAt: string;
  fields: Field[];
  signers: SignerForPdf[];
  events: Array<{ at: string; kind: EventKind; signer: string | null; ip: string | null; detail: string }>;
}

/** A time for the certificate, in UTC: 2026-11-17 22:44:05 UTC. */
export const utc = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : "-");

const EVENT_TEXT: Record<EventKind, string> = {
  created: "Document created",
  sent: "Invitation sent",
  opened: "Opened the document",
  consented: "Agreed to sign electronically",
  signed: "Signed",
  declined: "Declined to sign",
  reminded: "Reminder sent",
  completed: "Document completed",
  voided: "Document voided"
};

/** Builds the signed PDF: the values on the pages, then the signing certificate. */
export async function buildSignedPdf(original: Uint8Array, input: SignedPdfInput): Promise<Uint8Array> {
  const pdf = await load(original);
  // The PDF's own form fields would stay editable. Lock them into the page first.
  try {
    pdf.getForm().flatten();
  } catch {
    // A broken form is not a reason to stop. The values drawn below are still on the pages.
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const pages = pdf.getPages();
  const byRole = new Map(input.signers.map((s) => [s.roleId, s]));
  const images = new Map<string, PDFImage>();
  const image = async (key: string, bytes: Uint8Array | null) => {
    if (!bytes) return null;
    if (!images.has(key)) images.set(key, await pdf.embedPng(bytes));
    return images.get(key)!;
  };

  for (const f of input.fields) {
    const signer = byRole.get(f.roleId);
    const page = pages[f.page];
    if (!signer || !page) continue;
    const v = signer.values[f.id];
    if (v === undefined || v === false || v === "") continue;
    const size = shownSize(page);
    const box = { u: f.x * size.w, v: f.y * size.h, w: f.w * size.w, h: f.h * size.h };
    if (f.type === "signature" || f.type === "initials") {
      const img = await image(`${f.roleId}:${f.type}`, f.type === "signature" ? signer.signature : signer.initials);
      if (img) imageInBox(page, img, box);
    } else if (f.type === "checkbox") {
      if (v === true) checkInBox(page, box);
    } else if (typeof v === "string") {
      textInBox(page, font, v, box);
    }
  }

  await addCertificate(pdf, input, { font, bold, mono }, image);

  pdf.setTitle(input.title);
  pdf.setProducer(`${input.appName} eSign`);
  pdf.setModificationDate(new Date(input.completedAt));
  return pdf.save({ useObjectStreams: false });
}

type Fonts = { font: PDFFont; bold: PDFFont; mono: PDFFont };

function wrap(font: PDFFont, s: string, size: number, width: number): string[] {
  const words = drawable(font, s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      // A very long word, such as a hash, breaks by character.
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let n = rest.length;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

async function addCertificate(pdf: PDFDocument, input: SignedPdfInput, f: Fonts, image: (key: string, b: Uint8Array | null) => Promise<PDFImage | null>) {
  const W = 612;
  const H = 792;
  const M = 54;
  const width = W - M * 2;
  const first = pdf.getPageCount();
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const need = (h: number) => {
    if (y - h < M + 24) newPage();
  };
  const lines = (s: string, o: { font?: PDFFont; size?: number; color?: RGB; indent?: number; gap?: number } = {}) => {
    const font = o.font ?? f.font;
    const size = o.size ?? 9.5;
    const indent = o.indent ?? 0;
    for (const l of wrap(font, s, size, width - indent)) {
      need(size + 4);
      y -= size + 3;
      page.drawText(l, { x: M + indent, y, size, font, color: o.color ?? TEXT });
    }
    y -= o.gap ?? 0;
  };
  const pair = (label: string, value: string, mono = false) => {
    const size = 9.5;
    const labelW = 120;
    const vl = wrap(mono ? f.mono : f.font, value, mono ? 8.5 : size, width - labelW);
    need((size + 3) * vl.length + 2);
    y -= size + 3;
    page.drawText(drawable(f.font, label), { x: M, y, size, font: f.font, color: MUTED });
    vl.forEach((l, i) => {
      if (i > 0) y -= size + 3;
      page.drawText(l, { x: M + labelW, y, size: mono ? 8.5 : size, font: mono ? f.mono : f.font, color: TEXT });
    });
  };
  const rule = () => {
    need(14);
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: RULE });
    y -= 6;
  };
  const heading = (s: string, size = 12) => {
    need(size + 18);
    y -= 10;
    lines(s, { font: f.bold, size, gap: 2 });
  };

  lines("Signing certificate", { font: f.bold, size: 18, gap: 4 });
  lines(`${input.appName} eSign`, { color: MUTED, gap: 6 });
  rule();
  pair("Document", input.title);
  pair("File", input.fileName);
  pair("Document ID", input.documentId, true);
  pair("Original SHA-256", input.fileHash, true);
  if (input.sender) pair("Sent by", `${input.sender.name} <${input.sender.email}>`);
  pair("Completed", utc(input.completedAt));
  pair("Signers", String(input.signers.length));

  heading("Signers");
  for (const s of input.signers) {
    rule();
    lines(`${s.name} <${s.email}>`, { font: f.bold, size: 10.5 });
    pair("Role", s.roleName);
    pair("Sent", utc(s.sentAt));
    pair("Opened", utc(s.openedAt));
    pair("Agreed to e-sign", utc(s.consentedAt));
    pair("Signed", utc(s.completedAt));
    pair("IP address", s.ip || "-");
    pair("Device", (s.userAgent || "-").slice(0, 180));
    const sig = await image(`${s.roleId}:signature`, s.signature);
    if (sig) {
      const h = 36;
      const w = Math.min((sig.width / sig.height) * h, 200);
      need(h + 12);
      y -= h + 6;
      page.drawText("Signature", { x: M, y: y + h / 2 - 3, size: 9.5, font: f.font, color: MUTED });
      page.drawRectangle({ x: M + 118, y: y - 2, width: w + 4, height: h + 4, borderColor: RULE, borderWidth: 0.6 });
      page.drawImage(sig, { x: M + 120, y, width: w, height: h });
    }
  }

  heading("Agreement");
  lines(`Before signing, each signer agreed to this text: "${CONSENT_TEXT}"`, { gap: 2 });

  heading("Audit log");
  for (const e of input.events) {
    const who = e.signer ? ` (${e.signer})` : "";
    const ip = e.ip ? `, IP ${e.ip}` : "";
    const detail = e.detail ? `: ${e.detail}` : "";
    lines(`${utc(e.at)}  ${EVENT_TEXT[e.kind]}${who}${detail}${ip}`, { size: 8.5 });
  }

  rule();
  lines(
    `This certificate is part of the signed file. ${input.appName} keeps the SHA-256 hash of the signed file. To check a copy, compare its hash with the hash on the document page in ${input.appName}.`,
    { size: 8, color: MUTED }
  );

  // Page numbers on the certificate pages.
  const all = pdf.getPages();
  const total = all.length - first;
  all.slice(first).forEach((p, i) => {
    p.drawText(`Signing certificate, page ${i + 1} of ${total}`, { x: M, y: M - 18, size: 8, font: f.font, color: MUTED });
  });
}
