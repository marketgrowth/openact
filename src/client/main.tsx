import { createClient } from "@openact/ui";
import { apps } from "../../.openact/client";
import { site } from "./site";
import "./main.css";

// The installed apps come from openact.apps.json. Run `npm run openact -- add github:owner/repo` to add one.
createClient({ apps: [...apps, site] });
