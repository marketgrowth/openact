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
- **Removing someone from a company** removes them from all its projects.
- **Upgrading an older install.** Migration `0003_companies.sql` gives each project owner a company that holds their projects. Everyone else becomes a guest, so nobody can see more than before. Make people members in **Company settings** when you are ready.
- The AI agent only routes requests to projects in the same company.

Company owners and admins can also turn apps on or off and choose what each role can do in each app. Read [Permissions](permissions.md).
