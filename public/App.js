import React, { useEffect } from "react";
import { init } from "./index.js";
export function App() {
    useEffect(() => {
        init().catch((error) => {
            console.error(error);
            const log = document.querySelector("#message-log");
            if (log)
                log.textContent = "Initialization failed.";
        });
    }, []);
    return (React.createElement(React.Fragment, null,
        React.createElement("div", { id: "container", style: { position: "absolute", margin: "5px" } },
            React.createElement("div", { className: "buttons" },
                React.createElement("label", { htmlFor: "file-input", style: {
                        background: "rgba(0,0,0,0.5)",
                        color: "white",
                        padding: "5px 10px",
                        cursor: "pointer",
                        borderRadius: "5px",
                    } }, "Upload File"),
                React.createElement("input", { type: "file", id: "file-input", style: { display: "none" }, multiple: true, accept: ".usd,.usda,.usdc,.usdz,.png,.jpg,.jpeg,.tga,.exr,.mtl,.obj" }),
                React.createElement("label", { htmlFor: "folder-input", style: {
                        background: "rgba(0,0,0,0.5)",
                        color: "white",
                        padding: "5px 10px",
                        cursor: "pointer",
                        borderRadius: "5px",
                        marginLeft: "6px",
                    } }, "Upload Folder"),
                React.createElement("input", { type: "file", id: "folder-input", style: { display: "none" }, multiple: true, ...{ webkitdirectory: "", directory: "" } }),
                React.createElement("a", { className: "file", href: "?file=/unitree_model/Go2/usd/go2.usd", style: {
                        color: "white",
                        marginLeft: "10px",
                        textDecoration: "none",
                        background: "rgba(0,0,0,0.5)",
                        padding: "5px 10px",
                        borderRadius: "5px",
                    } }, "Load Go2 Model"),
                React.createElement("a", { className: "file", href: "?file=/unitree_model/G1/29dof/usd/g1_29dof_rev_1_0/g1_29dof_rev_1_0.usd", style: {
                        color: "white",
                        marginLeft: "6px",
                        textDecoration: "none",
                        background: "rgba(0,0,0,0.5)",
                        padding: "5px 10px",
                        borderRadius: "5px",
                    } }, "Load G1 29DoF"),
                React.createElement("a", { className: "file", href: "?file=/unitree_model/H1/h1/usd/h1.usd", style: {
                        color: "white",
                        marginLeft: "6px",
                        textDecoration: "none",
                        background: "rgba(0,0,0,0.5)",
                        padding: "5px 10px",
                        borderRadius: "5px",
                    } }, "Load H1"),
                React.createElement("label", { className: "toggle-option", htmlFor: "toggle-visuals" },
                    React.createElement("input", { type: "checkbox", id: "toggle-visuals" }),
                    "Show Visual Meshes"),
                React.createElement("label", { className: "toggle-option", htmlFor: "toggle-collisions" },
                    React.createElement("input", { type: "checkbox", id: "toggle-collisions" }),
                    "Show Collisions"),
                React.createElement("label", { className: "toggle-option", htmlFor: "toggle-link-dynamics" },
                    React.createElement("input", { type: "checkbox", id: "toggle-link-dynamics" }),
                    "Show COM & Inertia"),
                React.createElement("span", { className: "filename", style: { marginLeft: "10px", color: "#ccc" } })),
            React.createElement("p", { id: "message-log" }, "Waiting for initialization to start..."),
            React.createElement("div", { id: "loading-bar-container" },
                React.createElement("div", { id: "loading-bar" }),
                React.createElement("span", { id: "loading-percent" }, "0%"))),
        React.createElement("div", { id: "joint-panel", className: "joint-panel", style: { display: "none" } },
            React.createElement("div", { id: "joint-panel-header", className: "joint-panel-header" }, "Joint Panel"),
            React.createElement("div", { id: "joint-panel-list", className: "joint-panel-list" }))));
}
