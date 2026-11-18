import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFileName, fmtBytes, sniffImage, sniffPdf, titleFromFileName, PDF_MAX_BYTES } from "../apps/docs/src/shared/types.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

test("a PDF is known by its header, not by its name or type", () => {
  assert.equal(sniffPdf(bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj")), true);
  // Some writers put a few bytes before the header. Readers allow that in the first 1024 bytes.
  assert.equal(sniffPdf(bytes(`${" ".repeat(10)}%PDF-1.4`)), true);
  assert.equal(sniffPdf(bytes(`${"x".repeat(1100)}%PDF-1.4`)), false);
  assert.equal(sniffPdf(bytes("<html><script>alert(1)</script>")), false);
  assert.equal(sniffPdf(bytes("%PDF")), false);
  assert.equal(sniffPdf(new Uint8Array()), false);
  // A PDF is never taken for an image.
  assert.equal(sniffImage(bytes("%PDF-1.7")), null);
});

test("file names lose folders and unsafe characters and always end in .pdf", () => {
  assert.equal(cleanFileName("Q3 report.pdf"), "Q3 report.pdf");
  assert.equal(cleanFileName("C:\\Users\\me\\Desktop\\plan.PDF"), "plan.PDF");
  assert.equal(cleanFileName("../../etc/passwd"), "passwd.pdf");
  assert.equal(cleanFileName('a"b<c>\n.pdf'), "a b c .pdf");
  assert.equal(cleanFileName(""), "document.pdf");
  assert.equal(cleanFileName(undefined), "document.pdf");
  const long = cleanFileName(`${"x".repeat(500)}.pdf`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith(".pdf"));
});

test("a title comes from the file name", () => {
  assert.equal(titleFromFileName("Program_Plan_2026.pdf"), "Program Plan 2026");
  assert.equal(titleFromFileName("Policy.PDF"), "Policy");
  assert.equal(titleFromFileName(".pdf"), "Untitled PDF");
});

test("sizes read well", () => {
  assert.equal(fmtBytes(512), "512 bytes");
  assert.equal(fmtBytes(820 * 1024), "820 KB");
  assert.equal(fmtBytes(PDF_MAX_BYTES), "25.0 MB");
});
