# Enhanced Reaction-Time Game

This standalone project builds on the original reaction-time game with synchronized and debounced button input, cycle-based timing, a separated next-state FSM, a 4-digit seven-segment display, and a self-checking testbench.

## Run the simulation

```sh
iverilog -g2012 -Wall -s reaction_time_game_tb -o simulation.vvp \
  button_conditioner.v seven_segment_display.v reaction_time_game.v reaction_time_game_tb.v
vvp simulation.vvp
```

The testbench writes `wave_enhanced.vcd`. In WaveTrace, add `clk`, `reset`, `start`, `reaction_button`, `led`, `done`, `false_start`, `reaction_ms`, `expected_reaction_ms`, `dut.state`, `dut.button_clean`, `dut.reaction_cycles`, `dut.wait_count_ms`, and `dut.lfsr`. Use **Fit to Window** and select unsigned decimal radix for the counters and millisecond values.

## Timing convention

`reaction_cycles` counts complete rising-edge intervals after the LED turns on. The first accepted, debounced button sample captures the elapsed full-cycle count. `reaction_ms` is the integer quotient of captured cycles divided by `CLK_HZ/1000`, so sub-millisecond fractions are truncated. Synchronizer and debounce latency are intentionally included because the physical input is only recognized after it is safely conditioned.

The button is synchronized through two flip-flops and must remain stable for `DEBOUNCE_MS` before its clean state changes. A button held before start inhibits the start request until released; it is not treated as an early press. A press during the randomized wait sets `false_start` and ends the round.

## Pseudo-random wait

The 32-bit LFSR uses a nonzero reset seed and repairs a zero state back to that seed. The wait is selected as `WAIT_MIN_MS + (lfsr % WAIT_RANGE)`. The millisecond timer is aligned at round start so the selected wait interval is counted from the start event. Modulo reduction can be slightly biased; the LFSR is pseudo-random, not cryptographically random. The configured limits must satisfy `1 <= WAIT_MIN_MS <= WAIT_MAX_MS`.

## Seven-segment display

The display scans four decimal digits, shows the current/result time from 0000 to 9999 ms, saturates larger values at 9999, and displays four minus signs for a false start. Outputs `seg_n[6:0]` and `digit_n[3:0]` are active-low for a common-anode display. Board pin assignments, oscillator frequency, and electrical constraints are board-specific and are not included; set `CLK_HZ` and add the correct constraints for the target FPGA board.
