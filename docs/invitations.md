# Invitations

A person joins a company only when they accept an invitation. Nobody is added without a yes.

## Levels

| Level | Who invites | Who is invited | What happens when they accept |
| --- | --- | --- | --- |
| Site | The super owner | The contact at a client company | The company exists already, with no people. The person becomes its first owner and skips onboarding. |
| Company | A company owner or admin | An admin or a member | The person gets that company role. |
| Workspace | A member of the workspace | A member | The person joins the workspace. This level comes with workspace access. |

Only the super owner makes a site invitation. Only a company owner invites an owner.

## Send an invitation

- **Company:** open **Company settings > People**. Type the email, pick a role and, if the company has more than one workspace, pick a workspace. The invited person starts in the workspace you pick. Without a pick, they start in the default workspace.
- **Site:** open **Settings > Site settings > Invite a company**. Give the official company name, the company type and the owner's email.

The reply is the same for an email that has an account and one that has none. A person who is in the company already gets a clear message, because owners and admins see the people list.

## Accept or decline

A person with an account sees the invitation in a banner at the top of the app. A person with no company sees it on a full page, before onboarding. A new person signs in with the email address that was invited and then sees the invitation.

- **Accept** adds the person to the company in one step and removes the invitation.
- **Decline** removes the invitation. When it was a site invitation, the empty company is removed too.

An invitation expires after 14 days. An expired invitation is not listed and cannot be accepted.

## Limits

- One company sends at most 50 invitations in 24 hours. The super owner has the same limit for site invitations. Deleting an invitation does not reset the count.
- The email subject is always "You have an invitation on" and the site name. The company name and the sender's name are in the body only.
- With `SIGNUP_MODE=invite`, a site or company invitation lets a new email sign up. A workspace invitation does not.

## For developers

- Table `company_invitations`: `role` (owner, admin, member), `level` (site, company, workspace), `workspace_id`, `expires_at`. Table `invitation_log` counts what was sent.
- Routes: `GET /api/invitations`, `POST /api/invitations/:id/accept`, `POST /api/invitations/:id/decline`, `POST /api/companies/:id/members` (invites), `POST /api/site/companies/invite`.
- `joinCompaniesAtSignIn()` no longer applies invitations. It only applies claimed email domains.
- In tests, `d.join(inviter, companyId, person, role)` invites and accepts.
