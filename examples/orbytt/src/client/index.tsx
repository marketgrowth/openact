import { lazy } from "react";
import { Icon, Link, defineClientApp, navigate, useCloseOnPhone, usePath } from "@openact/ui";
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
import { AGENTS, CHATS, SAVED_SEARCHES } from "./data";

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
const AgentChat = lazy(() => import("./pages").then((m) => ({ default: m.AgentChatPage })));
const Chat = lazy(() => import("./pages").then((m) => ({ default: m.ChatPage })));

/** The panel groups: agents, saved searches, recent chats and the connection status. */
function OrbyttSection() {
  const { connected, setQuery } = useOrbytt();
  const done = useCloseOnPhone();
  const path = usePath();
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Agents</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu aria-label="Agents" data-nav="orbytt-agents">
            {AGENTS.map((a) => {
              const to = `/a/orbytt/agents/${a.id}`;
              return (
                <SidebarMenuItem key={a.id}>
                  <SidebarMenuButton asChild isActive={path === to}>
                    <Link to={to} onClick={done}>
                      <Icon name={a.icon} />
                      <span className="truncate">{a.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
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
      <SidebarGroup>
        <SidebarGroupLabel>Recent chats</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu aria-label="Recent chats" data-nav="orbytt-chats">
            {CHATS.map((c) => {
              const to = `/a/orbytt/chats/${c.id}`;
              return (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton asChild isActive={path === to} className="text-sidebar-foreground/80">
                    <Link to={to} onClick={done}>
                      <span className="truncate">{c.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
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
    { pattern: /^\/a\/orbytt\/contractors\/?$/, render: () => <Contractors /> },
    { pattern: /^\/a\/orbytt\/agents\/([a-z-]+)\/?$/, render: (m) => <AgentChat id={m[1]!} /> },
    { pattern: /^\/a\/orbytt\/chats\/([a-z0-9-]+)\/?$/, render: (m) => <Chat id={m[1]!} /> }
  ],
  nav: [
    { label: "Find talent", icon: "talent", path: "/a/orbytt/talent" },
    { label: "Shortlist", icon: "star", path: "/a/orbytt/shortlist" },
    { label: "Interviews", icon: "video", path: "/a/orbytt/interviews" },
    { label: "Contractors", icon: "briefcase", path: "/a/orbytt/contractors" }
  ],
  SidebarSection: OrbyttSection
});
