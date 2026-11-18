import { useCallback, useEffect, useState } from "react";
import { Icon, Link, Notice, PageBody, SiteHeader, api, errorText, useWorkspace } from "@openact/ui";
import { Button } from "@openact/ui/components/button";
import { API, CMS_SETTINGS, adminUrl, type CmsSite } from "../shared/rules";

/*
 * What the framed EmDash admin may do. It runs scripts and keeps its own sign-in (same-origin to itself),
 * sends forms, opens sign-in windows and downloads files. It cannot navigate the OpenAct page.
 */
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals";

/** EmDash signs in with passkeys. The frame needs these to use them, and the clipboard for copy buttons. */
const ALLOW = "publickey-credentials-get *; publickey-credentials-create *; clipboard-write";

/** The CMS page: the company's EmDash admin in a frame. */
export default function CmsPage() {
  const { current } = useWorkspace();
  const [site, setSite] = useState<CmsSite | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  const load = useCallback(() => {
    if (!current) return;
    setProblem(null);
    api<CmsSite>(`${API}/companies/${current.id}/site`).then(setSite, (e) => setProblem(errorText(e)));
  }, [current]);
  useEffect(load, [load]);

  const admin = site?.siteUrl ? adminUrl(site.siteUrl) : null;

  return (
    <>
      <SiteHeader title="CMS">
        {admin && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setFrameKey((k) => k + 1)} aria-label="Reload the EmDash admin">
              <Icon name="history" />
              <span className="hidden sm:inline">Reload</span>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={admin} target="_blank" rel="noreferrer">
                <Icon name="external" />
                <span className="hidden sm:inline">Open in new tab</span>
                <span className="sr-only sm:hidden">Open EmDash in a new tab</span>
              </a>
            </Button>
          </>
        )}
      </SiteHeader>
      {admin ? (
        <div className="flex min-h-[calc(100svh-var(--header-height)-1rem)] flex-1 flex-col overflow-hidden md:rounded-b-xl" data-cms-frame="">
          <iframe
            key={frameKey}
            src={admin}
            title="EmDash admin"
            className="w-full flex-1 border-0 bg-background"
            sandbox={SANDBOX}
            allow={ALLOW}
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <PageBody className="max-w-2xl">
          {problem && <Notice tone="error">{problem}</Notice>}
          {!site && !problem && <p className="text-sm text-muted-foreground">Loading…</p>}
          {site && !site.siteUrl && (
            <div className="grid gap-3 rounded-lg border p-4" data-cms-empty="">
              <h2 className="text-base font-medium">Connect your EmDash site</h2>
              {site.canManage ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Add the address of your EmDash site in Company settings. Then the EmDash admin opens here, next to the app rail.
                  </p>
                  <div>
                    <Button asChild>
                      <Link to={CMS_SETTINGS}>Add the EmDash address</Link>
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No EmDash site is connected yet. Ask a company owner or admin to add its address in Company settings.</p>
              )}
            </div>
          )}
        </PageBody>
      )}
    </>
  );
}
