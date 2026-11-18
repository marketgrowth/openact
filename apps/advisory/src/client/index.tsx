import { lazy } from "react";
import { defineClientApp } from "@openact/ui";
import { ADVISORY_HOME } from "../shared/rules";
import { AdvisoryProvider } from "./state";
import { AdvisorySection } from "./AdvisorySection";

/*
 * Advisory in the web app: its own icon in the app rail, the directory of advisors in the panel, and these pages:
 *   /a/advisory            the directory
 *   /a/advisory/p/<id>     an advisor's profile, with Book a consult and Pay in advance
 *   /a/advisory/pay/<id>   the payment page for a request
 *   /a/advisory/my         the person's own requests
 *   /a/advisory/me         the advisor dashboard
 *   /a/advisory/manage     applications, fees and engagements, for managers
 */

const DirectoryPage = lazy(() => import("./browse").then((m) => ({ default: m.DirectoryPage })));
const ProfilePage = lazy(() => import("./browse").then((m) => ({ default: m.ProfilePage })));
const PayPage = lazy(() => import("./pay").then((m) => ({ default: m.PayPage })));
const MyRequestsPage = lazy(() => import("./pay").then((m) => ({ default: m.MyRequestsPage })));
const DashboardPage = lazy(() => import("./dashboard").then((m) => ({ default: m.DashboardPage })));
const ManagePage = lazy(() => import("./manage").then((m) => ({ default: m.ManagePageView })));
const SettingsTab = lazy(() => import("./manage").then((m) => ({ default: m.AdvisorySettingsTab })));

export default defineClientApp({
  id: "advisory",
  name: "Advisory",
  icon: "handshake",
  home: ADVISORY_HOME,
  Provider: AdvisoryProvider,
  routes: [
    { pattern: /^\/a\/advisory\/?$/, render: () => <DirectoryPage /> },
    { pattern: /^\/a\/advisory\/p\/([^/]+)\/?$/, render: (m) => <ProfilePage key={m[1]} advisorId={m[1]!} /> },
    { pattern: /^\/a\/advisory\/pay\/([^/]+)\/?$/, render: (m) => <PayPage key={m[1]} requestId={m[1]!} /> },
    { pattern: /^\/a\/advisory\/my\/?$/, render: () => <MyRequestsPage /> },
    { pattern: /^\/a\/advisory\/me\/?$/, render: () => <DashboardPage /> },
    { pattern: /^\/a\/advisory\/manage\/?$/, render: () => <ManagePage /> }
  ],
  SidebarSection: AdvisorySection,
  companySettingsTabs: [{ id: "advisory", label: "Advisory", Tab: ({ detail, onChanged }) => <SettingsTab detail={detail} onChanged={onChanged} /> }]
});
