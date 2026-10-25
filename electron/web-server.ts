import { createReadStream, promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

type Project = { root: string; name: string };
type JobKind = "compile" | "simulation";
type Job = { child: ChildProcess; kind: JobKind };

const PORT = Number(process.env.VERILOG_IDE_PORT ?? 4174);
const HOST = "127.0.0.1";
const activeProjects = new Set<string>();
const successfulBuilds = new Set<string>();
const jobs = new Map<string, Job>();
const eventClients = new Set<ServerResponse>();
const appRoot = path.resolve(__dirname, "../..");
const isDev = process.argv.includes("--dev");

function sendEvent(event: Record<string, unknown>) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) client.write(payload);
}

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function requireActiveProject(root: string) {
  const resolved = await fs.realpath(root);
  if (!activeProjects.has(resolved)) throw new Error("Open this project in the current browser session first.");
  return resolved;
}

async function projectPath(root: string, relative: string) {
  const resolvedRoot = await fs.realpath(root);
  const target = path.resolve(resolvedRoot, relative);
  if (!isInside(resolvedRoot, target)) throw new Error("That file path is outside the active project.");
  let current = target;
  while (true) {
    try {
      const actual = await fs.realpath(current);
      if (!isInside(resolvedRoot, actual)) throw new Error("Symbolic links outside the active project are not allowed.");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Symbolic links are not allowed for project files.");
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  return target;
}

function assertAllowedBrowserRequest(request: IncomingMessage) {
  const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
  const host = request.headers.host;
  if (!host || !allowedHosts.has(host)) throw new Error("Requests must use the local Verilog IDE address.");
  const origin = request.headers.origin;
  if (!origin) return;
  const allowedOrigins = new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    ...(isDev ? ["http://localhost:5173", "http://127.0.0.1:5173"] : [])
  ]);
  if (!allowedOrigins.has(origin)) throw new Error("Requests from other websites are not allowed.");
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 8 * 1024 * 1024) throw new Error("Request body is too large.");
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
  return parsed as Record<string, unknown>;
}

function textField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "string") throw new Error(`Missing or invalid ${key}.`);
  return value;
}

