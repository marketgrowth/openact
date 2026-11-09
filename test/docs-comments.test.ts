import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMENT_MAX, cleanBody, cleanMentions, cleanQuote, isThreadId } from "../apps/docs/src/shared/comments.ts";
import { renderHtml, sanitizeDoc } from "../apps/docs/src/shared/content.ts";

const T1 = "0b6d3c1e-4f2a-4d8e-9a1b-2c3d4e5f6a7b";
const T2 = "1c7e4d2f-5a3b-4e9f-8b2c-3d4e5f6a7b8c";

test("comment bodies are plain text with a length limit", () => {
  assert.deepEqual(cleanBody("  Looks good.\r\n\r\n\r\n\r\nShip it. \u0007"), { body: "Looks good.\n\nShip it." });
  assert.deepEqual(cleanBody("   "), { problem: "Type a comment." });
  assert.deepEqual(cleanBody(42), { problem: "Type a comment." });
  assert.ok("problem" in cleanBody("x".repeat(COMMENT_MAX + 1)));
});

test("quotes are one short line", () => {
  assert.equal(cleanQuote("  The   launch\nis Monday "), "The launch is Monday");
  assert.equal(cleanQuote(""), null);
  assert.equal(cleanQuote(null), null);
  assert.equal(cleanQuote("x".repeat(900))!.length, 500);
});

test("mentions keep only ids, without repeats", () => {
  assert.deepEqual(cleanMentions([T1, T1, "bob", 7, T2]), [T1, T2]);
  assert.deepEqual(cleanMentions("x"), []);
  assert.equal(isThreadId(T1), true);
  assert.equal(isThreadId("abc"), false);
});

test("comment marks stay in the doc, one for each thread", () => {
  const doc = sanitizeDoc({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Ship on Monday",
            marks: [
              { type: "comment", attrs: { threadId: T1 } },
              { type: "comment", attrs: { threadId: T2 } },
              { type: "comment", attrs: { threadId: T1 } },
              { type: "comment", attrs: { threadId: "<script>" } },
              { type: "bold" },
              { type: "bold" }
            ]
          }
        ]
      }
    ]
  });
  assert.deepEqual(doc.content![0]!.content![0]!.marks, [
    { type: "comment", attrs: { threadId: T1 } },
    { type: "comment", attrs: { threadId: T2 } },
    { type: "bold" }
  ]);
});

test("share and print pages never show comments", () => {
  const doc = sanitizeDoc({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Private note", marks: [{ type: "comment", attrs: { threadId: T1 } }] }] }]
  });
  const html = renderHtml(doc).blocks.join("");
  assert.equal(html, "<p>Private note</p>");
});
