`timescale 1ns/1ps

module seven_segment_display #(
    parameter integer CLK_HZ = 50_000_000
) (
    input  wire        clk,
    input  wire        reset,
    input  wire [13:0] value,
    input  wire        error,
    output reg  [6:0]  seg_n,
    output reg  [3:0]  digit_n
);
    localparam integer RAW_SCAN_DIV = CLK_HZ / 4_000;
    localparam integer SCAN_DIV = (RAW_SCAN_DIV < 1) ? 1 : RAW_SCAN_DIV;
    localparam integer SCAN_WIDTH = (SCAN_DIV < 2) ? 1 : $clog2(SCAN_DIV);

    reg [SCAN_WIDTH-1:0] scan_count;
    reg [1:0] digit_index;
    reg [3:0] digit_value;

    function [6:0] decode_digit;
        input [3:0] digit;
        begin
            case (digit)
                4'd0: decode_digit = 7'b0000001;
                4'd1: decode_digit = 7'b1001111;
                4'd2: decode_digit = 7'b0010010;
                4'd3: decode_digit = 7'b0000110;
                4'd4: decode_digit = 7'b1001100;
                4'd5: decode_digit = 7'b0100100;
                4'd6: decode_digit = 7'b0100000;
                4'd7: decode_digit = 7'b0001111;
                4'd8: decode_digit = 7'b0000000;
                4'd9: decode_digit = 7'b0000100;
                default: decode_digit = 7'b1111111;
            endcase
        end
    endfunction

    always @(posedge clk) begin
        if (reset) begin
            scan_count <= 0;
            digit_index <= 0;
        end else if (scan_count == SCAN_DIV - 1) begin
            scan_count <= 0;
            digit_index <= digit_index + 1'b1;
        end else begin
            scan_count <= scan_count + 1'b1;
        end
    end

    always @* begin
        digit_n = 4'b1111;
        case (digit_index)
            2'd0: begin
                digit_n = 4'b1110;
                digit_value = (value / 1_000) % 10;
            end
            2'd1: begin
                digit_n = 4'b1101;
                digit_value = (value / 100) % 10;
            end
            2'd2: begin
                digit_n = 4'b1011;
                digit_value = (value / 10) % 10;
            end
            default: begin
                digit_n = 4'b0111;
                digit_value = value % 10;
            end
        endcase

        if (error)
            seg_n = 7'b1111110;
        else
            seg_n = decode_digit(digit_value);
    end
endmodule
