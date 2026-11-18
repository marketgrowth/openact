import { useEffect, useRef, useState, type ReactNode } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageSize } from "../shared/types";

/*
 * Shows the pages of a PDF with pdf.js, one canvas per page, at the width of the column.
 * Fields go on top of each page in an overlay. Positions in the overlay are fractions of the page,
 * so they stay in place at every width and zoom.
 * A page draws only when it comes near the screen, so long PDFs open fast.
 */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;

/** Opens PDF bytes. pdf.js does not run scripts in the PDF, and XFA forms stay off. */
export async function openPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false }).promise;
}

/** Loads a PDF from the API. Extra headers carry a signing token. */
export function usePdf(url: string | null, headers?: Record<string, string>): { doc: PdfDoc | null; error: string | null } {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = headers ? JSON.stringify(headers) : "";
  useEffect(() => {
    if (!url) return;
    let stop = false;
    let opened: PdfDoc | null = null;
    setDoc(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin", headers: headers ?? {} });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `The PDF could not be loaded (${res.status}).`);
        }
        opened = await openPdf(await res.arrayBuffer());
        if (stop) return void opened.loadingTask.destroy();
        setDoc(opened);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : "The PDF could not be loaded.");
      }
    })();
    return () => {
      stop = true;
      void opened?.loadingTask.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key]);
  return { doc, error };
}

function PdfCanvas({ doc, index, width }: { doc: PdfDoc; index: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || !width) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let stop = false;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (stop) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = ref.current;
      if (!canvas) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      await task.promise.catch(() => {});
    })();
    return () => {
      stop = true;
      task?.cancel();
    };
  }, [doc, index, width, near]);

  return (
    <div ref={box} className="absolute inset-0">
      <canvas ref={ref} className="size-full" aria-hidden="true" />
    </div>
  );
}

/**
 * The pages of a PDF, one under the other, with an overlay on each page.
 * `pages` comes from the server, so the layout is right before pdf.js finishes.
 */
export function PdfPages({
  doc,
  pages,
  maxWidth = 860,
  overlay,
  className
}: {
  doc: PdfDoc | null;
  pages: PageSize[];
  maxWidth?: number;
  overlay?: (page: number) => ReactNode;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(el.clientWidth, maxWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  return (
    <div ref={wrap} className={className ?? "flex w-full flex-col items-center gap-4"}>
      {width > 0 &&
        pages.map((p, i) => (
          <div
            key={i}
            className="relative shrink-0 bg-paper shadow-sm ring-1 ring-paper-border"
            style={{ width, height: Math.round((width * p.h) / p.w) }}
            data-pdf-page={i}
            aria-label={`Page ${i + 1} of ${pages.length}`}
          >
            {doc ? <PdfCanvas doc={doc} index={i} width={width} /> : <div className="absolute inset-0 animate-pulse bg-muted/40" />}
            {overlay && <div className="absolute inset-0">{overlay(i)}</div>}
          </div>
        ))}
    </div>
  );
}
