---
title: Library
description: A resource library at three levels. The site keeps a Content Vault, each company keeps its own library, and each person keeps My Library. Readers search in plain words with Ask.
---

# Library

The Library app (id `library`) is a resource library at three levels:

| Level | Who manages it | Who reads it |
| --- | --- | --- |
| **Content Vault** | Site owners (super admins) | Site owners only. Automations and AI agents add to it. |
| **Company library** | The company owner (permission `library.manage`) | The company's members |
| **My Library** | Each person | That person only. It holds their bookmarks and the items they add. |

A member sees only their company library and their own My Library. The vault is never visible on a company route. Library is a free app.

It holds four formats of resource:

| Format | How it gets in | How readers see it |
| --- | --- | --- |
| Document | Upload a PDF, Word, PowerPoint, Excel or text file (up to 100 MB) | A preview of a PDF, and a link to open the file |
| Link | Paste a link | The page's title, summary and image, and a link to the page |
| Video | Paste a YouTube or Vimeo link, or upload an MP4, WebM or MOV file (up to 100 MB) | A player in the page |
| Article | Write it in the app | The full text in the page |

## The side panel

- A **search field** with an agent icon. Type a question and press Enter, or press `/` to go to the field. It opens Ask.
- **My Library**: Bookmarked, Add to My Library.
- **Company Library**: All resources, Categories.
- **Manage Company** (company owners only): Company resources, Add resource, Library Settings.
- **Manage Site Library** (site owners only): Content Vault, Add to Content Vault, To review, Automations, Site Library Settings.

## Read

The library page has the page title, a line of intro text, the suggested questions, the filters and the cards. Readers can:

- filter by format (Videos, Documents, Links, Articles), and by each list that is on, such as Type and Topic
- sort by newest or A to Z, and search by keyword
- share a filtered view: the filters are in the address
- open a resource: the player, preview or text, its tags, related resources, and "Ask about this"
- save a resource to My Library with the bookmark icon

Featured resources come first. On a phone, the list filters fold into one "Filters" button. **Categories** shows each list value with its count.

## My Library

My Library has two parts:

- **Saved**: published company resources that the person bookmarked. A resource that the company archives or deletes leaves the list.
- **Added by me**: links, files and notes that the person adds. They are published at once, and only that person sees them. The page shows the badge "Only you".

A person can add up to 200 items and 500 MB of files in each company. When a person leaves a company, their My Library there is deleted, with its files and bookmarks.

## Ask

Ask is a natural language search over the library. It answers only from the company's published resources and the person's own My Library items, with a numbered link to each one it uses. It never reads the vault, drafts, or another person's items.

1. Each save of a resource splits its summary, text and extracted text into chunks of about 300 words. A document's text comes from Workers AI (`toMarkdown`), when the deploy has it. A link's text comes from its page.
2. For each question, the server ranks the chunks with BM25 keyword search and keeps the best 8, from at most 6 resources.
3. The model gets those chunks as untrusted data, numbered by resource, and must cite each fact as [1], [2] and so on. A personal item is marked as the reader's own private item. A number that does not match a resource is dropped from the answer.
4. The answer streams as [AG-UI](./reference/ag-ui.md) events: `RUN_STARTED`, the `search` step, a `CUSTOM` event `library.searched` with the counts, the `answer` step, the text message, a `CUSTOM` event `library.citations` with the cited resources, and `RUN_FINISHED`. A citation of a personal item has `personal: true`.

When no chunk matches, Ask says so and makes no model call. A follow-up keeps the last 6 turns, and uses the question before it to find resources. "Ask about this" sends the resource id as `forwardedProps.resourceId`, so Ask reads only that resource.

Ask uses the same AI as the rest of the site: the person's own key, then the company key, then the partner or site default. It calls the core helper `aiText()`, so keyed providers go through Cloudflare AI Gateway.

- Permission `library.ask` (owner, admin and member by default) decides who may ask.
- The company setting **Search with AI (Ask)** turns it off for the company. Then the route answers 409 and the search field hides.
- The setting **Notice under each answer** adds a line, such as "We give guidance, not legal advice."

The route is `POST /api/apps/library/companies/:id/ask`. It takes an AG-UI `RunAgentInput` body, so any AG-UI client can use it.

## Manage Company

The company owner sees **Manage Company**. The pages are the same as the vault pages, for the company's own library:

- **Company resources**: tabs Drafts, Published and Archived. Publish, edit, archive, restore or delete.
- **Add resource**: paste a link or upload a file. The server reads the page or the file and fills the title, summary, image and format. Check the fields, pick the tags, then publish or save a draft. "Or write an article" opens an empty article.
- **Library Settings**: the page words, the lists, the suggested questions, the notice and Ask.

A new company starts with a copy of the site's lists. After that, the company changes its own lists, and the site lists do not change them. A company resource can use only the company's own list values.

## Manage Site Library

Site owners see **Manage Site Library**:

- **Content Vault**: the site's templates. Tabs To review, Drafts, Published and Archived.
- **Add to Content Vault**: the same form as Add resource.
- **To review**: drafts that automations and AI agents added. Each row shows where it came from. Publish, edit or dismiss it. A dismissed entry does not come back from its feed.
- **Automations**: see below.
- **Site Library Settings**: the default words, lists and switches. A company that sets no words of its own uses these.

A resource is a Draft, Published or Archived. An archived resource leaves the list and Ask. An edit to a published resource goes live when you save it. There is no version history.

Two switches apply to the vault only:

