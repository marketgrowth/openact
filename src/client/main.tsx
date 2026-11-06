import { createClient, type DirectoryApp } from "@openact/ui";
import { apps } from "../../.openact/client";
import directory from "../../directory/apps.json";
import { site } from "./site";
import "./main.css";

// The installed apps come from openact.apps.json. Run `npm run openact -- add github:owner/repo` to add one.
// The directory lists more apps on the Apps page (/apps).
createClient({ apps: [...apps, site], directory: directory.apps as DirectoryApp[] });
