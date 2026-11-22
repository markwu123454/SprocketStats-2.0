// AG Grid setup: the community modules and the seasonal theme (agGridTheme.ts).
// A page that renders a grid imports this, so the grid's code loads with that
// page rather than with every page.

import { AllCommunityModule, ModuleRegistry } from "ag-grid-community"
import "./agGridTheme"

ModuleRegistry.registerModules([AllCommunityModule])
