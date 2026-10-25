`timescale 1ns/1ps

module mux8to1 (
    input  wire [7:0] data_in,
    input  wire [2:0] select,
    output wire       data_out
);
    wire not_s2;
    wire not_s1;
    wire not_s0;
    wire [7:0] term;

    not inv_s2 (not_s2, select[2]);
    not inv_s1 (not_s1, select[1]);
    not inv_s0 (not_s0, select[0]);

    and and_d0 (term[0], data_in[0], not_s2, not_s1, not_s0);
    and and_d1 (term[1], data_in[1], not_s2, not_s1, select[0]);
    and and_d2 (term[2], data_in[2], not_s2, select[1], not_s0);
    and and_d3 (term[3], data_in[3], not_s2, select[1], select[0]);
    and and_d4 (term[4], data_in[4], select[2], not_s1, not_s0);
    and and_d5 (term[5], data_in[5], select[2], not_s1, select[0]);
    and and_d6 (term[6], data_in[6], select[2], select[1], not_s0);
    and and_d7 (term[7], data_in[7], select[2], select[1], select[0]);

    or or_output (data_out, term[0], term[1], term[2], term[3],
                           term[4], term[5], term[6], term[7]);
endmodule
