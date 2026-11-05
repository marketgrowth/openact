# Security

## Report a problem

Do not open a public issue for a security problem. Use GitHub private vulnerability reporting: open the **Security** tab of this repository, then click **Report a vulnerability**. Include:

- What the problem is
- The steps to make it happen
- The version or commit you tested

## What OpenAct does

- Sign-in uses one-time email codes. There are no passwords to leak.
- Codes and session tokens are stored only as SHA-256 hashes. Codes also use `AUTH_SECRET`.
- Codes expire after 10 minutes and 5 wrong tries. Code requests have limits per email and per IP address.
- Session cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` on HTTPS.
- The API rejects writes from other origins.
- Every project route checks the person's role in that project. People who are not members get a "not found" reply.
- Files always download. They never open inside the app, so an uploaded HTML file cannot run as OpenAct.
- AI requests do not include task notes, files or email addresses.

## Your part

- Set a long random `AUTH_SECRET`.
- Keep `RESEND_API_KEY` and AI keys in Worker secrets, not in `wrangler.jsonc`.
- Turn on D1 Time Travel backups in the Cloudflare dashboard.
- Use `SIGNUP_MODE=invite` or `ALLOWED_EMAIL_DOMAINS` if your deployment is for one team.
