---
title: Library
description: A resource library for the whole site. Readers filter it or ask an AI chat. Managers add resources in one step, and automations add more.
---

# Library

The Library app (id `library`) is a resource library for the whole site. It holds four formats of resource:

| Format | How it gets in | How readers see it |
| --- | --- | --- |
| Document | Upload a PDF, Word, PowerPoint, Excel or text file (up to 100 MB) | A preview of a PDF, and a link to open the file |
| Link | Paste a link | The page's title, summary and image, and a link to the page |
| Video | Paste a YouTube or Vimeo link, or upload an MP4, WebM or MOV file (up to 100 MB) | A player in the page |
| Article | Write it in the app | The full text in the page |

The site owns the content, not a company. Only super admins manage it. Every company with the app on reads the same library. Library is a free app.

One app fits many kinds of sites: guides and case studies for clients, studies and opinion pieces for members, how-to videos for customers, playbooks for partners, onboarding videos for staff. The app ships with neutral words and empty lists. Each site sets its own.

## Read

The library page has the page title, a line of intro text, the Ask box, the filters and the cards. Readers can:

- filter by format (Videos, Documents, Links, Articles), and by each list that is on, such as Type and Topic
- sort by newest or A to Z, and search by keyword
- share a filtered view: the filters are in the address
- open a resource: the player, preview or text, its tags, related resources, and "Ask about this"

Featured resources come first. On a phone, the list filters fold into one "Filters" button.

## Ask

Ask is an AI chat at the top of the library. It answers only from the published resources, with a numbered link to each one it uses.

1. Each save of a resource splits its summary, text and extracted text into chunks of about 300 words. A document's text comes from Workers AI (`toMarkdown`), when the deploy has it. A link's text comes from its page.
2. For each question, the server ranks the chunks with BM25 keyword search and keeps the best 8, from at most 6 resources.
3. The model gets those chunks as untrusted data, numbered by resource, and must cite each fact as [1], [2] and so on. A number that does not match a resource is dropped from the answer.
4. The answer streams as [AG-UI](./reference/ag-ui.md) events: `RUN_STARTED`, the `search` step, a `CUSTOM` event `library.searched` with the counts, the `answer` step, the text message, a `CUSTOM` event `library.citations` with the cited resources, and `RUN_FINISHED`.

When no chunk matches, Ask says so and makes no model call. A follow-up keeps the last 6 turns, and uses the question before it to find resources. "Ask about this" sends the resource id as `forwardedProps.resourceId`, so Ask reads only that resource.

Ask uses the same AI as the rest of the site: the person's own key, then the company key, then the site default. It calls the core helper `aiText()`, so keyed providers go through Cloudflare AI Gateway. Drafts never go to the model.

- Permission `library.ask` (owner, admin and member by default) decides who may ask.
- The setting **Ask (AI chat)** turns it off for the whole site. Then the route answers 409 and the box hides.
- The setting **Notice under each answer** adds a line, such as "We give guidance, not legal advice."

The route is `POST /api/apps/library/companies/:id/ask`. It takes an AG-UI `RunAgentInput` body, so any AG-UI client can use it.

## Manage

Super admins see **Manage** in the side panel:

- **To review**: drafts that automations and AI agents added. Each row shows where it came from. Publish, edit or dismiss it. A dismissed entry does not come back from its feed.
- **Add resource**: paste a link or upload a file. The server reads the page or the file and fills the title, summary, image and format. Check the fields, pick the tags, then publish or save a draft. "Or write an article" opens an empty article.
- **Automations**: see below.
- **Settings**: the lists, the page words, the suggested questions and the switches.

A resource is a Draft, Published or Archived. An archived resource leaves the list and Ask. An edit to a published resource goes live when you save it. There is no version history.

**Review before publish** (off by default) needs a second manager to publish each resource that a person adds. Each automation has its own setting.

**Fill in new items with AI** (off by default) writes a short summary and picks a type and topics for new links, files and automation items. It uses the site's AI (the deploy default), because a resource belongs to the site.

## Automations

Automations add resources without a person. Each one sends new resources to To review, or publishes them.

