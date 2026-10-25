# Reaction Time Project

A small Verilog reaction-time game and self-checking Icarus Verilog testbench.

## Run the simulation

From this folder, compile and run:

```sh
iverilog -g2012 -Wall -s reaction_time_game_tb -o simulation.vvp reaction_time_game.v reaction_time_game_tb.v
vvp simulation.vvp
```

The testbench writes `wave.vcd` in this folder. Open it in VS Code with WaveTrace, click **Add Signals**, and add `clk`, `reset`, `start`, `reaction_button`, `led`, `done`, `false_start`, `reaction_ms`, `state`, `cycle_count`, `wait_count`, and `lfsr`. Use **Fit to Window** to see the complete trace. The VCD records the top-level testbench signals and the DUT's internal state/counters.

## RapidRTL schematic

Open `reaction_time_game.v` and run **RapidRTL: Visualize File** from the Command Palette or click the RapidRTL schematic button in the editor toolbar. The workspace uses RapidRTL's high-level view to keep the full design readable; gate-level expansion of the complete 32-bit-counter design exceeds the renderer's memory limit. `reaction_time_game_rapidrtl.svg` is a saved RapidRTL schematic generated from the Verilog source.

## Game behavior

- Pulse `start` to begin a round.
- Wait for `led` to turn on, then assert `reaction_button`.
- `reaction_ms` reports the elapsed time in milliseconds and `done` marks a completed round.
- Pressing the reaction button while waiting sets `false_start` and completes the round without turning on the LED.
- The wait interval is pseudorandom, based on a 32-bit LFSR. `CLK_HZ`, `WAIT_MIN_MS`, and `WAIT_MAX_MS` are parameters.

The included testbench uses a 1 ms clock period and checks both a valid 237 ms response and an early press. In WaveTrace, select **Unsigned/Decimal** radix for `reaction_ms`, `expected_reaction_ms`, and the counters, then use **Fit to Window** to show the full run. `state` is encoded as `00` idle, `01` waiting, `10` reacting, and `11` finished.
