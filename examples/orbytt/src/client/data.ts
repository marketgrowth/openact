/* Sample data for the Orbytt mockup. These people do not exist. The real app gets talent from the Orbytt API. */

export interface Talent {
  id: string;
  name: string;
  role: string;
  city: string;
  country: "PH" | "US";
  /** The talent's own time zone, for the profile. */
  timeZone: string;
  /** Hours each workday that overlap with the company's hours (Pacific time in this mockup). */
  overlap: number;
  rate: number;
  skills: string[];
  available: string;
  years: number;
  /** Average rating from past clients, out of 5, and how many reviews. */
  rating: number;
  reviews: number;
  languages: string[];
  bio: string;
  experience: Array<{ title: string; org: string; years: string }>;
  /** Links the talent added to their profile. Labels only in this mockup. */
  links: string[];
}

const t = (x: Talent) => x;

export const TALENT: Talent[] = [
  t({ id: "T-1042", name: "Maria Santos", role: "Bookkeeper", city: "Quezon City", country: "PH", timeZone: "Manila (UTC+8)", overlap: 4, rate: 14, skills: ["Xero", "QuickBooks", "Payroll", "Month-end close"], available: "Now", years: 6, rating: 4.9, reviews: 23, languages: ["English (fluent)", "Filipino"],
    bio: "I keep the books for small US companies. I reconcile accounts every week, run payroll twice a month and close the month by day five.",
    experience: [{ title: "Senior bookkeeper", org: "A US accounting firm, remote", years: "2022 to now" }, { title: "Accounts assistant", org: "A Manila logistics company", years: "2019 to 2022" }],
    links: ["Xero Advisor certificate", "QuickBooks ProAdvisor"] }),
  t({ id: "T-1187", name: "Paolo Ramos", role: "Shopify developer", city: "Cebu City", country: "PH", timeZone: "Manila (UTC+8)", overlap: 3, rate: 22, skills: ["Shopify", "Liquid", "React", "Klaviyo"], available: "In 2 weeks", years: 5, rating: 4.8, reviews: 17, languages: ["English (fluent)", "Cebuano", "Filipino"],
    bio: "I build and speed up Shopify stores. I write custom themes, connect apps, and fix slow product pages.",
    experience: [{ title: "Shopify developer", org: "Freelance, 30 stores", years: "2021 to now" }, { title: "Front-end developer", org: "A Cebu web agency", years: "2019 to 2021" }],
    links: ["Portfolio", "GitHub"] }),
  t({ id: "T-0931", name: "Rachel Kim", role: "Executive assistant", city: "Austin, TX", country: "US", timeZone: "Central (UTC-6)", overlap: 8, rate: 38, skills: ["Calendar", "Travel", "Notion", "Board prep"], available: "Now", years: 9, rating: 5.0, reviews: 11, languages: ["English (native)", "Korean"],
    bio: "I support founders and CEOs. I run calendars across time zones, plan travel, and prepare board meetings.",
    experience: [{ title: "Executive assistant to the CEO", org: "A Series B software company", years: "2020 to now" }, { title: "Office manager", org: "An Austin design studio", years: "2017 to 2020" }],
    links: ["LinkedIn"] }),
  t({ id: "T-1210", name: "Joy Villanueva", role: "Customer support lead", city: "Davao City", country: "PH", timeZone: "Manila (UTC+8)", overlap: 6, rate: 11, skills: ["Zendesk", "Help Scout", "Training", "Macros"], available: "Now", years: 7, rating: 4.9, reviews: 31, languages: ["English (fluent)", "Filipino"],
    bio: "I lead small support teams. I write help articles, build macros, and keep first replies under one hour.",
    experience: [{ title: "Support team lead", org: "A US e-commerce brand", years: "2021 to now" }, { title: "Support agent", org: "A Davao BPO", years: "2018 to 2021" }],
    links: ["Zendesk certificate"] }),
  t({ id: "T-0877", name: "Jordan Ellis", role: "Paid ads specialist", city: "Denver, CO", country: "US", timeZone: "Mountain (UTC-7)", overlap: 7, rate: 65, skills: ["Google Ads", "Meta Ads", "GA4", "Landing pages"], available: "In 1 month", years: 8, rating: 4.7, reviews: 14, languages: ["English (native)"],
    bio: "I run paid search and social for B2B and e-commerce. I test offers fast and report on cost per lead every week.",
    experience: [{ title: "Paid media lead", org: "A Denver growth agency", years: "2020 to now" }, { title: "Marketing analyst", org: "A SaaS startup", years: "2018 to 2020" }],
    links: ["Portfolio", "LinkedIn"] }),
  t({ id: "T-1305", name: "Carlo Mendoza", role: "Video editor", city: "Iloilo City", country: "PH", timeZone: "Manila (UTC+8)", overlap: 2, rate: 12, skills: ["Premiere Pro", "After Effects", "Shorts", "Captions"], available: "Now", years: 4, rating: 4.8, reviews: 26, languages: ["English (fluent)", "Hiligaynon"],
    bio: "I edit short videos for social channels. I cut, caption and color, and I deliver within 48 hours.",
    experience: [{ title: "Video editor", org: "Two US podcast channels", years: "2022 to now" }],
    links: ["Showreel"] }),
  t({ id: "T-1121", name: "Dana Brooks", role: "HubSpot admin", city: "Raleigh, NC", country: "US", timeZone: "Eastern (UTC-5)", overlap: 5, rate: 72, skills: ["HubSpot", "Workflows", "Reporting", "Data cleanup"], available: "In 2 weeks", years: 6, rating: 4.9, reviews: 9, languages: ["English (native)"],
    bio: "I set up and clean up HubSpot. I build workflows, lead scoring and the reports that sales teams use every day.",
    experience: [{ title: "Revenue operations manager", org: "A B2B software company", years: "2021 to now" }, { title: "Marketing operations", org: "A Raleigh agency", years: "2019 to 2021" }],
    links: ["HubSpot certificates", "LinkedIn"] }),
  t({ id: "T-1266", name: "Liza Garcia", role: "Virtual assistant", city: "Makati", country: "PH", timeZone: "Manila (UTC+8)", overlap: 8, rate: 9, skills: ["Inbox", "Data entry", "Canva", "Research"], available: "Now", years: 3, rating: 4.8, reviews: 19, languages: ["English (fluent)", "Filipino"],
    bio: "I work US hours. I manage inboxes, enter data, research leads and make simple Canva graphics.",
    experience: [{ title: "Virtual assistant", org: "Three US small businesses", years: "2023 to now" }],
    links: ["Portfolio"] }),
  t({ id: "T-0998", name: "Sam Patel", role: "Full stack developer", city: "Columbus, OH", country: "US", timeZone: "Eastern (UTC-5)", overlap: 6, rate: 85, skills: ["TypeScript", "Cloudflare", "Postgres", "React"], available: "In 1 month", years: 11, rating: 5.0, reviews: 8, languages: ["English (native)", "Gujarati"],
    bio: "I build web apps on Cloudflare Workers and Postgres. I like small teams, clear specs and weekly demos.",
    experience: [{ title: "Staff engineer", org: "A health tech company", years: "2019 to now" }, { title: "Software engineer", org: "A Columbus fintech", years: "2015 to 2019" }],
    links: ["GitHub", "Personal site"] }),
  t({ id: "T-1339", name: "Bea Navarro", role: "Social media manager", city: "Baguio", country: "PH", timeZone: "Manila (UTC+8)", overlap: 4, rate: 13, skills: ["Instagram", "TikTok", "Planning", "Community"], available: "Now", years: 5, rating: 4.7, reviews: 21, languages: ["English (fluent)", "Ilocano", "Filipino"],
    bio: "I plan and post content for lifestyle brands. I write captions, schedule posts and answer comments every day.",
    experience: [{ title: "Social media manager", org: "Two US beauty brands", years: "2021 to now" }],
    links: ["Portfolio"] })
];

