# 8-to-1 Multiplexer — RapidRTL

The mux is built from NOT, AND, and OR gates. Open `mux8to1.v` and run **RapidRTL: Visualize File** to inspect its gate-level schematic.

Run the testbench with Icarus Verilog:

```sh
iverilog -g2012 -Wall -s mux8to1_tb -o simulation_8x1.vvp mux8to1.v mux8to1_tb.v
vvp simulation_8x1.vvp
```

The testbench checks each of the eight select values and writes `wave_8x1.vcd`.
