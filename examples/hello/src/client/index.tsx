import { lazy } from "react";
import { defineClientApp } from "@openact/ui";

const NotesPage = lazy(() => import("./NotesPage"));

export default defineClientApp({
  id: "hello",
  name: "Hello",
  icon: "chat",
  nav: [{ label: "Notes", icon: "chat", path: "/a/hello" }],
  // Community apps keep their pages under /a/<id>/. /a/hello is this app's home.
  routes: [{ path: "/a/hello", render: () => <NotesPage /> }]
});
