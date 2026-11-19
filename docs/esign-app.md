---
title: eSign
description: Send PDFs for signature. Templates with signer roles and fields, signing links that need no account, and a signed PDF with a signing certificate. Part of OpenAct Director.
---

# eSign

eSign lets a company send PDFs for signature. You upload a PDF, add signer roles such as Client and Company, and put fields on the pages. Then you send it. Each signer gets an email with their own link. A signer needs no account. When everyone has signed, eSign makes the signed PDF with a signing certificate at the end.

::: tip Part of OpenAct Director
eSign is a paid app. It needs a [Director or Producer plan](plans.md). Without a plan, eSign is locked: the Apps page shows it with a **Director** badge and an **Upgrade** button, and the signing links stop working until the company has a plan again. Your data stays saved.
:::

eSign has its own icon in the app rail. It works without Docs. When Docs is on, you can send a PDF from the Docs library, and eSign saves each signed PDF back to Docs.

## Install eSign

On sites that MarketGrowth runs, eSign is already installed. On your own deploy, you need a [license key](plans.md#license-keys) and access to the private Director repository. Read [Get the Director apps](plans.md#get-the-director-apps).

```bash
npm run openact -- add esign
npm install
npm run deploy
```

eSign is a new app. It is not a copy of DocuSeal or of any other product, and it has none of their code.

## Who does what

| Role | What they do | Permission |
| --- | --- | --- |
| Sender | Makes templates, sends documents, and sees, reminds and voids the documents they sent | Send documents for signature (`esign.send`) |
| Manager | Sees, reminds and voids every document, changes every template, and chooses where signed PDFs go | Manage all documents (`esign.manage`) |
| Signer | Opens the link from the email, agrees to sign electronically, fills in their fields and signs | No account. The link is the access. |

By default, owners, admins and members can send. Owners and admins manage. Change this in Company settings, on the Permissions tab. Guests do not see eSign.

Templates belong to the company. Everyone who can send can use every template. Only the person who made a template, or a manager, can change it.

## Send a document

1. Choose **eSign** in the app rail, then **New document**.
2. Choose one:
   - **Use a template**: the send form opens.
   - **Upload a PDF**: up to 25 MB. eSign makes a template from it and opens the editor.
   - **From Docs**: choose a PDF in the Docs library. This shows when Docs is on and you can see docs.
3. In the editor, name each signer role, such as Client and Company. A template can have up to 10 roles.
4. Choose a role, then a field type, then click on a page. Hold Shift to place more than one field.
5. Drag a field to move it. Drag its corner to resize it. The panel on the right changes its role, type, label and choices.
6. Choose **Save**, then **Send for signature**.
7. Type a name and an email for each role. Turn on **Sign in order** if the second signer must wait for the first. Add a note if you want. Choose **Send**.

Every role needs at least one signature or initials field before you can send.

### Field types

| Field | What the signer does |
| --- | --- |
| Signature | Draws, types or uploads a signature. One signature fills every signature field of that signer. |
| Initials | The same, for initials |
| Full name | Types their name. It starts with the name the sender typed. |
| Email | Nothing. eSign fills in the signer's email. |
| Date signed | Nothing. eSign fills in the date of signing (UTC). |
| Text | Types one line of text |
| Checkbox | Checks it. Optional by default. |
| Choice | Picks one of the choices |

### Keyboard

| Keys | What they do |
| --- | --- |
| Arrow keys | Move the selected field. Hold Shift for bigger steps. |
| Delete or Backspace | Remove the selected field |
| Ctrl+D or Cmd+D | Copy the selected field |
| Ctrl+S or Cmd+S | Save |
| Escape | Stop placing fields, or clear the selection |

## Sign a document

The signer opens the link in the email. The page shows the PDF with their fields in yellow. Other signers' fields show as dashed boxes with the role name.

1. Fill in each field. **Next field** goes to the next field that is not done.
2. Choose **Sign here** to add a signature: draw it, type it or upload a picture.
3. Check the box to agree to sign electronically.
4. Choose **Finish and sign**.

A signer can also choose **Decline** and give a reason. Then the document closes for everyone, and the sender gets an email.

The signing token is in the hash of the link (`/esign/sign#<token>`). The browser never sends the hash to a server, so the token stays out of server logs. The page sends it to the API in a header. eSign stores only a hash of the token, and a copy sealed with `AUTH_SECRET` so that reminders can use the same link.

## When everyone has signed

The Worker makes the signed PDF:

- It draws each value on the pages.
- It locks the PDF's own form fields, if it has any, into the pages.
- It adds a **signing certificate** at the end: the document ID, the SHA-256 hash of the original PDF, each signer's name, email, role, times (sent, opened, agreed, signed), IP address and device, their signature, the agreement text, and the full audit log.

Then eSign:

- stores the signed PDF and its SHA-256 hash,
- saves a copy to Docs, when Docs is on and **Save signed PDFs to Docs** is on,
- emails each signer a link to download it, and emails the sender the hash.

If making the PDF fails, the job that runs every 10 minutes tries again, up to 5 times. The sender can also choose **Try again** on the document page.

### Check a copy

On the document page, **Check a copy** compares a file with the hash of the signed PDF. The browser computes the hash. The file does not leave the computer. A copy that matches is the signed PDF with no changes.

## The document page

| Action | What it does |
| --- | --- |
| Remind | Emails the signers who can sign now and have not signed, with the same link. At most once an hour for each signer. |
| Void | Closes the document. The signing links stop working. Signers who got the email get a short notice. |
| Signed PDF | Downloads the signed PDF with its certificate |
| Delete | Deletes a voided or declined document and its audit log. A completed document stays as a record. |

A template that was sent cannot be deleted, so its documents keep their PDF. Archive it instead. Documents sent from an archived template keep working.

## Company settings

Company settings has an **eSign** tab:

- **Save signed PDFs to Docs**: on by default. It works when Docs is on for the company.
- **Docs folder**: where signed PDFs go. The default is the top of the library.

## Legal use

In the US, the ESIGN Act and UETA accept an electronic signature when the signer shows intent to sign and agrees to do business electronically. eSign records both: the signer checks the agreement box, and each signature has a time, an IP address and a device in the audit log. Other countries have their own rules.

MarketGrowth is not a law firm. Ask a lawyer to check the agreement text and your use before you send contracts with eSign. Some documents, such as wills and some court papers, cannot be signed electronically in many places.

## How it works

| Part | Where |
| --- | --- |
| Tables | `esign_templates`, `esign_submissions` (a document sent for signature), `esign_submitters` (one signer), `esign_events` (the audit log), `esign_settings`, `esign_state` |
| Files | R2 under `esign/<company id>/`: `t/<template id>.pdf` for templates, `s/<document id>/<file id>.pdf` for signed PDFs |
| Signed-in API | `/api/apps/esign/...` in `apps/esign/src/server/routes.ts` |
| Signing API | `/api/apps/esign/public/...` in `apps/esign/src/server/public.ts`. The token comes in the `X-Esign-Token` header. |
| PDF work | `apps/esign/src/server/pdf.ts`, with [pdf-lib](https://pdf-lib.js.org) (MIT) |
| Pages in the browser | [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0) draws the pages. It loads only on eSign pages. |
| Docs link | `appService("docs", "library")`. Without Docs, eSign works the same and skips the Docs parts. |

A document keeps a copy of the template's fields from the moment it was sent. A later change to the template does not change a document that people are signing.

## Not in eSign yet

- A digital signature with a certificate (PAdES), so that PDF readers show the file as unchanged
- An API and webhooks for other systems
- Bulk send from a list
- Reminders on a schedule, and links that expire
- Fonts for characters outside Western European languages on the signed PDF. Such characters show as "?" today.
- Text fields with more than one line