export const talentById = (id: string) => TALENT.find((x) => x.id === id);

/** Saved searches in the panel. Each one fills the search box on the Find talent page. */
export const SAVED_SEARCHES = [
  { label: "Bookkeeper with Xero", query: "Xero" },
  { label: "Shopify developer", query: "Shopify" },
  { label: "Support with Zendesk", query: "Zendesk" }
];

export const INTERVIEWS = [
  { talentId: "T-1042", when: "Tue, Nov 10, 9:00 a.m. PT", status: "Accepted" },
  { talentId: "T-1187", when: "Waiting for the talent", status: "Asked" }
];

export const CONTRACTORS = [
  { name: "Ana Reyes", role: "Customer support lead", city: "Davao City, Philippines", projects: ["Website relaunch"], projectRole: "Editor", ends: "Feb 28, 2027", hours: 32, rate: 11 },
  { name: "Marco Dela Cruz", role: "Bookkeeper", city: "Quezon City, Philippines", projects: ["Fall fundraiser", "Office move"], projectRole: "Editor", ends: "Dec 31, 2026", hours: 18, rate: 14 }
];

export const ACTIVITY = [
  { icon: "video", text: "Maria Santos accepted your interview for Tue, Nov 10, 9:00 a.m. PT.", when: "2 h ago" },
  { icon: "briefcase", text: "Ana Reyes logged 6 h on Website relaunch.", when: "Yesterday" },
  { icon: "star", text: "You shortlisted Paolo Ramos, Shopify developer.", when: "Yesterday" },
  { icon: "users", text: "Marco Dela Cruz joined Fall fundraiser and Office move as a guest.", when: "Mon" }
];

