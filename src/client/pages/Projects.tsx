import { useEffect, useState } from "react";
import { PROJECT_COLORS, ROLE_LABELS, type ProjectColor, type ProjectSummary, type User } from "../../shared/types";
import { api, errorText } from "../api";
import { Link, navigate } from "../router";
import { Icon, Modal, useToast } from "../ui";

export function ProjectsPage({ me }: { me: User }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<{ projects: ProjectSummary[] }>("/api/projects")
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(errorText(e)));
  }, []);

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Hi {me.name || me.email}</p>
          <h1>Projects</h1>
        </div>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> New project
        </button>
      </div>

      {error && <div className="notice warn">{error}</div>}
      {!projects && !error && <p className="muted">Loading your projects…</p>}
      {projects && !projects.length && (
        <div className="state">
          <h3>No projects yet</h3>
          <p>Make a project. Then invite your team. There is no limit on people.</p>
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            Make your first project
          </button>
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
                  <span className="pc-name">{p.name}</span>
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
                    <span className="chip">{ROLE_LABELS[p.role]}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </main>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ProjectColor>("indigo");
  const [template, setTemplate] = useState<"blank" | "example">("blank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/projects", { body: { name, description, color, template } });
      toast("Project created.");
      navigate(`/p/${r.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="New project" onClose={onClose}>
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
