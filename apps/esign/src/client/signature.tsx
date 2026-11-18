import { useEffect, useRef, useState } from "react";
import { Modal, Notice } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@openact/ui/components/tabs";
import { LIMITS } from "../shared/types";

/*
 * Makes a signature or initials image: draw it, type it, or upload a picture.
 * The result is a PNG data URL with a clear background, cut to the ink.
 */

type Mode = "draw" | "type" | "upload";

const W = 720;
const H = 240;

/** The ink color: the paper text token, so it reads well on the white page in both themes. */
function ink(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--paper-foreground").trim() || "black";
}

/** Cuts a canvas to the ink, with a small margin, and returns a PNG data URL under the size limit. */
function trimmed(src: HTMLCanvasElement): string | null {
  const ctx = src.getContext("2d");
  if (!ctx) return null;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  for (let scale = 1; scale > 0.2; scale *= 0.75) {
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round((x1 - x0 + 1) * scale));
    out.height = Math.max(1, Math.round((y1 - y0 + 1) * scale));
    out.getContext("2d")!.drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, out.width, out.height);
    const url = out.toDataURL("image/png");
    if (url.length <= LIMITS.imageChars) return url;
  }
  return null;
}

export function SignatureDialog({
  kind,
  defaultText,
  onDone,
  onClose
}: {
  kind: "signature" | "initials";
  defaultText: string;
  onDone: (png: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("draw");
  const [typed, setTyped] = useState(defaultText);
  const [problem, setProblem] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const label = kind === "signature" ? "signature" : "initials";

  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, W, H);
    setDrawn(false);
  };

  // Typed text, drawn in a handwriting font when the device has one.
  useEffect(() => {
    if (mode !== "type") return;
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    const t = typed.trim();
    if (!t) return;
    let size = kind === "signature" ? 96 : 120;
    ctx.fillStyle = ink();
    ctx.textBaseline = "middle";
    do {
      ctx.font = `italic ${size}px "Segoe Script", "Snell Roundhand", "Brush Script MT", cursive`;
      size -= 4;
    } while (ctx.measureText(t).width > W - 40 && size > 20);
    ctx.fillText(t, 20, H / 2);
  }, [mode, typed, kind]);

  useEffect(() => {
    if (mode === "draw") clear();
  }, [mode]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "draw") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
    const ctx = e.currentTarget.getContext("2d")!;
    ctx.fillStyle = ink();
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    setDrawn(true);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "draw" || !last.current) return;
    const p = point(e);
    const ctx = e.currentTarget.getContext("2d")!;
    ctx.strokeStyle = ink();
    ctx.lineWidth = 3.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const up = () => {
    last.current = null;
  };

  const upload = async (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setProblem("Choose a PNG, JPEG or WebP image.");
    if (file.size > 5 * 1024 * 1024) return setProblem("The image is too large. Choose one under 5 MB.");
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((ok, fail) => {
        img.onload = () => ok();
        img.onerror = () => fail(new Error("bad image"));
        img.src = url;
      });
      const c = canvas.current!;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, W, H);
      const s = Math.min(W / img.width, H / img.height, 1);
      ctx.drawImage(img, 0, 0, img.width * s, img.height * s);
      // A white background turns clear, so the image sits on the page like ink.
      const d = ctx.getImageData(0, 0, W, H);
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i]! > 235 && d.data[i + 1]! > 235 && d.data[i + 2]! > 235) d.data[i + 3] = 0;
      }
      ctx.putImageData(d, 0, 0);
      setDrawn(true);
    } catch {
      setProblem("This image cannot be read. Choose another one.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const done = () => {
    const c = canvas.current;
    if (!c) return;
    const url = trimmed(c);
    if (!url) return setProblem(mode === "type" ? `Type your ${label}.` : `Draw your ${label} in the box.`);
    onDone(url);
  };

  return (
    <Modal title={kind === "signature" ? "Add your signature" : "Add your initials"} onClose={onClose} wide>
      <Tabs
        value={mode}
        onValueChange={(v) => {
          setMode(v as Mode);
          setProblem(null);
          setDrawn(false);
        }}
      >
        <TabsList>
          <TabsTrigger value="draw">Draw</TabsTrigger>
          <TabsTrigger value="type">Type</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === "type" && (
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={kind === "signature" ? 60 : 6} aria-label={`Your ${label}`} autoFocus />
      )}
      {mode === "upload" && (
        <Input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void upload(e.target.files?.[0])}
          aria-label={`An image of your ${label}`}
        />
      )}
      <div className="relative rounded-lg border bg-paper">
        <canvas
          ref={canvas}
          width={W}
          height={H}
          className="block aspect-[3/1] w-full touch-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label={mode === "draw" ? `Draw your ${label} here` : `Your ${label}`}
          data-esign-canvas=""
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-paper-border" aria-hidden="true" />
        {mode === "draw" && !drawn && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-paper-muted">Draw with your mouse, finger or pen</p>
        )}
      </div>
      {problem && <Notice tone="error">{problem}</Notice>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={clear} disabled={mode === "type"}>
          Clear
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={done} data-esign-adopt="">
            Use this {label}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
