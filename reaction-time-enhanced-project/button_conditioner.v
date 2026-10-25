`timescale 1ns/1ps

module button_conditioner #(
    parameter integer CLK_HZ = 50_000_000,
    parameter integer DEBOUNCE_MS = 10
) (
    input  wire clk,
    input  wire reset,
    input  wire button_async,
    output reg  button_clean,
    output reg  button_ready
);
    localparam integer RAW_DEBOUNCE_CYCLES =
        (CLK_HZ / 1_000) * DEBOUNCE_MS;
    localparam integer DEBOUNCE_CYCLES =
        (RAW_DEBOUNCE_CYCLES < 1) ? 1 : RAW_DEBOUNCE_CYCLES;
    localparam integer COUNTER_WIDTH =
        (DEBOUNCE_CYCLES < 2) ? 1 : $clog2(DEBOUNCE_CYCLES + 1);

    reg button_meta;
    reg button_sync;
    reg button_candidate;
    reg [1:0] sync_warmup_count;
    reg [COUNTER_WIDTH-1:0] stable_count;

    always @(posedge clk) begin
        if (reset) begin
            button_meta <= 1'b0;
            button_sync <= 1'b0;
            button_candidate <= 1'b0;
            sync_warmup_count <= 0;
            button_clean <= 1'b0;
            button_ready <= 1'b0;
            stable_count <= 0;
        end else begin
            button_meta <= button_async;
            button_sync <= button_meta;

            if (sync_warmup_count < 2) begin
                sync_warmup_count <= sync_warmup_count + 1'b1;
            end else if (button_sync != button_candidate) begin
                button_candidate <= button_sync;
                stable_count <= 0;
            end else if (stable_count == DEBOUNCE_CYCLES - 1) begin
                button_clean <= button_candidate;
                button_ready <= 1'b1;
                stable_count <= 0;
            end else begin
                stable_count <= stable_count + 1'b1;
            end
        end
    end
endmodule
