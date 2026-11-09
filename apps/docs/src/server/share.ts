import type { Context } from "hono";
import { HttpError, appName, companyAppState, loadSite, randomToken, sha256Hex, type AppEnv } from "@openact/core/server";
import { FILE_SRC, SHARE_PREFIX, isShareToken } from "../shared/types";
import { linkProblemHtml, paperHeaders, paperPageHtml } from "./page-html";
import { parseContent, sendImage, type DocRow, type FileRow } from "./routes";

/*
 * Public share links: /docs/s/<token> and the images in that doc.
 * Anyone with the link can read the doc without signing in. Nobody can change it.
 * The link stops working when an editor turns it off, makes a new link, or deletes the doc,
 * and while Docs is off for the company or the site.
 */

const NOT_FOUND = () =>
  new Response(
    linkProblemHtml("This link does not work", "The link was turned off or replaced, or the doc was deleted. Ask the person who sent it for a new link."),
    { status: 404, headers: paperHeaders() }
  );

/** The shared doc for a token, or null. Checks that the apps are on. */
async function sharedDoc(c: Context<AppEnv>, token: string): Promise<DocRow | null> {
  if (!isShareToken(token)) return null;
  // Routes outside /api/ do not run the site middleware, so load the site switches here.
  await loadSite(c.env);
  const doc = await c.env.DB.prepare(
    `SELECT d.id, d.company_id, d.folder_id, d.category_id, d.title, d.content, d.page_size, d.orientation, d.margin, d.rev, d.updated_by, d.updated_at
     FROM docs_shares s JOIN docs_docs d ON d.id = s.doc_id
     WHERE s.token_hash = ?`
  )
    .bind(await sha256Hex(token))
    .first<DocRow>();
  if (!doc) return null;
  const state = await companyAppState(c.env, doc.company_id);
  if (!state.enabled("docs")) return null;
  return doc;
}

export async function sharePage(c: Context<AppEnv>): Promise<Response> {
  const token = c.req.param("token") ?? "";
  const doc = await sharedDoc(c, token);
  if (!doc) return NOT_FOUND();
  const nonce = randomToken(16);
  const html = paperPageHtml({
    title: doc.title,
    siteName: appName(c.env),
    doc: parseContent(doc.content),
    settings: { pageSize: doc.page_size, orientation: doc.orientation, margin: doc.margin },
    updatedAt: doc.updated_at,
    // In-app image paths become paths under this link, so a reader needs no account.
    imageUrl: (src) => {
      const m = FILE_SRC.exec(src);
      return m ? `${SHARE_PREFIX}${token}/files/${m[1]}` : null;
    },
    nonce,
    mode: "share"
  });
  return new Response(html, { headers: paperHeaders(nonce) });
}

export async function shareImage(c: Context<AppEnv>): Promise<Response> {
  const doc = await sharedDoc(c, c.req.param("token") ?? "");
  if (!doc) throw new HttpError(404, "This image is not available.");
  const file = await c.env.DB.prepare("SELECT id, doc_id, r2_key, content_type, size FROM docs_files WHERE id = ? AND doc_id = ?")
    .bind(c.req.param("fileId") ?? "", doc.id)
    .first<FileRow>();
  if (!file) throw new HttpError(404, "This image is not available.");
  return sendImage(c.env, file);
}
