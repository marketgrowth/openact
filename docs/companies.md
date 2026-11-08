# Companies and access

Every project belongs to one company. A person can be in many companies and switch between them with the company mark at the top of the app rail.

| Company role | What they can do |
| --- | --- |
| Owner | Manage the company, its people, its owners and every company project. Delete the company. |
| Admin | Manage the company, its people and every company project. |
| Member | See every company project as a viewer. Create projects. A company can change both in **Company settings > Permissions**. |
| Guest | See only the projects they are invited to. |

| Project visibility | Who can see it |
| --- | --- |
| Company | Every company member, as a viewer. Company owners and admins manage it. People on the project keep their project role. |
| Secret | Only the people on the project. Company owners and admins do not see it unless they are on it. |

- **Invite to the company** from **Company settings > People**. People join as members or admins.
- **Invite to one project** from that project's **People** tab. Someone from outside the company joins as a guest and sees only that project.
- **Email domain auto-join.** Set a domain such as `acme.com` in **Company settings**. People who sign in with that domain join as members. Public domains such as gmail.com are refused, your own email must use the domain, and each domain belongs to one company.
- **Request access.** A person who opens a project link without access sees a request form. The project owners get an email and approve (with a role) or decline in the **People** tab. Approving someone from outside the company makes them a guest. The page never shows the project's name.
- **AI defaults.** Company owners and admins set the AI access, note search and topic scope that new projects start with.
- **AI provider.** A company owner can choose the AI for the company's projects. Read [The AI provider of a company](#the-ai-provider-of-a-company).
- **Removing someone from a company** removes them from all its projects.
- **Upgrading an older install.** Migration `0003_companies.sql` gives each project owner a company that holds their projects. Everyone else becomes a guest, so nobody can see more than before. Make people members in **Company settings** when you are ready.
- The AI agent only routes requests to projects in the same company.

Company owners and admins can also turn apps on or off and choose what each role can do in each app. Read [Permissions](permissions.md).

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
