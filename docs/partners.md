# Partner domains

A partner domain gives a partner, such as an agency, its own address for your site. The agency's clients sign in at `app.brightline.com` and see the agency's name and logo. Your site, your database and your apps stay the same. A partner domain is another door into the same deploy.

Use partner domains to white-label your apps. The partner sells them to its clients under its own brand, and you bill the partner.

## How it works

| Part | On a partner host |
| --- | --- |
| App name | The partner name, or the partner company's name |
| Logo and browser tab icon | The partner company's logo |
| Sign-in page | "Sign in to" the partner name. Your heading, credit, background and legal links do not show. |
| Emails | The sign-in code and invitation emails show the partner name. The sender name is the partner name. The sender address stays the address in `EMAIL_FROM`, so Resend still sends from your verified domain. |
| Links in emails | They point to the partner host. |
| Submit issues and Contribute | Hidden |

People sign in on each host on its own. A session on your host does not carry over to a partner host.

## One company for each client

The partner company is the agency itself. For each client, the agency makes a separate company and invites the client to it. Each client then sees only their own company, people and data.

Do not use [workspaces](workspaces.md) for clients. Workspaces organize data, but they do not limit access, so an invited client could see the other clients.

A company that the partner's owners or admins make on their own host is a **client company** of the partner. OpenAct saves this in `companies.partner_id`. It counts and lists client companies only. It never gives access: the agency's people see a client company only when they are its members.

A company that someone else makes on the partner host, or that the agency makes on your own host, is an ordinary company.

## Add a partner domain

1. In Cloudflare, point the host name at your Worker.
   - When the partner's zone is in your Cloudflare account, add the host as a **custom domain** of the Worker.
   - When the partner keeps its own DNS, use [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/). Add the host as a custom hostname on your zone, and ask the partner to add a CNAME record that points at your fallback origin.
2. Make sure the partner company exists, with its logo. Its owner uploads the logo in **Company settings > General**.
3. Open **Settings > Site settings > Partner domains** and choose **Add a partner domain**.
4. Type the host name, pick the partner company, and type a name if it is not the company name.

A company can have up to 5 host names. A host name belongs to one partner.

## The partner's view

On its own host, the partner company's owners and admins see **Company settings > Clients**. It lists the partner's host names and its client companies, with the number of people in each.

To add a client:

1. Open the company menu and choose **New company**. Name it for the client.
2. Open **Company settings > People** in the new company and invite the client.

The partner collects payment from its clients in its own billing system. OpenAct does not bill the partner's clients.

## Bill the partner

**Site settings > Partner domains** shows the count of client companies for each partner. Bill the partner for each client company, in your own billing system.

## Remove a partner domain

Choose **Remove** next to the host name. The host goes back to your own name and logo within 30 seconds. The client companies stay, and their people keep their access. They stay counted as the partner's client companies until the partner company is deleted.

## For app builders

- `appName(env)` returns the partner name on a partner host. Use it for every name that people see in emails.
- `appUrl(c)` returns the partner host on a partner host. Use it for every link in an email.
- `c.get("partner")` holds the partner of the request, or null. Use it only for branding. Never use it for access.
- `partnerClientCompanies(env, partnerId, userId)` lists the partner's client companies that the person is a member of. Use it for a dashboard across clients. Check a permission in the partner company first, then check your app's permission in each client before you read its data.
