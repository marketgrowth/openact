import { lazy } from "react";
import { defineClientApp, useShell } from "@openact/ui";
import { ESIGN_HOME, SIGN_PATH } from "../shared/types";
import { EsignProvider } from "./state";

/*
 * eSign in the web app: its own icon in the app rail, and these pages:
 *   /a/esign               documents sent for signature
 *   /a/esign/templates     templates
 *   /a/esign/t/<id>        the template editor
 *   /a/esign/t/<id>/send   the template editor with the send form open
 *   /a/esign/s/<id>        one document: signers, audit log and files
 *   /esign/sign#<token>    the public signing page (no sign-in)
 * The pages and pdf.js load only when an eSign page opens.
 */

const DocumentsPage = lazy(() => import("./lists").then((m) => ({ default: m.DocumentsPage })));
const TemplatesPage = lazy(() => import("./lists").then((m) => ({ default: m.TemplatesPage })));
const NewDocumentDialog = lazy(() => import("./lists").then((m) => ({ default: m.NewDocumentDialog })));
const BuilderPage = lazy(() => import("./builder").then((m) => ({ default: m.BuilderPage })));
const SubmissionPage = lazy(() => import("./submission").then((m) => ({ default: m.SubmissionPage })));
const SignPage = lazy(() => import("./sign").then((m) => ({ default: m.SignPage })));
const SettingsTab = lazy(() => import("./settings").then((m) => ({ default: m.EsignSettingsTab })));

function NewDocument({ onClose }: { onClose: () => void }) {
  const { me } = useShell();
  if (!me) return null;
  return <NewDocumentDialog onClose={onClose} />;
}

export default defineClientApp({
  id: "esign",
  name: "eSign",
  icon: "signature",
  home: ESIGN_HOME,
  Provider: EsignProvider,
  routes: [
    { pattern: /^\/a\/esign\/?$/, render: () => <DocumentsPage /> },
    { pattern: /^\/a\/esign\/templates\/?$/, render: () => <TemplatesPage /> },
    { pattern: /^\/a\/esign\/t\/([^/]+)\/?$/, render: (m) => <BuilderPage key={m[1]} templateId={m[1]!} /> },
    { pattern: /^\/a\/esign\/t\/([^/]+)\/send\/?$/, render: (m) => <BuilderPage key={`${m[1]}-send`} templateId={m[1]!} sendOpen /> },
    { pattern: /^\/a\/esign\/s\/([^/]+)\/?$/, render: (m) => <SubmissionPage key={m[1]} submissionId={m[1]!} /> }
  ],
  publicRoutes: { [SIGN_PATH]: SignPage },
  nav: [
    { label: "Documents", icon: "file-pen", path: ESIGN_HOME },
    { label: "Templates", icon: "template", path: `${ESIGN_HOME}/templates` }
  ],
  commands: [{ id: "esign.new", label: "New document", icon: "plus", inSidebar: true, Dialog: NewDocument }],
  companySettingsTabs: [{ id: "esign", label: "eSign", Tab: ({ detail, onChanged }) => <SettingsTab detail={detail} onChanged={onChanged} /> }]
});
