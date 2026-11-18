import { lazy } from "react";
import { defineClientApp } from "@openact/ui";
import { EMDASH_HOME } from "../shared/rules";
import { EmdashMark } from "./mark";

/*
 * EmDash in the web app: its own group at the end of the app rail, below a divider,
 * and one page, /a/emdash, that shows the company's EmDash admin in a frame.
 * The app panel closes on that page, so the admin sits right of the rail.
 * A company turns the app on in Company settings > Apps, then adds the site address in Company settings > EmDash.
 */

const EmdashPage = lazy(() => import("./EmdashPage"));
const SettingsTab = lazy(() => import("./settings").then((m) => ({ default: m.EmdashSettingsTab })));

export default defineClientApp({
  id: "emdash",
  name: "EmDash",
  icon: "pencil",
  Mark: EmdashMark,
  home: EMDASH_HOME,
  railPlacement: "end",
  collapsePanel: true,
  routes: [{ pattern: /^\/a\/emdash\/?$/, render: () => <EmdashPage /> }],
  companySettingsTabs: [{ id: "emdash", label: "EmDash", Tab: ({ detail, onChanged }) => <SettingsTab detail={detail} onChanged={onChanged} /> }]
});
