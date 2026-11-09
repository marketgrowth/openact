import { createWorker } from "@openact/core/server";
import { apps, catalog } from "../.openact/server";
import { siteServer } from "./server/site";

// Durable Object classes must be exported from the main module.
export { ProjectRoom } from "@openact/core/server";
export * from "../.openact/durable-objects";

// The installed apps come from openact.apps.json. Run `npm run openact -- add github:owner/repo` to add one.
// siteServer adds this deploy's own routes, such as contributions. It is not in the catalog, so companies cannot turn it off.
export default createWorker({ apps: [...apps, siteServer], catalog });
