/*
 * The scoping call form on https://openact.ing/producer. The page opens it in a side drawer.
 * POST /api/producer takes the form and emails it through Resend. Reply-To is the visitor, so a reply goes straight to them.
 * A plain form post (no JavaScript) gets a 303 back to /producer#sent or /producer#send-error.
 * A post with Accept: application/json gets { ok: true } or { ok: false, message }.
 * Read www/README.md for the settings.
 */

/** Settings for the scoping call form, on the openact-site Worker. */
export interface ProducerEnv {
  /** Secret. A Resend API key that can send email. */
  RESEND_API_KEY?: string;
  /** Where requests go. One address, or more with commas. */
  PRODUCER_TO?: string;
  /** The sender, such as "OpenAct <hello@openact.ing>". Resend must have the domain verified. */
  PRODUCER_FROM?: string;
}

export const PRODUCER_API = "/api/producer";

const MAX_VALUE = 3000;
const LIMIT_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
const FIELDS: [key: string, label: string][] = [
  ["name", "Name"],
  ["email", "Email"],
  ["organization", "Organization"],
  ["website", "Website"],
  ["kind", "Organization type"],
  ["app", "The app they want"],
  ["start", "When they want to start"]
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clean = (v: FormDataEntryValue | null, n = MAX_VALUE) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, n) : "");
const oneLine = (v: FormDataEntryValue | null, n: number) => clean(v, n).replace(/[\r\n<>]/g, " ");
const isLocal = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

/** Counts posts per IP for one hour in this data center's cache. It slows spam. It is not a strict limit. */
async function overLimit(ip: string, origin: string): Promise<boolean> {
  const cache = caches.default;
  const key = new Request(`${origin}/__limit/producer/${encodeURIComponent(ip)}`);
  const hit = await cache.match(key);
  const count = hit ? Number(await hit.text()) || 0 : 0;
  if (count >= LIMIT_PER_HOUR) return true;
  await cache.put(key, new Response(String(count + 1), { headers: { "Cache-Control": "max-age=3600" } }));
  return false;
}

export async function handleProducer(request: Request, env: ProducerEnv): Promise<Response> {
  const url = new URL(request.url);
  const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
  const reply = (ok: boolean, message = "", status = 200) =>
    wantsJson
      ? json(ok ? { ok: true } : { ok: false, message }, status)
      : new Response(null, { status: 303, headers: { Location: `${url.origin}/producer#${ok ? "sent" : "send-error"}`, "Cache-Control": "no-store" } });

  if (request.method !== "POST") return json({ ok: false, message: "Use POST to send the form." }, 405);
  // Only the Producer page sends this form. A browser always sends Origin on a POST.
  const from = request.headers.get("origin");
  if (from && from !== url.origin && !isLocal(from)) return reply(false, "Send the form from the Producer page.", 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply(false, "Send the form again.", 400);
  }
  // The honeypot box. People leave it clear. Report success and send nothing.
  if (clean(form.get("botcheck"))) return reply(true);

  const values: Record<string, string> = {};
  for (const [key] of FIELDS) values[key] = key === "app" ? clean(form.get(key)) : oneLine(form.get(key), 200);
  if (!values.name) return reply(false, "Enter your name.", 400);
  if (!EMAIL_RE.test(values.email)) return reply(false, "Enter a valid email address.", 400);
  if (!values.app) return reply(false, "Tell us about the app that you want to build.", 400);

  const key = (env.RESEND_API_KEY || "").trim();
  const to = (env.PRODUCER_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  const sender = (env.PRODUCER_FROM || "").trim();
  if (!key || !to.length || !sender) {
    console.warn("[openact] Set RESEND_API_KEY, PRODUCER_TO and PRODUCER_FROM on openact-site to turn on the Producer form.");
    return reply(false, "The form is not set up yet. Try again later.", 503);
  }
  if (await overLimit(request.headers.get("CF-Connecting-IP") || "unknown", url.origin)) {
    return reply(false, "Too many requests. Try again in an hour.", 429);
  }

  const rows = FIELDS.filter(([k]) => values[k]);
  const subject = `Producer scoping call: ${values.organization || values.name}`;
  const text = rows.map(([k, label]) => `${label}: ${values[k]}`).join("\n") + "\n\nReply to this email to answer the visitor.";
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f4;">
<div style="max-width:600px;margin:0 auto;padding:28px 24px;font-family:'IBM Plex Sans',Arial,sans-serif;font-size:15px;line-height:1.55;color:#0c110f;">
<p style="margin:0 0 18px;font-weight:700;font-size:18px;">${esc(subject)}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;">
${rows.map(([k, label]) => `<tr><th style="text-align:left;vertical-align:top;padding:8px 12px 8px 0;border-top:1px solid #d6ddd9;font-weight:600;width:34%;">${esc(label)}</th><td style="padding:8px 0;border-top:1px solid #d6ddd9;white-space:pre-wrap;">${esc(values[k])}</td></tr>`).join("\n")}
</table>
<p style="margin:18px 0 0;font-size:13px;color:#66706c;">Sent from openact.ing/producer. Reply to this email to answer the visitor.</p>
</div></body></html>`;

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to,
        reply_to: `"${values.name.replace(/"/g, "")}" <${values.email}>`,
        subject,
        text,
        html,
        tags: [{ name: "source", value: "producer-form" }]
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    return reply(false, "We could not send your request. Try again in a minute.", 502);
  }
  if (!res.ok) {
    console.warn("[openact] Resend did not send the Producer form:", res.status);
    return reply(false, "We could not send your request. Try again in a minute.", 502);
  }
  return reply(true);
}
