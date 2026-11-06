/* Sample data for the Orbytt mockup. These people do not exist. The real app gets talent from the Orbytt API. */

export interface Talent {
  /** Orbytt shows an ID, not a name, until the person accepts an interview. */
  id: string;
  role: string;
  city: string;
  country: "PH" | "US";
  /** Hours each workday that overlap with the company's hours (Pacific time in this mockup). */
  overlap: number;
  rate: number;
  skills: string[];
  available: string;
  years: number;
}

export const TALENT: Talent[] = [
  { id: "T-1042", role: "Bookkeeper", city: "Quezon City", country: "PH", overlap: 4, rate: 14, skills: ["Xero", "QuickBooks", "Payroll"], available: "Now", years: 6 },
  { id: "T-1187", role: "Shopify developer", city: "Cebu City", country: "PH", overlap: 3, rate: 22, skills: ["Shopify", "Liquid", "React"], available: "In 2 weeks", years: 5 },
  { id: "T-0931", role: "Executive assistant", city: "Austin, TX", country: "US", overlap: 8, rate: 38, skills: ["Calendar", "Travel", "Notion"], available: "Now", years: 9 },
  { id: "T-1210", role: "Customer support lead", city: "Davao City", country: "PH", overlap: 6, rate: 11, skills: ["Zendesk", "Help Scout", "Training"], available: "Now", years: 7 },
  { id: "T-0877", role: "Paid ads specialist", city: "Denver, CO", country: "US", overlap: 7, rate: 65, skills: ["Google Ads", "Meta Ads", "GA4"], available: "In 1 month", years: 8 },
  { id: "T-1305", role: "Video editor", city: "Iloilo City", country: "PH", overlap: 2, rate: 12, skills: ["Premiere Pro", "After Effects", "Shorts"], available: "Now", years: 4 },
  { id: "T-1121", role: "HubSpot admin", city: "Raleigh, NC", country: "US", overlap: 5, rate: 72, skills: ["HubSpot", "Workflows", "Reporting"], available: "In 2 weeks", years: 6 },
  { id: "T-1266", role: "Virtual assistant", city: "Makati", country: "PH", overlap: 8, rate: 9, skills: ["Inbox", "Data entry", "Canva"], available: "Now", years: 3 },
  { id: "T-0998", role: "Full stack developer", city: "Columbus, OH", country: "US", overlap: 6, rate: 85, skills: ["TypeScript", "Cloudflare", "Postgres"], available: "In 1 month", years: 11 },
  { id: "T-1339", role: "Social media manager", city: "Baguio", country: "PH", overlap: 4, rate: 13, skills: ["Instagram", "TikTok", "Planning"], available: "Now", years: 5 }
];

/** Saved searches in the panel. Each one fills the search box on the Find talent page. */
export const SAVED_SEARCHES = [
  { label: "Bookkeeper with Xero", query: "Xero" },
  { label: "Shopify developer", query: "Shopify" },
  { label: "Support with Zendesk", query: "Zendesk" }
];

export const INTERVIEWS = [
  { talentId: "T-1042", role: "Bookkeeper", when: "Tue, Nov 10, 9:00 a.m. PT", status: "Accepted" },
  { talentId: "T-1187", role: "Shopify developer", when: "Waiting for the talent", status: "Asked" }
];

export const CONTRACTORS = [
  { name: "Ana Reyes", role: "Customer support lead", city: "Davao City, Philippines", projects: ["Website relaunch"], projectRole: "Editor", ends: "Feb 28, 2027", hours: 32, rate: 11 },
  { name: "Marco Dela Cruz", role: "Bookkeeper", city: "Quezon City, Philippines", projects: ["Fall fundraiser", "Office move"], projectRole: "Editor", ends: "Dec 31, 2026", hours: 18, rate: 14 }
];

export const ACTIVITY = [
  { icon: "video", text: "T-1042 accepted your interview for Tue, Nov 10, 9:00 a.m. PT.", when: "2 h ago" },
  { icon: "briefcase", text: "Ana Reyes logged 6 h on Website relaunch.", when: "Yesterday" },
  { icon: "star", text: "You shortlisted T-1187, Shopify developer.", when: "Yesterday" },
  { icon: "users", text: "Marco Dela Cruz joined Fall fundraiser and Office move as a guest.", when: "Mon" }
];

/** A sample match score: higher when the talent fits the search. */
export function matchScore(t: Talent, query: string): number {
  const base = 70 + (parseInt(t.id.slice(2), 10) % 17);
  const q = query.trim().toLowerCase();
  if (q && t.skills.concat(t.role).some((s) => s.toLowerCase().includes(q))) return Math.min(98, base + 12);
  return base;
}