/** A sample match score: higher when the talent fits the search. */
export function matchScore(t: Talent, query: string): number {
  const base = 70 + (parseInt(t.id.slice(2), 10) % 17);
  const q = query.trim().toLowerCase();
  if (q && t.skills.concat(t.role).some((s) => s.toLowerCase().includes(q))) return Math.min(98, base + 12);
  return base;
}

/** The Orbytt agents in the panel. Each one acts for the person and stays inside their role. */
export interface Agent {
  id: string;
  name: string;
  icon: string;
  summary: string;
  /** Things to ask, shown on a new chat. */
  prompts: string[];
}

export const AGENTS: Agent[] = [
  {
    id: "scout",
    name: "Talent scout",
    icon: "talent",
    summary: "Finds and ranks talent for a role. It reads your saved searches and your shortlist.",
    prompts: ["Find a bookkeeper who uses Xero", "Who can start now with 6 or more hours of overlap?", "Compare my shortlist"]
  },
  {
    id: "scheduler",
    name: "Interview scheduler",
    icon: "calendar",
    summary: "Asks talent for interviews and finds times that work in both time zones.",
    prompts: ["Set up an interview with Paolo Ramos", "Move Maria's interview to Wednesday", "Which interviews are waiting?"]
  },
  {
    id: "onboarding",
    name: "Onboarding agent",
    icon: "briefcase",
    summary: "Adds new contractors to your projects as guests and tracks their contract dates.",
    prompts: ["Add Ana Reyes to Office move", "Whose contract ends next?", "Show hours for this month"]
  }
];

export const agentById = (id: string) => AGENTS.find((a) => a.id === id);

/** A message in a chat. An agent message can show talent cards. */
export interface ChatMessage {
  from: "you" | "agent";
  text: string;
  talent?: string[];
}

export interface Chat {
  id: string;
  title: string;
  agentId: string;
  when: string;
  messages: ChatMessage[];
}

/** Recent chats in the panel. */
export const CHATS: Chat[] = [
  {
    id: "c-301",
    title: "Bookkeeper for month-end close",
    agentId: "scout",
    when: "Today",
    messages: [
      { from: "you", text: "Find a bookkeeper who can close our month by day five. Xero, and some overlap with Pacific time." },
      {
        from: "agent",
        text: "I found 2 people who fit. Maria Santos is the best match: 6 years of bookkeeping, month-end close by day five, and 4 hours of overlap. Liza Garcia works US hours and does data entry, but she is not a bookkeeper.",
        talent: ["T-1042", "T-1266"]
      },
      { from: "you", text: "Shortlist Maria." },
      { from: "agent", text: "Done. Maria Santos is on your shortlist. Do you want me to ask her for an interview?" }
    ]
  },
  {
    id: "c-298",
    title: "Interview times with Maria Santos",
    agentId: "scheduler",
    when: "Yesterday",
    messages: [
      { from: "you", text: "Set up an interview with Maria Santos next week." },
      { from: "agent", text: "Maria accepted Tue, Nov 10, 9:00 a.m. PT. That is 1:00 a.m. Wednesday in Manila, and she works US hours. I sent the invite to you and to her.", talent: ["T-1042"] },
      { from: "you", text: "Ask Paolo Ramos too." },
      { from: "agent", text: "I asked Paolo Ramos for an interview. He can start in 2 weeks. I will tell you when he answers.", talent: ["T-1187"] }
    ]
  },
  {
    id: "c-287",
    title: "Onboard Ana Reyes",
    agentId: "onboarding",
    when: "Mon",
    messages: [
      { from: "you", text: "Ana Reyes starts Monday. Add her to Website relaunch." },
      { from: "agent", text: "Ana Reyes is now a guest editor on Website relaunch. She sees only that project. Her contract ends Feb 28, 2027." },
      { from: "you", text: "Can you add her to every project?" },
      { from: "agent", text: "I need your approval for that. Guests see only the projects you add them to, and 4 projects is a big change. Approve it in the project settings, or tell me which projects." }
    ]
  }
];

export const chatById = (id: string) => CHATS.find((c) => c.id === id);