- **Review before publish** (off by default) needs a second site owner to publish each resource that a person adds. Each automation has its own setting.
- **Fill in new items with AI** (off by default) writes a short summary and picks a type and topics for new links, files and automation items. It uses the deploy default AI.

A later release lets company owners copy vault templates into their own library.

## Automations

Automations add resources to the vault without a person. Each one sends new resources to To review, or publishes them.

| Automation | How it works | Limits |
| --- | --- | --- |
| Feed or blog | An RSS or Atom feed, or a blog address that links to its feed. The cron job checks it every hour, day or week. A new entry becomes a Link with the automation's tags. | 20 automations a site, 10 new entries a run |
| Video channel | A YouTube channel. New videos become Video resources that play in the page. | The same |
| Webhook | `POST /api/apps/library/inbound/<key>` with `url`, and optional `title`, `summary`, `type`, `topics` and `audience` (names from the site's lists). | 60 calls an hour a key, https links only |
| AI agents | The MCP tool `library_add_draft` adds vault drafts, for a super admin only. The tool `library_search` searches the caller's company library. | The person's own permissions |

"New automation" checks the address first and shows the latest 3 entries. You can start with those entries, or take only newer ones. The webhook key shows once. The site stores only its hash. **New key** stops the old one at once.

The Automations page lists each automation with its tags, where new items go, its last run and its state. A feed that fails 3 times in a row pauses, and the "Recent runs" log shows why. The cron trigger `*/10 * * * *` runs the feeds that are due, up to 5 a run.

Text from feeds, pages, files and webhooks is untrusted. The server drops its tags, cuts it to a safe length, and sends it to a model only as labeled data. The server reads only public `https` sites, never `localhost` or private addresses.

## Make it fit your brand

Every word that readers see is a setting. The site sets the defaults. Each company owner can set its own in **Library Settings**.

| Setting | Default | Example | Who sets it |
| --- | --- | --- | --- |
| Page title | Library | Resources, Research, Help center | Site and company |
| Line under the title | (none) | Guides, templates, videos and news from our team. | Site and company |
| Lists: label, and on or off | Type, Topic, Audience, all on | Content type, Industry, Role | Site and company |
| List values | (empty) | Guide, Template, Insight, Case study, News, Webinar | Site and company |
| Suggested questions (up to 3) | (none) | What is new this month? | Site and company |
| Notice under each answer | (none) | We give guidance, not legal advice. | Site and company |
| Search with AI (Ask) | On | | Site and company |
| Fill in new items with AI | Off | | Site only |
| Review before publish | Off | | Site only |

A hidden list value stays on the resources that use it, but readers cannot filter by it. A list that is off hides its filter and its tags.

Who can read the library, use Ask and manage the company library is set per company, in Company settings, on the Permissions tab.

## Use it from another app

The app has a `content` service. It returns one company's published resources only, and checks no access: call it after your own permission check. It never returns vault templates or My Library items.

```ts
import { appService } from "@openact/core/server";
import type { LibraryContentService } from "@openact/app-library/service";

const library = appService<LibraryContentService>("library", "content");
if (library) {
  const news = await library.listResources(env, companyId, { typeIds: [newsTypeId], since: "2026-11-01T00:00:00Z", limit: 5 });
  const hits = await library.search(env, companyId, "weekly check-in");
  const path = library.resourcePath(hits[0]!.id); // /a/library/r/<id>
}
```

| Function | Returns |
| --- | --- |
| `listTerms(env, companyId, kind)` | The visible values of one company list (`type`, `topic` or `audience`). Empty when the list is off. |
| `listResources(env, companyId, opts)` | Published resources, featured and newest first. Filter by `q`, `formats`, `typeIds`, `topicIds`, `audienceIds` and `since`. |
| `getResource(env, companyId, id)` | One published company resource, or null. |
| `search(env, companyId, query, limit)` | Published resources, best match first (BM25 over their text). |
| `resourcePath(id)` | The web app path of a resource. |

## Data

`library_resources.scope` is `vault`, `company` or `personal`. A company or personal row has `company_id`. A personal row also has `owner_user_id`. Every query names its level, so a route never mixes them.

| Table | Holds |
| --- | --- |
| `library_resources` | Scope, company, owner, format, title, summary, text, link, image, video, file, status, featured, origin, automation, dates |
| `library_terms` | List values: company (none for the site), kind, name, order, hidden |
| `library_resource_terms` | The tags of each resource |
| `library_chunks` | The Ask index: about 300 words a row |
| `library_bookmarks` | My Library bookmarks: company, person, resource |
| `library_company_settings` | Each company's settings, one row a key |
| `library_automations` | Feeds, video channels and webhooks (the key's hash only) |
| `library_automation_entries` | Entries each automation already took, so a dismissed one does not come back |
| `library_runs` | The last 200 runs, for the log and the webhook limit |
| `library_settings` | The site settings, one row a key |

The vault tables and site settings have no `company_id`. `npm run sync` warns about each one. That is expected.

Vault files live in R2 under `library/<resource id>/`. Company and personal files live under `library/<company id>/<resource id>/`. Deleting a resource deletes its file, chunks, tags and bookmarks. Deleting a company deletes its library, its members' My Library items and their files.

## Coming next

- White-label content: company owners copy vault templates into their library, with "Update available" when the site changes a template.
- Formats Ebook and Research card.
- Publicly Available: public links to resources, for campaign landing pages.
- Topic watch, semantic search (Vectorize), and export and import between sites.
