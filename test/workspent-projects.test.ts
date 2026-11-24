import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeploy, type Person } from "./harness/deploy.ts";

/* WorkSpent Projects on a whole deploy in memory: kinds of work, clients and rates, the timer, weekly approval, the client link and reports. */

const API = "/api/apps/workspent";
const today = () => new Date().toISOString().slice(0, 10);
const sunday = (date: string) => {
  const t = Date.parse(date + "T00:00:00Z");
  return new Date(t - new Date(t).getUTCDay() * 86_400_000).toISOString().slice(0, 10);
};
const plus = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

async function world() {
  const d = makeDeploy({ SUPER_ADMIN_EMAILS: "owner@agency.test" });
  const owner = d.person("owner@agency.test", "Olive Owner");
  const admin = d.person("admin@agency.test", "Ada Admin");
  const maria = d.person("maria@agency.test", "Maria C.");
  const guest = d.person("leo@outside.test", "Leo M.");
  const call = (who: Person | null, method: string, path: string, body?: unknown) => d.call(who, method, path, body);
  const ok = async (who: Person | null, method: string, path: string, body?: unknown) => {
    const r = await call(who, method, path, body);
    assert.ok(r.status >= 200 && r.status < 300, `${method} ${path}: ${r.status} ${r.text}`);
    return r.json as Record<string, any>;
  };
  await ok(owner, "POST", "/api/companies", { name: "Oak Lane Homes" });
  const companyId = d.one<{ id: string }>("SELECT company_id AS id FROM company_members WHERE user_id = ?", owner.id).id;
  await ok(owner, "POST", `/api/companies/${companyId}/members`, {
    email: admin.email,
    role: "admin"
  });
  await ok(owner, "POST", `/api/companies/${companyId}/members`, {
    email: maria.email,
    role: "member"
  });
  await ok(owner, "PATCH", `/api/companies/${companyId}/apps/workspent`, {
    enabled: true
  });
  const website = (await ok(owner, "POST", "/api/projects", {
    name: "Website refresh",
    companyId
  })) as any;
  const retainer = (await ok(owner, "POST", "/api/projects", {
    name: "Monthly retainer",
    companyId
  })) as any;
  const secret = (await ok(owner, "POST", "/api/projects", {
    name: "Secret plan",
    companyId,
    visibility: "secret"
  })) as any;
  const pid = (p: any) => (p.project?.id ?? p.id) as string;
  const task = (await ok(owner, "POST", `/api/projects/${pid(website)}/tasks`, {
    title: "Home page copy"
  })) as any;
  // A guest: shared one project only.
  d.db.prepare("INSERT INTO company_members (company_id, user_id, role, created_at) VALUES (?, ?, 'guest', ?)").run(companyId, guest.id, new Date().toISOString());
  d.db.prepare("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'editor', ?)").run(pid(retainer), guest.id, new Date().toISOString());
  const c = `${API}/companies/${companyId}`;
  return {
    d,
    owner,
    admin,
    maria,
    guest,
    companyId,
    c,
    call,
    ok,
    websiteId: pid(website),
    retainerId: pid(retainer),
    secretId: pid(secret),
    taskId: (task.task?.id ?? task.id) as string
  };
}

test("kinds of work: both on by default, the company chooses, and the site owner sets the default", async () => {
  const w = await world();
  let me = await w.ok(w.maria, "GET", `${w.c}/me`);
  assert.equal(me.projects, true);
  assert.equal(me.shifts, true);
  assert.equal(me.canTrack, true);
  // A member cannot change the settings. An owner can.
  assert.equal(
    (
      await w.call(w.maria, "PUT", `${w.c}/settings`, {
        projects: true,
        shifts: false
      })
    ).status,
    403
  );
  assert.equal(
    (
      await w.call(w.owner, "PUT", `${w.c}/settings`, {
        projects: false,
        shifts: false
      })
    ).status,
    400
  );
  await w.ok(w.owner, "PUT", `${w.c}/settings`, {
    projects: true,
    shifts: false,
    currency: "USD",
    roundingMinutes: 15
  });
  me = await w.ok(w.maria, "GET", `${w.c}/me`);
  assert.deepEqual([me.projects, me.shifts], [true, false]);
  // The site default: only the site owner sets it. The company's own choice still wins.
  assert.equal(
    (
      await w.call(w.admin, "PUT", `${w.c}/site-kinds`, {
        projects: false,
        shifts: true
      })
    ).status,
    403
  );
  await w.ok(w.owner, "PUT", `${w.c}/site-kinds`, {
    projects: false,
    shifts: true
  });
  const s = await w.ok(w.owner, "GET", `${w.c}/settings`);
  assert.equal(s.canSetSite, true);
  assert.deepEqual(s.site, { projects: false, shifts: true });
  assert.equal(s.projects, true);
  assert.equal(s.fromSite, false);
});

