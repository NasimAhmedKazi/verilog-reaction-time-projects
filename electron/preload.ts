import { contextBridge, ipcRenderer } from "electron";

type ProcessPayload = {
  id: string;
  kind: "compile" | "simulation";
  stream?: string;
  text?: string;
  code?: number | null;
  signal?: string | null;
  error?: string;
};

const api = {
  isWeb: false as const,
  createProject: () => ipcRenderer.invoke("project:new"),
  openProject: () => ipcRenderer.invoke("project:open"),
  openSampleProject: () => ipcRenderer.invoke("project:sample"),
  listFiles: (root: string) => ipcRenderer.invoke("project:files", root),
  readFile: (root: string, relative: string) => ipcRenderer.invoke("file:read", root, relative),
  writeFile: (root: string, relative: string, content: string) => ipcRenderer.invoke("file:write", root, relative, content),
  createFile: (root: string, relative: string, content: string) => ipcRenderer.invoke("file:create", root, relative, content),
  renameFile: (root: string, relative: string, newName: string) => ipcRenderer.invoke("file:rename", root, relative, newName) as Promise<string>,
  deleteFile: (root: string, relative: string) => ipcRenderer.invoke("file:delete", root, relative) as Promise<void>,
  checkTools: () => ipcRenderer.invoke("tool:check"),
  compile: (root: string, files: string[], top: string) => ipcRenderer.invoke("compile:start", root, files, top),
  runSimulation: (root: string) => ipcRenderer.invoke("simulation:start", root),
  stopSimulation: (id: string) => ipcRenderer.invoke("simulation:stop", id),
  readWaveform: (root: string) => ipcRenderer.invoke("waveform:read", root),
  onProcessEvent: (callback: (event: { type: "start" | "output" | "exit"; id: string; kind: "compile" | "simulation"; stream?: string; text?: string; code?: number | null; signal?: string | null; error?: string }) => void) => {
    const onStart = (_event: Electron.IpcRendererEvent, data: ProcessPayload) => callback({ ...data, type: "start" });
    const onOutput = (_event: Electron.IpcRendererEvent, data: ProcessPayload) => callback({ ...data, type: "output" });
    const onExit = (_event: Electron.IpcRendererEvent, data: ProcessPayload) => callback({ ...data, type: "exit" });
    ipcRenderer.on("process:start", onStart);
    ipcRenderer.on("process:output", onOutput);
    ipcRenderer.on("process:exit", onExit);
    return () => {
      ipcRenderer.removeListener("process:start", onStart);
      ipcRenderer.removeListener("process:output", onOutput);
      ipcRenderer.removeListener("process:exit", onExit);
    };
  }
};

contextBridge.exposeInMainWorld("verilogIDE", api);
