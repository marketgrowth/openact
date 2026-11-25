---
title: WorkSpent
description: Time tracking for OpenAct. Projects for client work with a timer, rates and client approval. Shifts for PIN clock-in at a location, schedules and pay periods.
---

# WorkSpent

WorkSpent (id `workspent`) records the time people spend on work. It is a free app. It has two kinds of work. A company turns on one or both in **Settings**:

- **Projects:** time on projects for clients. People use a timer or type in hours. Each hour has a rate. A client approves their hours from a link, or a manager approves them. Freelancers use it for their own clients, and companies use it for the freelancers they hire.
- **Shifts:** time at a location on a schedule. The rest of this page up to [Projects](#projects) is about Shifts. Taxes and payroll stay with your payroll provider.

The side panel shows **My time** for everyone, then a section for each kind of work that is on, then **Manage** (Team and Settings) for owners and admins.

- People clock in and out with a PIN on a time clock device at the location. They need no account and no email.
- Managers see who is on the clock, fix missed clock-ins with a reason, and approve the pay period.
- An approved period exports a CSV for your payroll provider.
- Managers plan shifts for each person on **Schedule**, then publish them. Staff see their shifts on **My time**.

Phone clock-in with a QR code comes in a later release.

## Turn it on

The app is off in each company until an owner or admin turns it on.

1. Go to **Company settings > Apps** and turn on **WorkSpent**.
2. Open WorkSpent from the app rail (the clock icon).
3. Go to **Locations and devices** and select **Add a location**. Give it a name, a time zone and a pay period.
4. Go to **Team** and add each person. Pick their locations. Type a PIN, or leave it empty and WorkSpent makes one. WorkSpent shows the PIN once. Give it to the person.
5. On the tablet or computer at the location, sign in, open **Locations and devices** and select **Set up this device as the time clock**. The device then shows the PIN pad. You can sign out.

## Key terms

| Term | What it is |
| --- | --- |
| Location | A place that hours belong to, such as a care home or an office. Each location has a time zone, a pay period and flag limits. |
| Time clock device | A tablet or a computer at one location. It shows the PIN pad. A location can have several devices. |
| Person | Someone whose hours WorkSpent tracks. A person can have an OpenAct account or not. |
| PIN | 4 to 6 digits, unique at a location. WorkSpent stores only a hash of it. |
| Punch | One clock event: clock in, start a meal break, end a meal break or clock out. |
| Shift | The punches from a clock-in to a clock-out. A shift belongs to the date of its clock-in, in the location's time zone. |
| Pay period | Every week, every 2 weeks, or twice a month (1st to 15th, 16th to month end). |

WorkSpent does not store hours. It works them out from the punches, so a fix changes the hours at once.

## The time clock device

The device page is `/a/workspent/clock`. It works without sign-in.

1. A person types their PIN and selects **Next**.
2. The device says hello and shows only the buttons that fit: **Clock in**, **Start meal break**, **End meal break** or **Clock out**.
3. The device confirms, then goes back to the PIN pad.

The time comes from the server, not from the device. The device reports in every 2 minutes. **Locations and devices** shows when each device was last seen and its internet address.

- **Wrong PINs.** 5 wrong PINs in a row lock the PIN pad of that device for 15 minutes. A manager can select **Unlock**.
- **No connection.** The device still takes clock-ins. It saves them in the browser and sends them when the connection is back. The server then checks each PIN, and the timesheet marks the clock-in as sent late. A clock-in older than 24 hours is refused. A manager adds it by hand. Until they are sent, the saved clock-ins hold the PINs in the browser of the device.
- **Lost device.** Select **Switch off**. The device key stops working at once. Its clock-ins stay.

The device keeps a device key in its browser. The server keeps only a hash of the key. Clear the browser data, and the device must be set up again.

## Timesheets

**Timesheets** shows one location and one pay period:

- Who is on the clock now, and since when.
- Flags to review, hours this period, and the devices that are online.
- One row for each person: days, hours, hours over the day and week limits, flags and a status.

Select a name to see each clock-in of the period, with every fix.

### Flags

Flags help managers check the hours. They do not decide pay. Each location sets its own limits.

| Flag | When |
| --- | --- |
| Over the day limit | More than 8 hours in a day (you can change the number) |
| Over the week limit | More than 40 hours in a week, Sunday to Saturday (you can change the number) |
| No meal break | A shift of more than 5 hours with no meal break that starts by then (you can change the number) |
| Missed clock-out | No clock-out after 14 hours (you can change the number), or a new clock-in before the clock-out |
| Missed clock-in | A break or a clock-out with no clock-in before it |
| Sent late | A device was offline and sent the clock-in later |
| Questioned by the person | The person questioned a fix |

A week can cross two pay periods. Its hours over the limit count once, in the period that holds its Saturday.

### Fix the hours

A manager can add a missed clock-in, clock-out or break, change a time, add a whole shift, delete a wrong punch, clock someone in or out now, and make a new PIN. Every fix follows these rules:

1. A reason is required.
2. The original stays. The punch shows who changed it, when and why. A deleted punch is crossed out, not erased.
3. The person sees the fix on **My time** and can select **Confirm** or **Question it**. A questioned fix is flagged.
4. An approved period is locked. A company owner or admin reopens it.
5. A manager cannot change or approve their own hours.

Times in a fix are in the location's time zone. A clock-out time before the clock-in time is on the next day.

## Schedule

**Schedule** plans who works when at a location. It plans the work. Hours for payroll still come from the time clock.

### Views

| View | Shows |
| --- | --- |
| Week | A roster: one row for each person, one column for each day. An Open shifts row on top, each person's week hours, and coverage at the bottom. |
| Day | A timeline from 12 AM to 12 AM. Each shift shows against the real clock-ins, with a status: on time, late, not in yet, or not on the schedule. Coverage shows the people on shift in each hour. |
| Month | A calendar. Each day shows the scheduled hours, the hours worked for past days, open shifts, drafts, and the Day, Evening and Night cover. Select a day to see its shifts. |
| List | The shifts of two weeks, by day. Filter by open shifts or by changes not published. It is the default view on a phone. |

A shift belongs to a part of the day by its local start time: Day (5 AM to 1 PM), Evening (1 PM to 9 PM) or Night (9 PM to 5 AM). A gap shows when a part of the day has no shift, while the location has that part on another day of the view. So an office with no night shifts never shows night gaps.

### Add and change shifts

1. In the Week view, select **+** in a person's row on a day. Or select a shift to change it.
2. Pick the person, or **Open shift** when nobody is assigned yet.
3. Set the date, the start and end times and the meal break. **Quick times** fill in a Day, Evening or Night shift. An end time before the start time is on the next day.
4. Optional: repeat the shift every week, for up to 12 weeks.
5. Select **Add the shift**.

A person cannot have two shifts at the same time, at any location of the company. The editor shows the person's hours for the week and warns when they go over the week flag limit of the location.

**Copy last week** copies the shifts of the week before into the week on screen, as drafts. It keeps the local times. It skips a shift that would overlap another shift, and the shifts of people who are turned off.

### Publish

A new or changed shift is a draft. Staff do not see it. **Publish** sends every draft, change and delete in the view to staff. Until then:

- A changed shift shows as changed. Staff still see the published version.
- A deleted shift shows as deleted. Staff still see it.
- A draft that was never published goes at once when you delete it.

Staff with an account see their published shifts for the next 3 weeks on **My time**, with the next shift on top.

The schedule is for managers of the location only: `workspent.manage`, or a location manager. Other people see only their own shifts.

## Approve and export

Select **Approve the period** after its last day. WorkSpent refuses while a missed clock-in or clock-out is not fixed. Then select **Export CSV**.

The CSV has one row per shift:

| Column | What it holds |
| --- | --- |
| Person, Location, Date | The date of the clock-in, in the location's time zone |
| Clock in, Clock out | Local date and time, such as `2026-11-18 06:55` |
| Break minutes, Worked minutes, Hours | Hours has two decimals. Worked minutes add up to the timesheet. |
| Flags | The flags of the shift |
| Manager changes | The number of fixes and their reasons |

The file opens in Excel and Google Sheets. A cell that starts with `=`, `+`, `-` or `@` gets a leading apostrophe, so a spreadsheet does not run it as a formula.

## My time

People with an OpenAct account see their own hours on **My time**, once an admin links their account in **Team**. They also confirm or question each fix of their hours.

## Who can do what

| Permission | Default roles | What it allows |
| --- | --- | --- |
| `workspent.clock` | Owners, admins, members | See My time, and confirm or question a fix |
| `workspent.track` | Owners, admins, members, guests | Log time on projects they can see, and send their week |
| `workspent.manage` | Owners, admins | See every timesheet and time log, fix hours, approve periods and project weeks, and export |
| `workspent.setup` | Owners, admins | Turn Projects and Shifts on or off. Add clients, rates, locations, devices, people and PINs, and set the rules |

A **location manager** gets `workspent.manage` for one location only, such as a house manager for one home. Pick location managers on each location in **Locations and devices**. A location manager must be an owner, admin or member.

People without an account have no role. They can only use a PIN on a time clock device.

Change the roles in **Company settings > Permissions**.

## Projects

Projects come from the Projects app. WorkSpent adds a client, a rate and a budget in hours to each project. A person logs time only on projects they can see in the Projects app. A guest logs time only on the projects shared with them.

1. In **Clients and projects**, add your clients. A client with an approver email approves their own hours. Leave the email empty when a manager approves them.
2. Edit each project: pick its client, and set a rate and a budget if you need them. Turn off **Track time on this project** for projects without time.
3. In **Team**, set each person's kind (staff or freelancer), rate and the hours planned each week.

The rate of an hour comes from the project, then the client, then the person.

### My time and the timer

People start the timer on **My time**, or select **Add time** and type the time as `1:30`, `1.5` or `90m`. One timer runs at a time. Starting a new one stops the last one. **Settings** can round each entry to 6 or 15 minutes.

### Send and approve a week

A person selects **Send week for approval**. The week splits into one part for each client, and one for hours with no client.

- On **Time log**, a manager selects a person and then, for each part, **Approve**, **Return** with a note, or **Send to** the client.
- **Send to** emails the client's approver a link. The link works for 14 days and once. The client sees only their own hours, then approves them or asks a question. WorkSpent stores only a hash of the link.
- Nobody approves their own week.
- Approved hours lock, and each entry keeps the rate it had. An owner or admin selects **Reopen** to unlock them.
- A change to sent hours takes them back, so the person sends them again.

### Reports

**Reports** totals hours, billable hours and amounts for any dates, by client, project, person or task. **Export CSV** gives one row per entry. Members see only their own time. Invoices come in a later release.

### Settings

**Settings** turns Projects and Shifts on or off for the company, and sets the currency and rounding. The site owner (super admin) also sets the **Site default**: the kinds of work that companies get until they choose.

## For app builders: the sync service

Other apps, such as DirectCare and Orbytt, add locations and people through a service. They never read WorkSpent tables.

```ts
import { appService, companyAppState } from "@openact/core/server";
import type { WorkSpentSync } from "@openact/app-workspent/server";

const state = await companyAppState(env, companyId);
const sync = state.enabled("workspent") ? appService<WorkSpentSync>("workspent", "sync") : undefined;
if (sync) {
  await sync.upsertLocation(env, companyId, { sourceApp: "directcare", sourceKey: home.id, name: home.name, timeZone: "America/Los_Angeles" });
  await sync.upsertPerson(env, companyId, { sourceApp: "directcare", sourceKey: staff.id, name: staff.name, locationKeys: [home.id] });
}
```

The other app keeps its own record. WorkSpent keeps the PIN and the hours. A second call with the same `sourceKey` updates the same row.

## Data

All tables start with `workspent_` and carry `company_id`: `locations`, `location_managers`, `devices`, `people`, `person_locations`, `punches`, `changes`, `periods` and `shifts` for Shifts, and `settings`, `clients`, `projects`, `members`, `entries` and `weeks` for Projects. A shift keeps the version that staff see in `published_json`. An entry keeps no foreign key to its project, so deleting a project never deletes approved hours. WorkSpent reads the projects a person can see through the Projects app's `visibleProjects` service. Read [Naming rules for data](naming.md).

When a person leaves the company, their WorkSpent person keeps the hours and loses the link to the account. Deleting a company deletes its WorkSpent rows.

WorkSpent keeps names, PIN hashes, times, the device and the internet address of each clock-in. It takes no photos, no location and no screen data.
