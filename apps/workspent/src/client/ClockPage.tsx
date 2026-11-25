import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Logo } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { cn } from "@openact/ui/lib/utils";
import {
  API,
  DEVICE_HEADER,
  DEVICE_HEARTBEAT_MS,
  DEVICE_STORAGE,
  HOME,
  PIN_MAX,
  PIN_MIN,
  PUNCH_DONE,
  PUNCH_KINDS,
  PUNCH_LABELS,
  QUEUE_STORAGE,
  type DeviceHello,
  type PinAnswer,
  type PunchKind
} from "../shared/rules";

/*
 * The time clock device: a PIN pad for one location. It works without sign-in.
 * It keeps its device key in this browser. The server keeps only a hash of the key.
 * When the connection drops, it saves clock-ins on the device and sends them when the connection is back.
 * The server then checks each PIN and marks the clock-in as sent late.
 */

type Queued = { id: string; pin: string; kind: PunchKind; at: string };

class DeviceError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // Storage is off. The queue then lasts for this page only.
  }
};

function readQueue(): Queued[] {
  try {
    const v = JSON.parse(read(QUEUE_STORAGE) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function call<T>(key: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/device${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { [DEVICE_HEADER]: key, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit"
    });
  } catch {
    throw new DeviceError(0, "No connection.");
  }
  const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!res.ok) throw new DeviceError(res.status, data?.error ?? `The request failed (${res.status}).`, data?.code);
  return data as T;
}

type Screen =
  | { kind: "pad" }
  | { kind: "person"; answer: PinAnswer; pin: string }
  | { kind: "offline"; pin: string }
  | { kind: "done"; text: string; sub?: string };

export default function ClockPage() {
  const [key] = useState(() => read(DEVICE_STORAGE));
  const [hello, setHello] = useState<DeviceHello | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [screen, setScreen] = useState<Screen>({ kind: "pad" });
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Queued[]>(readQueue);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const syncing = useRef(false);

  const saveQueue = (q: Queued[]) => {
    setQueue(q);
    write(QUEUE_STORAGE, q.length ? JSON.stringify(q) : null);
  };

  const sync = useCallback(async () => {
    if (!key || syncing.current) return;
    const q = readQueue();
    if (!q.length) return;
    syncing.current = true;
    try {
      const r = await call<{ saved: string[]; rejected: Array<{ id: string; problem: string }> }>(key, "/sync", { punches: q });
      const gone = new Set([...r.saved, ...r.rejected.map((x) => x.id)]);
      saveQueue(readQueue().filter((x) => !gone.has(x.id)));
      if (r.rejected.length)
        setMessage(`${r.rejected.length} saved clock-in${r.rejected.length === 1 ? " was" : "s were"} not accepted. ${r.rejected[0]!.problem}`);
      setOnline(true);
    } catch (e) {
      if (e instanceof DeviceError && e.status === 0) setOnline(false);
    } finally {
      syncing.current = false;
    }
  }, [key]);

  const sayHello = useCallback(async () => {
    if (!key) return;
    const sent = Date.now();
    try {
      const h = await call<DeviceHello>(key, "");
      const back = Date.now();
      // The server time, corrected for half the round trip.
      setOffset(Date.parse(h.serverTime) - (sent + back) / 2);
      setHello(h);
      setLockedUntil(h.lockedUntil ? Date.parse(h.lockedUntil) : null);
      setOnline(true);
      setFatal(null);
      sync();
    } catch (e) {
      if (e instanceof DeviceError && e.status === 0) setOnline(false);
      else if (e instanceof DeviceError && (e.status === 401 || e.status === 403)) setFatal(e.message);
    }
  }, [key, sync]);

  useEffect(() => {
    sayHello();
    const t = setInterval(sayHello, DEVICE_HEARTBEAT_MS);
    const back = () => sayHello();
    window.addEventListener("online", back);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", back);
    };
  }, [sayHello]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Back to the PIN pad after a few seconds on the done screen, and after 30 idle seconds on the person screen.
  useEffect(() => {
    if (screen.kind === "pad") return;
    const t = setTimeout(reset, screen.kind === "done" ? 5000 : 30_000);
    return () => clearTimeout(t);
  }, [screen]);

  function reset() {
    setScreen({ kind: "pad" });
    setPin("");
  }

  const serverNow = now + offset;
  const tz = hello?.location.timeZone;
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(serverNow));
  const dateLine = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" }).format(new Date(serverNow));
  const locked = lockedUntil && lockedUntil > serverNow ? lockedUntil : null;

  async function submitPin() {
    if (!key || pin.length < PIN_MIN || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const answer = await call<PinAnswer>(key, "/pin", { pin });
      setScreen({ kind: "person", answer, pin });
      setOnline(true);
    } catch (e) {
      if (e instanceof DeviceError && e.status === 0) {
        setOnline(false);
        setScreen({ kind: "offline", pin });
      } else if (e instanceof DeviceError && e.code === "pin_locked") {
        setMessage(e.message);
        sayHello();
        setPin("");
      } else {
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function punch(kind: PunchKind, thePin: string) {
    if (!key || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await call<{ person: { name: string }; at: string }>(key, "/punch", { pin: thePin, kind });
      setScreen({ kind: "done", text: `${PUNCH_DONE[kind]} at ${new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(r.at))}.`, sub: r.person.name });
    } catch (e) {
      if (e instanceof DeviceError && e.status === 0) {
        queuePunch(kind, thePin);
      } else {
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
        reset();
      }
    } finally {
      setBusy(false);
    }
  }

  function queuePunch(kind: PunchKind, thePin: string) {
    const item: Queued = { id: crypto.randomUUID(), pin: thePin, kind, at: new Date(serverNow).toISOString() };
    saveQueue([...readQueue(), item]);
    setOnline(false);
    setScreen({
      kind: "done",
      text: `${PUNCH_LABELS[kind]} saved on this device at ${clock}.`,
      sub: "The connection is down. This device sends it when the connection is back."
    });
  }

  // Digits from a keyboard, for a computer at the location.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screen.kind !== "pad" || locked) return;
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < PIN_MAX ? p + e.key : p));
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") submitPin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!key || fatal) {
    return (
      <Frame>
        <div className="grid max-w-md gap-4 text-center" data-clock-state="not-set-up">
          <Icon name="clock" size={32} className="mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">This device is not a time clock</h1>
          <p className="text-sm text-muted-foreground">
            {fatal ?? "An admin sets up a time clock in WorkSpent. Sign in on this device, open Locations and devices, and choose Set up this device as the time clock."}
          </p>
          <div>
            <Button asChild variant="outline">
              <a href={`${HOME}/locations`}>Sign in and set it up</a>
            </Button>
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="grid w-full max-w-md gap-5" data-clock-state={screen.kind}>
        <header className="grid gap-1 text-center">
          <p className="text-sm text-muted-foreground">{hello ? `${hello.location.name} · ${hello.device.name}` : "Connecting…"}</p>
          <p className="text-5xl font-semibold tabular-nums tracking-tight" aria-live="off">
            {clock}
          </p>
          <p className="text-sm text-muted-foreground">{dateLine}</p>
        </header>

        {!online && (
          <p className="rounded-md border border-warn-border bg-warn px-3 py-2 text-center text-sm text-warn-foreground" role="status">
            No connection. You can still clock in. This device saves it and sends it later.
          </p>
        )}
        {queue.length > 0 && online && (
          <p className="text-center text-xs text-muted-foreground" role="status">
            Sending {queue.length} saved clock-in{queue.length === 1 ? "" : "s"}…
          </p>
        )}
        {message && (
          <p className="rounded-md border border-destructive/40 px-3 py-2 text-center text-sm text-destructive" role="alert">
            {message}
          </p>
        )}

        {screen.kind === "pad" &&
          (locked ? (
            <p className="rounded-md border px-3 py-4 text-center text-sm" role="alert">
              Too many wrong PINs. The PIN pad is locked for {Math.max(1, Math.ceil((locked - serverNow) / 60_000))} more minutes. A manager can unlock it in WorkSpent.
            </p>
          ) : (
            <Pad pin={pin} setPin={setPin} onNext={submitPin} busy={busy} />
          ))}

        {screen.kind === "person" && (
          <div className="grid gap-3 text-center">
            <p className="text-2xl font-semibold">Hello, {screen.answer.person.name}</p>
            <p className="text-sm text-muted-foreground">
              {screen.answer.state === "out"
                ? "You are clocked out."
                : screen.answer.state === "on_break"
                  ? `On meal break since ${fmt(screen.answer.since, tz)}.`
                  : `On the clock since ${fmt(screen.answer.since, tz)}.`}
            </p>
            <div className="grid gap-2">
              {PUNCH_KINDS.map((k) => (
                <Button
                  key={k}
                  size="lg"
                  className="h-14 text-base"
                  variant={k === "in" || k === "out" ? "default" : "outline"}
                  disabled={busy || !screen.answer.kinds.includes(k)}
                  onClick={() => punch(k, screen.pin)}
                >
                  {PUNCH_LABELS[k]}
                </Button>
              ))}
            </div>
            <Button variant="ghost" onClick={reset}>
              Not you? Start over
            </Button>
          </div>
        )}

        {screen.kind === "offline" && (
          <div className="grid gap-3 text-center">
            <p className="text-lg font-semibold">Pick what to save</p>
            <p className="text-sm text-muted-foreground">The device cannot check your PIN now. It checks it when the connection is back.</p>
            <div className="grid gap-2">
              {PUNCH_KINDS.map((k) => (
                <Button key={k} size="lg" className="h-14 text-base" variant="outline" onClick={() => queuePunch(k, screen.pin)}>
                  {PUNCH_LABELS[k]}
                </Button>
              ))}
            </div>
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
          </div>
        )}

        {screen.kind === "done" && (
          <div className="grid gap-3 text-center" role="status">
            <Icon name="check" size={40} className="mx-auto text-agent-done" />
            <p className="text-2xl font-semibold">{screen.text}</p>
            {screen.sub && <p className="text-sm text-muted-foreground">{screen.sub}</p>}
            <p className="text-xs text-muted-foreground">This screen goes back to the PIN pad in a few seconds.</p>
            <Button variant="outline" onClick={reset}>
              Done
            </Button>
          </div>
        )}
      </div>
    </Frame>
  );
}

const fmt = (iso: string | null, tz?: string) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "");

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-8 text-foreground">
      {children}
      <footer className="flex items-center gap-2 text-xs text-muted-foreground">
        <Logo size={14} />
        WorkSpent time clock
      </footer>
    </main>
  );
}

function Pad({ pin, setPin, onNext, busy }: { pin: string; setPin: (f: (p: string) => string) => void; onNext: () => void; busy: boolean }) {
  const press = (d: string) => setPin((p) => (p.length < PIN_MAX ? p + d : p));
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 text-center">
        <p className="text-base font-medium" id="ws-pin-label">
          Enter your PIN
        </p>
        <div className="flex justify-center gap-2" aria-labelledby="ws-pin-label" aria-live="polite" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(PIN_MIN, pin.length) }, (_, i) => (
            <span key={i} className={cn("size-3.5 rounded-full border-2 border-foreground/60", i < pin.length && "bg-foreground")} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Button key={d} variant="outline" className="h-16 text-2xl font-medium tabular-nums" onClick={() => press(d)} disabled={busy}>
            {d}
          </Button>
        ))}
        <Button variant="ghost" className="h-16 text-base" onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy || !pin}>
          Delete
        </Button>
        <Button variant="outline" className="h-16 text-2xl font-medium tabular-nums" onClick={() => press("0")} disabled={busy}>
          0
        </Button>
        <Button className="h-16 text-base" onClick={onNext} disabled={busy || pin.length < PIN_MIN}>
          Next
        </Button>
      </div>
    </div>
  );
}
