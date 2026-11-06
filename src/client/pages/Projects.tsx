import { useState } from "react";
import {
  COMPANY_ROLE_LABELS,
  PROJECT_COLORS,
  ROLE_LABELS,
  VISIBILITIES,
  VISIBILITY_HELP,
  VISIBILITY_LABELS,
  type Company,
  type ProjectColor,
  type User,
  type Visibility
} from "../../shared/types";
import { canCreateProjects } from "../../shared/access";
import { useWorkspace } from "../workspace";
import { api, errorText } from "../api";
import { Link, navigate } from "../router";
import { Icon, Modal, useToast } from "../ui";

export function ProjectsPage({ me, onNewProject, onNewCompany }: { me: User; onNewProject: () => void; onNewCompany: () => void }) {
  const ws = useWorkspace();
  const projects = ws.projects;
  const current = ws.current;

  if (ws.companies && !ws.companies.length) {
    return (
      <main className="wrap page">
        <div className="state">
          <h3>Create your company</h3>
          <p>Every project belongs to a company. Make one for your team, then add projects and invite people. Anyone you invite to one project joins as a guest and sees only that project.</p>
          <button type="button" className="btn primary" onClick={onNewCompany}>
            <Icon name="plus" size={16} /> Create a company
          </button>
        </div>
      </main>
    );
  }

  const canCreate = canCreateProjects(current?.role ?? null);
  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Hi {me.name || me.email}</p>
          <h1>{current ? current.name : "Projects"}</h1>
          {current && (
            <p className="hint">
              You are {/^[aeiou]/i.test(COMPANY_ROLE_LABELS[current.role]) ? "an" : "a"} {COMPANY_ROLE_LABELS[current.role].toLowerCase()} in this company.
            </p>
          )}
        </div>
        {canCreate && (
          <button type="button" className="btn primary" onClick={onNewProject}>
            <Icon name="plus" size={16} /> New project
          </button>
        )}
      </div>

      {!projects && <p className="muted">Loading your projects…</p>}
      {projects && !projects.length && (
        <div className="state">
          <h3>No projects yet</h3>
          {canCreate ? (
            <>
              <p>Make a project. Then invite your team. There is no limit on people.</p>
              <button type="button" className="btn primary" onClick={onNewProject}>
                Make your first project
              </button>
            </>
          ) : (
            <p>You are a guest in this company. You see a project here when someone invites you to it.</p>
          )}
        </div>
      )}
      {projects && projects.length > 0 && (
        <ul className="project-grid">
          {projects.map((p) => {
            const pct = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
            return (
              <li key={p.id}>
                <Link to={`/p/${p.id}`} className={`project-card pc-${p.color}`}>
                  <span className="pc-swatch" aria-hidden="true" />
                  <span className="pc-name">
                    {p.name}
                    {p.visibility === "secret" && (
                      <span className="pc-secret" title="Secret project">
                        <Icon name="shield" size={14} /> Secret
                      </span>
                    )}
                  </span>
                  {p.description && <span className="pc-desc">{p.description}</span>}
                  <span className="pc-progress" aria-label={`${pct}% done`}>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="pc-meta">
                    <span>
                      <b>{p.taskCount}</b> {p.taskCount === 1 ? "task" : "tasks"}
                    </span>
                    <span>
                      <b>{pct}%</b> done
                    </span>
                    {p.lateCount > 0 && (
                      <span className="late">
                        <b>{p.lateCount}</b> late
                      </span>
                    )}
                    <span>
                      <b>{p.memberCount}</b> {p.memberCount === 1 ? "person" : "people"}
                    </span>
                    <span className="chip">{p.isMember ? ROLE_LABELS[p.role] : `${ROLE_LABELS[p.role]} via company`}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export function NewProjectDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ProjectColor>("indigo");
  const [template, setTemplate] = useState<"blank" | "example">("blank");
  const [visibility, setVisibility] = useState<Visibility>("company");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/projects", { body: { name, description, color, template, visibility, companyId: company.id } });
      toast("Project created.");
      navigate(`/p/${r.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`New project in ${company.name}`} onClose={onClose}>
      <form className="stack" onSubmit={create}>
        <div className="field">
          <label htmlFor="np-name">Name</label>
          <input id="np-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Website relaunch" />
        </div>
        <div className="field">
          <label htmlFor="np-desc">Description</label>
          <textarea id="np-desc" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional. One or two sentences about the goal." />
        </div>
        <fieldset className="field">
          <legend className="lbl">Color</legend>
          <div className="swatches">
            {PROJECT_COLORS.map((c) => (
              <label key={c} className={`swatch pc-${c}`} title={c}>
                <input type="radio" name="np-color" value={c} checked={color === c} onChange={() => setColor(c)} />
                <span className="sr-only">{c}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend className="lbl">Start with</legend>
          <label className="radio-row">
            <input type="radio" name="np-template" checked={template === "blank"} onChange={() => setTemplate("blank")} />
            <span>
              <b>A blank project</b>
              <span className="hint">Add your own tasks, or draft them with AI.</span>
            </span>
          </label>
          <label className="radio-row">
            <input type="radio" name="np-template" checked={template === "example"} onChange={() => setTemplate("example")} />
            <span>
              <b>An example plan</b>
              <span className="hint">Ten sample tasks for a website relaunch. Edit or delete them.</span>
            </span>
          </label>
        </fieldset>
        <fieldset className="field">
          <legend className="lbl">Who can see it</legend>
          {VISIBILITIES.map((v) => (
            <label key={v} className="radio-row">
              <input type="radio" name="np-visibility" checked={visibility === v} onChange={() => setVisibility(v)} />
              <span>
                <b>{VISIBILITY_LABELS[v]}</b>
                <span className="hint">{VISIBILITY_HELP[v]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row-end">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}
