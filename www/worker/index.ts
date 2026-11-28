import { handleContribute, isContributeRoute, type ContributeEnv } from "./contribute.ts";
import { handleProducer, PRODUCER_API, type ProducerEnv } from "./producer.ts";

/*
 * The openact-site Worker at https://openact.ing.
 * It sends www.openact.ing to openact.ing, answers the contribution routes (/api/contribute), sends the Producer form (/api/producer) and serves the files that Astro builds into dist/.
 * The Promptbook (design.html) lives at https://design.openact.ing. That host shows it at "/", and openact.ing/design sends people there.
 * The files under /design/ (promptbook.md and promptbook.json) stay on both hosts, because the docs and agents link to them.
 */

const DESIGN_HOST = "design.openact.ing";
const isDesignPage = (pathname: string) => pathname === "/design" || pathname === "/design/" || pathname === "/design.html";

interface Env extends ContributeEnv, ProducerEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === "www.openact.ing") {
      url.hostname = "openact.ing";
      return Response.redirect(url.toString(), 301);
    }
    if (url.hostname === DESIGN_HOST) {
      if (isDesignPage(url.pathname)) return Response.redirect(`https://${DESIGN_HOST}/`, 301);
      if (url.pathname === "/") return env.ASSETS.fetch(new Request(new URL("/design", url), request));
      return env.ASSETS.fetch(request);
    }
    if (isDesignPage(url.pathname)) return Response.redirect(`https://${DESIGN_HOST}/`, 301);
    if (isContributeRoute(url.pathname)) return handleContribute(request, env);
    if (url.pathname === PRODUCER_API) return handleProducer(request, env);
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
