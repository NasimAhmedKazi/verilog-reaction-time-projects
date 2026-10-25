`timescale 1ns/1ps

module mux4to1 (
    input  wire [3:0] data_in,
    input  wire [1:0] select,
    output wire       data_out
);
    wire not_s1;
    wire not_s0;
    wire term0;
    wire term1;
    wire term2;
    wire term3;

    not inv_s1 (not_s1, select[1]);
    not inv_s0 (not_s0, select[0]);

    and and_d0 (term0, data_in[0], not_s1, not_s0);
    and and_d1 (term1, data_in[1], not_s1, select[0]);
    and and_d2 (term2, data_in[2], select[1], not_s0);
    and and_d3 (term3, data_in[3], select[1], select[0]);

    or or_output (data_out, term0, term1, term2, term3);
endmodule
