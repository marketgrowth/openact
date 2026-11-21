import { useCallback, useEffect, useRef, useState } from "react";
import { PLANS, newerVersion, type DirectorStatus, type InstallResult, type StoreRepo } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Field, Icon, Notice, useToast } from "../ui";
import { useWorkspace } from "../workspace";
import { Badge } from "@openact/ui/components/badge";
import { Button } from "@openact/ui/components/button";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Textarea } from "@openact/ui/components/textarea";

/*
 * License and Director apps, in Site settings > Plan. For self-hosted deploys.
 * 1. Buy: Stripe Checkout at the OpenAct store. The store issues a license key for this site's host.
 * 2. Or add a license key by hand.
 * 3. Install or update the Director apps: connect GitHub once, pick the repository, and the store commits the apps.
 *    The site's Cloudflare build deploys them.
 * The Worker talks to the store. See packages/core/src/server/director.ts.
 */

const API = "/api/site/director";

const dateText = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export function DirectorStore() {
  const toast = useToast();
  const ws = useWorkspace();
  const [info, setInfo] = useState<DirectorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [keyText, setKeyText] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [repos, setRepos] = useState<StoreRepo[] | null>(null);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<InstallResult | null>(null);
  const handled = useRef(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api<DirectorStatus>(API));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  const loadRepos = useCallback(async () => {
    try {
      const r = await api<{ repos: StoreRepo[] }>(`${API}/repos`);
      setRepos(r.repos);
      const first = r.repos.find((x) => x.private) ?? r.repos[0];
      if (first) setRepo((cur) => cur || first.fullName);
    } catch (e) {
      const code = (e as { code?: string }).code;
      // Not connected yet is a normal state, not an error.
      if (code === "github_not_connected") setRepos(null);
      else setError(errorText(e));
    }
  }, []);

  // Coming back from Stripe or GitHub: read the address once, then clean it.
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const q = new URLSearchParams(location.search);
    const storeBack = q.get("store");
    const githubBack = q.get("github");
    if (storeBack || githubBack) history.replaceState(null, "", location.pathname);
    void (async () => {
      await load();
      if (storeBack === "paid") await waitForKey();
      if (storeBack === "canceled") toast("Checkout was canceled. Nothing changed.");
      if (githubBack === "connected") toast("GitHub is connected.");
      if (githubBack === "canceled") toast("GitHub was not connected.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the license works, load the repositories.
  useEffect(() => {
    if (info?.github && info.license && info.license.state !== "ended") void loadRepos();
  }, [info?.github, info?.license?.state, loadRepos, info?.license]);

  // Pick the apps that are not installed, or that have an update.
  useEffect(() => {
    if (!info?.catalog) return;
    setChosen(info.catalog.filter((a) => newerVersion(a.version, info.installed.find((i) => i.id === a.id)?.version ?? null)).map((a) => a.id));
  }, [info]);

  /** After checkout, Stripe tells the store. Ask for the key a few times while that happens. */
  async function waitForKey() {
    setWaiting(true);
    try {
      for (let i = 0; i < 20; i++) {
        const r = await api<{ saved: boolean; status: string | null; director: DirectorStatus }>(`${API}/claim`, { method: "POST" });
        setInfo(r.director);
        if (r.saved || (r.director.license && r.director.license.state !== "ended")) {
          toast("The license key is saved. The paid apps are unlocked.");
          await ws.reloadAccess();
          return;
        }
        await new Promise((ok) => setTimeout(ok, 3000));
      }
      setError("The payment went through, but the license key is not here yet. Choose Check for the key in a minute.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWaiting(false);
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const buy = (plan: "director" | "producer") =>
    run(plan, async () => {
      const r = await api<{ url: string }>(`${API}/checkout`, { method: "POST", body: { plan } });
      location.href = r.url;
    });

  const saveKey = () =>
    run("key", async () => {
      setInfo(await api<DirectorStatus>(`${API}/license`, { method: "PUT", body: { license: keyText } }));
      setKeyText("");
      setShowKey(false);
      toast("The license key is saved.");
      await ws.reloadAccess();
    });

  const removeKey = () =>
    run("remove", async () => {
      setInfo(await api<DirectorStatus>(`${API}/license`, { method: "DELETE" }));
      toast("The saved license key is removed.");
    });

  const link = () =>
    run("link", async () => {
      const r = await api<{ link: "active" | "pending"; director: DirectorStatus }>(`${API}/link`, { method: "POST" });
      setInfo(r.director);
      toast(r.link === "active" ? "This site is linked to the store." : "The link waits for MarketGrowth to approve it.");
    });

  const connect = () =>
    run("github", async () => {
      const r = await api<{ url: string }>(`${API}/github`, { method: "POST" });
      location.href = r.url;
    });

  const install = () =>
    run("install", async () => {
      setResult(await api<InstallResult>(`${API}/install`, { method: "POST", body: { repo, branch: branch.trim() || undefined, apps: chosen } }));
    });

  if (!info) return error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-muted-foreground">Loading the license…</p>;

  const lic = info.license;
  const current = !!lic && lic.state !== "ended";
  const selectedRepo = repos?.find((r) => r.fullName === repo) ?? null;

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4" aria-labelledby="director-store">
      <div className="grid gap-1">
        <h2 id="director-store" className="text-base font-semibold">
          License and Director apps
        </h2>
        <p className="text-sm text-muted-foreground">
          For a site that runs on your own Cloudflare account. Buy a plan, then install the Director apps here. Your Cloudflare build deploys them.
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {waiting && <Notice tone="info">Waiting for the license key from the OpenAct store…</Notice>}

      {/* The license */}
      <div className="grid gap-2">
        {lic ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{PLANS[lic.plan].name}</Badge>
            <span>{`Licensed to ${lic.licensee}, until ${dateText(lic.expiresAt)}.`}</span>
            {lic.source === "secret" && <span className="text-muted-foreground">From the OPENACT_LICENSE secret.</span>}
          </div>
        ) : (
          <p className="text-sm">This site has no license key.</p>
        )}
        {lic?.state === "grace" && <Notice tone="warn">The license ended. Renew it in the next few days to keep getting updates.</Notice>}
        {lic?.state === "ended" && (
          <Notice tone="warn">The license ended. The app versions you have keep working. Renew to install updates and new apps.</Notice>
        )}
        {info.licenseProblem && <Notice tone="error">{info.licenseProblem}</Notice>}
        {!info.host && <Notice tone="warn">Set APP_URL to this site's address. A license from the store works only on that address.</Notice>}

        <div className="flex flex-wrap gap-2">
          {(!current || lic?.state === "grace") && info.checkout && (
            <>
              <Button size="sm" disabled={!!busy || !info.host} onClick={() => buy("director")}>
                <Icon name="star" /> {busy === "director" ? "Opening…" : lic ? "Renew Director" : "Buy Director"}
              </Button>
            </>
          )}
          {info.storeOrder && (
            <Button size="sm" variant="outline" disabled={waiting || !!busy} onClick={() => void waitForKey()}>
              Check for the key
            </Button>
          )}
          {lic && !info.storeOrder && info.host && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={link}>
              {busy === "link" ? "Linking…" : "Link to the store"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowKey((v) => !v)}>
            {showKey ? "Close" : "Add a license key"}
          </Button>
          {lic?.source === "settings" && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={removeKey}>
              Remove the saved key
            </Button>
          )}
        </div>
        {!info.checkout && !lic && (
          <p className="text-sm text-muted-foreground">The OpenAct store does not sell plans online yet. Ask MarketGrowth for a license key, then add it here.</p>
        )}
        {showKey && (
          <div className="grid gap-2">
            <Field label="License key" htmlFor="license-key" help="It starts with oa1. MarketGrowth sends it with your plan.">
              <Textarea id="license-key" rows={3} value={keyText} onChange={(e) => setKeyText(e.target.value)} spellCheck={false} />
            </Field>
            <div>
              <Button size="sm" disabled={!keyText.trim() || !!busy} onClick={saveKey}>
                {busy === "key" ? "Saving…" : "Save the key"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* The apps */}
      <div className="grid gap-2 border-t pt-4">
        <h3 className="text-sm font-semibold">Install or update apps</h3>
        {!info.catalog ? (
          <p className="text-sm text-muted-foreground">The OpenAct store did not answer. Try again later.</p>
        ) : (
          <ul className="grid gap-2">
            {info.catalog.map((a) => {
              const have = info.installed.find((i) => i.id === a.id)?.version ?? null;
              const update = have && newerVersion(a.version, have);
              return (
                <li key={a.id} className="flex items-center gap-3 text-sm">
                  <Checkbox
                    id={`app-${a.id}`}
                    checked={chosen.includes(a.id)}
                    disabled={!current}
                    onCheckedChange={(v) => setChosen((cur) => (v ? [...cur, a.id] : cur.filter((x) => x !== a.id)))}
                  />
                  <label htmlFor={`app-${a.id}`} className="flex flex-1 flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground">{a.version}</span>
                    {have && !update && <Badge variant="secondary">Installed</Badge>}
                    {update && <Badge variant="outline">{`Update from ${have}`}</Badge>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {!current ? (
          <p className="text-sm text-muted-foreground">Installs need a current license.</p>
        ) : !info.github ? (
          <p className="text-sm text-muted-foreground">
            Installs from this page are not ready yet. With access from MarketGrowth, run npm run openact -- add docs (or advisory, esign).
          </p>
        ) : repos === null ? (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              Connect GitHub once. Give the OpenAct Director app only the private repository of this site. The store adds the apps to it, and your
              Cloudflare build deploys them.
            </p>
            <div>
              <Button size="sm" disabled={!!busy} onClick={connect}>
                <Icon name="plug" /> {busy === "github" ? "Opening GitHub…" : "Connect GitHub"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Repository" htmlFor="director-repo">
                <NativeSelect id="director-repo" value={repo} onChange={(e) => setRepo(e.target.value)}>
                  {repos.map((r) => (
                    <NativeSelectOption key={r.fullName} value={r.fullName}>
                      {r.private ? r.fullName : `${r.fullName} (public)`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Branch" htmlFor="director-branch" help="Leave it empty for the branch that Cloudflare deploys.">
                <Input id="director-branch" value={branch} placeholder={selectedRepo?.defaultBranch ?? "main"} onChange={(e) => setBranch(e.target.value)} />
              </Field>
            </div>
            {selectedRepo && !selectedRepo.private && (
              <Notice tone="warn">This repository is public. The OpenAct Director License needs a private repository. Make it private in GitHub first.</Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!!busy || !repo || !chosen.length || (selectedRepo !== null && !selectedRepo.private)} onClick={install}>
                {busy === "install" ? "Adding the apps…" : `Install ${chosen.length} ${chosen.length === 1 ? "app" : "apps"}`}
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={connect}>
                Change the GitHub access
              </Button>
            </div>
          </div>
        )}

        {result && (
          <Notice tone="info">
            <div className="grid gap-1">
              <p>
                {result.pullRequest ? (
                  <>
                    The {result.branch} branch is protected, so the apps are in a{" "}
                    <a className="underline" href={result.pullRequest} target="_blank" rel="noreferrer">
                      pull request
                    </a>
                    . Merge it to deploy.
                  </>
                ) : (
                  <>
                    The apps are in a{" "}
                    <a className="underline" href={result.commit} target="_blank" rel="noreferrer">
                      new commit
                    </a>{" "}
                    on {result.branch}. Cloudflare builds your site now. The apps show up when the build ends, in a few minutes.
                  </>
                )}
              </p>
              {result.notes.length > 0 && (
                <ul className="list-disc pl-5">
                  {result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <div>
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  Check again
                </Button>
              </div>
            </div>
          </Notice>
        )}
      </div>
    </section>
  );
}
