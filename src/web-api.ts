import type { ProcessEvent, VerilogIDEApi } from "./types";

async function request<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/${encodeURIComponent(action)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as { result?: T; error?: string };
  if (!response.ok) throw new Error(payload.error || `Local backend request failed (${response.status}).`);
  return payload.result as T;
}

export function createWebApi(): VerilogIDEApi {
  const jobProjects = new Map<string, string>();
  const rememberJob = async (root: string, action: string, body: Record<string, unknown>) => {
    const id = await request<string>(action, body);
    jobProjects.set(id, root);
    return id;
  };
  return {
    isWeb: true,
    createProject: (root) => request("project:create", { root }),
    openProject: (root) => request("project:open", { root }),
    openSampleProject: () => request("project:sample"),
    listFiles: (root) => request("project:files", { root }),
    readFile: (root, relative) => request("file:read", { root, relative }),
    writeFile: (root, relative, content) => request("file:write", { root, relative, content }),
    createFile: (root, relative, content) => request("file:create", { root, relative, content }),
    renameFile: (root, relative, newName) => request("file:rename", { root, relative, newName }),
    deleteFile: (root, relative) => request("file:delete", { root, relative }),
    checkTools: () => request("tool:check"),
    compile: (root, files, top) => rememberJob(root, "compile:start", { root, files, top }),
    runSimulation: (root) => rememberJob(root, "simulation:start", { root }),
    stopSimulation: (id) => request("simulation:stop", { root: jobProjects.get(id) ?? "", id }),
    readWaveform: (root) => request("waveform:read", { root }),
    onProcessEvent: (callback) => {
      const events = new EventSource("/api/events");
      events.onmessage = (event) => {
        try {
          const processEvent = JSON.parse(event.data) as ProcessEvent;
          if (processEvent.type === "exit") jobProjects.delete(processEvent.id);
          callback(processEvent);
        } catch (error) {
          console.error("Could not read a local simulation event:", error);
        }
      };
      return () => events.close();
    }
  };
}