async function listFiles(root: string) {
  const result: Array<{ path: string; kind: "file" | "directory" }> = [];
  async function walk(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "build") continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        result.push({ path: relative, kind: "directory" });
        await walk(absolute);
      } else if (/\.(?:v|sv|vh|svh|vcd|json)$/i.test(entry.name)) {
        result.push({ path: relative, kind: "file" });
      }
    }
  }
  await walk(root);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function runJob(kind: JobKind, executable: string, args: string[], cwd: string) {
  const id = randomUUID();
  const envPath = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(path.delimiter);
  const child = spawn(executable, args, {
    cwd,
    shell: false,
    windowsHide: true,
    env: { ...process.env, PATH: envPath }
  });
  jobs.set(id, { child, kind });
  sendEvent({ type: "start", id, kind });
  child.stdout?.on("data", (data: Buffer) => sendEvent({ type: "output", id, kind, stream: "stdout", text: data.toString() }));
  child.stderr?.on("data", (data: Buffer) => sendEvent({ type: "output", id, kind, stream: "stderr", text: data.toString() }));
  let finished = false;
  child.once("error", (error) => {
    finished = true;
    jobs.delete(id);
    const code = (error as NodeJS.ErrnoException).code;
    sendEvent({
      type: "exit",
      id,
      kind,
      code: -1,
      error: code === "ENOENT" ? `${executable} was not found. Install Icarus Verilog and make sure it is available in PATH.` : error.message
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
    sendEvent({ type: "exit", id, kind, code, signal });
  });
  return id;
}

async function handleApi(action: string, body: Record<string, unknown>) {
  if (action === "tool:check") {
    return Promise.all(["iverilog", "vvp"].map((tool) => new Promise<{ tool: string; available: boolean; path?: string }>((resolve) => {
      const envPath = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(path.delimiter);
      const probe = spawn("which", [tool], { shell: false, env: { ...process.env, PATH: envPath } });
      let output = "";
      probe.stdout?.on("data", (data: Buffer) => output += data.toString());
      probe.once("error", () => resolve({ tool, available: false }));
      probe.once("close", (code) => resolve(code === 0 ? { tool, available: true, path: output.trim() } : { tool, available: false }));
    })));
  }
  if (action === "project:create") {
    const root = path.resolve(textField(body, "root"));
    await fs.mkdir(root, { recursive: true });
    const actualRoot = await fs.realpath(root);
    const configPath = path.join(actualRoot, "verilog-project.json");
    try {
      await fs.access(configPath);
      throw new Error("A Verilog project already exists in this folder. Open the existing project instead.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const name = path.basename(actualRoot);
    await fs.writeFile(configPath, JSON.stringify({ name, topModule: "", sources: [], compilerFlags: ["-g2012"] }, null, 2));
    activeProjects.add(actualRoot);
    return { root: actualRoot, name } satisfies Project;
  }
  if (action === "project:open") {
    const root = await fs.realpath(textField(body, "root"));
    const configPath = await projectPath(root, "verilog-project.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8")) as { name?: string };
    activeProjects.add(root);
    return { root, name: config.name || path.basename(root) } satisfies Project;
  }
  if (action === "project:sample") {
    const source = path.join(appRoot, "sample-project");
    const root = path.join(homedir(), "Documents", "Verilog IDE", "and-gate-demo");
    const configPath = path.join(root, "verilog-project.json");
    try {
      await fs.access(configPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(path.dirname(root), { recursive: true });
      await fs.cp(source, root, { recursive: true, errorOnExist: true, force: false });
    }
    const actualRoot = await fs.realpath(root);
    const config = JSON.parse(await fs.readFile(path.join(actualRoot, "verilog-project.json"), "utf8")) as { name?: string };
    activeProjects.add(actualRoot);
    return { root: actualRoot, name: config.name || path.basename(root) } satisfies Project;
  }

  const root = await requireActiveProject(textField(body, "root"));
  if (action === "project:files") return listFiles(root);
  if (action === "file:read") return fs.readFile(await projectPath(root, textField(body, "relative")), "utf8");
  if (action === "file:write") {
    const target = await projectPath(root, textField(body, "relative"));
    await fs.writeFile(target, textField(body, "content"), "utf8");
    return null;
  }
  if (action === "file:create") {
    const relative = textField(body, "relative");
    if (!/\.(?:v|sv|vh|svh)$/i.test(relative)) throw new Error("Create a Verilog or SystemVerilog source file.");
    const target = await projectPath(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, textField(body, "content"), { encoding: "utf8", flag: "wx" });
    return null;
  }
  if (action === "file:rename") {
    const relative = textField(body, "relative");
    const newName = textField(body, "newName");
    if (!/\.(?:v|sv|vh|svh)$/i.test(relative) || !/^[A-Za-z0-9_.-]+$/.test(newName) || newName.startsWith(".")) {
      throw new Error("Rename an HDL file using letters, numbers, underscores, hyphens, and dots.");
    }
    const source = await projectPath(root, relative);
    const destination = await projectPath(root, path.join(path.dirname(relative), newName));
    if (!/\.(?:v|sv|vh|svh)$/i.test(destination)) throw new Error("The new file name must keep a Verilog file extension.");
    await fs.rename(source, destination);
    return path.relative(root, destination);
  }
  if (action === "file:delete") {
    const relative = textField(body, "relative");
    if (!/\.(?:v|sv|vh|svh)$/i.test(relative)) throw new Error("Only HDL source files can be deleted.");
    await fs.unlink(await projectPath(root, relative));
    return null;
  }
  if (action === "compile:start") {
    const files = body.files;
    if (!Array.isArray(files) || !files.length || files.some((file) => typeof file !== "string")) {
      throw new Error("Add at least one Verilog source or testbench before compiling.");
    }
    const top = typeof body.top === "string" ? body.top : "";
    if (top && !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(top)) throw new Error("The top-level module name is not valid.");
    const inputs = await Promise.all(files.map((file) => projectPath(root, file)));
    for (const input of inputs) {
      if (!/\.(?:v|sv|vh|svh)$/i.test(input)) throw new Error(`Unsupported HDL source file: ${path.basename(input)}`);
      await fs.access(input);
    }
    const build = await projectPath(root, "build");
    await fs.mkdir(build, { recursive: true });
    const args = ["-g2012", "-Wall", "-o", path.join(build, "simulation.vvp")];
    if (top) args.push("-s", top);
    args.push(...inputs);
    successfulBuilds.delete(root);
    return runJob("compile", "iverilog", args, root);
  }
  if (action === "simulation:start") {
    if (!successfulBuilds.has(root)) throw new Error("Compile the project successfully before running a simulation.");
    const executable = await projectPath(root, path.join("build", "simulation.vvp"));
    return runJob("simulation", "vvp", [executable], path.join(root, "build"));
  }
  if (action === "simulation:stop") {
    const requestedRoot = textField(body, "root");
    if (!activeProjects.has(await fs.realpath(requestedRoot))) throw new Error("Open this project in the current browser session first.");
    const job = jobs.get(textField(body, "id"));
    if (job?.kind === "simulation") job.child.kill("SIGTERM");
    return null;
  }
  if (action === "waveform:read") {
    const file = await projectPath(root, path.join("build", "wave.vcd"));
    try {
      return { path: "build/wave.vcd", content: await fs.readFile(file, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  throw new Error(`Unknown API action: ${action}`);
}

async function serveStatic(request: IncomingMessage, response: ServerResponse) {
  const renderer = path.join(appRoot, "renderer-dist");
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${HOST}:${PORT}`).pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  const candidate = path.resolve(renderer, `.${pathname}`);
  const target = isInside(renderer, candidate) ? candidate : path.join(renderer, "index.html");
  let file = target;
  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) file = path.join(file, "index.html");
    await fs.access(file);
  } catch {
    file = path.join(renderer, "index.html");
  }
  const extensions: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf"
  };
  response.writeHead(200, {
    "content-type": extensions[path.extname(file)] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable"
  });
  createReadStream(file).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    assertAllowedBrowserRequest(request);
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    if (request.method === "OPTIONS" || request.method === "POST" && url.pathname.startsWith("/api/")) {
      response.setHeader("access-control-allow-origin", request.headers.origin ?? `http://${HOST}:${PORT}`);
      response.setHeader("vary", "Origin");
      response.setHeader("access-control-allow-headers", "content-type");
      response.setHeader("access-control-allow-methods", "POST, OPTIONS");
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      response.write(": connected\n\n");
      eventClients.add(response);
      request.on("close", () => eventClients.delete(response));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/")) {
      const action = decodeURIComponent(url.pathname.slice("/api/".length));
      try {
        const result = await handleApi(action, await requestBody(request));
        json(response, 200, { result });
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (!isDev && request.method === "GET") {
      await serveStatic(request, response);
      return;
    }
    response.writeHead(404).end("Not found");
  } catch (error) {
    json(response, 403, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Verilog IDE web server listening at http://${HOST}:${PORT}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const job of jobs.values()) job.child.kill("SIGTERM");
    server.close(() => process.exit(0));
  });
}
