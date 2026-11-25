import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assemble } from "../../src/assembler/index.js";
import { run, readWord } from "./rv32i-sim.js";

// The simulator is test equipment: check it first on programs whose results we know.

function runAsm(text) {
  const { program, errors } = assemble(text);
  assert.deepEqual(errors, []);
  return run(program.map((instruction) => instruction.word));
}

test("the hardware test program ends with the expected registers", () => {
  // Traced by hand from scripts/demo/hardware-test.s (the VHDL test program).
  const { registers, halted } = runAsm(readFileSync("scripts/demo/hardware-test.s", "utf8"));
  assert.ok(halted);
  assert.equal(registers[19], 8);
  assert.equal(registers[20], 3);
  assert.equal(registers[21], 5);   // bne taken → skips add; sub x21 = 8 - 3
  assert.equal(registers[22], 1);   // blt taken → skips 99; bge not taken → 1
  assert.equal(registers[23], -1);
  assert.equal(registers[24], 0);   // the three branches around "addi x24, x0, 99" are taken
  assert.equal(registers[25], 0);   // countdown loop 3 → 0
});

test("stores and loads go through little-endian data memory", () => {
  const { memory, registers } = runAsm(`
    addi x5, x0, -2
    sw   x5, 8(x0)
    lw   x6, 8(x0)
    lbu  x7, 8(x0)
    lb   x10, 8(x0)
    lhu  x11, 8(x0)
    halt: beq x0, x0, halt
  `);
  assert.equal(readWord(memory, 8), -2);
  assert.equal(registers[6], -2);
  assert.equal(registers[7], 0xFE);     // lowest byte, zero-extended
  assert.equal(registers[10], -2);      // lowest byte, sign-extended
  assert.equal(registers[11], 0xFFFE);  // lowest half, zero-extended
});

test("x0 stays 0 and unsigned comparisons see -1 as the largest number", () => {
  const { registers } = runAsm(`
    addi x0, x0, 5
    addi x5, x0, -1
    sltu x6, x0, x5
    slt  x7, x5, x0
    halt: beq x0, x0, halt
  `);
  assert.equal(registers[0], 0);
  assert.equal(registers[6], 1); // 0 < 0xFFFFFFFF unsigned
  assert.equal(registers[7], 1); // -1 < 0 signed
});

test("a program without halt stops at the step limit", () => {
  // An endless loop that is not the halt instruction: it jumps back 4 bytes, not to itself.
  const { program } = assemble("loop: addi x5, x5, 1\nbeq x0, x0, loop");
  const result = run(program.map((instruction) => instruction.word), { maxSteps: 50 });
  assert.equal(result.halted, false);
  assert.equal(result.steps, 50);
});

test("misaligned accesses are reported as bugs", () => {
  assert.throws(() => runAsm("lw x5, 2(x0)\nhalt: beq x0, x0, halt"), /misaligned 4-byte access at 2/);
});
