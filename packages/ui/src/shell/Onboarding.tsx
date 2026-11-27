import { useState } from "react";
import {
  COMPANY_NAME_MAX,
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  ONBOARDING_KINDS,
  ONBOARDING_KIND_LABELS,
  type Company,
  type EntityType,
  type OnboardingKind
} from "@openact/core/shared";
import { api, errorText } from "../api";
import { navigate } from "../router";
import { Field, Logo, Notice } from "../ui";
import { useWorkspace } from "../workspace";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";
import { ToggleGroup, ToggleGroupItem } from "@openact/ui/components/toggle-group";

/**
 * The first screen for a new person with no company (docs/onboarding.md).
 * Three answers make the company, its owner and its first workspace. The server checks the rules again.
 */
export function Onboarding({ appName, logoUrl, email }: { appName: string; logoUrl: string | null; email: string }) {
  const ws = useWorkspace();
  const [legalName, setLegalName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("llc");
  const [brand, setBrand] = useState("");
  const [brandKind, setBrandKind] = useState<OnboardingKind>("brand");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ company: Company }>("/api/onboarding", { body: { legalName, entityType, brand, brandKind } });
      await ws.reloadCompanies();
      await ws.switchTo(r.company.id);
      navigate("/");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-muted/40" data-onboarding="">
      <header className="flex h-16 items-center gap-3 px-6 sm:px-10">
        <Logo src={logoUrl} size={28} />
        <span className="text-lg font-semibold">{appName}</span>
        <span className="ml-auto hidden text-sm text-muted-foreground sm:inline">Signed in as {email}</span>
      </header>
      <div className="mx-auto grid w-full max-w-xl gap-6 px-6 pb-16 pt-6">
        <form className="grid gap-6 rounded-2xl border bg-card p-6 sm:p-10" onSubmit={submit}>
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold">Set up your company</h1>
            <p className="text-sm text-muted-foreground">This takes one minute. You can change every answer later in Company settings.</p>
          </div>
          <Field label="Official company name" htmlFor="ob-legal" help="Use the legal name, as it shows on your filings.">
            <Input id="ob-legal" required maxLength={COMPANY_NAME_MAX} value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="For example: Harbor & Pine, LLC" />
          </Field>
          <Field label="Company type" htmlFor="ob-type">
            <NativeSelect id="ob-type" value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType)}>
              {ENTITY_TYPES.map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {ENTITY_TYPE_LABELS[t]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Primary brand or business unit" htmlFor="ob-brand" help="This becomes your first workspace.">
            <div className="grid gap-3">
              <Input id="ob-brand" required maxLength={COMPANY_NAME_MAX} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="For example: Harbor Coffee" />
              <ToggleGroup type="single" variant="outline" value={brandKind} onValueChange={(v) => v && setBrandKind(v as OnboardingKind)} aria-label="Brand or business unit" className="justify-start">
                {ONBOARDING_KINDS.map((k) => (
                  <ToggleGroupItem key={k} value={k} className="px-4">
                    {ONBOARDING_KIND_LABELS[k]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" disabled={busy || !legalName.trim() || !brand.trim()}>
            Create company
          </Button>
        </form>
        <p className="text-sm text-muted-foreground">Did someone invite you to a company? Open the link in your invitation email. You will not see this step.</p>
      </div>
    </main>
  );
}
