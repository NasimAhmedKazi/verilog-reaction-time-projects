`timescale 1ms/1us

module reaction_time_game_tb;
    localparam integer EXPECTED_REACTION_MS = 237;

    reg clk = 0;
    reg reset = 1;
    reg start = 0;
    reg reaction_button = 0;
    wire led;
    wire done;
    wire false_start;
    wire [31:0] reaction_ms;
    reg [31:0] expected_reaction_ms = EXPECTED_REACTION_MS;
    wire [1:0] state;
    wire [31:0] cycle_count;
    wire [31:0] wait_count;
    wire [31:0] lfsr;

    always #0.5 clk = ~clk;

    reaction_time_game #(
        .CLK_HZ(1_000),
        .WAIT_MIN_MS(8),
        .WAIT_MAX_MS(12)
    ) dut (
        .clk(clk),
        .reset(reset),
        .start(start),
        .reaction_button(reaction_button),
        .led(led),
        .done(done),
        .false_start(false_start),
        .reaction_ms(reaction_ms)
    );

    assign state = dut.state;
    assign cycle_count = dut.cycle_count;
    assign wait_count = dut.wait_count;
    assign lfsr = dut.lfsr;

    initial begin
        $dumpfile("wave.vcd");
        $dumpvars(0, reaction_time_game_tb);

        repeat (3) @(negedge clk);
        reset = 0;
        @(negedge clk);
        start = 1;
        @(negedge clk);
        start = 0;

        wait (led);
        repeat (EXPECTED_REACTION_MS) @(posedge clk);
        #0.01;
        reaction_button = 1;
        wait (done);
        #0.01;
        if (false_start) $fatal(1, "Valid reaction was incorrectly marked as an early press.");
        if (reaction_ms !== EXPECTED_REACTION_MS)
            $fatal(1, "Expected %0d ms, measured %0d ms.", EXPECTED_REACTION_MS, reaction_ms);
        $display("PASS: reaction time measured as %0d ms.", reaction_ms);

        @(negedge clk);
        reaction_button = 0;
        repeat (2) @(negedge clk);
        start = 1;
        @(negedge clk);
        start = 0;
        @(negedge clk);
        reaction_button = 1;
        wait (done);
        #1;
        if (!false_start) $fatal(1, "Early button press was not detected.");
        if (led) $fatal(1, "LED should remain off after an early press.");
        $display("PASS: early press detected before the LED.");

        @(negedge clk);
        reaction_button = 0;
        $display("All reaction-time tests passed.");
        $finish;
    end
endmodule
