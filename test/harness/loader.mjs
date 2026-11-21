// Lets Node load the Worker source in tests: it adds the .ts extension that the
// bundler adds for us, and gives stand-ins for the cloudflare:* built-in modules.
import { register } from "node:module";

register("./resolve.mjs", import.meta.url);
