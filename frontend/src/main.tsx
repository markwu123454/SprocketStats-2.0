import {createRoot} from "react-dom/client";
import App from "./App";
import "./index.css";

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  window.location.reload();
});

const root = createRoot(document.getElementById("root")!);
root.render(<App/>);