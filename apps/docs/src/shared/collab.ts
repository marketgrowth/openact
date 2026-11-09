/*
 * Small rules for live editing that the collaboration room and tests share.
 * Messages follow the y-websocket protocol: a varuint message type, then the payload.
 * Pure, with no imports, so tests can load it directly.
 */

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
/** Sync message types from y-protocols/sync. */
export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

/** Reads a varuint at `at`. Returns the value and the next position, or null when the bytes end early. */
export function readVarUint(buf: Uint8Array, at = 0): { value: number; next: number } | null {
  let value = 0;
  let mult = 1;
  for (let i = at; i < buf.length && i < at + 5; i++) {
    const b = buf[i]!;
    value += (b & 0x7f) * mult;
    if (b < 0x80) return { value, next: i + 1 };
    mult *= 128;
  }
  return null;
}

/**
 * What a message from a browser asks for: "read" (sync step 1, or awareness such as a cursor) or "write"
 * (sync step 2 or an update, which change the doc). Unknown or broken messages are "bad".
 * The room drops "write" messages from people who can only read.
 */
export function messageKind(buf: Uint8Array): "read" | "write" | "awareness" | "bad" {
  const type = readVarUint(buf, 0);
  if (!type) return "bad";
  if (type.value === MSG_AWARENESS) return "awareness";
  if (type.value !== MSG_SYNC) return "bad";
  const sub = readVarUint(buf, type.next);
  if (!sub) return "bad";
  if (sub.value === SYNC_STEP1) return "read";
  if (sub.value === SYNC_STEP2 || sub.value === SYNC_UPDATE) return "write";
  return "bad";
}

/** Durable Object storage keeps values under 2 MB. The room saves the shared doc in parts of this size. */
export const CHUNK_BYTES = 512 * 1024;

export function toChunks(data: Uint8Array, size = CHUNK_BYTES): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
  return out.length ? out : [new Uint8Array(0)];
}

export function fromChunks(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A color for a person's cursor, from their id, as a theme token. The same person always gets the same color. */
const CARET_COLORS = ["var(--pc-indigo)", "var(--pc-teal)", "var(--pc-amber)", "var(--pc-rose)", "var(--pc-violet)", "var(--pc-slate)"];
export function caretColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CARET_COLORS[h % CARET_COLORS.length]!;
}
