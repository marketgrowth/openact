import { emailButton, emailLayout, escapeHtml, sendEmail, type EmailMessage, type Env } from "@openact/core/server";

/*
 * Advisory emails. Each one is short and has one button.
 * Emails go out after the response, through `defer`, so a slow email never blocks the page.
 */

function message(env: Env, to: string, subject: string, heading: string, lines: string[], button?: { url: string; label: string }): EmailMessage {
  const text = [...lines, ...(button ? [`${button.label}: ${button.url}`] : [])].join("\n\n");
  const html = emailLayout(
    env,
    heading,
    lines.map((l) => `<p style="margin:0 0 16px">${escapeHtml(l)}</p>`).join("") + (button ? emailButton(button.url, button.label) : "")
  );
  return { to, subject, text, html };
}

export function send(env: Env, msg: EmailMessage, defer: (p: Promise<unknown>) => void) {
  defer(sendEmail(env, msg).catch((e) => console.warn("[openact] Advisory email failed", e instanceof Error ? e.message : "unknown")));
}

export const newRequestEmail = (env: Env, o: { to: string; clientName: string; url: string }) =>
  message(env, o.to, `${o.clientName} asked for a consult`, "New consult request", [`${o.clientName} sent you a consult request.`, "Open it to accept or decline."], {
    url: o.url,
    label: "Open the request"
  });

export const paymentLinkEmail = (env: Env, o: { to: string; advisorName: string; offer: string; price: string; url: string }) =>
  message(
    env,
    o.to,
    `${o.advisorName} accepted your request`,
    "Your request is accepted",
    [`${o.advisorName} accepted your request for "${o.offer}".`, `The price is ${o.price}. Pay on the payment page to start.`],
    { url: o.url, label: "Go to the payment page" }
  );

export const declinedEmail = (env: Env, o: { to: string; advisorName: string; note: string; url: string }) =>
  message(
    env,
    o.to,
    `${o.advisorName} declined your request`,
    "Your request was declined",
    [`${o.advisorName} cannot take your request now.`, ...(o.note ? [`Their note: ${o.note}`] : []), "You can ask another advisor."],
    { url: o.url, label: "See the advisors" }
  );

export const applicationEmail = (env: Env, o: { to: string; name: string; label: string; url: string }) =>
  message(env, o.to, `${o.name} applied to be a ${o.label.toLowerCase()}`, "New application", [`${o.name} applied to be a ${o.label.toLowerCase()}.`, "Review the profile and the offers, then approve or decline."], {
    url: o.url,
    label: "Review the application"
  });

export const decisionEmail = (env: Env, o: { to: string; approved: boolean; label: string; note: string; url: string }) =>
  o.approved
    ? message(env, o.to, `You are now a listed ${o.label.toLowerCase()}`, "Your profile is live", ["Your application is approved. Members can now see your profile and your offers."], {
        url: o.url,
        label: "Open your dashboard"
      })
    : message(env, o.to, "Your application was not approved", "Application not approved", ["Your application was not approved.", ...(o.note ? [`The note: ${o.note}`] : [])], {
        url: o.url,
        label: "Open your profile"
      });

export const engagementEmail = (env: Env, o: { to: string; other: string; offer: string; url: string }) =>
  message(env, o.to, `Your engagement "${o.offer}" has started`, "The engagement has started", [`The payment for "${o.offer}" is confirmed.`, `Your project with ${o.other} is ready.`], {
    url: o.url,
    label: "Open the project"
  });
