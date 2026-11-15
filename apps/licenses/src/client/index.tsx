import { lazy } from "react";
import { defineClientApp } from "@openact/ui";

const LicensesPage = lazy(() => import("./LicensesPage"));

export default defineClientApp({
  id: "licenses",
  name: "License Keys",
  icon: "shield",
  home: "/licenses",
  nav: [{ label: "License keys", icon: "shield", path: "/licenses" }],
  routes: [{ pattern: /^\/licenses\/?$/, render: () => <LicensesPage /> }]
});
