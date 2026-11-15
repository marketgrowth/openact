import type { ReactNode } from "react";

/* A small, fixed notice on the public demo at a.openact.ing. This file lives on the `demo` branch only. */

export function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <p
        role="note"
        data-demo-notice=""
        className="pointer-events-none fixed bottom-3 right-3 z-50 max-w-[calc(100vw-1.5rem)] rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm"
      >
        This is a demo. All data is deleted every night at about 2 AM Pacific time.
      </p>
    </>
  );
}
