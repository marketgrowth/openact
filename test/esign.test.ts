import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import {
  CONSENT_TEXT,
  checkFields,
  checkRoles,
  checkSigners,
  checkValues,
  isPngDataUrl,
  sendProblems,
  signedDate,
  signersOpen,
  type Field,
  type Role
} from "../apps/esign/src/shared/types.ts";
import { PdfProblem, buildSignedPdf, inspectPdf, pngBytes, sniffPdf } from "../apps/esign/src/server/pdf.ts";

// A 1 by 1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const roles: Role[] = [
  { id: "client", name: "Client" },
  { id: "company", name: "Company" }
];

const field = (p: Partial<Field>): Field => ({
  id: "f1",
  roleId: "client",
  type: "text",
  page: 0,
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.03,
  label: "",
  required: true,
  ...p
});

test("roles need names that are not empty and not the same", () => {
  assert.deepEqual(checkRoles([{ id: "a", name: " Client " }]), { ok: [{ id: "a", name: "Client" }] });
  assert.match((checkRoles([]) as { problem: string }).problem, /at least one/);
  assert.match((checkRoles([{ id: "a", name: "" }]) as { problem: string }).problem, /needs a name/);
  assert.match(
    (
      checkRoles([
        { id: "a", name: "Client" },
        { id: "b", name: "client" }
      ]) as { problem: string }
    ).problem,
    /Two signer roles/
  );
  assert.match((checkRoles(Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, name: `R${i}` }))) as { problem: string }).problem, /up to 10/);
  assert.match((checkRoles([{ id: "bad id!", name: "X" }]) as { problem: string }).problem, /not valid/);
});

test("fields stay on the page and belong to a role", () => {
  const r = checkFields([field({ x: 0.95, y: -1, w: 0.2 })], roles, 2);
  assert.ok("ok" in r);
  const f = r.ok[0]!;
  assert.equal(f.x, 0.8);
  assert.equal(f.y, 0);
  assert.match((checkFields([field({ roleId: "gone" })], roles, 2) as { problem: string }).problem, /role that is gone/);
  assert.match((checkFields([field({ page: 2 })], roles, 2) as { problem: string }).problem, /not in the PDF/);
  assert.match((checkFields([field({ type: "nope" as never })], roles, 2) as { problem: string }).problem, /type/);
  assert.match((checkFields([field({}), field({})], roles, 2) as { problem: string }).problem, /not valid/);
  assert.match((checkFields([field({ x: Number.NaN })], roles, 2) as { problem: string }).problem, /position/);
});

test("a choice field needs two different choices", () => {
  assert.match((checkFields([field({ type: "select", options: ["Yes", "Yes"] })], roles, 1) as { problem: string }).problem, /two choices/);
  const r = checkFields([field({ type: "select", options: [" Yes ", "No", ""] })], roles, 1);
  assert.ok("ok" in r);
  assert.deepEqual(r.ok[0]!.options, ["Yes", "No"]);
});

test("a checkbox is optional unless it says required, other fields are required unless they say not", () => {
  const r = checkFields([field({ id: "a", type: "checkbox", required: undefined as never }), field({ id: "b", required: undefined as never })], roles, 1);
  assert.ok("ok" in r);
  assert.equal(r.ok[0]!.required, false);
  assert.equal(r.ok[1]!.required, true);
});

test("every role needs a field with a signature or initials before sending", () => {
  assert.deepEqual(sendProblems(roles, []), [
    "Add at least one field before you send.",
    "Client has no fields. Add a field for Client, or remove the role.",
    "Company has no fields. Add a field for Company, or remove the role."
  ]);
  const p = sendProblems(roles, [field({ type: "signature" }), field({ id: "f2", roleId: "company", type: "text" })]);
  assert.deepEqual(p, ["Company has no signature or initials field."]);
  assert.deepEqual(sendProblems(roles, [field({ type: "signature" }), field({ id: "f2", roleId: "company", type: "initials" })]), []);
});

test("signers: one for each role, with a name and a valid email", () => {
  const ok = checkSigners(
    [
      { roleId: "client", name: "Ana", email: "ANA@Example.com " },
      { roleId: "company", name: "Victor", email: "v@example.com" }
    ],
    roles
  );
  assert.ok("ok" in ok);
  assert.equal(ok.ok[0]!.email, "ana@example.com");
  assert.match((checkSigners([{ roleId: "client", name: "Ana", email: "ana@example.com" }], roles) as { problem: string }).problem, /Company/);
  assert.match(
    (
      checkSigners(
        [
          { roleId: "client", name: "Ana", email: "nope" },
          { roleId: "company", name: "V", email: "v@x.co" }
        ],
        roles
      ) as { problem: string }
    ).problem,
    /valid email/
  );
  assert.match(
    (
      checkSigners(
        [
          { roleId: "client", name: " ", email: "a@x.co" },
          { roleId: "company", name: "V", email: "v@x.co" }
        ],
        roles
      ) as { problem: string }
    ).problem,
    /name/
  );
});

test("in order, only the first signer who has not signed can sign; at the same time, everyone can", () => {
  const s = [
    { id: "a", position: 0, status: "completed" as const },
    { id: "b", position: 1, status: "sent" as const },
    { id: "c", position: 2, status: "waiting" as const }
  ];
  assert.deepEqual(
    signersOpen(s, true, "pending").map((x) => x.id),
    ["b"]
  );
  assert.deepEqual(
    signersOpen(s, false, "pending").map((x) => x.id),
    ["b", "c"]
  );
  assert.deepEqual(signersOpen(s, false, "voided"), []);
  assert.deepEqual(signersOpen([...s, { id: "d", position: 3, status: "declined" as const }], false, "pending"), []);
});

