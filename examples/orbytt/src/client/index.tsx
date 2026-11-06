import { lazy } from "react";
import { Icon, defineClientApp, navigate, useCloseOnPhone } from "@openact/ui";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from "@openact/ui/components/sidebar";
import { OrbyttMark } from "./OrbyttMark";
import { OrbyttProvider, useOrbytt } from "./state";
import { SAVED_SEARCHES } from "./data";

/*
 * A mockup of the Orbytt app: a second app in the app rail, with its own panel and pages.
 * The real app will talk to the Orbytt API through the Worker. This one keeps sample data in memory.
 */

const page = (name: "OverviewPage" | "TalentPage" | "ShortlistPage" | "InterviewsPage" | "ContractorsPage") =>
  lazy(() => import("./pages").then((m) => ({ default: m[name] })));
const Overview = page("OverviewPage");
const Talent = page("TalentPage");
const Shortlist = page("ShortlistPage");
const Interviews = page("InterviewsPage");
const Contractors = page("ContractorsPage");

/** The panel groups: saved searches and the connection status. */
function OrbyttSection() {
  const { connected, setQuery } = useOrbytt();
  const done = useCloseOnPhone();
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Saved searches</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu aria-label="Saved searches" data-nav="orbytt-searches">
            {SAVED_SEARCHES.map((s) => (
              <SidebarMenuItem key={s.label}>
                <SidebarMenuButton
                  className="text-sidebar-foreground/80"
                  onClick={() => {
                    done();
                    setQuery(s.query);
                    navigate("/a/orbytt/talent");
                  }}
                >
                  <span className="truncate">{s.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup className="mt-auto">
        <SidebarGroupLabel>Connection</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => navigate("/a/orbytt")} className="text-sidebar-foreground/80">
                <Icon name="plug" />
                <span>{connected ? "Connected to Orbytt" : "Not connected"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

export default defineClientApp({
  id: "orbytt",
  name: "Orbytt",
  Mark: OrbyttMark,
  Provider: OrbyttProvider,
  routes: [
    { pattern: /^\/a\/orbytt\/?$/, render: () => <Overview /> },
    { pattern: /^\/a\/orbytt\/talent\/?$/, render: () => <Talent /> },
    { pattern: /^\/a\/orbytt\/shortlist\/?$/, render: () => <Shortlist /> },
    { pattern: /^\/a\/orbytt\/interviews\/?$/, render: () => <Interviews /> },
    { pattern: /^\/a\/orbytt\/contractors\/?$/, render: () => <Contractors /> }
  ],
  nav: [
    { label: "Find talent", icon: "talent", path: "/a/orbytt/talent" },
    { label: "Shortlist", icon: "star", path: "/a/orbytt/shortlist" },
    { label: "Interviews", icon: "video", path: "/a/orbytt/interviews" },
    { label: "Contractors", icon: "briefcase", path: "/a/orbytt/contractors" }
  ],
  SidebarSection: OrbyttSection
});
