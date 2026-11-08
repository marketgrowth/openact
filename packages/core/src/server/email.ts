import type { Env } from "./env";
import { HttpError, appName, escapeHtml } from "./util";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends one email through the Resend API.
 * Without RESEND_API_KEY (local development), the message is printed to the terminal instead.
 */
export async function sendEmail(env: Env, msg: EmailMessage): Promise<"sent" | "logged"> {
  if (!env.RESEND_API_KEY) {
    console.log(`\n[openact] RESEND_API_KEY is not set, so this email was not sent.\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`);
    return "logged";
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[openact] Resend returned ${res.status}: ${body.slice(0, 500)}`);
    throw new HttpError(502, "The email could not be sent. Try again in a minute.");
  }
  return "sent";
}

/** The HTML frame for an email. Apps use it so their emails match. */
export function emailLayout(env: Env, heading: string, bodyHtml: string): string {
  const name = escapeHtml(appName(env));
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f2f5f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#192033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #d2dae4;border-radius:12px">
<tr><td style="padding:28px 28px 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#5a6577">${name}</td></tr>
<tr><td style="padding:0 28px 8px;font-size:22px;font-weight:700;line-height:1.3">${escapeHtml(heading)}</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
</table>
</td></tr></table></body></html>`;
}

export function signInCodeEmail(env: Env, to: string, code: string): EmailMessage {
  const name = appName(env);
  return {
    to,
    subject: `${code} is your ${name} sign-in code`,
    text: `Your ${name} sign-in code is ${code}.\n\nThe code expires in 10 minutes. If you did not ask for this code, you can ignore this email.`,
    html: emailLayout(
      env,
      "Your sign-in code",
      `<p style="margin:0 0 16px">Type this code on the sign-in page:</p>
<p style="margin:0 0 16px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:.2em">${escapeHtml(code)}</p>
<p style="margin:0;color:#5a6577">The code expires in 10 minutes. If you did not ask for this code, you can ignore this email.</p>`
    )
  };
}

/** A call-to-action button for an email body. */
export function emailButton(url: string, label: string): string {
  return `<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#3247cf;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:8px">${escapeHtml(label)}</a></p>`;
}

export function companyInviteEmail(
  env: Env,
  opts: { to: string; companyName: string; inviterName: string; role: string; url: string; hasAccount: boolean }
): EmailMessage {
  const action = opts.hasAccount ? "Open the company" : "Sign in to join";
  const lead = `${opts.inviterName} added you to the company "${opts.companyName}" as ${/^[aeiou]/i.test(opts.role) ? "an" : "a"} ${opts.role.toLowerCase()}.`;
  return {
    to: opts.to,
    subject: `${opts.inviterName} added you to ${opts.companyName}`,
    text: `${lead}\n\n${action}: ${opts.url}\n\nSign in with this email address. You get a one-time code. You do not need a password.`,
    html: emailLayout(
      env,
      `Join ${opts.companyName}`,
      `<p style="margin:0 0 20px">${escapeHtml(lead)}</p>${emailButton(opts.url, action)}<p style="margin:0;color:#5a6577">Sign in with this email address. You get a one-time code. You do not need a password.</p>`
    )
  };
}
