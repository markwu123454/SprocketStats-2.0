import {createRoot} from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/agGridTheme";

const REQUIRED_ENV_VARS = ["VITE_BACKEND_URL"] as const;
const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !import.meta.env[key]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
}

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  window.location.reload();
});

const root = createRoot(document.getElementById("root")!);
root.render(<App/>);