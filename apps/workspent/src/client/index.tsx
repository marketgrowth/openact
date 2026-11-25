import { lazy } from "react";
import { Redirect, defineClientApp } from "@openact/ui";
import { CLOCK_PATH, HOME } from "../shared/rules";
import { useMe } from "./lib";

/*
 * WorkSpent in the web app. Managers start on Timesheets and plan shifts on Schedule. People who only clock in start on My time.
 * The time clock device page (/a/workspent/clock) works without sign-in. It uses a device key instead.
 */

const TimesheetsPage = lazy(() => import("./TimesheetsPage"));
const MyTimePage = lazy(() => import("./MyTimePage"));
const SchedulePage = lazy(() => import("./SchedulePage"));
const PeoplePage = lazy(() => import("./PeoplePage"));
const LocationsPage = lazy(() => import("./LocationsPage"));
const ClockPage = lazy(() => import("./ClockPage"));

/** The home: Timesheets for managers, My time for everyone else. */
function Home() {
  const me = useMe();
  if (!me.data && !me.error) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const manages = !!me.data && (me.data.canManageAll || me.data.canSetup || me.data.managedLocationIds.length > 0);
  return manages || me.error ? <TimesheetsPage /> : <Redirect to={`${HOME}/my-time`} />;
}

export default defineClientApp({
  id: "workspent",
  name: "WorkSpent",
  icon: "clock",
  home: HOME,
  routes: [
    { path: HOME, render: () => <Home /> },
    { path: `${HOME}/timesheets`, render: () => <TimesheetsPage /> },
    { path: `${HOME}/schedule`, render: () => <SchedulePage /> },
    { path: `${HOME}/my-time`, render: () => <MyTimePage /> },
    { path: `${HOME}/people`, render: () => <PeoplePage /> },
    { path: `${HOME}/locations`, render: () => <LocationsPage /> }
  ],
  publicRoutes: { [CLOCK_PATH]: ClockPage },
  nav: [
    { label: "Timesheets", icon: "calendar", path: `${HOME}/timesheets` },
    { label: "Schedule", icon: "calendar-check", path: `${HOME}/schedule` },
    { label: "My time", icon: "clock", path: `${HOME}/my-time` },
    { label: "People and PINs", icon: "users", path: `${HOME}/people` },
    { label: "Locations and devices", icon: "monitor", path: `${HOME}/locations` }
  ]
});
