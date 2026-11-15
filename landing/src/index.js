// Sends www.openact.ing to openact.ing. Serves the static files for every other request.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.openact.ing") {
      url.hostname = "openact.ing";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  }
};
