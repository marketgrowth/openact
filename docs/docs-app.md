---
title: Docs
description: A company library of paper-size docs, with folders, categories and tags. Share a doc with a link, or print it to PDF. Part of OpenAct Director.
---

# Docs

Docs is a company library of rich text documents. Each doc is a page the size of paper. You can sort docs into folders, give each doc a category, and add tags. You can share a doc with a link, and anyone can print it or save it as a PDF. The pages on screen match the printed pages.

::: tip Part of OpenAct Director
Docs is a paid app. It needs a [Director or Producer plan](plans.md). Without a plan, Docs is locked: the Apps page shows it with a **Director** badge and an **Upgrade** button, and your docs stay saved.
:::

Docs comes with OpenAct, next to Projects. It has its own icon in the app rail. In a company with a plan, it is on unless an admin turns it off.

## Write a doc

1. Choose **Docs** in the app rail.
2. Choose **New doc**. Type a title, and choose a folder, a category and a paper size if you want them.
3. Write. Your changes save on their own after a short pause.

The toolbar has headings, bold, italic, underline, strikethrough, links, lists, checklists, quotes, code blocks, sections that open and close, text alignment, images, tables, lines and page breaks. Press Ctrl+Enter (Cmd+Enter on a Mac) to start a new page.

Choose **Page** to set the paper size (Letter, A4 or Legal), the orientation and the margins. Dashed lines on the sheet show where each printed page starts.

Images must be PNG, JPEG, WebP or GIF files, up to 5 MB.

## Write together

Several people can write in the same doc at the same time. Each person sees the others' changes as they type, with a colored cursor and a name for each person. The status at the top of the doc shows **Live** while the connection is open.

- **Changes merge.** Two people can change the same paragraph at once. Nobody loses their work, and nobody has to reload.
- **Offline:** when the connection drops, keep writing. The status shows **Offline**, and your changes stay on this device. They sync when the connection comes back.
- **Readers:** people who can see docs but cannot write them watch the changes live. The server refuses changes from them, even if their browser sends some.
- **Saving:** the server saves every change at once. A few seconds after people stop typing, it also saves a clean copy that the library, share links and print use.

Live editing uses one Durable Object for each doc (`DOCS_ROOMS` in `wrangler.jsonc`). A deploy without that binding still works: Docs then saves the usual way, and when two people save the same doc, the second person sees a notice and can load the latest version.

The copy on a device is kept in the browser (IndexedDB). It is deleted when the doc is deleted or when you lose access to it. On a shared computer, use a private window.

## Comments

Choose **Comments** at the top of a doc to open the comments panel.

- **Comment on text:** select the text, then choose the comment button on the toolbar. The text gets a highlight. Click the highlight to open its thread.
- **Comment on the whole doc:** type in the box at the top of the panel.
- **Reply, resolve and reopen:** each thread has a reply box and a **Resolve** button. A resolved thread loses its highlight and moves to the resolved list. A reply reopens it.
- **Mention someone:** type @ and choose a person. They get an email with a link to the doc. People who already wrote in a thread get an email when someone replies.
- **Change or delete:** you can change and delete your own comments. The person who started a thread can delete it. People who can organize the library can delete any comment or thread.

Comments save at once, apart from the doc's content, so they never clash with someone who is writing. Other people see new comments as they arrive. Share pages and printed pages never show comments.

## AI writing help

Select text in a doc, then choose **AI** on the toolbar. Choose what the AI should do:

- Improve writing, Fix spelling and grammar, Make shorter, Make longer, Summarize
- Simplify: rewrites the text in Simplified Technical English (ASD-STE100) with American spelling
- Change tone: professional, friendly, confident, casual or direct
- Translate into one of 13 languages
- Ask AI: type your own instruction
- Continue writing: writes one or two paragraphs after the cursor. It needs no selection.

The answer streams into a preview. Your doc does not change until you choose **Replace selection**, **Insert below** or **Insert**. Choose **Try again** for another answer.

AI writing help is off until a company owner or admin turns it on, because it sends doc text to the AI. To turn it on, open **Company settings**, then the **Docs** tab. It sends only the selected text and up to 1,500 characters before and after it. For Continue writing, it sends the text before the cursor.

Docs uses the company's AI provider: the company's own key when an owner set one on the AI provider tab, or the deploy default. Requests go through Cloudflare AI Gateway. For local tests without AI, set `AI_PROVIDER` to `dev-scripted`.

## Organize the library

Docs gives you three ways to sort docs. Use them together.

