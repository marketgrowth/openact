import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { CHUNK_BYTES, MSG_AWARENESS, MSG_SYNC, caretColor, fromChunks, messageKind, readVarUint, toChunks } from "../apps/docs/src/shared/collab.ts";
import { docSchema } from "../apps/docs/src/shared/schema.ts";
import { sanitizeDoc } from "../apps/docs/src/shared/content.ts";

const msg = (write: (e: encoding.Encoder) => void) => {
  const e = encoding.createEncoder();
  write(e);
  return encoding.toUint8Array(e);
};

test("the room tells reads from writes", () => {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, "hi");
  const step1 = msg((e) => (encoding.writeVarUint(e, MSG_SYNC), syncProtocol.writeSyncStep1(e, doc)));
  const step2 = msg((e) => (encoding.writeVarUint(e, MSG_SYNC), syncProtocol.writeSyncStep2(e, doc)));
  const update = msg((e) => (encoding.writeVarUint(e, MSG_SYNC), syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc))));
  const aw = new awarenessProtocol.Awareness(doc);
  const awareness = msg((e) => (encoding.writeVarUint(e, MSG_AWARENESS), encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(aw, [doc.clientID]))));
  assert.equal(messageKind(step1), "read");
  assert.equal(messageKind(step2), "write");
  assert.equal(messageKind(update), "write");
  assert.equal(messageKind(awareness), "awareness");
  assert.equal(messageKind(new Uint8Array([])), "bad");
  assert.equal(messageKind(new Uint8Array([7, 0])), "bad");
  assert.equal(messageKind(new Uint8Array([0, 9])), "bad");
  assert.equal(messageKind(new Uint8Array([0x80])), "bad");
  // Awareness keeps a timer. Stop it, so the test run can end.
  aw.destroy();
});

test("varuints read like lib0 writes them", () => {
  for (const n of [0, 1, 127, 128, 300, 16384, 2 ** 28]) {
    const buf = msg((e) => encoding.writeVarUint(e, n));
    assert.deepEqual(readVarUint(buf), { value: n, next: buf.length });
  }
});

test("saved state splits into parts and joins back", () => {
  const data = new Uint8Array(CHUNK_BYTES * 2 + 10).map((_, i) => i % 251);
  const parts = toChunks(data);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.length <= CHUNK_BYTES));
  assert.deepEqual(fromChunks(parts), data);
  assert.deepEqual(fromChunks(toChunks(new Uint8Array(0))), new Uint8Array(0));
});

test("a doc goes into a shared doc and comes back the same", () => {
  const json = sanitizeDoc({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ship ", marks: [{ type: "bold" }] },
          { type: "text", text: "Monday", marks: [{ type: "comment", attrs: { threadId: "0b6d3c1e-4f2a-4d8e-9a1b-2c3d4e5f6a7b" } }] }
        ]
      },
      { type: "pageBreak" },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }] }] }
    ]
  });
  const doc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(docSchema(), json, doc.getXmlFragment("default"));
  // A second doc that syncs from the first gets the same content.
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  const back = sanitizeDoc(yXmlFragmentToProsemirrorJSON(other.getXmlFragment("default")));
  assert.deepEqual(back, json);
});

test("cursor colors are theme tokens and stable", () => {
  assert.match(caretColor("user-1"), /^var\(--pc-[a-z]+\)$/);
  assert.equal(caretColor("user-1"), caretColor("user-1"));
});
