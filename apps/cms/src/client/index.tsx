import { lazy } from "react";
import { defineClientApp } from "@openact/ui";
import { CMS_HOME } from "../shared/rules";

/*
 * CMS in the web app: its own group at the end of the app rail, below a divider,
 * and one page, /a/cms, that shows the company's EmDash admin in a frame.
 * The app panel closes on that page, so the admin sits right of the rail.
 * A company turns the app on in Company settings > Apps, then adds the site address in Company settings > CMS.
 */

const CmsPage = lazy(() => import("./CmsPage"));
const SettingsTab = lazy(() => import("./settings").then((m) => ({ default: m.CmsSettingsTab })));

export default defineClientApp({
  id: "cms",
  name: "CMS",
  icon: "website",
  home: CMS_HOME,
  railPlacement: "end",
  collapsePanel: true,
  routes: [{ pattern: /^\/a\/cms\/?$/, render: () => <CmsPage /> }],
  companySettingsTabs: [{ id: "cms", label: "CMS", Tab: ({ detail, onChanged }) => <SettingsTab detail={detail} onChanged={onChanged} /> }]
});
