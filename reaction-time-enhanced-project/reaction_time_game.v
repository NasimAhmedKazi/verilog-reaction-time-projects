`timescale 1ns/1ps

module reaction_time_game #(
    parameter integer CLK_HZ = 50_000_000,
    parameter integer WAIT_MIN_MS = 1_000,
    parameter integer WAIT_MAX_MS = 4_000,
    parameter integer DEBOUNCE_MS = 10
) (
    input  wire        clk,
    input  wire        reset,
    input  wire        start,
    input  wire        reaction_button,
    output reg         led,
    output reg         done,
    output reg         false_start,
    output reg  [31:0] reaction_ms,
    output wire [6:0]  seg_n,
    output wire [3:0]  digit_n
);
    localparam integer CYCLES_PER_MS =
        (CLK_HZ < 1_000) ? 1 : CLK_HZ / 1_000;
    localparam integer WAIT_RANGE = WAIT_MAX_MS - WAIT_MIN_MS + 1;
    localparam [31:0] LFSR_SEED = 32'h1ACE_B00C;
    localparam [1:0] IDLE = 2'd0;
    localparam [1:0] WAITING = 2'd1;
    localparam [1:0] REACTING = 2'd2;
    localparam [1:0] FINISHED = 2'd3;

    reg [1:0] state;
    reg [31:0] cycle_count;
    reg [31:0] wait_count_ms;
    reg [31:0] reaction_cycles;
    reg [31:0] lfsr;
    reg [1:0] next_state;
    wire button_clean;
    wire button_ready;
    wire millisecond_tick = (cycle_count == CYCLES_PER_MS - 1);
    wire [31:0] measured_cycles = reaction_cycles + 1'b1;
    wire start_accepted = (state == IDLE) && start && button_ready && !button_clean;
    reg [13:0] display_value;
    wire display_error = false_start;

    button_conditioner #(
        .CLK_HZ(CLK_HZ),
        .DEBOUNCE_MS(DEBOUNCE_MS)
    ) button_input (
        .clk(clk),
        .reset(reset),
        .button_async(reaction_button),
        .button_clean(button_clean),
        .button_ready(button_ready)
    );

    always @* begin
        next_state = state;
        case (state)
            IDLE: begin
                if (start_accepted)
                    next_state = WAITING;
            end
            WAITING: begin
                if (button_clean)
                    next_state = FINISHED;
                else if (millisecond_tick && wait_count_ms <= 1)
                    next_state = REACTING;
            end
            REACTING: begin
                if (button_clean)
                    next_state = FINISHED;
            end
            FINISHED: begin
                if (!start && !button_clean)
                    next_state = IDLE;
            end
            default: next_state = IDLE;
        endcase
    end

    always @(posedge clk) begin
        if (reset) begin
            state <= IDLE;
            cycle_count <= 0;
            wait_count_ms <= 0;
            reaction_cycles <= 0;
            lfsr <= LFSR_SEED;
            led <= 1'b0;
            done <= 1'b0;
            false_start <= 1'b0;
            reaction_ms <= 0;
        end else begin
            state <= next_state;

            if (start_accepted || millisecond_tick)
                cycle_count <= 0;
            else
                cycle_count <= cycle_count + 1'b1;

            if (lfsr == 0)
                lfsr <= LFSR_SEED;
            else
                lfsr <= {lfsr[30:0], lfsr[31] ^ lfsr[21] ^ lfsr[1] ^ lfsr[0]};

            if (start_accepted) begin
                wait_count_ms <= WAIT_MIN_MS + (lfsr % WAIT_RANGE);
                reaction_cycles <= 0;
                reaction_ms <= 0;
                done <= 1'b0;
                false_start <= 1'b0;
                led <= 1'b0;
            end else begin
                case (state)
                    IDLE: begin
                        led <= 1'b0;
                    end
                    WAITING: begin
                        if (button_clean) begin
                            done <= 1'b1;
                            false_start <= 1'b1;
                            led <= 1'b0;
                        end else if (millisecond_tick) begin
                            if (wait_count_ms > 0)
                                wait_count_ms <= wait_count_ms - 1'b1;
                            if (wait_count_ms <= 1)
                                led <= 1'b1;
                        end
                    end
                    REACTING: begin
                        if (button_clean) begin
                            done <= 1'b1;
                            led <= 1'b0;
                            reaction_ms <= measured_cycles / CYCLES_PER_MS;
                        end else begin
                            reaction_cycles <= reaction_cycles + 1'b1;
                        end
                    end
                    FINISHED: begin
                        led <= 1'b0;
                    end
                    default: begin
                        led <= 1'b0;
                        done <= 1'b0;
                        false_start <= 1'b0;
                    end
                endcase
            end
        end
    end

    always @* begin
        if (false_start) begin
            display_value = 14'h3FFF;
        end else if (!done && reaction_ms == 0) begin
            display_value = 0;
        end else if (reaction_ms > 9_999) begin
            display_value = 9_999;
        end else begin
            display_value = reaction_ms[13:0];
        end
    end

    seven_segment_display #(
        .CLK_HZ(CLK_HZ)
    ) result_display (
        .clk(clk),
        .reset(reset),
        .value(display_value),
        .error(display_error),
        .seg_n(seg_n),
        .digit_n(digit_n)
    );
endmodule