| Automation | How it works | Limits |
| --- | --- | --- |
| Feed or blog | An RSS or Atom feed, or a blog address that links to its feed. The cron job checks it every hour, day or week. A new entry becomes a Link with the automation's tags. | 20 automations a site, 10 new entries a run |
| Video channel | A YouTube channel. New videos become Video resources that play in the page. | The same |
| Webhook | `POST /api/apps/library/inbound/<key>` with `url`, and optional `title`, `summary`, `type`, `topics` and `audience` (names from the site's lists). | 60 calls an hour a key, https links only |
| AI agents | The MCP tools `library_search` and `library_add_draft`. An agent can only add drafts, and only for a super admin. | The person's own permissions |

"New automation" checks the address first and shows the latest 3 entries. You can start with those entries, or take only newer ones. The webhook key shows once. The site stores only its hash. **New key** stops the old one at once.

The Automations page lists each automation with its tags, where new items go, its last run and its state. A feed that fails 3 times in a row pauses, and the "Recent runs" log shows why. The cron trigger `*/10 * * * *` runs the feeds that are due, up to 5 a run.

Text from feeds, pages, files and webhooks is untrusted. The server drops its tags, cuts it to a safe length, and sends it to a model only as labeled data. The server reads only public `https` sites, never `localhost` or private addresses.

## Make it fit your brand

Every word that readers see is a setting. A super admin changes them in **Settings**.

| Setting | Default | Example |
| --- | --- | --- |
| Page title | Library | Resources, Research, Help center |
| Line under the title | (none) | Guides, templates, videos and news from our team. |
| Lists: label, and on or off | Type, Topic, Audience, all on | Content type, Industry, Role |
| List values | (empty) | Guide, Template, Insight, Case study, News, Webinar |
| Suggested questions (up to 3) | (none) | What is new this month? |
| Notice under each answer | (none) | We give guidance, not legal advice. |
| Ask (AI chat) | On | |
| Fill in new items with AI | Off | |
| Review before publish | Off | |

A hidden list value stays on the resources that use it, but readers cannot filter by it. A list that is off hides its filter and its tags.

Who can read the library and use Ask is set per company, in Company settings, on the Permissions tab.

## Use it from another app

The app has a `content` service. It returns published resources only, and checks no access: call it after your own permission check.

```ts
import { appService } from "@openact/core/server";
import type { LibraryContentService } from "@openact/app-library/service";

const library = appService<LibraryContentService>("library", "content");
if (library) {
  const news = await library.listResources(env, { typeIds: [newsTypeId], since: "2026-11-01T00:00:00Z", limit: 5 });
  const hits = await library.search(env, "weekly check-in");
  const path = library.resourcePath(hits[0]!.id); // /a/library/r/<id>
}
```

| Function | Returns |
| --- | --- |
| `listTerms(env, kind)` | The visible values of one list (`type`, `topic` or `audience`). Empty when the list is off. |
| `listResources(env, opts)` | Published resources, featured and newest first. Filter by `q`, `formats`, `typeIds`, `topicIds`, `audienceIds` and `since`. |
| `getResource(env, id)` | One published resource, or null. |
| `search(env, query, limit)` | Published resources, best match first (BM25 over their text). |
| `resourcePath(id)` | The web app path of a resource. |

## Data

All tables are site tables with no `company_id`. `npm run sync` warns about each one. That is expected.

| Table | Holds |
| --- | --- |
| `library_resources` | Format, title, summary, text, link, image, video, file, status, featured, origin, automation, dates |
| `library_terms` | List values: kind, name, order, hidden |
| `library_resource_terms` | The tags of each resource |
| `library_chunks` | The Ask index: about 300 words a row |
| `library_automations` | Feeds, video channels and webhooks (the key's hash only) |
| `library_automation_entries` | Entries each automation already took, so a dismissed one does not come back |
| `library_runs` | The last 200 runs, for the log and the webhook limit |
| `library_settings` | The settings, one row a key |

Files live in R2 under `library/<resource id>/`. Deleting a resource deletes its file, chunks and tags.

## Coming next

- Topic watch: AI searches the web for a topic on a schedule and adds what it finds to To review.
- Semantic search (Vectorize) next to keyword search, and token-by-token streaming of answers.
- Public pages, at a path the site picks.
- Export and import between sites.
