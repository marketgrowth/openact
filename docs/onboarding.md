# Onboarding

Onboarding is the first screen for a new person. It makes their company and their first workspace.

## When it runs

Onboarding runs after sign-in when both of these are true:

- The site setting **Onboarding** is on. It is on by default.
- The person has no company of any role.

A person who joined through an invitation has a company already. They never see onboarding. A guest on a project is in a company too, so they skip it as well.

## What it asks

| Question | What it does |
| --- | --- |
| Official company name | The legal name, as on the company's filings. It is also the name that shows in the app. |
| Company type | Corporation, LLC, Sole proprietorship, Partnership, Nonprofit or Other. |
| Primary brand or business unit | The name of the first workspace. A toggle sets its kind: Brand or Business unit. |

The person becomes the company's owner. Owners and admins can change all three answers later in **Company settings**. The legal name and the company type are on the General page. Rename the workspace in **Company settings > Workspaces**.

On a partner host, onboarding shows the partner's name and logo. The company it makes is an ordinary company, not a client company.

## Turn it off

A super admin opens **Settings > Site settings > Onboarding** and turns the switch off. A new person then sees an empty screen and uses **New company** in the menu. The setting applies to everyone on the site, including the super admin.

## For developers

- `GET /api/onboarding` answers `{ "required": boolean }`.
- `POST /api/onboarding` takes `{ legalName, entityType, brand, brandKind }` and makes the company, the owner and the first workspace in one batch. It refuses with 409 when the person has a company, and with 400 when onboarding is off.
- `PATCH /api/site/onboarding` takes `{ enabled }`. Only a super admin can call it. The key is `onboarding_enabled` in `site_settings`. A missing key means on.
- `companies.legal_name` and `companies.entity_type` come from migration `0016_onboarding.sql`. Companies made before it have both as null.
- The `companyCreated` hook runs for onboarding as it does for New company.
