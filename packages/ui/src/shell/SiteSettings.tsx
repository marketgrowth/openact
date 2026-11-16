import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SIGN_IN_CREDIT,
  DEFAULT_SIGN_IN_HEADING,
  LEGAL_URL_MAX,
  SIGN_IN_BACKGROUND_MAX_BYTES,
  SIGN_IN_CREDIT_MAX,
  SIGN_IN_HEADING_MAX,
  SITE_LOGO_MAX_BYTES,
  SITE_LOGO_TYPES,
  SITE_NAME_MAX,
  type SiteSettings
} from "@openact/core/shared";
import { api, errorText } from "../api";
import { Field, Logo, Notice, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { Switch } from "@openact/ui/components/switch";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { Separator } from "@openact/ui/components/separator";
import { SiteCompanyApps } from "./SiteCompanyApps";

/** Which part of Site settings to show. Each one is a section of the Settings page. */
export type SiteSection = "general" | "sign-in" | "apps";

/**
 * Site settings for super admins: the app name, the logo, the sign-in page and the apps of this deploy.
 * The Settings page shows one section at a time.
 */
export function SiteSettingsSection({ section, onSaved }: { section: SiteSection; onSaved: (s: SiteSettings) => void }) {
  const toast = useToast();
  const ws = useWorkspace();
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appBusy, setAppBusy] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const bgFile = useRef<HTMLInputElement>(null);
  const [signIn, setSignIn] = useState({ heading: "", credit: "", termsUrl: "", privacyUrl: "" });
  const [signInBusy, setSignInBusy] = useState(false);

  // The form holds what a super admin saved. Empty fields mean the defaults.
  const signInForm = (s: SiteSettings) => ({
    heading: s.signIn.customHeading ? s.signIn.heading : "",
    credit: s.signIn.customHeading ? s.signIn.credit : "",
    termsUrl: s.signIn.termsUrl ?? "",
    privacyUrl: s.signIn.privacyUrl ?? ""
  });

  useEffect(() => {
    api<SiteSettings>("/api/site")
      .then((s) => {
        setSite(s);
        setName(s.customName ? s.appName : "");
        setSignIn(signInForm(s));
      })
      .catch((err) => setLoadError(errorText(err)));
  }, []);

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

  const saveSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignInBusy(true);
    try {
      const s = await api<SiteSettings>("/api/site/sign-in", { method: "PATCH", body: signIn });
      apply(s);
      setSignIn(signInForm(s));
      toast("The sign-in page is saved.");
    } catch (err) {
      toast(errorText(err));
    } finally {
      setSignInBusy(false);
    }
  };

  const uploadBackground = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (!(SITE_LOGO_TYPES as readonly string[]).includes(f.type)) throw new Error("Use a PNG, JPEG or WebP image.");
      if (f.size > SIGN_IN_BACKGROUND_MAX_BYTES) throw new Error("The background must be 3 MB or smaller.");
      const form = new FormData();
      form.append("file", f);
      apply(await api<SiteSettings>("/api/site/sign-in-background", { method: "PUT", form }));
      toast("The sign-in background is saved.");
    } catch (err) {
      toast(errorText(err));
    } finally {
      if (bgFile.current) bgFile.current.value = "";
    }
  };

  const removeBackground = async () => {
    try {
      apply(await api<SiteSettings>("/api/site/sign-in-background", { method: "DELETE" }));
      toast("The default sign-in background is back.");
    } catch (err) {
      toast(errorText(err));
    }
  };

  const setAppOn = async (id: string, name: string, enabled: boolean) => {
    setAppBusy(true);
    try {
      apply(await api<SiteSettings>(`/api/site/apps/${encodeURIComponent(id)}`, { method: "PATCH", body: { enabled } }));
      await ws.reloadAccess();
      toast(enabled ? `${name} is on for the site.` : `${name} is off in every company. Other people see the change within a minute.`);
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

  if (loadError) return <Notice tone="error">{loadError}</Notice>;
  if (!site) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!site.canEdit) return <Notice tone="error">Only super admins can change site settings.</Notice>;

  if (section === "general")
    return (
      <div className="grid gap-6">
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
            <input ref={file} type="file" accept={SITE_LOGO_TYPES.join(",")} className="sr-only" id="site-logo" onChange={(e) => upload(e.target.files?.[0])} />
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
      </div>
    );

  if (section === "apps") {
    const apps = site.apps ?? [];
    if (!apps.length) return <p className="text-sm text-muted-foreground">This site has no apps to turn off.</p>;
    return (
      <div className="grid gap-6">
        <section className="grid gap-3" aria-labelledby="site-apps-all">
          <div className="grid gap-1">
            <h3 id="site-apps-all" className="text-sm font-medium">
              Every company
            </h3>
            <p className="text-sm text-muted-foreground">An app that is off here is off in every company on this site.</p>
          </div>
          <ul className="grid gap-2" data-site-apps="">
            {apps.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-lg border p-3" data-site-app={a.id}>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground">{a.enabled ? "On" : "Off"}</span>
                <Switch checked={a.enabled} disabled={appBusy} onCheckedChange={(on) => setAppOn(a.id, a.name, on)} aria-label={`${a.name} app for the whole site`} />
              </li>
            ))}
          </ul>
        </section>
        <Separator />
        <section className="grid gap-3" aria-labelledby="site-apps-company">
          <div className="grid gap-1">
            <h3 id="site-apps-company" className="text-sm font-medium">
              One company
            </h3>
            <p className="text-sm text-muted-foreground">Choose which apps each company can use. A change here does not touch the other companies.</p>
          </div>
          <SiteCompanyApps siteOff={apps.filter((a) => !a.enabled).map((a) => a.id)} />
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <form className="grid gap-4" onSubmit={saveSignIn} data-site-sign-in-form="">
        <Field label="Sign-in heading" htmlFor="site-signin-heading" help="It shows beside the sign-in form. Leave it empty to use the default quote.">
          <Input
            id="site-signin-heading"
            value={signIn.heading}
            maxLength={SIGN_IN_HEADING_MAX}
            placeholder={DEFAULT_SIGN_IN_HEADING}
            onChange={(e) => setSignIn((v) => ({ ...v, heading: e.target.value }))}
          />
        </Field>
        <Field label="Credit" htmlFor="site-signin-credit" help="Who said the heading. It shows under the heading. Leave it empty for no credit.">
          <Input
            id="site-signin-credit"
            value={signIn.credit}
            maxLength={SIGN_IN_CREDIT_MAX}
            placeholder={signIn.heading.trim() ? "" : DEFAULT_SIGN_IN_CREDIT}
            disabled={!signIn.heading.trim()}
            onChange={(e) => setSignIn((v) => ({ ...v, credit: e.target.value }))}
          />
        </Field>
        <Field
          label="Terms of Use link"
          htmlFor="site-terms-url"
          help="The sign-in page says that people agree to the Terms of Use and Privacy Policy. Add the links so people can read them."
        >
          <Input
            id="site-terms-url"
            type="url"
            inputMode="url"
            value={signIn.termsUrl}
            maxLength={LEGAL_URL_MAX}
            placeholder="https://example.com/terms"
            onChange={(e) => setSignIn((v) => ({ ...v, termsUrl: e.target.value }))}
          />
        </Field>
        <Field label="Privacy Policy link" htmlFor="site-privacy-url">
          <Input
            id="site-privacy-url"
            type="url"
            inputMode="url"
            value={signIn.privacyUrl}
            maxLength={LEGAL_URL_MAX}
            placeholder="https://example.com/privacy"
            onChange={(e) => setSignIn((v) => ({ ...v, privacyUrl: e.target.value }))}
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={signInBusy || JSON.stringify(signIn) === JSON.stringify(signInForm(site))}>
            Save sign-in page
          </Button>
        </div>
      </form>
      <Separator />
      <Field
        label="Sign-in background"
        help="PNG, JPEG or WebP, up to 3 MB. A wide image looks best. It shows behind the heading. Choose Use default to show the default background again."
      >
        <div className="flex flex-wrap items-center gap-3">
          {site.signIn.backgroundUrl ? (
            <img src={site.signIn.backgroundUrl} alt="" className="h-12 w-20 rounded-md border object-cover" />
          ) : (
            <span className="flex h-12 w-20 items-center justify-center rounded-md border bg-stage text-[10px] text-stage-muted">Default</span>
          )}
          <input
            ref={bgFile}
            type="file"
            accept={SITE_LOGO_TYPES.join(",")}
            className="sr-only"
            id="site-signin-background"
            onChange={(e) => uploadBackground(e.target.files?.[0])}
          />
          <Button asChild variant="outline" size="sm">
            <label htmlFor="site-signin-background" className="cursor-pointer">
              {site.signIn.backgroundUrl ? "Replace background" : "Upload background"}
            </label>
          </Button>
          {site.signIn.backgroundUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={removeBackground}>
              Use default
            </Button>
          )}
        </div>
      </Field>
    </div>
  );
}
