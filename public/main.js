import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
const rootElement = document.getElementById("app-root");
if (!rootElement) {
    throw new Error("Missing #app-root container");
}
createRoot(rootElement).render(React.createElement(App, null));