test("a person logs time only on projects they can see, and the rate comes from the project, the client, then the person", async () => {
  const w = await world();
  const client = (
    await w.ok(w.owner, "POST", `${w.c}/clients`, {
      name: "Harbor Legal",
      approverName: "Dana K.",
      approverEmail: "Dana@Harbor.test",
      rate: "75"
    })
  ).client;
  assert.equal(client.rateCents, 7500);
  assert.equal(client.approverEmail, "dana@harbor.test");
  assert.equal((await w.call(w.maria, "POST", `${w.c}/clients`, { name: "Planted" })).status, 403);
  // Only people who set up WorkSpent see client rates and approver emails.
  const seen = (await w.ok(w.maria, "GET", `${w.c}/clients`)).clients[0];
  assert.deepEqual([seen.rateCents, seen.approverEmail, seen.hasApprover], [null, "", true]);
  await w.ok(w.owner, "PUT", `${w.c}/projects/${w.websiteId}`, {
    clientId: client.id,
    budgetHours: 10
  });
  await w.ok(w.owner, "PUT", `${w.c}/projects/${w.retainerId}`, { rate: 60 });
  await w.ok(w.owner, "PUT", `${w.c}/team/${w.maria.id}`, {
    kind: "freelancer",
    rate: 50,
    weeklyHours: 30
  });
  // The member sees company projects, not the secret one. The guest sees only the shared project.
  const mine = (await w.ok(w.maria, "GET", `${w.c}/projects`)).projects.map((p: any) => p.name).sort();
  assert.deepEqual(mine, ["Monthly retainer", "Website refresh"]);
  const theirs = (await w.ok(w.guest, "GET", `${w.c}/projects`)).projects.map((p: any) => p.name);
  assert.deepEqual(theirs, ["Monthly retainer"]);
  assert.equal(
    (
      await w.call(w.maria, "POST", `${w.c}/entries`, {
        projectId: w.secretId,
        date: today(),
        minutes: 30
      })
    ).status,
    404
  );
  assert.equal(
    (
      await w.call(w.guest, "POST", `${w.c}/entries`, {
        projectId: w.websiteId,
        date: today(),
        minutes: 30
      })
    ).status,
    404
  );
  await w.ok(w.guest, "POST", `${w.c}/entries`, {
    projectId: w.retainerId,
    date: today(),
    minutes: 45
  });
  // A task must belong to the project.
  assert.equal(
    (
      await w.call(w.maria, "POST", `${w.c}/entries`, {
        projectId: w.retainerId,
        taskId: w.taskId,
        date: today(),
        minutes: 30
      })
    ).status,
    400
  );
  const e = (
    await w.ok(w.maria, "POST", `${w.c}/entries`, {
      projectId: w.websiteId,
      taskId: w.taskId,
      date: today(),
      minutes: 90,
      note: "First draft"
    })
  ).entry;
  assert.equal(e.clientName, "Harbor Legal");
  assert.equal(e.taskName, "Home page copy");
  assert.equal(e.rateCents, 7500, "the client rate");
  const r = (
    await w.ok(w.maria, "POST", `${w.c}/entries`, {
      projectId: w.retainerId,
      date: today(),
      minutes: 60
    })
  ).entry;
  assert.equal(r.rateCents, 6000, "the project rate");
  // Another person cannot change Maria's entry.
  assert.equal((await w.call(w.admin, "PATCH", `${w.c}/entries/${e.id}`, { minutes: 5 })).status, 404);
  await w.ok(w.owner, "PUT", `${w.c}/projects/${w.retainerId}`, { rate: "" });
  const week = await w.ok(w.maria, "GET", `${w.c}/my-projects?week=${today()}`);
  assert.equal(week.entries.find((x: any) => x.id === r.id).rateCents, 5000, "the person's rate");
  assert.equal(week.weeklyMinutes, 1800);
});

