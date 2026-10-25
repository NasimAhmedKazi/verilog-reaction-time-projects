# 4-to-1 Multiplexer

This project implements a combinational 4:1 multiplexer. The two-bit `select`
input chooses one of four data bits:

| `select` | Output |
| --- | --- |
| `00` | `data_in[0]` |
| `01` | `data_in[1]` |
| `10` | `data_in[2]` |
| `11` | `data_in[3]` |

The design explicitly instantiates two select inverters, four 3-input AND
gates, and a 4-input OR gate. RapidRTL is configured to show the gate-level
schematic with readable signal names.
`mux4to1_tb.v` checks each select value and writes the simulation waveform to
`wave.vcd`. `mux4to1_rapidrtl.svg` is rendered by RapidRTL's bundled synthesis
engine and netlist renderer. The schematic implements:

```text
Y = D0·S1'·S0' + D1·S1'·S0 + D2·S1·S0' + D3·S1·S0
```

Run from this folder:

```sh
iverilog -g2012 -Wall -s mux4to1_tb -o simulation.vvp mux4to1.v mux4to1_tb.v
vvp simulation.vvp
```
