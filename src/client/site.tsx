import { lazy } from "react";
import { defineClientApp } from "@openact/ui";

/* This deploy's own pages, outside any app: the colophon. */

const Colophon = lazy(() => import("./Colophon").then((m) => ({ default: m.Colophon })));

export const site = defineClientApp({
  id: "site",
  name: "OpenAct",
  publicRoutes: { "/colophon": Colophon },
  nav: [{ label: "Colophon", icon: "doc", path: "/colophon", placement: "footer" }]
});
