`timescale 1ns/1ps

module and_gate_tb;
    reg a, b;
    wire y;

    and_gate uut (
        .a(a),
        .b(b),
        .y(y)
    );

    initial begin
        $dumpfile("wave.vcd");
        $dumpvars(0, and_gate_tb);
        $monitor("Time=%0t A=%b B=%b Y=%b", $time, a, b, y);

        a = 0; b = 0; #10;
        a = 0; b = 1; #10;
        a = 1; b = 0; #10;
        a = 1; b = 1; #10;
        #10;
        $finish;
    end
endmodule
