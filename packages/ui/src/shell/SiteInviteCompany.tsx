import { useState } from "react";
import { COMPANY_NAME_MAX, ENTITY_TYPES, ENTITY_TYPE_LABELS, type EntityType } from "@openact/core/shared";
import { api, errorText } from "../api";
import { Field, Notice, useToast } from "../ui";
import { Button } from "@openact/ui/components/button";
import { Input } from "@openact/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@openact/ui/components/native-select";

/*
 * Site settings > Invite a company. A super admin invites a client company (B2B).
 * The server makes the company with no people. The invited person becomes its first owner when they accept.
 */
export function SiteInviteCompany() {
  const toast = useToast();
  const [legalName, setLegalName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("llc");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/site/companies/invite", { body: { legalName, entityType, email } });
      toast(`Invitation sent to ${email}.`);
      setLegalName("");
      setEmail("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid max-w-xl gap-5" onSubmit={submit} data-site-invite-company="">
      <Field label="Official company name" htmlFor="ic-name" help="Use the legal name.">
        <Input id="ic-name" required maxLength={COMPANY_NAME_MAX} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
      </Field>
      <Field label="Company type" htmlFor="ic-type">
        <NativeSelect id="ic-type" value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType)}>
          {ENTITY_TYPES.map((t) => (
            <NativeSelectOption key={t} value={t}>
              {ENTITY_TYPE_LABELS[t]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Owner email" htmlFor="ic-email" help="This person becomes the first owner of the company when they accept. They skip onboarding.">
        <Input id="ic-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div>
        <Button type="submit" disabled={busy || !legalName.trim() || !email.trim()}>
          Send invitation
        </Button>
      </div>
    </form>
  );
}
