import { useEffect, useRef, useState } from "react";
import { SITE_LOGO_MAX_BYTES, SITE_LOGO_TYPES, SITE_NAME_MAX, type SiteSettings } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Field, Logo, Modal, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { Switch } from "@openact/ui/components/switch";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Separator } from "@openact/ui/components/separator";

/** Site settings for super admins: the app name, the logo and the apps of this deploy. */
export function SiteSettingsDialog({ onSaved, onClose }: { onSaved: (s: SiteSettings) => void; onClose: () => void }) {
  const toast = useToast();
  const ws = useWorkspace();
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [appBusy, setAppBusy] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<SiteSettings>("/api/site")
      .then((s) => {
        setSite(s);
        setName(s.customName ? s.appName : "");
      })
      .catch((err) => toast(errorText(err)));
  }, [toast]);

  const apply = (s: SiteSettings) => {
    setSite(s);
    onSaved(s);
  };

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await api<SiteSettings>("/api/site", { method: "PATCH", body: { appName: name } });
      apply(s);
      setName(s.customName ? s.appName : "");
      toast(s.customName ? "The app name is saved." : "The app name is back to the default.");
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (!(SITE_LOGO_TYPES as readonly string[]).includes(f.type)) throw new Error("Use a PNG, JPEG or WebP image.");
      if (f.size > SITE_LOGO_MAX_BYTES) throw new Error("The logo must be 1 MB or smaller.");
      const form = new FormData();
      form.append("file", f);
      apply(await api<SiteSettings>("/api/site/logo", { method: "PUT", form }));
      toast("The logo is saved.");
    } catch (err) {
      toast(errorText(err));
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const setAppOn = async (id: string, name: string, enabled: boolean) => {
    setAppBusy(true);
    try {
      apply(await api<SiteSettings>(`/api/site/apps/${encodeURIComponent(id)}`, { method: "PATCH", body: { enabled } }));
      await ws.reloadAccess();
      toast(enabled ? `${name} is on for the site.` : `${name} is off for the site. Other people see the change within a minute.`);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setAppBusy(false);
    }
  };

  const removeLogo = async () => {
    try {
      apply(await api<SiteSettings>("/api/site/logo", { method: "DELETE" }));
      toast("The logo is removed.");
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <Modal title="Site settings" description="The name, logo and apps that everyone on this site sees. Only super admins can change them." onClose={onClose}>
      {!site ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <form className="grid gap-4" onSubmit={saveName} data-site-name-form="">
            <Field
              label="App name"
              htmlFor="site-name"
              help={`It shows on the sign-in page, in the browser tab and in emails. Leave it empty to use the default name, ${site.defaultName}.`}
            >
              <Input id="site-name" value={name} maxLength={SITE_NAME_MAX} placeholder={site.defaultName} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || name.trim() === (site.customName ? site.appName : "")}>
                Save name
              </Button>
            </div>
          </form>
          <Separator />
          <Field label="Logo" help="PNG, JPEG or WebP, up to 1 MB. A square image looks best. It shows on the sign-in page and as the browser tab icon.">
            <div className="flex flex-wrap items-center gap-3">
              <Logo size={48} src={site.logoUrl} />
              <input
                ref={file}
                type="file"
                accept={SITE_LOGO_TYPES.join(",")}
                className="sr-only"
                id="site-logo"
                onChange={(e) => upload(e.target.files?.[0])}
              />
              <Button asChild variant="outline" size="sm">
                <label htmlFor="site-logo" className="cursor-pointer">
                  {site.logoUrl ? "Replace logo" : "Upload logo"}
                </label>
              </Button>
              {site.logoUrl && (
                <Button type="button" variant="ghost" size="sm" onClick={removeLogo}>
                  Remove
                </Button>
              )}
            </div>
          </Field>
          {site.apps && site.apps.length > 0 && (
            <>
              <Separator />
              <Field label="Apps" help="Turn an app off for every company on this site. An app that is off keeps its data. Companies cannot turn it on again until you do.">
                <ul className="grid gap-2" data-site-apps="">
                  {site.apps.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-lg border p-3" data-site-app={a.id}>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                      <span className="text-xs text-muted-foreground">{a.enabled ? "On" : "Off"}</span>
                      <Switch
                        checked={a.enabled}
                        disabled={appBusy}
                        onCheckedChange={(on) => setAppOn(a.id, a.name, on)}
                        aria-label={`${a.name} app for the whole site`}
                      />
                    </li>
                  ))}
                </ul>
              </Field>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
