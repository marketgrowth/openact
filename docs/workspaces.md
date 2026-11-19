# Workspaces

A workspace is a named slice of a company's work. Use workspaces when one team works on several brands, business units, locations or regions.

OpenAct has two flat levels:

1. **Companies.** One deploy holds many companies. Each company has its own people, roles, plan and billing.
2. **Workspaces.** Each company holds one or more workspaces. Workspaces do not nest.

## Company or workspace?

| Situation | Use |
| --- | --- |
| Different people, different billing or a different legal entity | A separate company |
| The same team and the same billing, with a different focus | A workspace |

Example: a publisher runs four media brands with one team and one bill. That is one company with four workspaces. An agency that manages client companies, each with its own people and billing, uses one company for each client.

## How workspaces work

- **Every company has a default workspace.** OpenAct makes it with the company. It has the company name until you rename it. It cannot be archived.
- **A company with one workspace sees no workspace UI.** The switcher shows only when a company has two or more active workspaces.
- **Each workspace has a kind:** Brand, Business unit, Location or Region. The kind changes only the label. Every kind works the same way.
- **Roles come from the company.** Workspaces use the company roles: owner, admin, member and guest. There are no roles per workspace.
- **Workspaces organize work. They do not limit access.** A person who can open a project or doc can open it from a link, in any workspace. Use secret projects to limit who sees a project.
- **Brand fields live on the workspace:** name, slug, kind, logo, colors and website. A workspace without a logo shows the company logo.
- **Archive, not delete.** An archived workspace leaves the switcher. Its projects and docs stay. Owners and admins still see them in **All workspaces**, and can restore the workspace.

## Switch workspace

Open the company menu: the company mark at the top of the app rail, or the panel header. Pick a workspace under **Workspaces**. OpenAct remembers your choice.

Owners and admins also see **All workspaces**. It shows the work of every workspace together, and each project card names its workspace. New work made in **All workspaces** goes to the default workspace.

Guests do not see the switcher. They see everything they are invited to, in every workspace.

## Manage workspaces

Owners and admins open **Company settings > Workspaces**, or choose **Manage workspaces** in the company menu.

- **Add a workspace:** type a name, pick a kind, then choose **Add workspace**.
- **Edit a workspace:** choose **Edit** to change its name, kind, slug, website, colors and logo.
- **Archive or restore:** choose **Edit**, then **Archive workspace** or **Restore workspace**.

A company can have up to 50 workspaces, archived ones included.

## Workspaces in apps

An app chooses where it keeps its data. It declares this with `scope` in its manifest. See [Build an app](apps.md#workspace-aware-apps).

| App | Scope | What changes |
| --- | --- | --- |
| Projects | Workspace | Each project belongs to one workspace. The list shows the open workspace. Project owners can move a project in **Project settings > Workspace**. |
| Docs | Workspace | Each doc and folder belongs to one workspace. A doc in a folder is in the folder's workspace. Categories and tags stay company-wide. |
| Advisory | Company | One marketplace for the deploy. |
| eSign | Company | Documents are signed by the company, the legal entity. A signed PDF saved to a Docs folder goes to that folder's workspace. |

Search and the AI agent still work across the whole company, with the same access checks as before.

## Upgrade an existing deploy

Migration `0013_workspaces` makes one default workspace for each company. Migrations `projects_0002_workspaces` and `docs_0006_workspaces` put every existing project, folder and doc in that default workspace. Each person keeps the company they had open. Nothing else changes until an owner or admin adds a second workspace.

**Duplicate a company** (Site settings) copies the content into the new company's default workspace. It does not copy the other workspaces.

## Not in this release

- **Linked companies:** a parent company over subsidiaries or client companies, with parent admins who can open the child. Planned next.
- **Roles per workspace**, such as a manager who sees one brand only. Planned only for a real case.
- **Custom domains** for a workspace or a white-label partner. The `website` field leaves room for it.
