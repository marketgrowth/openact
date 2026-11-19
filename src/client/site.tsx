import { lazy, useEffect } from "react";
import { defineClientApp } from "@openact/ui";
import { CONTRIBUTE_URL } from "../shared/contribute";

/* This deploy's own pages, outside any app: the colophon, and the old /contribute address. */

const Colophon = lazy(() => import("./Colophon").then((m) => ({ default: m.Colophon })));

/** The Contribute page moved to openact.ing. Old links to /contribute go there. */
function ContributeMoved() {
  useEffect(() => {
    window.location.replace(`${CONTRIBUTE_URL}${window.location.search}`);
  }, []);
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-sm text-muted-foreground">
      <p>
        The Contribute page moved. <a href={CONTRIBUTE_URL} className="underline underline-offset-4">Open it on openact.ing</a>.
      </p>
    </main>
  );
}

export const site = defineClientApp({
  id: "site",
  name: "OpenAct",
  // The colophon has no icon on the app rail. Its page still works at /colophon.
  // Contribute is in Company settings, for the site owner only. It is not on the rail.
  publicRoutes: { "/contribute": ContributeMoved, "/colophon": Colophon }
});
