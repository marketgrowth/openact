import { createWorker } from "@openact/core/server";
import { apps, catalog } from "../.openact/server";
import { demoServer } from "./server/demo";

// Durable Object classes must be exported from the main module.
export { ProjectRoom } from "@openact/core/server";
export * from "../.openact/durable-objects";

// The installed apps come from openact.apps.json. Run `npm run openact -- add github:owner/repo` to add one.
// Contributions run on the landing page Worker at https://openact.ing/contribute (www/), not here.
// demoServer runs the nightly reset of the public demo at a.openact.ing (demo branch only).
export default createWorker({ apps: [...apps, demoServer], catalog });
