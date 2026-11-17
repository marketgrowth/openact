import { handleContribute, isContributeRoute, type ContributeEnv } from "./contribute.ts";

/*
 * The openact-site Worker at https://openact.ing.
 * It sends www.openact.ing to openact.ing, answers the contribution routes (/api/contribute) and serves the files that Astro builds into dist/.
 */

interface Env extends ContributeEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === "www.openact.ing") {
      url.hostname = "openact.ing";
      return Response.redirect(url.toString(), 301);
    }
    if (isContributeRoute(url.pathname)) return handleContribute(request, env);
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
