import { appName, emailButton, emailLayout, escapeHtml, type EmailMessage, type Env } from "@openact/core/server";
export { sendEmail, type EmailMessage } from "@openact/core/server";

/* Emails of the projects app. They use the core email layout. */

export function inviteEmail(
  env: Env,
  opts: { to: string; projectName: string; inviterName: string; role: string; url: string; hasAccount: boolean }
): EmailMessage {
  const name = appName(env);
  const action = opts.hasAccount ? "Open the project" : "Sign in to join";
  const lead = `${opts.inviterName} added you to "${opts.projectName}" as ${/^[aeiou]/i.test(opts.role) ? "an" : "a"} ${opts.role.toLowerCase()}.`;
  return {
    to: opts.to,
    subject: `${opts.inviterName} added you to ${opts.projectName}`,
    text: `${lead}\n\n${action}: ${opts.url}\n\nSign in with this email address. You get a one-time code. You do not need a password.`,
    html: emailLayout(
      env,
      `Join ${opts.projectName}`,
      `<p style="margin:0 0 20px">${escapeHtml(lead)}</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#3347cf;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:8px">${escapeHtml(action)}</a></p>
<p style="margin:0;color:#5a6579">Sign in with this email address. You get a one-time code. You do not need a password. ${escapeHtml(name)} does not use passwords.</p>`
    )
  };
}

export function accessRequestEmail(
  env: Env,
  opts: { to: string; projectName: string; requesterName: string; requesterEmail: string; note: string; url: string }
): EmailMessage {
  const lead = `${opts.requesterName} (${opts.requesterEmail}) asks for access to "${opts.projectName}".`;
  return {
    to: opts.to,
    subject: `${opts.requesterName} asks for access to ${opts.projectName}`,
    text: `${lead}${opts.note ? `\n\nTheir note: ${opts.note}` : ""}\n\nApprove or decline the request: ${opts.url}`,
    html: emailLayout(
      env,
      "Access request",
      `<p style="margin:0 0 16px">${escapeHtml(lead)}</p>${opts.note ? `<p style="margin:0 0 20px;padding:10px 12px;background:#f2f4f8;border-radius:8px">${escapeHtml(opts.note)}</p>` : ""}${emailButton(opts.url, "Review the request")}`
    )
  };
}

export function accessGrantedEmail(env: Env, opts: { to: string; projectName: string; role: string; url: string }): EmailMessage {
  const lead = `You can now open "${opts.projectName}" as ${/^[aeiou]/i.test(opts.role) ? "an" : "a"} ${opts.role.toLowerCase()}.`;
  return {
    to: opts.to,
    subject: `You have access to ${opts.projectName}`,
    text: `${lead}\n\nOpen the project: ${opts.url}`,
    html: emailLayout(env, "Access approved", `<p style="margin:0 0 20px">${escapeHtml(lead)}</p>${emailButton(opts.url, "Open the project")}`)
  };
}
