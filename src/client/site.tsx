import { lazy } from "react";
import { defineClientApp } from "@openact/ui";
import { DemoNotice } from "./DemoNotice";

/* This deploy's own pages, outside any app: contributions and the colophon. */

const Contribute = lazy(() => import("./Contribute").then((m) => ({ default: m.Contribute })));
const Colophon = lazy(() => import("./Colophon").then((m) => ({ default: m.Colophon })));

export const site = defineClientApp({
  id: "site",
  name: "OpenAct",
  // The demo notice shows on every signed-in page (demo branch only).
  Provider: DemoNotice,
  publicRoutes: { "/contribute": Contribute, "/colophon": Colophon },
  // Footer items show at the bottom of the app rail. The colophon has no icon there. Its page still works at /colophon.
  nav: [{ label: "Contribute", icon: "heart", path: "/contribute", placement: "footer" }]
});