test("the timer runs one at a time, and rounding applies when it stops", async () => {
  const w = await world();
  await w.ok(w.owner, "PUT", `${w.c}/settings`, {
    projects: true,
    shifts: true,
    roundingMinutes: 15
  });
  const a = (
    await w.ok(w.maria, "POST", `${w.c}/timer/start`, {
      projectId: w.websiteId,
      date: today(),
      note: "Copy"
    })
  ).entry;
  assert.ok(a.timerStartedAt);
  // Move the start back 50 minutes, then start another timer. The first one stops at 45 minutes (rounded to 15).
  w.d.db.prepare("UPDATE workspent_entries SET timer_started_ms = ? WHERE id = ?").run(Date.now() - 50 * 60_000, a.id);
  const b = (
    await w.ok(w.maria, "POST", `${w.c}/timer/start`, {
      projectId: w.retainerId,
      date: today()
    })
  ).entry;
  const rows = w.d.all<{
    id: string;
    minutes: number;
    timer_started_ms: number | null;
  }>("SELECT id, minutes, timer_started_ms FROM workspent_entries ORDER BY created_at");
  assert.equal(rows.find((r) => r.id === a.id)!.minutes, 45);
  assert.equal(rows.filter((r) => r.timer_started_ms !== null).length, 1);
  // Sending the week while a timer runs is refused.
  assert.equal((await w.call(w.maria, "POST", `${w.c}/weeks/${today()}/send`)).status, 409);
  // A timer under a minute leaves nothing.
  await w.ok(w.maria, "POST", `${w.c}/timer/stop`);
  assert.equal(w.d.all("SELECT id FROM workspent_entries WHERE id = ?", b.id).length, 0);
  assert.equal((await w.call(w.maria, "POST", `${w.c}/timer/stop`)).status, 409);
  // Typed time rounds too.
  const typed = (
    await w.ok(w.maria, "POST", `${w.c}/entries`, {
      projectId: w.retainerId,
      date: today(),
      minutes: 20
    })
  ).entry;
  assert.equal(typed.minutes, 15);
});

test("a week is sent, the client approves their part by link, a manager approves the rest, and approved hours lock", async () => {
  const w = await world();
  const client = (
    await w.ok(w.owner, "POST", `${w.c}/clients`, {
      name: "Harbor Legal",
      approverEmail: "dana@harbor.test",
      rate: 75
    })
  ).client;
  await w.ok(w.owner, "PUT", `${w.c}/projects/${w.websiteId}`, {
    clientId: client.id
  });
  const day = plus(sunday(today()), -6); // Monday of last week
  const e1 = (
    await w.ok(w.maria, "POST", `${w.c}/entries`, {
      projectId: w.websiteId,
      date: day,
      minutes: 120
    })
  ).entry;
  await w.ok(w.maria, "POST", `${w.c}/entries`, {
    projectId: w.retainerId,
    date: day,
    minutes: 60
  });
  const week = sunday(day);
  assert.equal((await w.ok(w.maria, "POST", `${w.c}/weeks/${day}/send`)).sent, 2);
  let log = await w.ok(w.admin, "GET", `${w.c}/time-log?week=${week}&userId=${w.maria.id}`);
  assert.deepEqual(log.parts.map((p: any) => p.status).sort(), ["sent", "sent"]);
  assert.equal(log.people.find((p: any) => p.userId === w.maria.id).status, "sent");
  // A member cannot see another person's log, or decide.
  assert.equal((await w.call(w.maria, "GET", `${w.c}/time-log?week=${week}&userId=${w.admin.id}`)).status, 403);
  assert.equal(
    (
      await w.call(w.maria, "POST", `${w.c}/weeks/${week}/decide`, {
        userId: w.maria.id,
        clientId: null,
        action: "approve"
      })
    ).status,
    403
  );
  // The link goes to the client's approver.
  const link = await w.ok(w.admin, "POST", `${w.c}/weeks/${week}/link`, {
    userId: w.maria.id,
    clientId: client.id
  });
  assert.equal(link.emailed, "logged");
  const token = String(link.url).split("#t=")[1]!;
  assert.ok(token.length > 20);
  assert.equal(w.d.all("SELECT id FROM workspent_weeks WHERE link_hash = ?", token).length, 0, "only the hash is stored");
  const view = await w.ok(null, "POST", `${API}/approve/view`, { token });
  assert.equal(view.clientName, "Harbor Legal");
  assert.equal(view.minutes, 120);
  assert.equal(view.cents, 15000);
  assert.equal(view.entries.length, 1, "the client sees only their own hours");
  assert.equal(
    (
      await w.call(null, "POST", `${API}/approve/view`, {
        token: "x".repeat(40)
      })
    ).status,
    404
  );
  await w.ok(null, "POST", `${API}/approve/decide`, {
    token,
    action: "approve"
  });
  assert.equal(
    (
      await w.call(null, "POST", `${API}/approve/decide`, {
        token,
        action: "approve"
      })
    ).status,
    404,
    "a link works once"
  );
  // The manager approves the part with no client. No one approves their own week.
  assert.equal(
    (
      await w.call(w.admin, "POST", `${w.c}/weeks/${week}/decide`, {
        userId: w.admin.id,
        clientId: null,
        action: "approve"
      })
    ).status,
    403
  );
  await w.ok(w.admin, "POST", `${w.c}/weeks/${week}/decide`, {
    userId: w.maria.id,
    clientId: null,
    action: "approve"
  });
  log = await w.ok(w.maria, "GET", `${w.c}/time-log?week=${week}`);
  assert.deepEqual(
    log.parts.map((p: any) => p.status),
    ["approved", "approved"]
  );
  assert.equal(log.parts.find((p: any) => p.clientId === client.id).decidedBy, "The client");
  // Approved hours lock, and their rate stays when the client's rate changes.
  assert.equal((await w.call(w.maria, "PATCH", `${w.c}/entries/${e1.id}`, { minutes: 10 })).status, 409);
  await w.ok(w.owner, "PATCH", `${w.c}/clients/${client.id}`, { rate: 100 });
  log = await w.ok(w.maria, "GET", `${w.c}/time-log?week=${week}`);
  assert.equal(log.entries.find((x: any) => x.id === e1.id).rateCents, 7500);
  // An owner reopens. The rate follows the client again.
  assert.equal(
    (
      await w.call(w.admin, "POST", `${w.c}/weeks/${week}/reopen`, {
        userId: w.maria.id,
        clientId: client.id
      })
    ).status,
    200
  );
  log = await w.ok(w.maria, "GET", `${w.c}/time-log?week=${week}`);
  assert.equal(log.entries.find((x: any) => x.id === e1.id).rateCents, 10000);
  // A change to sent hours takes them back, so the person sends them again.
  await w.ok(w.maria, "PATCH", `${w.c}/entries/${e1.id}`, { minutes: 150 });
  log = await w.ok(w.maria, "GET", `${w.c}/time-log?week=${week}`);
  assert.equal(log.parts.find((p: any) => p.clientId === client.id).status, "open");
  // Return with a note needs the note.
  await w.ok(w.maria, "POST", `${w.c}/weeks/${week}/send`);
  assert.equal(
    (
      await w.call(w.admin, "POST", `${w.c}/weeks/${week}/decide`, {
        userId: w.maria.id,
        clientId: client.id,
        action: "return"
      })
    ).status,
    400
  );
  await w.ok(w.admin, "POST", `${w.c}/weeks/${week}/decide`, {
    userId: w.maria.id,
    clientId: client.id,
    action: "return",
    note: "Split the copy work by page"
  });
  log = await w.ok(w.maria, "GET", `${w.c}/time-log?week=${week}`);
  assert.equal(log.parts.find((p: any) => p.clientId === client.id).note, "Split the copy work by page");
});

