import { lazy } from "react";
import { Redirect, defineClientApp } from "@openact/ui";
import { APPROVE_PATH, CLOCK_PATH, HOME } from "../shared/rules";
import { useMe } from "./lib";
import { PATHS, WorkSpentNav } from "./WorkSpentNav";

/*
 * WorkSpent in the web app. A company turns on Projects, Shifts or both (WorkSpent settings).
 * Managers of shifts start on Timesheets. Everyone else starts on My time.
 * The time clock device page (/a/workspent/clock) and the client approval page (/a/workspent/approve) work without sign-in.
 */

const TimesheetsPage = lazy(() => import("./TimesheetsPage"));
const MyTimePage = lazy(() => import("./MyTimePage"));
const SchedulePage = lazy(() => import("./SchedulePage"));
const PeoplePage = lazy(() => import("./PeoplePage"));
const LocationsPage = lazy(() => import("./LocationsPage"));
const ClockPage = lazy(() => import("./ClockPage"));
const TimeLogPage = lazy(() => import("./TimeLogPage"));
const ClientsPage = lazy(() => import("./ClientsPage"));
const ReportsPage = lazy(() => import("./ReportsPage"));
const SettingsPage = lazy(() => import("./SettingsPage"));
const ApprovePage = lazy(() => import("./ApprovePage"));

/** The home: Timesheets for managers of shifts, My time for everyone else. */
function Home() {
  const me = useMe();
  if (!me.data && !me.error) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const manages = !!me.data && me.data.shifts && (me.data.canManageAll || me.data.canSetup || me.data.managedLocationIds.length > 0);
  return manages || me.error ? <TimesheetsPage /> : <Redirect to={PATHS.myTime} />;
}

export default defineClientApp({
  id: "workspent",
  name: "WorkSpent",
  icon: "clock",
  home: HOME,
  routes: [
    { path: HOME, render: () => <Home /> },
    { path: PATHS.timesheets, render: () => <TimesheetsPage /> },
    { path: PATHS.schedule, render: () => <SchedulePage /> },
    { path: PATHS.myTime, render: () => <MyTimePage /> },
    { path: PATHS.team, render: () => <PeoplePage /> },
    { path: PATHS.locations, render: () => <LocationsPage /> },
    { path: PATHS.timeLog, render: () => <TimeLogPage /> },
    { path: PATHS.clients, render: () => <ClientsPage /> },
    { path: PATHS.reports, render: () => <ReportsPage /> },
    { path: PATHS.settings, render: () => <SettingsPage /> }
  ],
  publicRoutes: { [CLOCK_PATH]: ClockPage, [APPROVE_PATH]: ApprovePage },
  SidebarSection: WorkSpentNav
});
