# Naming rules for data

These rules tell people and coding agents how to name the tables, columns and indexes of an app. `npm run sync` checks every new table against them. For now, a broken rule is a warning. Set `OPENACT_STRICT=1` to make it an error, for example in your CI.

The rules apply to new names only. Released tables keep their names, because a rename would break every deploy that already ran the old migration.

## The rules

All names use lowercase ASCII snake_case. Each name works in SQL without quotes, and has 63 characters or fewer.

| Item | Rule | Example |
| --- | --- | --- |
| Table prefix | The app id, with dashes changed to underscores, then `_` | `acme-crm` uses `acme_crm_` |
| Table | Prefix + plural noun | `acme_crm_deals` |
| Join table | Prefix + both nouns | `acme_crm_deal_contacts` |
| Primary key | `id TEXT` (a UUID), or a key made of foreign keys | `id` |
| Foreign key | The singular noun of the target + `_id` | `deal_id`, `company_id` |
| Company | Every app row reaches a company: a `company_id` column, or a foreign key to a table that has one | `company_id` |
| Workspace | `workspace_id`, when the app has `"scope": "workspace"` | `workspace_id` |
| Time as ISO text | Ends in `_at`, type TEXT, ISO 8601 in UTC | `created_at` |
| Time as epoch milliseconds | Ends in `_ms`, type INTEGER | `expires_ms` |
| Calendar date | Ends in `_date`, type TEXT, `YYYY-MM-DD` | `due_date` |
| Yes or no | Starts with `is_` or `has_`, type INTEGER 0 or 1 | `is_archived` |
| JSON | Ends in `_json`, type TEXT | `settings_json` |
| Secret | Store only a hash, in a column that ends in `_hash` | `token_hash` |
| Index | `idx_` + table + columns | `idx_acme_crm_deals_company` |

## What sync checks

1. **Every migration runs.** Sync applies all migrations, in deploy order, to an empty in-memory database. A migration that fails stops sync before it reaches a real database.
2. **The prefix.** An app's table must start with the app's prefix.
3. **No shared prefix.** The app `acme` must not make `acme_crm_deals` when the app `acme-crm` is installed. Sync stops when two apps claim one table.
4. **A company for every row.** A table without `company_id`, and without a foreign key to a table that has one, gets a warning.
5. **Column types.** `_at` must be TEXT, `_ms` must be INTEGER, and `is_` and `has_` must be INTEGER.
6. **Foreign keys and secrets.** A column that points at another table must end in `_id`. A column named like a token, secret, password or code gets a warning: store a hash.
7. **Index names.** An index must start with `idx_`.

The checks need Node 22.13 or later, which has `node:sqlite`. On an older Node, sync skips them and says so.

## Names that stay

The projects app made these tables before apps had prefixes: `projects`, `project_members`, `tasks`, `attachments`, `board_columns`, `invitations`, `agent_actions`, `access_requests` and `vector_outbox`. They keep their names. Never use them for a new table.

Some released core columns end in `_at` but hold epoch milliseconds, such as `login_codes.expires_at` and the `oauth_*` tables. Read each column's type before you compare times. New columns follow the rules above.

To replace a name, add a new column or table, copy the data in a migration, and stop using the old one. Remove the old one only in a major core version.
