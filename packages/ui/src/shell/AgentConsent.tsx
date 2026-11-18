import { useEffect, useState } from "react";
import type { AppConfig } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Logo, Notice, ThemeSwitch } from "../ui";
import { Button } from "@openact/ui/components/button";
import { Card, CardContent } from "@openact/ui/components/card";
import { Checkbox } from "@openact/ui/components/checkbox";
import { Label } from "@openact/ui/components/label";
import { NativeSelect } from "@openact/ui/components/native-select";

/** The path of the consent page. An AI agent sends the person here to connect (OAuth 2.1 authorization). */
export const CONSENT_PATH = "/oauth/authorize";

interface ConsentInfo {
  client: { name: string; uri: string | null; redirectHost: string };
  wantsWrite: boolean;
  companies: Array<{ id: string; name: string; role: string }>;
}

/**
 * The consent page for agent access. The person picks a company and chooses whether the agent may change data.
 * The server checks the request again when they answer, and sends the browser back to the agent.
 */
export function AgentConsent({ config }: { config: AppConfig }) {
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [allowChanges, setAllowChanges] = useState(false);
  const [busy, setBusy] = useState(false);

  // The agent's request, as it came in the address.
  const params = Object.fromEntries(new URLSearchParams(location.search));

  useEffect(() => {
    api<ConsentInfo | { redirect: string }>(`/api/oauth/authorize${location.search}`)
      .then((r) => {
        if ("redirect" in r) return location.assign(r.redirect);
        setInfo(r);
        setCompanyId(r.companies[0]?.id ?? "");
        setAllowChanges(r.wantsWrite);
      })
      .catch((e) => setProblem(errorText(e)));
  }, []);

  const answer = async (allow: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await api<{ redirect: string }>("/api/oauth/authorize", { body: { ...params, companyId, allow, allowChanges } });
      location.assign(r.redirect);
    } catch (e) {
      setProblem(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background bg-glow p-6 md:p-10" data-agent-consent="">
      <div className="fixed top-[max(1rem,env(safe-area-inset-top))] right-4 z-10">
        <ThemeSwitch />
      </div>
      <main className="w-full max-w-md">
        <Card className="shadow-xl">
          <CardContent className="grid gap-6 p-6 md:p-8">
            <div className="flex flex-col items-center gap-2 text-center">
              <Logo src={config.logoUrl} size={40} />
              <span className="text-sm font-medium text-muted-foreground">{config.appName}</span>
            </div>
            {!info && !problem && <p className="text-center text-sm text-muted-foreground">Checking the request…</p>}
            {problem && !info && <Notice tone="error">{problem}</Notice>}
            {info && (
              <>
                <div className="grid gap-2 text-center">
                  <h1 className="text-xl font-bold text-balance">Connect {info.client.name}?</h1>
                  <p className="text-sm text-balance text-muted-foreground">
                    The agent acts as you in one company. It can use the tools of the apps there, and only what your role allows.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    After you answer, you go back to <span className="font-mono">{info.client.redirectHost}</span>.
                  </p>
                </div>
                {info.companies.length === 0 ? (
                  <Notice tone="warn">You are not in a company yet. Make or join a company first, then connect the agent again.</Notice>
                ) : (
                  <div className="grid gap-2">
                    <Label htmlFor="consent-company">Company</Label>
                    <NativeSelect id="consent-company" className="w-full" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                      {info.companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <Checkbox id="consent-write" checked={allowChanges} onCheckedChange={(v) => setAllowChanges(v === true)} />
                  <div className="grid gap-1">
                    <Label htmlFor="consent-write">Allow changes</Label>
                    <p className="text-sm text-muted-foreground">
                      Without this, the agent can only read. Deletes and changes to people always stay with you.
                    </p>
                  </div>
                </div>
                {problem && <Notice tone="error">{problem}</Notice>}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => answer(false)} data-consent-deny="">
                    Do not connect
                  </Button>
                  <Button type="button" disabled={busy || !companyId} onClick={() => answer(true)} data-consent-allow="">
                    Connect
                  </Button>
                </div>
                <p className="text-center text-xs text-muted-foreground">You can disconnect the agent at any time in Settings, under Connected agents.</p>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
