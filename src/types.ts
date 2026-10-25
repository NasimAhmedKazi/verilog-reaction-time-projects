export type Project = { root: string; name: string };
export type ProjectFile = { path: string; kind: "file" | "directory" };
export type ToolStatus = { tool: string; available: boolean; path?: string };

export type ProcessEvent = {
  type: "start" | "output" | "exit";
  id: string;
  kind: "compile" | "simulation";
  stream?: string;
  text?: string;
  code?: number | null;
  signal?: string | null;
  error?: string;
};

export type SignalChange = { time: number; value: string };
export type WaveSignal = { id: string; name: string; width: number; changes: SignalChange[] };
export type Waveform = { timescale: string; endTime: number; signals: WaveSignal[] };

export type VerilogIDEApi = {
  readonly isWeb: boolean;
  createProject(root?: string): Promise<Project | null>;
  openProject(root?: string): Promise<Project | null>;
  openSampleProject(): Promise<Project>;
  listFiles(root: string): Promise<ProjectFile[]>;
  readFile(root: string, relative: string): Promise<string>;
  writeFile(root: string, relative: string, content: string): Promise<void>;
  createFile(root: string, relative: string, content: string): Promise<void>;
  renameFile(root: string, relative: string, newName: string): Promise<string>;
  deleteFile(root: string, relative: string): Promise<void>;
  checkTools(): Promise<ToolStatus[]>;
  compile(root: string, files: string[], top: string): Promise<string>;
  runSimulation(root: string): Promise<string>;
  stopSimulation(id: string): Promise<void>;
  readWaveform(root: string): Promise<{ path: string; content: string } | null>;
  onProcessEvent(callback: (event: ProcessEvent) => void): () => void;
};

declare global {
  interface Window {
    verilogIDE: VerilogIDEApi;
  }
}
