import { createWorker } from "@openact/core/server";
import { apps } from "../.openact/server";

// Durable Object classes must be exported from the main module.
export { ProjectRoom } from "@openact/core/server";
export * from "../.openact/durable-objects";

// The installed apps come from openact.apps.json. Run `npm run openact -- add github:owner/repo` to add one.
export default createWorker({ apps });
