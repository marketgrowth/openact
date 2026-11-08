# SDK reference

An OpenAct app uses two packages. Both ship as TypeScript source in the OpenAct repository, so your editor shows the full types.

| Package | Where it runs | Import from |
| --- | --- | --- |
| `@openact/core` | The Cloudflare Worker | `@openact/core/server` for server code, `@openact/core/shared` for types and rules that both sides use |
| `@openact/ui` | The web app | `@openact/ui` for the shell and helpers, `@openact/ui/components/<name>` for shadcn/ui components |

Apps import only from these entry points, never from files inside the packages. Read [Build an app](../apps.md) for a walkthrough and [Permissions](../permissions.md) for access.

## The app manifest

Every app has a `package.json` with an `openact` field. The `openact` script reads it.

| Field | Required | What it does |
| --- | --- | --- |
| `id` | Yes | 2 to 31 lowercase letters, numbers or dashes, starting with a letter. Unique in a deploy. Not one of the [reserved names](../directory.md#reserved-names). |
| `name` | No | The name in the app rail and Company settings. The default is the id. |
| `server` | No | The file that exports `defineServerApp(...)` as default |
| `client` | No | The file that exports `defineClientApp(...)` as default |
| `migrations` | No | A folder of numbered SQL files. The default is `./migrations`. |
| `durableObjects` | No | Durable Object classes that the server file exports |
| `enabledByDefault` | No | `false` makes each company turn the app on first. The default is `true`. |

## Server: `@openact/core/server`

### `defineServerApp(app)`

| Field | Type | What it does |
| --- | --- | --- |
| `id` | `string` | The same id as the manifest |
| `name` | `string` | The app name |
| `permissions` | `Record<string, PermissionDef>` | What people can do, by company role. See [Permissions](../permissions.md). |
| `routes` | `(api: Hono<AppEnv>) => void` | Adds the app's API routes. Use `/api/apps/<id>/...`. |
| `middleware` | `MiddlewareHandler<AppEnv>[]` | Runs on every API request, after the session is read |
| `scheduled` | `(env, cron) => Promise<void>` | Runs on each cron trigger. `DAILY_CRON` is the daily schedule. |
| `hooks` | `AppHooks` | Joins the core's sign-in and company events. See below. |

### Hooks

| Hook | When it runs | What your app does |
| --- | --- | --- |
| `allowSignup(env, email)` | Sign-up is limited, and this email asks for a code | Return `true` to let the email sign up, for example for your own invitation |
| `signedIn(env, user)` | After each sign-in | Accept your app's invitations |
| `companyCreated(env, companyId, userId)` | A company was created | Set up defaults |
| `companyDetail(env, companyId)` | `GET /api/companies/:id` | Return extra fields, such as your company settings |
| `companyUpdate(env, companyId, body)` | `PATCH /api/companies/:id` | Save your fields. Return `true` when you changed something. |
| `companyMemberRemoved(env, companyId, userId)` | A person leaves or is removed | Remove their access to your data in that company |
| `companyDeleting(env, companyId)` | Before a company is deleted | Delete your data and files for that company |

### Access

| Helper | What it does |
| --- | --- |
| `requireUser(c)` | The signed-in person. Throws 401 when nobody is signed in. |
| `requirePermission(env, companyId, userId, permission)` | Checks the company, the app switch and the role. Returns the company role. |
| `hasPermission(env, companyId, userId, permission)` | The same check, as `true` or `false` |
| `requireAppOn(env, companyId, appId)` | Throws 403 `app_off` when the app is off in the company |
| `companyAppState(env, companyId)` | `enabled(appId)` and `roles(permission)` for one company, from one query |
| `appOffError(appId)` | The `app_off` error, for your own access checks |
| `companyRole(env, companyId, userId)` | The person's company role, or `null` |
| `requireCompanyRole(env, companyId, userId, roles)` | Throws unless the person has one of the roles. Prefer `requirePermission()` in apps. |
| `currentCompanyId(env, userId)` | The company the person works in now |
| `listCompanies(env, userId)` | The companies the person is in |
| `getCatalog()` | Every installed app, with `id`, `name` and `enabledByDefault` |
| `isSuperAdmin(env, user)` | `true` when the person's email is in `SUPER_ADMIN_EMAILS` |
| `requireSuperAdmin(c)` | The signed-in super admin. Throws 403 `not_super_admin` for anyone else. |

### Input and errors

| Helper | What it does |
| --- | --- |
| `readJson(c)` | Reads a JSON object from the request body. Throws 400 for anything else. |
| `text(value, field, { max, required })` | A trimmed string, with a length check |
| `oneOf(value, field, allowed)` | One of the allowed strings |
| `num(value, field)`, `dateOrNull(value, field)` | A number, or a `YYYY-MM-DD` date or `null` |
| `normalizeEmail(value)`, `isEmail(email)` | Email helpers |
| `HttpError(status, message, code?)` | Throw it to send `{ "error": message, "code": code }`. Write a message that the person can act on. |
| `newId()`, `nowIso()`, `todayIso()`, `addDays(iso, days)` | Ids and dates |
| `sha256Hex(text)`, `randomToken()` | Hashes and tokens. Store only hashes of secrets. |

### Live updates

| Helper | What it does |
| --- | --- |
| `registerRoomKind(kind, readRevisions)` | Call once. `readRevisions(env, ids)` returns the newest revision of each item. |
| `markChanged(kind, id)` | Marks an item as changed in this request. Open pages reload it. |
| `flushChanges(env)` | Sends the changes now, for work after a streamed response starts |
| `assertLiveRequest(c)` | Checks the WebSocket upgrade and the `Origin` header. Call it before your access check. |
| `acceptLive(c, kind, id, viewer, rev)` | Accepts the WebSocket after your access check |
| `disconnectFromRoom(env, kind, id, userId)` | Closes a person's open pages, for example after they lose access |

Live messages carry only revision numbers and viewer names. Pages load the data through your API, which checks access.

### Email and files

| Helper | What it does |
| --- | --- |
| `sendEmail(env, message)` | Sends with Resend, or prints to the log when no key is set |
| `emailLayout(env, heading, html)`, `emailButton(url, label)` | The standard email look |
| `deletePrefix(bucket, prefix)` | Deletes every R2 file under a prefix. Use `<app id>/...` keys. |

## Client: `@openact/ui`

### `defineClientApp(app)`

| Field | What it does |
| --- | --- |
| `id`, `name` | The same id and name as the manifest |
| `icon` | The app's icon in the app rail, as a Lucide name for `Icon`, such as `"users"` |
| `Mark` | A custom rail icon, such as a brand mark. Draw it with `currentColor`. |
| `home` | Where the rail icon goes. Default: `/` for the first app with a home page, otherwise `/a/<id>` |
| `ownsPath(path)` | Which paths belong to the app. Default: the home, `/a/<id>/...` and the app's routes |
| `routes` | Pages: `{ pattern: RegExp, render: (match) => ReactNode }`. Start each page with `SiteHeader` and `PageBody`. |
| `Home` | The page at `/`. The first app with a home page that is on owns it. |
| `publicRoutes` | Pages that work without sign-in, by path |
| `nav` | Items at the top of the app's panel (`main`), or icons at the bottom of the rail (`footer`) |
| `SidebarSection` | Groups in the app's panel, such as Pinned, Projects and Recent |
| `commands` | Dialogs: `{ id, label, icon, shortcut?, inSidebar?, Dialog }`. `shortcut: "k"` opens with Ctrl+K or Cmd+K. |
| `companySettingsTabs` | Extra tabs in Company settings: `{ id, label, Tab }` |
| `Provider` | State around the whole signed-in shell |

An app shows in the rail only when it has an `icon` or a `Mark`, and only in companies where it is on.

### Hooks

| Hook | What it returns |
| --- | --- |
| `useShell()` | `me`, `config`, `apps`, `open(dialog)` and `runCommand(id)` |
| `useWorkspace()` | `companies`, `current`, `switchTo(id)`, `reloadCompanies()`, `access` and `reloadAccess()` |
| `useCan(permission)` | `true` when the person has the permission in the current company |
| `useAppOn(appId)` | `true` when the app is on in the current company |
| `usePath()` | The current path |
| `useLive(path, enabled, onRev)` | Opens a live room. Returns `connected` and `viewers`. |
| `useToast()` | Shows a short message: `toast("Saved.")` |
| `useCloseOnPhone()` | Closes the side panel on a phone after a person picks an item |

### Helpers and components

| Export | What it does |
| --- | --- |
| `api(path, { method, body })` | Calls the API with the session cookie. Throws `ApiError` with the server's message. |
| `errorText(error)` | A message to show for any error |
| `navigate(to, replace?)`, `Link` | Moves between pages without a reload |
| `SiteHeader`, `PageBody` | The page header and the padded page body |
| `Icon`, `Avatar`, `CompanyMark`, `Logo` | Icons and marks |
| `Modal`, `Field`, `Notice`, `ConfirmButton`, `LinkedText` | Common building blocks |
| `getTheme()`, `setTheme(pref)` | Light, dark or system |
| `@openact/ui/components/<name>` | shadcn/ui components: button, card, dialog, dropdown-menu, sidebar, table, tabs, checkbox and more |

Use theme token classes, such as `bg-muted` and `text-muted-foreground`. Do not use fixed colors.

## Shared: `@openact/core/shared`

| Export | What it does |
| --- | --- |
| `COMPANY_ROLES`, `CompanyRole`, `COMPANY_ROLE_LABELS` | owner, admin, member and guest |
| `User`, `Company`, `CompanyDetail`, `AppConfig` | The core types |
| `PermissionDef`, `CompanyAccess`, `CompanyAppSettings` | Permission types |
| `rolesWithPermission(def, chosen)` | The roles that have a permission, with the fixed rules applied |
| `canManageCompany(role)` | `true` for owners and admins |
