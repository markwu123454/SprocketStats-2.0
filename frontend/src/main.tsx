import {createRoot} from "react-dom/client";
import App from "./App";
import "./index.css";
import {AllCommunityModule, ModuleRegistry} from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  window.location.reload();
});

const root = createRoot(document.getElementById("root")!);
root.render(<App/>);