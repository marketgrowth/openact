import { useEffect, useState } from "react";
import { api, errorText, Notice, useToast } from "@openact/ui";
import { Label } from "@openact/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { Switch } from "@openact/ui/components/switch";
import { API, type EsignSettings } from "../shared/types";

/** Company settings, eSign tab: save signed PDFs to Docs, and the Docs folder for them. */
export function EsignSettingsTab({ detail, onChanged }: { detail: { id: string; esign?: unknown }; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const initial = (detail.esign ?? { saveToDocs: true, docsFolderId: null, docsOn: false }) as EsignSettings & { docsOn: boolean };
  const [s, setS] = useState(initial);
  const [folders, setFolders] = useState<Array<{ id: string; path: string }> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initial.docsOn) return;
    api<{ folders: Array<{ id: string; path: string }> }>(`${API}/companies/${detail.id}/docs-folders`)
      .then((r) => setFolders(r.folders))
      .catch((e) => setProblem(errorText(e)));
  }, [detail.id, initial.docsOn]);

  const save = async (next: Partial<EsignSettings>) => {
    setBusy(true);
    setProblem(null);
    try {
      await api(`/api/companies/${detail.id}`, { method: "PATCH", body: { esign: next } });
      setS({ ...s, ...next });
      toast("eSign settings saved.");
      await onChanged();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4" data-esign-settings="">
      {problem && <Notice tone="error">{problem}</Notice>}
      {!s.docsOn && <Notice tone="info">Docs is off for this company. Turn Docs on to keep a copy of each signed PDF in the library.</Notice>}
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="grid gap-1">
          <Label htmlFor="esign-docs">Save signed PDFs to Docs</Label>
          <p className="text-sm text-muted-foreground">
            When everyone signs, eSign puts a copy of the signed PDF, with its signing certificate, in the Docs library. Everyone who can see docs can open it.
          </p>
        </div>
        <Switch id="esign-docs" checked={s.saveToDocs} disabled={busy || !s.docsOn} onCheckedChange={(v) => void save({ saveToDocs: v })} />
      </div>
      {s.docsOn && s.saveToDocs && (
        <div className="grid gap-2 rounded-lg border p-3">
          <Label htmlFor="esign-folder">Docs folder</Label>
          <NativeSelect
            id="esign-folder"
            value={s.docsFolderId ?? ""}
            disabled={busy || !folders}
            onChange={(e) => void save({ docsFolderId: e.target.value || null })}
          >
            <NativeSelectOption value="">Top of the library</NativeSelectOption>
            {folders?.map((f) => (
              <NativeSelectOption key={f.id} value={f.id}>
                {f.path}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Choose who can send documents in the Permissions tab, under Send documents for signature.</p>
    </div>
  );
}
