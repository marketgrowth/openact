import { lazy } from "react";
import { defineClientApp } from "@openact/ui";

const NotesPage = lazy(() => import("./NotesPage"));

export default defineClientApp({
  id: "hello",
  name: "Hello",
  nav: [{ label: "Notes", icon: "chat", path: "/hello" }],
  routes: [{ pattern: /^\/hello\/?$/, render: () => <NotesPage /> }]
});
