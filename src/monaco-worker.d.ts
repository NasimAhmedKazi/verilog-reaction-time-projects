import type EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment: {
      getWorker: () => InstanceType<typeof EditorWorker>;
    };
  }
  var MonacoEnvironment: {
    getWorker: () => InstanceType<typeof EditorWorker>;
  };
}

export {};