| Tool | What it is for | Rules |
| --- | --- | --- |
| **Folders** | Where a doc lives, such as Clients / Acme / Proposals | A doc is in one folder or in none. Folders go up to 5 levels deep. |
| **Categories** | What kind of doc it is, such as Proposal, Policy or Meeting notes | A doc has one category or none. Each category has a color. |
| **Tags** | Free labels, such as Q1, Launch or Acme | A doc has up to 20 tags. Type a new name to make a new tag. |

The side panel shows the folder tree, the categories and the tags, with the number of docs in each. Choose one to see its docs. **All docs** shows every doc, and **Not in a folder** shows docs that have no folder. On each list, you can find a doc by its title and filter by category and tag.

To file a doc, open it and choose its folder, category and tags in the bar above the toolbar. These save at once. They do not change the doc's content, so they never clash with someone who is writing in it.

- **Folders:** choose **+** next to Folders to make a top-level folder. Open the menu of a folder to make a folder inside it, to rename or move it, or to delete it. You can delete a folder only when it is empty, so no doc is lost by mistake.
- **Categories:** choose the pencil next to Categories to add, rename, recolor or delete them. When you delete a category, its docs stay, with no category.
- **Tags:** editors make tags on a doc. Choose the pencil next to Tags to rename a tag or to delete it from every doc.

## Who can do what

Docs belong to the company. Docs has six permissions. A company owner or admin can change who has them in Company settings, under Permissions.

| Permission | What it allows | Default roles |
| --- | --- | --- |
| See docs | Open and print every doc in the library | Owner, admin, member |
| Write docs | Make, change and delete docs, add images, file docs in folders and categories, and tag them | Owner, admin, member |
| Organize the library | Make, rename, move and delete folders and categories, and rename or delete tags | Owner, admin |
| Share docs with a link | Make a share link, or turn it off | Owner, admin, member |
| Comment on docs | Read comments, start threads, reply, and resolve. Starting a thread on text also needs Write docs. | Owner, admin, member |
| Use AI writing help | Send selected text to the company's AI, when the company turned AI on | Owner, admin, member |

Guests do not see Docs. Every member who can see docs sees every doc in the company.

## Share a doc

1. Open the doc, then choose **Share**.
2. Choose **Make share link**, then **Copy**.

Anyone with the link can read the doc and print it. They cannot change it, and they do not need an account. The link always shows the latest saved version. The page has a table of contents when the doc has two or more headings.

- **Make a new link** replaces the link. The old link stops working at once.
- **Turn off link** stops all access through the link.
- Deleting the doc also stops the link.
- The link stops while Docs is off for the company or the site.

Share pages ask search engines not to list them, and they send no referrer to other sites. Treat a share link like a password: anyone who has it can read the doc.

## Print or save as a PDF

Choose **Print or PDF** in the editor, or **Print or save as PDF** on a share page. In the print dialog, choose **Save as PDF** as the printer.

The share page splits the doc into sheets of the page size, and each sheet prints as one page. Page numbers show at the bottom of each page. Sections that open and close print open.

A table or image that is taller than one page gets a page of its own on screen, but the browser splits it in print. Keep long tables short, or split them, when the page count matters.

## Turn Docs off

- **For one company:** a company owner or admin opens **App directory** on the app rail, then turns off Docs. The data stays.
- **For the whole site:** a super admin opens **Site settings**, then turns off Docs under **Apps**. Companies cannot turn it on again until a super admin does. Read [Site name, logo and apps](getting-started.md#site-name-logo-and-apps).

## How it works

- Docs keeps each doc as Tiptap JSON in D1. The Worker cleans every save against a fixed list of allowed blocks, styles and attributes. Links can go only to web pages, email addresses, phone numbers and headings in the same doc. Images must be files uploaded to the doc.
- The share page and the print page build their HTML on the server from the cleaned doc. They escape all text, and a strict Content-Security-Policy lets only the page's own script and style run.
- The database keeps a SHA-256 hash of each share token to find the doc, and a copy encrypted with `AUTH_SECRET` so people can copy the link again. It never keeps the token in plain text.
- Images live in R2 under `docs/<company id>/<doc id>/`. Uploads are checked by their first bytes, not their file name.
- Live editing follows the y-websocket protocol with Yjs. The browser connects to `/api/apps/docs/collab/<doc id>`. The Worker checks the session, the Origin and the Docs permissions, then passes the connection to the doc's Durable Object. The Durable Object also checks once a minute that each person is still in the company.
- The library has a revision number. A live room per company tells open Docs pages to load the lists again when someone changes a doc, a folder, a category or a tag.
- Share links live at `/docs/s/<token>`. `wrangler.jsonc` sends these paths to the Worker before the web app (`run_worker_first`).
