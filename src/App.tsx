import React, { useEffect } from "react";
import { init } from "./index.js";

export function App(): JSX.Element {
  useEffect(() => {
    init().catch((error) => {
      console.error(error);
      const log = document.querySelector("#message-log");
      if (log) log.textContent = "Initialization failed.";
    });
  }, []);

  return (
    <>
      <div id="container" style={{ position: "absolute", margin: "5px" }}>
        <div className="buttons">
          <label
            htmlFor="file-input"
            style={{
              background: "rgba(0,0,0,0.5)",
              color: "white",
              padding: "5px 10px",
              cursor: "pointer",
              borderRadius: "5px",
            }}
          >
            Upload File
          </label>
          <input
            type="file"
            id="file-input"
            style={{ display: "none" }}
            multiple
            accept=".usd,.usda,.usdc,.usdz,.png,.jpg,.jpeg,.tga,.exr,.mtl,.obj"
          />

          <label
            htmlFor="folder-input"
            style={{
              background: "rgba(0,0,0,0.5)",
              color: "white",
              padding: "5px 10px",
              cursor: "pointer",
              borderRadius: "5px",
              marginLeft: "6px",
            }}
          >
            Upload Folder
          </label>
          <input
            type="file"
            id="folder-input"
            style={{ display: "none" }}
            multiple
            {...({ webkitdirectory: "", directory: "" } as any)}
          />

          <a
            className="file"
            href="?file=/unitree_model/Go2/usd/go2.usd"
            style={{
              color: "white",
              marginLeft: "10px",
              textDecoration: "none",
              background: "rgba(0,0,0,0.5)",
              padding: "5px 10px",
              borderRadius: "5px",
            }}
          >
            Load Go2 Model
          </a>
          <a
            className="file"
            href="?file=/unitree_model/G1/29dof/usd/g1_29dof_rev_1_0/g1_29dof_rev_1_0.usd"
            style={{
              color: "white",
              marginLeft: "6px",
              textDecoration: "none",
              background: "rgba(0,0,0,0.5)",
              padding: "5px 10px",
              borderRadius: "5px",
            }}
          >
            Load G1 29DoF
          </a>
          <a
            className="file"
            href="?file=/unitree_model/H1/h1/usd/h1.usd"
            style={{
              color: "white",
              marginLeft: "6px",
              textDecoration: "none",
              background: "rgba(0,0,0,0.5)",
              padding: "5px 10px",
              borderRadius: "5px",
            }}
          >
            Load H1
          </a>

          <label className="toggle-option" htmlFor="toggle-visuals">
            <input type="checkbox" id="toggle-visuals" />
            Show Visual Meshes
          </label>

          <label className="toggle-option" htmlFor="toggle-collisions">
            <input type="checkbox" id="toggle-collisions" />
            Show Collisions
          </label>

          <label className="toggle-option" htmlFor="toggle-link-dynamics">
            <input type="checkbox" id="toggle-link-dynamics" />
            Show COM &amp; Inertia
          </label>

          <span className="filename" style={{ marginLeft: "10px", color: "#ccc" }} />
        </div>

        <p id="message-log">Waiting for initialization to start...</p>
        <div id="loading-bar-container">
          <div id="loading-bar" />
          <span id="loading-percent">0%</span>
        </div>
      </div>
      <div id="joint-panel" className="joint-panel" style={{ display: "none" }}>
        <div id="joint-panel-header" className="joint-panel-header">
          Joint Panel
        </div>
        <div id="joint-panel-list" className="joint-panel-list" />
      </div>
    </>
  );
}