test("values: required fields, auto fields and choices", () => {
  const fields: Field[] = [
    field({ id: "sig", type: "signature" }),
    field({ id: "nm", type: "name" }),
    field({ id: "em", type: "email" }),
    field({ id: "dt", type: "date" }),
    field({ id: "tx", type: "text", label: "Company" }),
    field({ id: "cb", type: "checkbox", required: false }),
    field({ id: "sl", type: "select", options: ["A", "B"], required: false })
  ];
  const signer = { name: "Ana Peña", email: "ana@example.com" };
  const at = "2026-11-17T22:44:05.000Z";
  const has = { signature: true, initials: false };
  const r = checkValues(fields, { tx: "Acme", em: "evil@example.com", dt: "01/01/1999", sl: "B" }, signer, at, has);
  assert.ok("ok" in r);
  assert.deepEqual(r.ok, { sig: true, nm: "Ana Peña", em: "ana@example.com", dt: "11/17/2026", tx: "Acme", cb: false, sl: "B" });
  assert.match((checkValues(fields, {}, signer, at, has) as { problem: string }).problem, /Company/);
  assert.match((checkValues(fields, { tx: "x" }, signer, at, { signature: false, initials: false }) as { problem: string }).problem, /signature/);
  assert.match((checkValues(fields, { tx: "x", sl: "C" }, signer, at, has) as { problem: string }).problem, /Choose one/);
  assert.match(
    (checkValues([field({ id: "cb", type: "checkbox", required: true, label: "I agree" })], {}, signer, at, has) as { problem: string }).problem,
    /Check "I agree"/
  );
});

test("the signing date is in UTC", () => {
  assert.equal(signedDate("2026-01-05T23:59:59.000Z"), "01/05/2026");
});

test("signature images must be PNG data URLs", () => {
  assert.equal(isPngDataUrl(PNG), true);
  assert.equal(isPngDataUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(isPngDataUrl(`data:image/png;base64,${"A".repeat(500_000)}`), false);
  assert.ok(pngBytes(PNG));
  // A data URL that says PNG but holds other bytes is refused.
  assert.equal(pngBytes(`data:image/png;base64,${btoa("GIF89a....")}`), null);
});

async function samplePdf(rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const p = doc.addPage([595, 842]);
  if (rotate) p.setRotation(degrees(rotate));
  return doc.save();
}

test("inspectPdf reads page sizes as a viewer shows them, and refuses what is not a PDF", async () => {
  assert.deepEqual(await inspectPdf(await samplePdf(), 300), [
    { w: 612, h: 792 },
    { w: 595, h: 842 }
  ]);
  assert.deepEqual((await inspectPdf(await samplePdf(90), 300))[1], { w: 842, h: 595 });
  await assert.rejects(inspectPdf(new TextEncoder().encode("<html>"), 300), PdfProblem);
  await assert.rejects(inspectPdf(await samplePdf(), 1), /2 pages/);
  await assert.rejects(inspectPdf(new TextEncoder().encode("%PDF-1.7 broken"), 300), /cannot read/);
  assert.equal(sniffPdf(new TextEncoder().encode("%PDF-1.4")), true);
});

test("buildSignedPdf draws the values and adds the signing certificate", async () => {
  const original = await samplePdf(90);
  const now = "2026-11-17T22:44:05.000Z";
  const out = await buildSignedPdf(original, {
    title: "Mutual NDA",
    appName: "OpenAct",
    documentId: "doc-1",
    sender: { name: "Victor", email: "victor@example.com" },
    fileName: "nda.pdf",
    fileHash: "a".repeat(64),
    completedAt: now,
    fields: [
      field({ id: "sig", type: "signature", page: 0 }),
      field({ id: "tx", type: "text", page: 1 }),
      field({ id: "cb", type: "checkbox", page: 0, required: false })
    ],
    signers: [
      {
        roleId: "client",
        roleName: "Client",
        name: "Ana Peña",
        email: "ana@example.com",
        // Characters that a standard PDF font cannot draw become "?", not an error.
        values: { sig: true, tx: "Acme 漢字 Inc.", cb: true },
        signature: pngBytes(PNG),
        initials: null,
        sentAt: now,
        openedAt: now,
        consentedAt: now,
        completedAt: now,
        ip: "203.0.113.9",
        userAgent: "Test browser"
      }
    ],
    events: [{ at: now, kind: "signed", signer: "Ana Peña", ip: "203.0.113.9", detail: "" }]
  });
  assert.ok(sniffPdf(out));
  const doc = await PDFDocument.load(out, { updateMetadata: false });
  // Two original pages and one certificate page.
  assert.equal(doc.getPageCount(), 3);
  assert.equal(doc.getTitle(), "Mutual NDA");
  assert.equal(doc.getProducer(), "OpenAct eSign");
  assert.ok(CONSENT_TEXT.length > 20);
});

test("buildSignedPdf adds more certificate pages for a long audit log", async () => {
  const now = "2026-11-17T22:44:05.000Z";
  const events = Array.from({ length: 120 }, (_, i) => ({ at: now, kind: "reminded" as const, signer: `Signer ${i}`, ip: null, detail: "" }));
  const out = await buildSignedPdf(await samplePdf(), {
    title: "Long",
    appName: "OpenAct",
    documentId: "doc-2",
    sender: null,
    fileName: "long.pdf",
    fileHash: "b".repeat(64),
    completedAt: now,
    fields: [],
    signers: [],
    events
  });
  assert.ok((await PDFDocument.load(out)).getPageCount() >= 4);
});
