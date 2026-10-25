import { describe, expect, it } from "vitest";
import { parseVcd } from "./vcd";

describe("parseVcd", () => {
  it("reads scopes, timescale, scalar and vector changes", () => {
    const waveform = parseVcd(`$timescale
  1 ns
$end
$scope module tb $end
$var wire 1 ! clk $end
$var reg 4 " bus [3:0] $end
$upscope $end
$enddefinitions $end
#0
0!
b0000 "
#5
1!
b1010 "
#10
0!
`);
    expect(waveform.timescale).toBe("1ns");
    expect(waveform.endTime).toBe(10);
    expect(waveform.signals.map((signal) => signal.name)).toEqual(["tb.clk", "tb.bus"]);
    expect(waveform.signals[1].changes).toEqual([
      { time: 0, value: "0000" },
      { time: 5, value: "1010" }
    ]);
  });

  it("preserves unknown and high-impedance scalar states", () => {
    const waveform = parseVcd(`$timescale 10 ps $end
$scope module tb $end
$var wire 1 ! signal $end
$upscope $end
$enddefinitions $end
#0
x!
#5
z!
`);
    expect(waveform.timescale).toBe("10ps");
    expect(waveform.signals[0].changes).toEqual([
      { time: 0, value: "x" },
      { time: 5, value: "z" }
    ]);
  });
});
