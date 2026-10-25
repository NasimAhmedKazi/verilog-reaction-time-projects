`timescale 1ns/1ps

module reaction_time_game #(
    parameter integer CLK_HZ = 50_000_000,
    parameter integer WAIT_MIN_MS = 1_000,
    parameter integer WAIT_MAX_MS = 4_000
) (
    input  wire        clk,
    input  wire        reset,
    input  wire        start,
    input  wire        reaction_button,
    output reg         led,
    output reg         done,
    output reg         false_start,
    output reg  [31:0] reaction_ms
);
    localparam integer CYCLES_PER_MS = (CLK_HZ >= 1_000) ? (CLK_HZ / 1_000) : 1;
    localparam [1:0] IDLE = 2'd0, WAITING = 2'd1, REACTING = 2'd2, FINISHED = 2'd3;
    localparam integer WAIT_RANGE = WAIT_MAX_MS - WAIT_MIN_MS + 1;

    reg [1:0] state;
    reg [31:0] cycle_count;
    reg [31:0] wait_count;
    reg [31:0] lfsr;

    wire millisecond_tick = cycle_count == CYCLES_PER_MS - 1;

    always @(posedge clk) begin
        if (reset) begin
            cycle_count <= 0;
            lfsr <= 32'h1ACE_B00C;
        end else begin
            if (millisecond_tick) begin
                cycle_count <= 0;
            end else begin
                cycle_count <= cycle_count + 1'b1;
            end
            lfsr <= {lfsr[30:0], lfsr[31] ^ lfsr[21] ^ lfsr[1] ^ lfsr[0]};
        end
    end

    always @(posedge clk) begin
        if (reset) begin
            state <= IDLE;
            wait_count <= 0;
            led <= 0;
            done <= 0;
            false_start <= 0;
            reaction_ms <= 0;
        end else begin
            case (state)
                IDLE: begin
                    led <= 0;
                    if (start) begin
                        wait_count <= WAIT_MIN_MS + (lfsr % WAIT_RANGE);
                        reaction_ms <= 0;
                        done <= 0;
                        false_start <= 0;
                        state <= WAITING;
                    end
                end

                WAITING: begin
                    if (reaction_button) begin
                        led <= 0;
                        done <= 1;
                        false_start <= 1;
                        state <= FINISHED;
                    end else if (millisecond_tick) begin
                        if (wait_count <= 1) begin
                            wait_count <= 0;
                            reaction_ms <= 0;
                            led <= 1;
                            state <= REACTING;
                        end else begin
                            wait_count <= wait_count - 1'b1;
                        end
                    end
                end

                REACTING: begin
                    if (reaction_button) begin
                        led <= 0;
                        done <= 1;
                        state <= FINISHED;
                    end else if (millisecond_tick) begin
                        reaction_ms <= reaction_ms + 1'b1;
                    end
                end

                FINISHED: begin
                    if (!start) state <= IDLE;
                end

                default: state <= IDLE;
            endcase
        end
    end
endmodule
