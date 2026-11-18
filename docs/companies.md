# Companies and access

Every project belongs to one company. A person can be in many companies and switch between them with the company mark at the top of the app rail.

A company can split its work into [workspaces](workspaces.md), such as brands, business units, locations or regions. Use a workspace when the same team does the work. Use a separate company when the people, billing or legal entity are different.

| Company role | What they can do |
| --- | --- |
| Owner | Manage the company, its people, its owners and every company project. Delete the company. |
| Admin | Manage the company, its people and every company project. |
| Member | See every company project as a viewer. Create projects. A company can change both in **Company settings > Permissions**. |
| Guest | See only the projects they are invited to. |

The gear at the bottom of the app rail opens **Settings** as a page. The side panel lists its sections in three groups:

- **Company settings**, for owners and admins: **General**, **People**, **Workspaces**, **Apps**, **Permissions**, **AI provider**, and a section for each app that adds one.
- **Personal account**, for everyone: **Profile** (name, email and theme) and **Sign-in and security** (sign out, delete account).
- **Site settings**, for super admins only.

Each section has its own address, such as `/settings/company/people`, so you can link to it.

| Project visibility | Who can see it |
| --- | --- |
| Company | Every company member, as a viewer. Company owners and admins manage it. People on the project keep their project role. |
| Secret | Only the people on the project. Company owners and admins do not see it unless they are on it. |

- **Invite to the company** from **Company settings > People**. People join as members or admins.
- **Invite to one project** from that project's **People** tab. Someone from outside the company joins as a guest and sees only that project.
- **Email domain auto-join.** Set a domain such as `acme.com` in **Company settings > General**. People who sign in with that domain join as members. Public domains such as gmail.com are refused, your own email must use the domain, and each domain belongs to one company.
- **Request access.** A person who opens a project link without access sees a request form. The project owners get an email and approve (with a role) or decline in the **People** tab. Approving someone from outside the company makes them a guest. The page never shows the project's name.
- **AI defaults.** Company owners and admins set the AI access, note search and topic scope that new projects start with.
- **AI provider.** A company owner can choose the AI for the company's projects. Read [The AI provider of a company](#the-ai-provider-of-a-company).
- **Removing someone from a company** removes them from all its projects.
- **Upgrading an older install.** Migration `0003_companies.sql` gives each project owner a company that holds their projects. Everyone else becomes a guest, so nobody can see more than before. Make people members in **Company settings** when you are ready.
- The AI agent only routes requests to projects in the same company.

Company owners and admins can also turn apps on or off and choose what each role can do in each app. Read [Permissions](permissions.md).

## Duplicate a company

A super admin can make a new company with a copy of another company's content. Use it to start a new company from a template, such as a company that holds the projects and policies for one kind of client.

1. Open **Settings > Site settings > Duplicate a company**.
2. Find the company, then click **Duplicate**.
3. Type a name for the new company, then click **Duplicate company**.
4. When the copy is ready, the page shows what was copied. Click **Open the company** to go to it.

You are the only owner of the new company. Invite people to it in **Company settings > People**.

| Copied | Not copied |
| --- | --- |
| The logo, the app settings, the permissions, the app blocks and the AI defaults | People, invitations and the email domain |
| Projects with their columns, tasks, phases, dates, notes and task files | Task assignees, project members, access requests and AI agent history |
| The Docs library: folders, categories, tags, docs, images and PDFs, and the AI writing help setting | Comments, share links and old PDF files that a new upload replaced |
| | The plan and the company's AI provider key |

Notes:

- You own each copied project, so secret projects stay open to you.
- Each image and file gets its own copy. The new company never points at the files of the original.
- A duplicate copies up to 400 files and 500 MB. For a larger company, delete some files first.
- If a step fails, OpenAct deletes the new company and its files. The original does not change.
- Each app copies its own data with the `companyDuplicating` hook. An app without the hook starts empty in the copy. Advisory has no hook, so its advisors, offers and engagements are not copied.
- A person can own up to 20 companies. Make another person an owner of a company and leave it, or delete one, to make room.

## The AI provider of a company

Each deploy has a default AI. The person who runs the deploy sets it with `AI_PROVIDER` and `AI_MODEL`. Read [Settings](getting-started.md#settings).

A company owner can replace the default with Claude and the company's own Anthropic API key:

1. Open **Company settings > AI provider**.
2. Set **Provider** to **Claude (Anthropic)**.
3. Choose a model. Claude Sonnet 5.5 is the recommended default. Claude Haiku 5.5 is faster and costs less. Claude Opus 5.5 is the strongest.
4. Make a key at [console.anthropic.com](https://console.anthropic.com/settings/keys) and paste it in **API key**.
5. Click **Test and save**. OpenAct sends one very short request with the key. If the key or the model does not work, nothing is saved and the page says why.

What changes:

- The agent, the topic check, task drafts and status summaries in every project of the company use Claude. The topic check uses Claude Haiku 5.5. Jev still runs the topic check when the deploy sets `TYPESAFE_API_KEY`.
- Search by meaning still uses the deploy's Workers AI embedding model.
- The company pays Anthropic for each request. Requests still go through the deploy's Cloudflare AI Gateway, so the deploy needs `CF_ACCOUNT_ID` and `AI_GATEWAY_ID`.

How the key is kept:

- The server encrypts the key with AES-GCM before it saves it in D1. The encryption key comes from `AUTH_SECRET`. Each saved key is bound to its company, so it does not decrypt for another company.
- The key never goes back to the web app. The page shows only its last 4 characters.
- If `AUTH_SECRET` changes, saved keys stop working, and the deploy default runs. The page asks a company owner to paste the key again.

Who can do what:

- Company owners change the provider, the model and the key. To change only the model, leave **API key** empty.
- Company admins see the current provider and model, but they cannot change them.
- **Use the deploy default** deletes the saved key, and the company goes back to the deploy default.

The setting is in the `company_ai` table (migration `0007_company_ai.sql`). Deleting a company deletes its row.
