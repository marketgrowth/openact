import { createClient, type DirectoryApp } from "@openact/ui";
import { apps, primary } from "../../.openact/client";
import directory from "../../directory/apps.json";
import { site } from "./site";
import "./main.css";

// The installed apps come from openact.apps.json. Run `npm run openact -- add github:owner/repo` to add one.
// The directory lists more apps on the Apps page (/apps).
// "primary" in openact.apps.json puts one app at the top of the app rail, above a divider.
createClient({ apps: [...apps, site], directory: directory.apps as DirectoryApp[], primary });
