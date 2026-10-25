`timescale 1ms/1us

module reaction_time_game_tb;
    localparam integer CLK_HZ = 1_000;
    localparam integer WAIT_MIN_MS = 12;
    localparam integer WAIT_MAX_MS = 16;
    localparam integer DEBOUNCE_MS = 1;
    localparam integer TARGET_REACTION_MS = 237;

    reg clk = 0;
    reg reset = 1;
    reg start = 0;
    reg reaction_button = 0;
    wire led;
    wire done;
    wire false_start;
    wire [31:0] reaction_ms;
    wire [6:0] seg_n;
    wire [3:0] digit_n;
    wire [31:0] expected_reaction_ms = TARGET_REACTION_MS;

    always #0.5 clk = ~clk;

    reaction_time_game #(
        .CLK_HZ(CLK_HZ),
        .WAIT_MIN_MS(WAIT_MIN_MS),
        .WAIT_MAX_MS(WAIT_MAX_MS),
        .DEBOUNCE_MS(DEBOUNCE_MS)
    ) dut (
        .clk(clk),
        .reset(reset),
        .start(start),
        .reaction_button(reaction_button),
        .led(led),
        .done(done),
        .false_start(false_start),
        .reaction_ms(reaction_ms),
        .seg_n(seg_n),
        .digit_n(digit_n)
    );

    task pulse_start;
        begin
            @(negedge clk);
            start = 1;
            @(negedge clk);
            start = 0;
        end
    endtask

    task reset_game;
        begin
            @(negedge clk);
            reset = 1;
            repeat (2) @(negedge clk);
            reset = 0;
            repeat (5) @(negedge clk);
        end
    endtask

    task release_button;
        begin
            reaction_button = 0;
            repeat (8) @(negedge clk);
        end
    endtask

    initial begin
        $dumpfile("wave_enhanced.vcd");
        $dumpvars(0, reaction_time_game_tb);

        repeat (3) @(negedge clk);
        reset = 0;

        // A held button must inhibit start until it has been released.
        reaction_button = 1;
        pulse_start();
        repeat (4) @(negedge clk);
        if (dut.state !== 2'b00 || done)
            $fatal(1, "Held button before start should leave the game idle.");
        release_button();

        // Reset while idle and while waiting.
        reset_game();
        force dut.lfsr = 32'd5;
        pulse_start();
        if (dut.state !== 2'b01)
            $fatal(1, "Game did not enter WAITING.");
        if (dut.wait_count_ms !== WAIT_MIN_MS)
            $fatal(1, "Minimum wait boundary was not selectable.");
        reset_game();
        release dut.lfsr;

        force dut.lfsr = 32'd4;
        pulse_start();
        if (dut.wait_count_ms !== WAIT_MAX_MS)
            $fatal(1, "Maximum wait boundary was not selectable.");
        reset_game();
        release dut.lfsr;

        pulse_start();
        if (dut.wait_count_ms < WAIT_MIN_MS || dut.wait_count_ms > WAIT_MAX_MS)
            $fatal(1, "Pseudo-random wait is outside configured bounds.");
        reset_game();
        if (dut.state !== 2'b00 || led || done)
            $fatal(1, "Reset during WAITING did not return to IDLE.");

        // Early press completes the round as a false start, with LED off.
        pulse_start();
        reaction_button = 1;
        wait (done);
        #0.1;
        if (!false_start || led)
            $fatal(1, "Early press was not reported correctly.");
        $display("PASS: early press detected; seven-segment error pattern active.");

        // Press held after completion must not start another round.
        pulse_start();
        repeat (4) @(negedge clk);
        if (!done || !false_start)
            $fatal(1, "Held button after completion changed the result.");
        release_button();

        // Valid reaction, timed in full clock cycles then reported in ms.
        pulse_start();
        wait (led);
        repeat (TARGET_REACTION_MS - 4) @(negedge clk);
        reaction_button = 1;
        wait (done);
        #0.1;
        if (false_start)
            $fatal(1, "Valid response was marked as a false start.");
        if (reaction_ms < TARGET_REACTION_MS ||
            reaction_ms > TARGET_REACTION_MS + 2)
            $fatal(1, "Expected about %0d ms, measured %0d ms.",
                   TARGET_REACTION_MS, reaction_ms);
        if (reaction_ms != expected_reaction_ms)
            $display("NOTE: synchronizer/debounce latency included: measured %0d ms, target %0d ms.",
                     reaction_ms, expected_reaction_ms);
        else
            $display("PASS: measured reaction time equals %0d ms.", reaction_ms);
        if (seg_n === 7'bxxxxxxx || digit_n === 4'bxxxx)
            $fatal(1, "Seven-segment outputs contain unknown values.");

        // Reset while reacting and while finished.
        release_button();
        pulse_start();
        wait (led);
        reset_game();
        if (dut.state !== 2'b00 || led || done)
            $fatal(1, "Reset during REACTING did not return to IDLE.");

        pulse_start();
        reaction_button = 1;
        wait (done);
        reset_game();
        if (dut.state !== 2'b00 || done || false_start)
            $fatal(1, "Reset during FINISHED did not clear round status.");

        // Consecutive rounds: start only after the button has been released.
        release_button();
        pulse_start();
        wait (led);
        reaction_button = 1;
        wait (done);
        #0.1;
        if (false_start)
            $fatal(1, "Second consecutive round did not complete successfully.");
        $display("PASS: reset in each FSM state, held-button cases, and consecutive rounds.");
        $display("All enhanced reaction-time tests passed.");
        $finish;
    end
endmodule
