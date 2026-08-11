import {createRoot} from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/agGridTheme";

const REQUIRED_ENV_VARS = ["VITE_BACKEND_URL"] as const;
const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !import.meta.env[key]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
}

// No forced reload here: sw.js doesn't call self.skipWaiting(), so a new
// service worker stays in "waiting" and never takes control of a tab that's
// already open. It only takes over on the user's next natural navigation or
// tab reopen -- updates apply seamlessly, never mid-session.

const root = createRoot(document.getElementById("root")!);
root.render(<App/>);