test("reports total hours and amounts, a member sees only their own, and the CSV matches", async () => {
  const w = await world();
  const client = (
    await w.ok(w.owner, "POST", `${w.c}/clients`, {
      name: "Harbor Legal",
      rate: 75
    })
  ).client;
  await w.ok(w.owner, "PUT", `${w.c}/projects/${w.websiteId}`, {
    clientId: client.id,
    budgetHours: 2
  });
  await w.ok(w.owner, "PUT", `${w.c}/projects/${w.retainerId}`, {
    isBillable: false
  });
  const day = today();
  await w.ok(w.maria, "POST", `${w.c}/entries`, {
    projectId: w.websiteId,
    date: day,
    minutes: 105
  });
  await w.ok(w.maria, "POST", `${w.c}/entries`, {
    projectId: w.retainerId,
    date: day,
    minutes: 60
  });
  await w.ok(w.admin, "POST", `${w.c}/entries`, {
    projectId: w.websiteId,
    date: day,
    minutes: 30,
    note: "=HYPERLINK(1)"
  });
  const q = `from=${plus(day, -1)}&to=${plus(day, 1)}`;
  const all = await w.ok(w.owner, "GET", `${w.c}/reports?${q}&groupBy=client`);
  assert.equal(all.totals.minutes, 195);
  assert.equal(all.totals.billableMinutes, 135);
  assert.equal(all.totals.cents, Math.round((135 * 7500) / 60));
  assert.equal(all.groups[0].label, "Harbor Legal");
  assert.equal(all.budgetsNearLimit, 1);
  const own = await w.ok(w.maria, "GET", `${w.c}/reports?${q}&groupBy=person`);
  assert.equal(own.totals.minutes, 165);
  assert.deepEqual(
    own.groups.map((g: any) => g.label),
    ["Maria C."]
  );
  assert.equal((await w.call(w.owner, "GET", `${w.c}/reports?from=${day}&to=soon`)).status, 400);
  const csv = await w.call(w.owner, "GET", `${w.c}/reports/export?${q}`);
  assert.equal(csv.status, 200);
  const lines = csv.text.trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.ok(
    lines.some((l) => l.includes("'=HYPERLINK(1)")),
    "a formula is turned into text"
  );
  // Projects off: the timer and new entries are refused.
  await w.ok(w.owner, "PUT", `${w.c}/settings`, {
    projects: false,
    shifts: true
  });
  assert.equal(
    (
      await w.call(w.maria, "POST", `${w.c}/entries`, {
        projectId: w.websiteId,
        date: day,
        minutes: 10
      })
    ).status,
    409
  );
});
