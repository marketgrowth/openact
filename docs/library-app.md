---
title: Library
description: One body of reference content for the whole site. Super admins write and publish. Every company reads.
---

# Library

The Library app (id `library`) holds one body of reference content for the whole site. It has two kinds of item:

- **Sources**: official pages, such as laws, rules and agency letters, each with a plain-language summary and a link.
- **Updates**: dated notes that say what changed, who it affects and what to do by when.

The site owns the content, not a company. Only super admins write it. Every company with the app on reads the same Library. Library is a free app.

## Make it fit your brand

The app holds no brand words. A super admin sets them in **Library > Lists and settings**.

| Setting | Default | Example: a care home site |
| --- | --- | --- |
| Page title | Library | Resource Library |
| Name for sources | Sources | Sources |
| Name for updates | Updates | Rule updates |
| List 1 (category) | Category | Level: Federal, State, Local |
| List 2 (audience) | Audience | Facility type |
| List 3 (topic) | Topic | Topic: Licensing, Surveys |
| Update field labels | What changed, Who it affects, What to do, By when | Same |
| "Last checked" date on sources | On | On |
| Notice under the title | Empty | "We give guidance, not legal advice." |
| Review checklist | 2 checks | Add "No personal data" |
| "New" window | 30 days | 30 days |
| Require a second reviewer | Off | Off |
| Ask (AI chat) | On | On |
| Line under the Ask box | "Ask a question. Answers come only from the published items, with a link to each one." | Same |

Each list can be off. A list that is off shows no filter and no tags. Its data stays.

Each list item can be renamed, moved or hidden. A hidden item stays on the items that have it, but readers cannot filter by it. Items are never deleted, so links do not break.

## Read

Readers need the **Read the library** permission (`library.view`). Owners, admins and members have it. Guests do not. Company owners and admins can change it in **Company settings > Permissions**.

- **Sources** (`/a/library`): search, then one group of boxes per list. A source shows **Updated** when an update that changes it was published inside the "new" window.
- **Updates** (`/a/library/updates`): newest first. The new ones are on top. The app panel shows how many are new.
- Each item has its own page with its official link and its links to other items.

Readers only see published copies.

## Ask

Ask is an AI chat at the top of the home page. A reader types a question, and the answer comes only from the published items, with a numbered link to each item it uses. Follow-up questions keep the thread.

How it works (retrieval-augmented generation):

1. The server ranks the published sources and updates for the question with keyword search (BM25). It counts the title twice. A follow-up also uses the question before it.
2. It sends the best 6 items to the model as numbered, labeled data. Drafts, review notes and archived items never go to the model.
3. The model answers with item numbers, such as [1]. The page turns each number into a link. Numbers that do not match an item are removed.
4. When no item matches, the server asks no model and says that the library does not cover the question yet.

Ask uses the same AI as the rest of OpenAct: the person's own key (when the company allows personal keys), then the company key, then the deploy default. The page says which one answers. A personal key bills the person's own account. AI answers can be wrong, so the page tells readers to check the source.

Readers need the **Ask the library** permission (`library.ask`). Owners, admins and members have it. A super admin can turn Ask off for the whole site in **Lists and settings**.

## Write, review and publish

Super admins see **Manage** in the app panel. Each item moves through these steps:

1. **Draft.** A super admin adds or edits the item. Readers do not see it.
2. **In review.** The writer sends it for review. A reviewer publishes it, or sends it back with a note.
3. **Published.** Every company sees it. Each publish keeps a version.
4. **Archived.** Readers no longer see it. The item and its versions stay. **Restore** brings it back.

To publish, the reviewer ticks every check on the site's review checklist. An update gets a published date: today, or a date that the reviewer sets, such as the date of the letter.

An edit to a published item makes a new draft. Readers keep the published version until the next publish.

When **Require a second reviewer** is on, an item must be in review, and a different super admin must publish it. The person who sent it or last changed it cannot.

## Use it from another app

The Library offers a service named `content`. It returns published content only. It does not check access: check that the Library is on for the company, and check your own permissions, first.

```ts
import { appService, companyAppState } from "@openact/core/server";
import type { LibraryContentService } from "@openact/app-library/service";

const library = appService<LibraryContentService>("library", "content");
const on = library && (await companyAppState(env, companyId)).enabled("library");
if (on) {
  const updates = await library.listUpdates(env, { audienceIds: [homeTypeId], since: "2026-10-24", limit: 5 });
  const links = updates.map((u) => library.itemPath("update", u.id)); // /a/library/updates/<id>
}
```

| Call | Returns |
| --- | --- |
| `listTerms(env, kind)` | The visible items of one list (`category`, `audience` or `topic`), in order. Empty when the list is off. |
| `listUpdates(env, { categoryIds?, audienceIds?, topicIds?, q?, since?, limit? })` | Published updates that match, newest first. `since` is a `YYYY-MM-DD` published date. |
| `listSources(env, { categoryIds?, audienceIds?, topicIds?, q?, limit? })` | Published sources that match, with the Updated date |
| `getUpdate(env, id)`, `getSource(env, id)` | One published item, or `null` |
| `itemPath(kind, id)` | The item's page in the web app |

An item matches a list when it has any of the ids you give for that list. Store the ids that your app needs, such as a map from your own types to Library audience ids, in your app's own data.

## Data

| Table | Holds |
| --- | --- |
| `library_terms` | The list items |
| `library_sources`, `library_updates` | The working copies |
| `library_source_terms`, `library_update_terms`, `library_update_sources` | Their links |
| `library_versions` | The published copies. Readers see the newest one. |
| `library_settings` | The brand settings, and the Ask switch |

These tables have no `company_id`, because the site owns the content. `npm run sync` warns about each one. That is expected for this app. Every write route calls `requireSuperAdmin`, and every read route calls `requirePermission` with `library.view`.

## Coming next

- **Make a task** from an update, in Projects, and "new since your last visit" for each person.
- Public pages for search, under `/a/library/`, with a Public switch for each item.
- Ask: answers that stream as the model writes, and semantic search with Vectorize next to keyword search.
