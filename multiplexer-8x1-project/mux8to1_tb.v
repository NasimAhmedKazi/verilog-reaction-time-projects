`timescale 1ns/1ps

module mux8to1_tb;
    reg [7:0] data_in;
    reg [2:0] select;
    wire data_out;
    integer i;

    mux8to1 uut (
        .data_in(data_in),
        .select(select),
        .data_out(data_out)
    );

    initial begin
        $dumpfile("wave_8x1.vcd");
        $dumpvars(0, mux8to1_tb);

        data_in = 8'b10110100;
        for (i = 0; i < 8; i = i + 1) begin
            select = i;
            #10;
            if (data_out !== data_in[i])
                $fatal(1, "select=%b: expected D%0d=%b, got %b",
                       select, i, data_in[i], data_out);
            $display("PASS: select=%b, output=%b", select, data_out);
        end

        $display("All 8:1 multiplexer tests passed.");
        $finish;
    end
endmodule
