import { emailButton, emailLayout, escapeHtml, sendEmail, type EmailMessage, type Env } from "@openact/core/server";

/*
 * eSign emails. Each one is short and has one button.
 * Signing links carry a secret token. Never log an email body when RESEND_API_KEY is set.
 */

function message(env: Env, to: string, subject: string, heading: string, lines: string[], button?: { url: string; label: string }): EmailMessage {
  const text = [...lines, ...(button ? [`${button.label}: ${button.url}`] : [])].join("\n\n");
  const html = emailLayout(
    env,
    heading,
    lines.map((l) => `<p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(l)}</p>`).join("") + (button ? emailButton(button.url, button.label) : "")
  );
  return { to, subject, text, html };
}

/** Sends after the response, so a slow email never blocks the page. */
export function send(env: Env, msg: EmailMessage, defer: (p: Promise<unknown>) => void) {
  defer(sendEmail(env, msg).catch((e) => console.warn("[openact] eSign email failed", e instanceof Error ? e.message : "unknown")));
}

export const inviteEmail = (env: Env, o: { to: string; sender: string; company: string; document: string; note: string; url: string; reminder?: boolean }) =>
  message(
    env,
    o.to,
    o.reminder ? `Reminder: please sign "${o.document}"` : `${o.sender} sent you "${o.document}" to sign`,
    o.reminder ? "A reminder to sign" : "Please sign this document",
    [
      `${o.sender} at ${o.company} asks you to sign "${o.document}".`,
      ...(o.note ? [`Their note: ${o.note}`] : []),
      "You do not need an account. Open the link, check the document, and sign.",
      "Do not share this email. The link lets anyone who has it sign as you."
    ],
    { url: o.url, label: "Review and sign" }
  );

export const signedCopyEmail = (env: Env, o: { to: string; document: string; url: string }) =>
  message(
    env,
    o.to,
    `"${o.document}" is signed by everyone`,
    "The document is complete",
    [`Everyone signed "${o.document}".`, "Open the link to download the signed PDF. It has a signing certificate at the end."],
    { url: o.url, label: "Download the signed PDF" }
  );

export const senderDoneEmail = (env: Env, o: { to: string; document: string; hash: string; url: string }) =>
  message(
    env,
    o.to,
    `"${o.document}" is signed by everyone`,
    "The document is complete",
    [
      `Everyone signed "${o.document}".`,
      `The SHA-256 of the signed PDF is:\n${o.hash}`,
      "Keep this email. You can use the hash to check a copy of the file later."
    ],
    { url: o.url, label: "Open the document" }
  );

export const declinedEmail = (env: Env, o: { to: string; signer: string; document: string; reason: string; url: string }) =>
  message(
    env,
    o.to,
    `${o.signer} declined to sign "${o.document}"`,
    "A signer declined",
    [
      `${o.signer} declined to sign "${o.document}".`,
      ...(o.reason ? [`Their reason: ${o.reason}`] : []),
      "The document is closed. Send a new one if you need to."
    ],
    { url: o.url, label: "Open the document" }
  );

export const voidedEmail = (env: Env, o: { to: string; sender: string; document: string }) =>
  message(env, o.to, `"${o.document}" was canceled`, "The document was canceled", [
    `${o.sender} canceled "${o.document}". You do not need to sign it.`,
    "The signing link no longer works."
  ]);
