import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const STUBS = new URL("./cloudflare-stubs.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("cloudflare:")) return { url: STUBS, shortCircuit: true };
  if ((specifier.startsWith(".") || specifier.startsWith("/")) && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL);
    const path = fileURLToPath(base);
    for (const cand of [path + ".ts", path + ".tsx", path + "/index.ts"]) {
      if (existsSync(cand) && statSync(cand).isFile()) return { url: pathToFileURL(cand).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
