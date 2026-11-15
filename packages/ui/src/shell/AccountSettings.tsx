import { useState } from "react";
import type { User } from "@openact/core/shared";
import { api, errorText } from "../api";
import { navigate } from "../router";
import { Field, ThemeSwitch, useToast } from "../ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Separator } from "@openact/ui/components/separator";

/*
 * Personal account settings. Every signed-in person can open them, in any company.
 * Profile: the name, the email and the theme. Sign-in and security: sign out, and delete the account.
 */

export function ProfileSection({ me, onMe }: { me: User; onMe: (u: User | null) => void }) {
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ user: User }>("/api/me", { method: "PATCH", body: { name } });
      onMe(r.user);
      toast("Your name is saved.");
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-6" data-account-profile="">
      <form className="grid gap-4" onSubmit={save}>
        <Field label="Name" htmlFor="acc-name" help="Your name shows on tasks, comments and the people list.">
          <Input id="acc-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <div className="grid gap-2">
          <span className="text-sm leading-none font-medium">Email</span>
          <span className="font-mono text-sm text-muted-foreground">{me.email}</span>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !name.trim() || name.trim() === me.name}>
            Save name
          </Button>
        </div>
      </form>
      <Separator />
      <Field label="Theme" help="System follows the setting on your device. The choice applies in this browser.">
        <ThemeSwitch />
      </Field>
    </div>
  );
}

export function SecuritySection({ me, onMe, onSignOut }: { me: User; onMe: (u: User | null) => void; onSignOut: (everywhere: boolean) => void }) {
  return (
    <div className="grid gap-6" data-account-security="">
      <div className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Sign out</h3>
          <p className="text-sm text-muted-foreground">Sign out on this device, or on every device where you are signed in.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => onSignOut(false)}>
            Sign out
          </Button>
          <Button type="button" variant="ghost" onClick={() => onSignOut(true)}>
            Sign out on all devices
          </Button>
        </div>
      </div>
      <Separator />
      <DeleteAccount me={me} onDeleted={() => onMe(null)} />
    </div>
  );
}

/** Deletes the person's own account. They type their email to confirm. */
function DeleteAccount({ me, onDeleted }: { me: User; onDeleted: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const matches = email.trim().toLowerCase() === me.email.toLowerCase();

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setProblem(null);
    try {
      await api("/api/me", { method: "DELETE", body: { email } });
      toast("Your account is deleted.");
      onDeleted();
      navigate("/", true);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <div className="grid gap-2 rounded-lg border border-destructive/30 p-4">
        <h3 className="text-sm font-medium">Delete account</h3>
        <p className="text-sm text-muted-foreground">
          You leave every company, and you are signed out on all devices. Projects, tasks and files that you made stay with their company. You cannot undo this.
        </p>
        <div>
          <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)} data-delete-account="">
            Delete account
          </Button>
        </div>
      </div>
    );
  return (
    <form className="grid gap-3 rounded-lg border border-destructive/40 p-4" onSubmit={remove} data-delete-account-form="">
      <h3 className="text-sm font-medium">Delete your account</h3>
      <p className="text-sm text-muted-foreground">
        You leave every company, and you are signed out on all devices. Projects, tasks and files that you made stay with their company. You cannot undo this.
      </p>
      <Field label="Type your email to confirm" htmlFor="acc-delete-email">
        <Input id="acc-delete-email" type="email" autoComplete="off" value={email} placeholder={me.email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {problem && (
        <p className="text-sm text-destructive" role="alert">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={!matches || busy}>
          Delete my account
        </Button>
      </div>
    </form>
  );
}
