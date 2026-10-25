import React from "react";
import ReactDOM from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import App from "./App";
import "./styles.css";
import { createWebApi } from "./web-api";

loader.config({ monaco });

window.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
};

if (!window.verilogIDE) {
  window.verilogIDE = createWebApi();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
