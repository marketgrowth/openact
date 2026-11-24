---
title: WorkSpent
description: A time clock for OpenAct. People clock in with a PIN on a tablet at the location. Managers fix, approve and export the hours.
---

# WorkSpent

WorkSpent (id `workspent`) is a time clock. It records when people start and stop work. It keeps hours only. Pay, pay rates and taxes stay with your payroll provider. WorkSpent is a free app.

- People clock in and out with a PIN on a time clock device at the location. They need no account and no email.
- Managers see who is on the clock, fix missed clock-ins with a reason, and approve the pay period.
- An approved period exports a CSV for your payroll provider.
- Managers plan shifts for each person on **Schedule**, then publish them. Staff see their shifts on **My time**.

This release covers on-site locations. Phone clock-in with a QR code and remote teams come in later releases.

## Turn it on

The app is off in each company until an owner or admin turns it on.

1. Go to **Company settings > Apps** and turn on **WorkSpent**.
2. Open WorkSpent from the app rail (the clock icon).
3. Go to **Locations and devices** and select **Add a location**. Give it a name, a time zone and a pay period.
4. Go to **People and PINs** and add each person. Pick their locations. Type a PIN, or leave it empty and WorkSpent makes one. WorkSpent shows the PIN once. Give it to the person.
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

People with an OpenAct account see their own hours on **My time**, once an admin links their account in **People and PINs**. They also confirm or question each fix of their hours.

## Who can do what

| Permission | Default roles | What it allows |
| --- | --- | --- |
| `workspent.clock` | Owners, admins, members | See My time, and confirm or question a fix |
| `workspent.manage` | Owners, admins | See every timesheet, fix hours, approve periods and export |
| `workspent.setup` | Owners, admins | Add locations, devices, people and PINs, and set the rules |

A **location manager** gets `workspent.manage` for one location only, such as a house manager for one home. Pick location managers on each location in **Locations and devices**. A location manager must be an owner, admin or member.

People without an account have no role. They can only use a PIN on a time clock device.

Change the roles in **Company settings > Permissions**.

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

All tables start with `workspent_` and carry `company_id`: `locations`, `location_managers`, `devices`, `people`, `person_locations`, `punches`, `changes`, `periods` and `shifts`. A shift keeps the version that staff see in `published_json`. Read [Naming rules for data](naming.md).

When a person leaves the company, their WorkSpent person keeps the hours and loses the link to the account. Deleting a company deletes its WorkSpent rows.

WorkSpent keeps names, PIN hashes, times, the device and the internet address of each clock-in. It takes no photos, no location and no screen data.
