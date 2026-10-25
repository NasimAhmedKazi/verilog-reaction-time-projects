# Verilog IDE

A local-first macOS desktop workspace for editing Verilog/SystemVerilog, compiling with Icarus Verilog, running testbenches, and inspecting VCD digital waveforms.

## Requirements

- macOS 12 or later (Apple Silicon and Intel)
- Node.js 20+ and npm
- Icarus Verilog (`iverilog` and `vvp`)

Install Icarus Verilog with Homebrew:

```sh
brew install icarus-verilog
```

If installed outside the default Homebrew locations, make sure both executables are on `PATH` before launching the IDE.

## Run in development

```sh
cd verilog-ide
npm install
npm run dev
```

To run the browser version (which uses a local loopback-only backend for project files and Icarus Verilog), use:

```sh
cd verilog-ide
npm install
npm run web:dev
```

Open <http://127.0.0.1:5173>. Use **Open sample** or enter an absolute local project-folder path when creating/opening a project. The local backend listens only on `127.0.0.1`; HDL and simulation output stay on the Mac. To build and serve the production web version locally, run `npm run web` and open <http://127.0.0.1:4174>. Keep the local backend private and do not expose its port to the internet.

## Try the sample project

Choose **Open sample** on the welcome screen. The app copies the bundled example to `Documents/Verilog IDE/and-gate-demo` and opens it. The project includes an AND gate, testbench, and a Vivado-style logic-symbol diagram at `sample-project/and_gate_schematic.svg`. The top-module field is set to `and_gate_tb`; click **Run** to compile and simulate. The testbench writes `build/wave.vcd`, prints signal values to the console, and automatically opens the waveform viewer after a successful run.

## Included Verilog projects

- [`sample-project/`](./sample-project/): AND gate, testbench, and schematic.
- [`multiplexer-project/`](./multiplexer-project/): gate-level 4-to-1 mux, testbench, and RapidRTL schematic.
- [`multiplexer-8x1-project/`](./multiplexer-8x1-project/): gate-level 8-to-1 mux and testbench.
- [`reaction-time-project/`](./reaction-time-project/): reaction-time game, self-checking testbench, and RapidRTL schematic.
- [`reaction-time-enhanced-project/`](./reaction-time-enhanced-project/): synchronized/debounced input, cycle-based timer, seven-segment display, and expanded testbench.

The `.vcd` files are example simulation traces. Rerun each testbench with Icarus Verilog to regenerate them.

## Project format

Each project is a directory with a `verilog-project.json` file. HDL sources (`.v`, `.sv`, `.vh`, `.svh`) stay with the project. Generated executables and the default waveform are isolated in `build/`. The compiler is called with argument arrays (never through a shell), using `iverilog -g2012 -Wall -o build/simulation.vvp ...`; simulation runs with `vvp build/simulation.vvp`.

The top-module field is optional. When provided, it is passed using `-s`. Source and testbench files are compiled together.

## Build and package

```sh
npm run typecheck
npm test
npm run build
npm run package:mac
```

The `.dmg` and `.zip` artifacts are written to `dist/` by electron-builder. `package:mac` targets Apple Silicon (`arm64`) on Apple Silicon build hosts. The package is unsigned unless a valid Apple Developer ID certificate is configured; a signed/notarized public release requires Apple Developer credentials and notarization.

## Current feature scope

- Monaco editor with HDL tokenization, indentation, matching brackets, folding, search, completion for common keywords, multiple tabs, and save shortcuts.
- Project folder creation/opening, HDL file creation, project tree, and persistent top-module setting.
- Icarus compiler diagnostics and console output, asynchronous simulation, and a stop control.
- VCD parsing for Icarus output with nested scopes, scalar/vector values at the cursor, signal selection/search, a time ruler, a movable cursor, edge markers, zoom/pan, and shift-click interval measurement.
- Secure Electron defaults (`contextIsolation`, sandbox, no renderer Node integration), project-root-constrained file access, and shell-free process spawning.

The waveform view is intended for digital logic and moderate-size VCD traces. VCD parsing currently happens in the renderer; very large traces may require a worker/virtualized renderer. Schematic generation, drag-and-drop signal reordering, and support for arbitrary dumpfile paths are not implemented. Only run HDL projects you trust: simulator code executes locally and may perform actions allowed to the current user.
