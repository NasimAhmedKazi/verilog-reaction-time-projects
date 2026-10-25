import Editor, { type OnMount } from "@monaco-editor/react";
import {
  Activity, AlertCircle, Check, ChevronDown, ChevronRight, CircleHelp,
  FileCode2, FilePlus2, FolderOpen, FolderPlus, Pencil, Play, Plus, Save,
  Square, Sun, Terminal, Trash2, Waves as WaveIcon, X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProcessEvent, Project, ProjectFile, ToolStatus, Waveform } from "./types";
import { moduleTemplate, testbenchTemplate } from "./templates";
import { parseVcd } from "./vcd";

type OpenFile = { path: string; content: string; savedContent: string };
type ConsoleLine = { text: string; stream: string; file?: string; line?: number };

function displayName(filePath: string) {
  return filePath.split("/").at(-1) ?? filePath;
}

function diagnosticLocation(text: string) {
  const match = /(?:^|\s)([^:\s]+):(\d+)(?::\d+)?:/.exec(text);
  if (!match) return null;
  return { file: match[1], line: Number(match[2]) };
}

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [tabs, setTabs] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState("");
  const [topModule, setTopModule] = useState("");
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [jobId, setJobId] = useState("");
  const [processKind, setProcessKind] = useState<"compile" | "simulation" | "">("");
  const [status, setStatus] = useState("Ready");
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);
  const [signalSearch, setSignalSearch] = useState("");
  const [cursorTime, setCursorTime] = useState(0);
  const [lightTheme, setLightTheme] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<"files" | "waveform">("files");
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const pendingAction = useRef<"compile" | "run" | null>(null);
  const currentJob = useRef("");
  const activeTab = tabs.find((tab) => tab.path === activePath);

  const addConsole = useCallback((text: string, stream = "stdout") => {
    if (!text) return;
    setConsoleLines((old) => [
      ...old,
      ...text.split(/\r?\n/).filter(Boolean).map((line) => ({
        text: line,
        stream,
        ...(diagnosticLocation(line) ?? {})
      }))
    ]);
  }, []);

  const refreshFiles = useCallback(async (root: string) => {
    setFiles(await window.verilogIDE.listFiles(root));
  }, []);

  const openProject = useCallback(async (selected: Project | null) => {
    if (!selected) return;
    setProject(selected);
    setTabs([]);
    setActivePath("");
    setWaveform(null);
    setSelectedSignals([]);
    setTopModule("");
    setConsoleLines([]);
    await refreshFiles(selected.root);
    try {
      const raw = await window.verilogIDE.readFile(selected.root, "verilog-project.json");
      const settings = JSON.parse(raw) as { topModule?: string };
      setTopModule(settings.topModule ?? "");
    } catch (error) {
      addConsole(`Could not load project settings: ${String(error)}`, "error");
    }
  }, [addConsole, refreshFiles]);

  const chooseProject = (create: boolean) => {
    if (tabs.some((tab) => tab.content !== tab.savedContent) && !window.confirm("Discard unsaved changes and open another project?")) return;
    if (window.verilogIDE.isWeb) {
      const action = create ? "Create" : "Open";
      const path = window.prompt(
        `${action} a local Verilog project.\nEnter the absolute folder path on this Mac:`,
        create ? "/Users/your-name/Documents/Verilog Projects/my-project" : ""
      );
      if (!path?.trim()) return;
      const choose = create ? window.verilogIDE.createProject : window.verilogIDE.openProject;
      void choose(path.trim()).then(openProject).catch((error) => addConsole(String(error), "error"));
      return;
    }
    const choose = create ? window.verilogIDE.createProject : window.verilogIDE.openProject;
    void choose().then(openProject).catch((error) => addConsole(String(error), "error"));
  };

  const chooseSample = () => {
    if (tabs.some((tab) => tab.content !== tab.savedContent) && !window.confirm("Discard unsaved changes and open the sample project?")) return;
    void window.verilogIDE.openSampleProject().then(openProject).catch((error) => addConsole(String(error), "error"));
  };

  useEffect(() => {
    void window.verilogIDE.checkTools().then(setTools).catch((error) => addConsole(`Could not check Icarus Verilog: ${String(error)}`, "error"));
    const unsubscribe = window.verilogIDE.onProcessEvent((event: ProcessEvent) => {
      if (event.type === "start") {
        currentJob.current = event.id;
        setJobId(event.id);
        setProcessKind(event.kind);
        setStatus(event.kind === "compile" ? "Compiling…" : "Simulating…");
        setConsoleOpen(true);
        return;
      }
      if (event.id !== currentJob.current) return;
      if (event.type === "output") {
        addConsole(event.text ?? "", event.stream ?? "stdout");
        return;
      }
      if (event.type === "exit") {
        if (event.error) addConsole(event.error, "error");
        const wasStopped = event.kind === "simulation" && event.signal === "SIGTERM";
        addConsole(event.kind === "compile"
          ? event.code === 0 ? "Compilation succeeded." : `Compilation failed (exit ${event.code ?? "unknown"}).`
          : wasStopped ? "Simulation stopped." : event.code === 0 ? "Simulation finished." : `Simulation exited with code ${event.code ?? "unknown"}.`,
        wasStopped ? "info" : event.code === 0 ? "success" : "error");
        setJobId("");
        setProcessKind("");
        if (event.kind === "compile" && event.code === 0) {
          setStatus("Compiled");
          if (pendingAction.current === "run" && project) {
            pendingAction.current = null;
            void startSimulation(project);
          } else {
            pendingAction.current = null;
          }
        } else if (event.kind === "simulation") {
          setStatus(event.signal === "SIGTERM" ? "Simulation stopped" : event.code === 0 ? "Simulation complete" : "Simulation failed");
          if (event.code === 0 && project) void loadWaveform(project);
        } else {
          pendingAction.current = null;
          setStatus("Compile failed");
        }
      }
    });
    return unsubscribe;
  }, [addConsole, project]);

  const loadWaveform = async (current: Project) => {
    try {
      const file = await window.verilogIDE.readWaveform(current.root);
      if (!file) {
        setWaveform(null);
        addConsole("No build/wave.vcd found. Add $dumpfile(\"wave.vcd\") and $dumpvars to your testbench.", "warning");
        return;
      }
      const parsed = parseVcd(file.content);
      setWaveform(parsed);
      setSelectedSignals(parsed.signals.slice(0, 8).map((signal) => signal.id));
      setCursorTime(0);
      setActiveSection("waveform");
    } catch (error) {
      addConsole(`Could not load waveform: ${String(error)}`, "error");
    }
  };

  const startSimulation = async (current: Project) => {
    try {
      await window.verilogIDE.runSimulation(current.root);
    } catch (error) {
      addConsole(String(error), "error");
      setStatus("Simulation failed");
    }
  };

  const openFile = async (filePath: string) => {
    if (tabs.some((tab) => tab.path === filePath)) {
      setActivePath(filePath);
      return;
    }
    if (!project) return;
    try {
      const content = await window.verilogIDE.readFile(project.root, filePath);
      setTabs((old) => [...old, { path: filePath, content, savedContent: content }]);
      setActivePath(filePath);
    } catch (error) {
      addConsole(`Could not open ${filePath}: ${String(error)}`, "error");
    }
  };

  const saveFile = useCallback(async (filePath = activePath) => {
    const tab = tabs.find((item) => item.path === filePath);
    if (!project || !tab) return;
    try {
      await window.verilogIDE.writeFile(project.root, tab.path, tab.content);
      setTabs((old) => old.map((item) => item.path === tab.path ? { ...item, savedContent: item.content } : item));
      addConsole(`Saved ${tab.path}`, "success");
    } catch (error) {
      addConsole(`Could not save ${tab.path}: ${String(error)}`, "error");
    }
  }, [activePath, addConsole, project, tabs]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [saveFile]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monaco.languages.register({ id: "verilog" });
    monaco.languages.setMonarchTokensProvider("verilog", {
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [/\b(module|endmodule|input|output|inout|wire|reg|logic|always|always_ff|always_comb|assign|begin|end|if|else|case|endcase|function|endfunction|task|endtask|parameter|localparam|generate|endgenerate|for|while|posedge|negedge|initial|integer|time|real|signed|unsigned)\b/, "keyword"],
          [/\$[a-zA-Z_]\w*/, "predefined"],
          [/\b\d+'[bBoOdDhH][0-9a-fA-F_xXzZ?]+\b|\b\d+\b/, "number"],
          [/\b[a-zA-Z_]\w*\b/, "identifier"],
          [/[{}()[\]]/, "@brackets"],
          [/[;,.]/, "delimiter"]
        ],
        comment: [[/[^/*]+/, "comment"], [/\*\//, "comment", "@pop"], [/[/*]/, "comment"]]
      }
    });
    monaco.languages.setLanguageConfiguration("verilog", {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
      autoClosingPairs: [
        { open: "{", close: "}" }, { open: "[", close: "]" },
        { open: "(", close: ")" }, { open: "\"", close: "\"" }
      ],
      indentationRules: { increaseIndentPattern: /^\s*(begin|case|module|function|task|generate)\b/, decreaseIndentPattern: /^\s*(end|endcase|endmodule|endfunction|endtask|endgenerate)\b/ }
    });
    monaco.languages.registerCompletionItemProvider("verilog", {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };
        return {
          suggestions: ["module", "endmodule", "input", "output", "inout", "wire", "reg", "logic", "always", "always_ff", "always_comb", "assign", "begin", "end", "initial", "parameter", "localparam", "posedge", "negedge", "case", "endcase"].map((keyword) => ({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            range
          }))
        };
      }
    });
    editor.addAction({
      id: "save-verilog-file",
      label: "Save file",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => void saveFile()
    });
  };

  const updateActiveContent = (content: string | undefined) => {
    if (content === undefined) return;
    setTabs((old) => old.map((tab) => tab.path === activePath ? { ...tab, content } : tab));
  };

  const createSource = async () => {
    if (!project) {
      addConsole("Create or open a project before adding files.", "warning");
      return;
    }
    const choice = window.prompt("Create a module or testbench?", "module");
    if (choice === null) return;
    const isTestbench = choice.toLowerCase().startsWith("t");
    const name = window.prompt("File name (without extension)", isTestbench ? "my_module_tb" : "my_module");
    if (!name) return;
    const cleanName = name.replace(/\.(v|sv)$/i, "");
    if (!/^[A-Za-z0-9_-]+$/.test(cleanName)) {
      addConsole("Use letters, numbers, underscores, and hyphens in file names.", "error");
      return;
    }
    const filePath = `${cleanName}.v`;
    try {
      await window.verilogIDE.createFile(project.root, filePath, isTestbench ? testbenchTemplate : moduleTemplate);
      await refreshFiles(project.root);
      await openFile(filePath);
    } catch (error) {
      addConsole(`Could not create ${filePath}: ${String(error)}`, "error");
    }
  };

  const renameSource = async (filePath: string) => {
    if (!project) return;
    const currentName = displayName(filePath);
    const proposed = window.prompt("Rename HDL file", currentName);
    if (!proposed || proposed === currentName) return;
    try {
      const newPath = await window.verilogIDE.renameFile(project.root, filePath, proposed);
      setTabs((old) => old.map((tab) => tab.path === filePath ? { ...tab, path: newPath } : tab));
      setActivePath((old) => old === filePath ? newPath : old);
      await refreshFiles(project.root);
    } catch (error) {
      addConsole(`Could not rename ${filePath}: ${String(error)}`, "error");
    }
  };

  const deleteSource = async (filePath: string) => {
    if (!project || !window.confirm(`Delete ${displayName(filePath)}? This cannot be undone.`)) return;
    if (tabs.some((tab) => tab.path === filePath && tab.content !== tab.savedContent)) {
      if (!window.confirm("This file has unsaved changes. Delete it anyway?")) return;
    }
    try {
      await window.verilogIDE.deleteFile(project.root, filePath);
      setTabs((old) => old.filter((tab) => tab.path !== filePath));
      setActivePath((old) => old === filePath ? "" : old);
      await refreshFiles(project.root);
    } catch (error) {
      addConsole(`Could not delete ${filePath}: ${String(error)}`, "error");
    }
  };

  const toggleFolder = (folderPath: string) => {
    setCollapsedFolders((old) => old.includes(folderPath) ? old.filter((path) => path !== folderPath) : [...old, folderPath]);
  };

  const saveProjectSettings = async () => {
    if (!project) return;
    try {
      const raw = await window.verilogIDE.readFile(project.root, "verilog-project.json");
      const settings = JSON.parse(raw) as Record<string, unknown>;
      await window.verilogIDE.writeFile(project.root, "verilog-project.json", JSON.stringify({ ...settings, topModule }, null, 2));
    } catch (error) {
      addConsole(`Could not save project settings: ${String(error)}`, "error");
    }
  };

  const compile = async (runAfter: boolean) => {
    if (!project) {
      addConsole("Create or open a project before compiling.", "warning");
      return;
    }
    const dirty = tabs.filter((tab) => tab.content !== tab.savedContent);
    for (const tab of dirty) await saveFile(tab.path);
    const sources = files
      .filter((file) => file.kind === "file" && /\.(v|sv)$/i.test(file.path))
      .map((file) => file.path);
    if (!sources.length) {
      addConsole("No .v or .sv source files found. Add a design and testbench.", "warning");
      setConsoleOpen(true);
      return;
    }
    pendingAction.current = runAfter ? "run" : null;
    setConsoleLines([]);
    setConsoleOpen(true);
    await saveProjectSettings();
    try {
      await window.verilogIDE.compile(project.root, sources, topModule.trim());
    } catch (error) {
      pendingAction.current = null;
      addConsole(String(error), "error");
      setStatus("Compile failed");
    }
  };

  const currentFileDiagnostics = useMemo(() => consoleLines.flatMap((line) => {
    if (!line.file || !line.line) return [];
    const matching = files.find((file) => file.path === line.file || displayName(file.path) === line.file);
    return matching ? [{ path: matching.path, line: line.line, message: line.text }] : [];
  }), [consoleLines, files]);

  const filteredSignals = waveform?.signals.filter((signal) => signal.name.toLowerCase().includes(signalSearch.toLowerCase())) ?? [];
  const dirtyCount = tabs.filter((tab) => tab.content !== tab.savedContent).length;

  return (
    <div className={`ide-shell ${lightTheme ? "light" : ""}`}>
      <header className="toolbar">
        <div className="app-brand"><div className="brand-symbol">V</div><span>Verilog<span className="brand-muted"> IDE</span></span></div>
        <div className="toolbar-divider" />
        <button className="tool-button" onClick={() => chooseProject(true)}><FolderPlus size={15} /> New Project</button>
        <button className="tool-button" onClick={() => chooseProject(false)}><FolderOpen size={15} /> Open</button>
        <button className="tool-button" onClick={() => void saveFile()} disabled={!activeTab}><Save size={15} /> Save</button>
        <button className="tool-button" onClick={() => void createSource()}><FilePlus2 size={15} /> Add HDL</button>
        <div className="toolbar-spacer" />
        <div className="tool-status"><span className={`status-led ${tools.length === 2 && tools.every((tool) => tool.available) ? "ready" : "missing"}`} />{tools.length === 0 ? "Checking tools…" : tools.every((tool) => tool.available) ? "Icarus ready" : "Icarus missing"}</div>
        <button className="tool-button primary" onClick={() => void compile(false)} disabled={Boolean(jobId)}><Activity size={15} /> Compile</button>
        <button className="tool-button run-button" onClick={() => void compile(true)} disabled={Boolean(jobId)}><Play size={14} /> Run</button>
        <button className="tool-button icon-only" title="Toggle theme" onClick={() => setLightTheme((value) => !value)}><Sun size={16} /></button>
      </header>

      <div className="workspace-titlebar">
        <span className="project-path"><span className="path-muted">PROJECT</span> {project?.name ?? "No project open"}</span>
        <span className={`build-state ${status.includes("fail") ? "state-error" : status.includes("Compiled") || status.includes("complete") ? "state-ok" : ""}`}><span className="state-dot" />{status}</span>
      </div>

      <main className="workbench">
        <aside className="activity-rail">
          <button className={activeSection === "files" ? "selected" : ""} title="Project files" onClick={() => setActiveSection("files")}><FileCode2 size={19} /></button>
          <button className={activeSection === "waveform" ? "selected" : ""} title="Waveform" onClick={() => setActiveSection("waveform")}><WaveIcon size={19} /></button>
          <div className="rail-bottom"><button title="Icarus setup" onClick={() => addConsole("Install with Homebrew: brew install icarus-verilog. The iverilog and vvp commands must be on PATH.", "info")}><CircleHelp size={18} /></button></div>
        </aside>

        {activeSection === "files" ? (
          <aside className="project-panel">
            <div className="panel-heading"><span>Explorer</span><button title="Add HDL file" onClick={() => void createSource()}><Plus size={15} /></button></div>
            <div className="tree-project"><ChevronDown size={14} /><span>{project?.name.toUpperCase() ?? "OPEN A PROJECT"}</span><button onClick={() => void createSource()} title="Add HDL file"><Plus size={14} /></button></div>
            <div className="file-tree">
              {files.filter((file) => {
                const parts = file.path.split("/");
                return !parts.slice(0, -1).some((_part, index) => collapsedFolders.includes(parts.slice(0, index + 1).join("/")));
              }).map((file) => (
                <div className={`tree-row ${file.kind}`} key={file.path}>
                  <button className={`file-tree-item ${file.path === activePath ? "active" : ""} ${file.kind}`} style={{ paddingLeft: `${12 + (file.path.split("/").length - 1) * 14}px` }} onClick={() => file.kind === "file" ? void openFile(file.path) : toggleFolder(file.path)}>
                    {file.kind === "directory" ? collapsedFolders.includes(file.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} /> : <FileCode2 size={14} />}
                    <span>{displayName(file.path)}</span>
                    {tabs.some((tab) => tab.path === file.path && tab.content !== tab.savedContent) && <i className="unsaved-dot" />}
                  </button>
                  {file.kind === "file" && /\.(v|sv|vh|svh)$/i.test(file.path) && <div className="tree-actions">
                    <button title={`Rename ${displayName(file.path)}`} onClick={() => void renameSource(file.path)}><Pencil size={12} /></button>
                    <button title={`Delete ${displayName(file.path)}`} onClick={() => void deleteSource(file.path)}><Trash2 size={12} /></button>
                  </div>}
                </div>
              ))}
              {!project && <div className="tree-empty">Create or open a project to begin.</div>}
              {project && files.length === 0 && <div className="tree-empty">No HDL files yet. Add a module to get started.</div>}
            </div>
            <div className="project-options">
              <label htmlFor="top-module">Top module</label>
              <input id="top-module" value={topModule} onChange={(event) => setTopModule(event.target.value)} onBlur={() => void saveProjectSettings()} placeholder="e.g. my_module_tb" />
            </div>
          </aside>
        ) : (
          <aside className="project-panel signal-panel">
            <div className="panel-heading"><span>Signals {waveform ? `(${waveform.signals.length})` : ""}</span><button title="Show project files" onClick={() => setActiveSection("files")}><FileCode2 size={15} /></button></div>
            {waveform ? <>
              <input className="signal-search" value={signalSearch} onChange={(event) => setSignalSearch(event.target.value)} placeholder="Search signals…" />
              <div className="signal-list">{filteredSignals.map((signal) => <label key={signal.id} className="signal-choice">
                <input type="checkbox" checked={selectedSignals.includes(signal.id)} onChange={(event) => setSelectedSignals((old) => event.target.checked ? [...old, signal.id] : old.filter((id) => id !== signal.id))} />
                <span className="signal-color" />
                <span title={signal.name}>{signal.name}</span>
              </label>)}</div>
            </> : <div className="tree-empty">Run a testbench that writes build/wave.vcd to inspect signal transitions.</div>}
          </aside>
        )}

        <section className="editor-workspace">
          <div className="editor-tabs">
            {tabs.map((tab) => <button className={`editor-tab ${tab.path === activePath ? "active" : ""}`} key={tab.path} onClick={() => setActivePath(tab.path)}>
              <FileCode2 size={14} /><span>{displayName(tab.path)}</span>{tab.content !== tab.savedContent && <span className="tab-dirty" />}
              <span className="tab-close" onClick={(event) => {
                event.stopPropagation();
                if (tab.content !== tab.savedContent && !window.confirm(`Discard unsaved changes to ${displayName(tab.path)}?`)) return;
                setTabs((old) => old.filter((item) => item.path !== tab.path));
                if (activePath === tab.path) setActivePath(tabs.find((item) => item.path !== tab.path)?.path ?? "");
              }}><X size={12} /></span>
            </button>)}
            {tabs.length === 0 && <div className="welcome-tabs"><span>NO FILE OPEN</span></div>}
          </div>
          {activeTab ? <div className="editor-container">
            <div className="editor-breadcrumb"><span>{project?.name ?? "Project"}</span><ChevronRight size={12} />{activePath}</div>
            <Editor
              height="100%"
              path={activePath}
              language="verilog"
              theme={lightTheme ? "vs" : "vs-dark"}
              value={activeTab.content}
              onChange={updateActiveContent}
              onMount={handleEditorMount}
              options={{
                automaticLayout: true, minimap: { enabled: false }, fontSize: 14,
                fontFamily: "'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
                lineNumbers: "on", scrollBeyondLastLine: false, tabSize: 4,
                padding: { top: 12 }, renderLineHighlight: "all",
                bracketPairColorization: { enabled: true }, smoothScrolling: true
              }}
            />
          </div> : (
            <div className="welcome-screen">
              <div className="welcome-icon"><Activity size={24} /></div>
              <h1>{project ? `Welcome to ${project.name}` : "Verilog IDE"}</h1>
              <p>Build, simulate, and inspect digital circuits with Icarus Verilog.</p>
              <div className="welcome-actions">
                <button onClick={() => chooseProject(true)}><FolderPlus size={16} /> Create project</button>
                <button onClick={() => void createSource()} disabled={!project}><FilePlus2 size={16} /> New Verilog file</button>
                {project && <button onClick={() => void compile(true)}><Play size={15} /> Run simulation</button>}
                <button onClick={chooseSample}><Activity size={15} /> Open sample</button>
              </div>
              {tools.length > 0 && !tools.every((tool) => tool.available) && <div className="dependency-banner"><AlertCircle size={16} /><span>Install Icarus Verilog with <code>brew install icarus-verilog</code>, then restart the app.</span></div>}
            </div>
          )}
          {currentFileDiagnostics.length > 0 && <div className="diagnostic-bar"><AlertCircle size={14} /> {currentFileDiagnostics.length} diagnostic{currentFileDiagnostics.length > 1 ? "s" : ""}</div>}
          <div className="editor-statusbar">
            <span>{activePath ? `${activePath} ${activeTab?.content !== activeTab?.savedContent ? "• Unsaved" : ""}` : "Select a source file to start editing"}</span>
            <span>{activeTab ? "Verilog" : ""} <span className="status-separator">|</span> UTF-8 <span className="status-separator">|</span> {dirtyCount ? `${dirtyCount} unsaved` : "Saved"}</span>
          </div>
        </section>

        <section className={`console-panel ${consoleOpen ? "open" : "closed"}`}>
          <div className="console-heading">
            <div className="console-tabs"><button className="active" onClick={() => setConsoleOpen(true)}><Terminal size={14} /> Console</button><span className="console-count">{consoleLines.length}</span></div>
            <div className="console-tools">
              {processKind === "simulation" && jobId && <button className="stop-button" onClick={() => void window.verilogIDE.stopSimulation(jobId)}><Square size={12} /> Stop simulation</button>}
              <button title="Clear console" onClick={() => setConsoleLines([])}>Clear</button>
              <button title={consoleOpen ? "Collapse console" : "Expand console"} onClick={() => setConsoleOpen((value) => !value)}>{consoleOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
            </div>
          </div>
          {consoleOpen && <div className="console-content">
            {consoleLines.length === 0 ? <div className="console-placeholder">Compiler output, diagnostics, and simulation logs will appear here.</div> : consoleLines.map((line, index) => <div className={`console-line ${line.stream}`} key={`${index}-${line.text}`}>
              <span className="console-prompt">{line.stream === "stderr" || line.stream === "error" ? "!" : line.stream === "success" ? "✓" : "›"}</span>
              {line.file && line.line ? <button className="diagnostic-link" onClick={() => { if (line.file) void openFile(files.find((file) => file.path === line.file || displayName(file.path) === line.file)?.path ?? line.file); setTimeout(() => editorRef.current?.revealLineInCenter(line.line!), 150); }}>{line.text}</button> : <span>{line.text}</span>}
            </div>)}
          </div>}
          {consoleOpen && <div className="bottom-status"><span><span className={`status-led ${tools.length === 2 && tools.every((tool) => tool.available) ? "ready" : "missing"}`} /> {tools.length === 2 && tools.every((tool) => tool.available) ? "iverilog / vvp detected" : "Install Icarus Verilog to compile"}</span><span>{project?.root ?? "No workspace"}</span></div>}
        </section>
      </main>

      {activeSection === "waveform" && waveform && <WaveformViewer
        waveform={waveform}
        signalIds={selectedSignals}
        cursorTime={cursorTime}
        onCursor={setCursorTime}
      />}
    </div>
  );
}

function WaveformViewer({ waveform, signalIds, cursorTime, onCursor }: {
  waveform: Waveform;
  signalIds: string[];
  cursorTime: number;
  onCursor: (time: number) => void;
}) {
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(Math.max(1, waveform.endTime));
  const [measureStart, setMeasureStart] = useState<number | null>(null);
  const [measureEnd, setMeasureEnd] = useState<number | null>(null);
  useEffect(() => {
    setViewStart(0);
    setViewEnd(Math.max(1, waveform.endTime));
    setMeasureStart(null);
    setMeasureEnd(null);
  }, [waveform]);
  const selected = waveform.signals.filter((signal) => signalIds.includes(signal.id));
  const width = 1000;
  const left = 12;
  const right = 20;
  const plotWidth = width - left - right;
  const rowHeight = 42;
  const height = Math.max(100, selected.length * rowHeight + 34);
  const duration = Math.max(1, waveform.endTime);
  const visibleDuration = Math.max(1, viewEnd - viewStart);
  const timeToX = (time: number) => left + (time - viewStart) / visibleDuration * plotWidth;
  const cursorX = timeToX(cursorTime);
  const formatValue = (value: string, signalWidth: number) => signalWidth === 1 ? value.toUpperCase() : value.length > 10 ? `${value.slice(0, 8)}…` : value;
  const valueAt = (signal: Waveform["signals"][number], time: number) => {
    let current = "x";
    for (const change of signal.changes) {
      if (change.time > time) break;
      current = change.value;
    }
    return formatValue(current, signal.width);
  };
  const zoom = (factor: number) => {
    const nextDuration = Math.max(1, Math.min(duration, visibleDuration * factor));
    const center = Math.max(0, Math.min(duration, cursorTime));
    const start = Math.max(0, Math.min(duration - nextDuration, center - nextDuration / 2));
    setViewStart(start);
    setViewEnd(start + nextDuration);
  };
  const pan = (fraction: number) => {
    const nextStart = Math.max(0, Math.min(duration - visibleDuration, viewStart + visibleDuration * fraction));
    setViewStart(nextStart);
    setViewEnd(nextStart + visibleDuration);
  };

  return (
    <div className="wave-modal">
      <div className="wave-header"><div><div className="wave-title"><WaveIcon size={17} /> Waveform Viewer</div><small>{waveform.timescale} · duration {waveform.endTime} {waveform.timescale}</small></div><div className="wave-actions">
        <button onClick={() => pan(-0.5)} title="Pan left">←</button>
        <button onClick={() => zoom(0.5)} title="Zoom in">+</button>
        <button onClick={() => zoom(2)} title="Zoom out">−</button>
        <button onClick={() => { setViewStart(0); setViewEnd(duration); setMeasureStart(null); setMeasureEnd(null); }} title="Fit all">Fit</button>
        <button onClick={() => onCursor(0)}>Reset cursor</button><span>{selected.length} signals</span>
        <button onClick={() => pan(0.5)} title="Pan right">→</button>
      </div></div>
      {selected.length === 0 ? <div className="wave-empty">Select signals from the left panel to display waveforms.</div> : <div className="wave-scroll">
        <svg className="wave-canvas" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const time = Math.max(viewStart, Math.min(viewEnd, viewStart + ((event.clientX - bounds.left) / bounds.width * width - left) / plotWidth * visibleDuration));
          if (event.shiftKey) {
            if (measureStart === null || measureEnd !== null) {
              setMeasureStart(time);
              setMeasureEnd(null);
            } else {
              setMeasureEnd(time);
            }
          } else {
            onCursor(time);
          }
        }}>
          {Array.from({ length: 11 }, (_, index) => {
            const x = left + plotWidth * index / 10;
            return <g key={index}><line x1={x} x2={x} y1="18" y2={height} className="wave-grid" /><text x={x} y="13" className="wave-tick">{(viewStart + visibleDuration * index / 10).toPrecision(3)}</text></g>;
          })}
          {selected.map((signal, row) => {
            const y = row * rowHeight + 31;
            let d = "";
            const changes = signal.changes.length ? signal.changes : [{ time: 0, value: "x" }];
            const yFor = (value: string) => value === "1" ? y - 10 : value === "0" ? y + 10 : y;
            let previousValue = "x";
            for (const change of changes) {
              if (change.time > viewStart) break;
              previousValue = change.value;
            }
            d = `M ${left} ${yFor(previousValue)}`;
            for (const change of changes.filter((entry) => entry.time > viewStart && entry.time <= viewEnd)) {
              const x = timeToX(change.time);
              d += ` H ${x} V ${yFor(change.value)}`;
              previousValue = change.value;
            }
            d += ` H ${width - right}`;
            return <g key={signal.id}>
              <line x1={left} x2={width - right} y1={row * rowHeight + rowHeight} y2={row * rowHeight + rowHeight} className="wave-row-line" />
              <path d={d} className="wave-trace" />
              {signal.width === 1 && signal.changes.filter((change) => change.time >= viewStart && change.time <= viewEnd).map((change, index) => <circle
                key={`${signal.id}-edge-${index}`}
                cx={timeToX(change.time)}
                cy={yFor(change.value)}
                r="2.5"
                className={change.value === "1" ? "wave-rising-edge" : change.value === "0" ? "wave-falling-edge" : "wave-unknown-edge"}
              />)}
              {signal.width > 1 && signal.changes.filter((change) => change.time >= viewStart && change.time <= viewEnd).map((change, index) => <text key={`${signal.id}-${index}`} x={timeToX(change.time) + 3} y={y + 4} className="wave-value">{formatValue(change.value, signal.width)}</text>)}
            </g>;
          })}
          {measureStart !== null && measureEnd !== null && <rect x={timeToX(Math.min(measureStart, measureEnd))} y="18" width={Math.abs(timeToX(measureEnd) - timeToX(measureStart))} height={height - 18} className="wave-measure" />}
          {cursorTime >= viewStart && cursorTime <= viewEnd && <line x1={cursorX} x2={cursorX} y1="17" y2={height} className="wave-cursor" />}
        </svg>
        <div className="wave-row-labels">{selected.map((signal) => <div className="wave-row-label" key={signal.id} title={`${signal.name} (${signal.width} bit${signal.width > 1 ? "s" : ""})`}><span>{signal.name}</span><code>{valueAt(signal, cursorTime)}</code><small>{signal.width}b</small></div>)}</div>
      </div>}
      <div className="wave-footer"><span>Cursor <b>{cursorTime.toFixed(2)} {waveform.timescale}</b></span><span>{measureStart !== null && measureEnd !== null ? <>Interval <b>{Math.abs(measureEnd - measureStart).toFixed(2)} {waveform.timescale}</b> · shift-click to reset</> : "Click to move cursor · shift-click twice to measure"}</span><span><Check size={13} /> VCD loaded</span></div>
    </div>
  );
}

export default App;
