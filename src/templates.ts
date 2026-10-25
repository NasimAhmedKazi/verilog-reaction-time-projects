export const moduleTemplate = `\`timescale 1ns/1ps

module my_module (
    input  wire a,
    input  wire b,
    output wire y
);
    assign y = a & b;
endmodule
`;

export const testbenchTemplate = `\`timescale 1ns/1ps

module my_module_tb;
    reg a, b;
    wire y;

    my_module uut (.a(a), .b(b), .y(y));

    initial begin
        $dumpfile("wave.vcd");
        $dumpvars(0, my_module_tb);
        $monitor("t=%0t a=%b b=%b y=%b", $time, a, b, y);

        a = 0; b = 0; #10;
        a = 0; b = 1; #10;
        a = 1; b = 0; #10;
        a = 1; b = 1; #10;
        $finish;
    end
endmodule
`;
