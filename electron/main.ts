import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type ProcessKind = "compile" | "simulation";
type Job = { child: ChildProcess; kind: ProcessKind };

let window: BrowserWindow | null = null;
let activeProjectRoot: string | null = null;
const jobs = new Map<string, Job>();
const successfulBuilds = new Set<string>();

function emit(channel: string, payload: unknown) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function projectPath(project: string, relativePath: string) {
  const root = await fs.realpath(project);
  const resolved = path.resolve(root, relativePath);
  if (!isInside(root, resolved)) throw new Error("That file path is outside the active project.");
  let existing = resolved;
  while (true) {
    try {
      const actual = await fs.realpath(existing);
      if (!isInside(root, actual)) throw new Error("That file path resolves outside the active project.");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        if ((await fs.lstat(existing)).isSymbolicLink()) {
          throw new Error("Symbolic links cannot be used as project file paths.");
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  return resolved;
}

async function requireActiveProject(root: string) {
  const resolved = await fs.realpath(root);
  if (!activeProjectRoot || resolved !== activeProjectRoot) {
    throw new Error("The requested path is not the active project.");
  }
  return resolved;
}

function runJob(kind: ProcessKind, executable: string, args: string[], cwd: string) {
  const id = randomUUID();
  let child: ChildProcess;
  try {
    const toolPath = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(path.delimiter);
    child = spawn(executable, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, PATH: toolPath } });
  } catch (error) {
    emit("process:exit", { id, kind, code: -1, error: error instanceof Error ? error.message : String(error) });
    return id;
  }
  jobs.set(id, { child, kind });
  emit("process:start", { id, kind });
  child.stdout?.on("data", (data: Buffer) => emit("process:output", { id, kind, stream: "stdout", text: data.toString() }));
  child.stderr?.on("data", (data: Buffer) => emit("process:output", { id, kind, stream: "stderr", text: data.toString() }));
  let finished = false;
  child.once("error", (error) => {
    finished = true;
    jobs.delete(id);
    const errorCode = (error as NodeJS.ErrnoException).code;
    emit("process:exit", {
      id,
      kind,
      code: -1,
      error: errorCode === "ENOENT"
        ? `${executable} was not found. Install Icarus Verilog and make sure it is available in PATH.`
        : error.message
    });
  });
  child.once("close", (code, signal) => {
    if (finished) return;
    finished = true;
    jobs.delete(id);
    if (kind === "compile") {
      if (code === 0) successfulBuilds.add(path.resolve(cwd));
      else successfulBuilds.delete(path.resolve(cwd));
    }
    emit("process:exit", { id, kind, code, signal });
  });
  return id;
}

function createWindow() {
  window = new BrowserWindow({
    width: 1460,
    height: 960,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#101317",
    title: "Verilog IDE",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(__dirname, "../../renderer-dist/index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("project:new", async () => {
    const choice = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const root = await fs.realpath(choice.filePaths[0]);
    const name = path.basename(root);
    const configPath = await projectPath(root, "verilog-project.json");
    try {
      await fs.access(configPath);
      throw new Error("A Verilog project already exists in this folder.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.writeFile(configPath, JSON.stringify({ name, topModule: "", sources: [], compilerFlags: ["-g2012"] }, null, 2));
    activeProjectRoot = root;
    return { root, name };
  });

  ipcMain.handle("project:open", async () => {
    const choice = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const root = await fs.realpath(choice.filePaths[0]);
    const configPath = await projectPath(root, "verilog-project.json");
    try {
      const config = JSON.parse(await fs.readFile(configPath, "utf8")) as { name?: string };
      activeProjectRoot = root;
      return { root, name: config.name || path.basename(root) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("This folder does not contain verilog-project.json. Create a project first.");
      throw new Error(`Could not read project settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ipcMain.handle("project:sample", async () => {
    const source = app.isPackaged
      ? path.join(process.resourcesPath, "sample-project")
      : path.join(__dirname, "../sample-project");
    const root = path.join(app.getPath("documents"), "Verilog IDE", "and-gate-demo");
    const configPath = path.join(root, "verilog-project.json");
    try {
      await fs.access(configPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(path.dirname(root), { recursive: true });
      await fs.cp(source, root, { recursive: true, errorOnExist: true, force: false });
    }
    const absoluteRoot = await fs.realpath(root);
    const config = JSON.parse(await fs.readFile(path.join(absoluteRoot, "verilog-project.json"), "utf8")) as { name?: string };
    activeProjectRoot = absoluteRoot;
    return { root: absoluteRoot, name: config.name || path.basename(root) };
  });

  ipcMain.handle("project:files", async (_event, root: string) => {
    const absoluteRoot = await requireActiveProject(root);
    const result: Array<{ path: string; kind: "file" | "directory" }> = [];
    async function walk(directory: string) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "build") continue;
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(absoluteRoot, absolute);
        if (entry.isDirectory()) {
          result.push({ path: relative, kind: "directory" });
          await walk(absolute);
        } else if (/\.(?:v|sv|vh|svh|vcd|json)$/i.test(entry.name)) {
          result.push({ path: relative, kind: "file" });
        }
      }
    }
    await walk(absoluteRoot);
    return result.sort((a, b) => a.path.localeCompare(b.path));
  });

  ipcMain.handle("file:read", async (_event, root: string, relative: string) => {
    await requireActiveProject(root);
    return fs.readFile(await projectPath(root, relative), "utf8");
  });
  ipcMain.handle("file:write", async (_event, root: string, relative: string, content: string) => {
    await requireActiveProject(root);
    const target = await projectPath(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await projectPath(root, relative);
    await fs.writeFile(target, content, "utf8");
  });
  ipcMain.handle("file:create", async (_event, root: string, relative: string, content: string) => {
    await requireActiveProject(root);
    if (!/\.(?:v|sv|vh|svh)$/i.test(relative)) throw new Error("Create a Verilog or SystemVerilog source file (.v, .sv, .vh, or .svh).");
    const target = await projectPath(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await projectPath(root, relative);
    await fs.writeFile(target, content, { encoding: "utf8", flag: "wx" });
  });
  ipcMain.handle("file:rename", async (_event, root: string, relative: string, newName: string) => {
    await requireActiveProject(root);
    if (!/\.(v|sv|vh|svh)$/i.test(relative) || !/^[A-Za-z0-9_.-]+$/.test(newName) || newName.startsWith(".")) {
      throw new Error("Rename an HDL file using letters, numbers, underscores, hyphens, and dots.");
    }
    const source = await projectPath(root, relative);
    const destination = await projectPath(root, path.join(path.dirname(relative), newName));
    const sourceStats = await fs.stat(source);
    if (!sourceStats.isFile()) throw new Error("Only HDL files can be renamed.");
    if (!/\.(v|sv|vh|svh)$/i.test(destination)) throw new Error("The new file name must keep a Verilog file extension.");
    await fs.rename(source, destination);
    return path.relative(await fs.realpath(root), destination);
  });
  ipcMain.handle("file:delete", async (_event, root: string, relative: string) => {
    await requireActiveProject(root);
    if (!/\.(v|sv|vh|svh)$/i.test(relative)) throw new Error("Only HDL source files can be deleted here.");
    const target = await projectPath(root, relative);
    const stats = await fs.stat(target);
    if (!stats.isFile()) throw new Error("Only HDL files can be deleted here.");
    await fs.unlink(target);
  });

  ipcMain.handle("tool:check", async () => {
    return Promise.all(["iverilog", "vvp"].map((tool) => new Promise<{ tool: string; available: boolean; path?: string }>((resolve) => {
      const envPath = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(path.delimiter);
      const probe = spawn("which", [tool], { shell: false, env: { ...process.env, PATH: envPath } });
      let output = "";
      probe.stdout?.on("data", (data: Buffer) => output += data.toString());
      probe.once("error", () => resolve({ tool, available: false }));
      probe.once("close", (code) => resolve(code === 0
        ? { tool, available: true, path: output.trim() }
        : { tool, available: false }));
    })));
  });

  ipcMain.handle("compile:start", async (_event, root: string, files: string[], topModule: string) => {
    if (!files.length) throw new Error("Add at least one Verilog source or testbench before compiling.");
    if (topModule && !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(topModule)) throw new Error("The top-level module name is not valid.");
    const absoluteRoot = await requireActiveProject(root);
    const inputs = await Promise.all(files.map((file) => projectPath(absoluteRoot, file)));
    for (const input of inputs) {
      if (!/\.(v|sv|vh|svh)$/i.test(input)) throw new Error(`Unsupported HDL source file: ${path.basename(input)}`);
      await fs.access(input);
    }
    const build = await projectPath(absoluteRoot, "build");
    await fs.mkdir(build, { recursive: true });
    await projectPath(absoluteRoot, "build");
    const args = ["-g2012", "-Wall", "-o", path.join(build, "simulation.vvp")];
    if (topModule) args.push("-s", topModule);
    args.push(...inputs);
    successfulBuilds.delete(absoluteRoot);
    return runJob("compile", "iverilog", args, absoluteRoot);
  });

  ipcMain.handle("simulation:start", async (_event, root: string) => {
    const absoluteRoot = await requireActiveProject(root);
    if (!successfulBuilds.has(absoluteRoot)) throw new Error("Compile the project successfully before running a simulation.");
    const executable = await projectPath(absoluteRoot, path.join("build", "simulation.vvp"));
    await fs.access(executable);
    return runJob("simulation", "vvp", [executable], path.join(absoluteRoot, "build"));
  });

  ipcMain.handle("simulation:stop", (_event, id: string) => {
    const job = jobs.get(id);
    if (job?.kind === "simulation") job.child.kill("SIGTERM");
  });
  ipcMain.handle("waveform:read", async (_event, root: string) => {
    await requireActiveProject(root);
    const file = await projectPath(root, path.join("build", "wave.vcd"));
    try {
      return { path: "build/wave.vcd", content: await fs.readFile(file, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
