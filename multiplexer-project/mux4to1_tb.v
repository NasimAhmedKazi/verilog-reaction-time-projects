`timescale 1ns/1ps

module mux4to1_tb;
    reg [3:0] data_in;
    reg [1:0] select;
    wire data_out;

    mux4to1 uut (
        .data_in(data_in),
        .select(select),
        .data_out(data_out)
    );

    initial begin
        $dumpfile("wave.vcd");
        $dumpvars(0, mux4to1_tb);

        data_in = 4'b1010;
        select = 2'b00;
        #10;
        if (data_out !== 1'b0) $fatal(1, "select=00: expected D0=0, got %b", data_out);
        $display("PASS: select=%b, output=%b", select, data_out);

        select = 2'b01;
        #10;
        if (data_out !== 1'b1) $fatal(1, "select=01: expected D1=1, got %b", data_out);
        $display("PASS: select=%b, output=%b", select, data_out);

        select = 2'b10;
        #10;
        if (data_out !== 1'b0) $fatal(1, "select=10: expected D2=0, got %b", data_out);
        $display("PASS: select=%b, output=%b", select, data_out);

        select = 2'b11;
        #10;
        if (data_out !== 1'b1) $fatal(1, "select=11: expected D3=1, got %b", data_out);
        $display("PASS: select=%b, output=%b", select, data_out);

        $display("All 4:1 multiplexer tests passed.");
        $finish;
    end
endmodule
