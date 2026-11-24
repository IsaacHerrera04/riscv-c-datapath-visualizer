import { test } from "node:test";
import assert from "node:assert/strict";

import { assemble } from "../../src/assembler/index.js";
import { encode } from "../../src/assembler/encoder.js";
import { findByName, INSTRUCTIONS } from "../../src/shared/instructions.js";
import { HARDWARE_PROGRAM, ALL_MNEMONICS } from "../fixtures/vectors.js";

const hex = (word) => "0x" + word.toString(16).toUpperCase().padStart(8, "0");

// Assembles a whole program and returns its words as hex strings.
function hexWords(text) {
  const { program, errors } = assemble(text);
  assert.deepEqual(errors, []);
  return program.map((ins) => hex(ins.word));
}

// ---------- Hardware test program (MEMORIA_PROGRAMA.vhd) ----------

test("hardware test program assembles to the VHDL hex (numeric offsets)", () => {
  const text = HARDWARE_PROGRAM.map(([line]) => line).join("\n");
  assert.deepEqual(hexWords(text), HARDWARE_PROGRAM.map(([, expected]) => expected));
});

test("the same program written with labels gives the same words", () => {
  const withLabels = [
    "      addi x19, x0, 8",
    "      addi x20, x0, 3",
    "      bne  x20, x19, L1",   // 8 → 20
    "      add  x21, x20, x19",
    "stop: beq  x0, x0, stop",
    "L1:   sub  x21, x19, x20",
    "      blt  x20, x19, L2",   // 24 → 32
    "      addi x22, x0, 99",
    "L2:   bge  x20, x19, L3",   // 32 → 40
    "      addi x22, x0, 1",
    "L3:   addi x23, x0, -1",
    "      bltu x19, x23, L4",   // 44 → 52
    "      addi x24, x0, 99",
    "L4:   blt  x23, x19, L5",   // 52 → 60
    "      addi x24, x0, 99",
    "L5:   bgeu x23, x19, L6",   // 60 → 68
    "      addi x24, x0, 99",
    "L6:   addi x25, x0, 3",
    "loop: addi x25, x25, -1",
    "      bne  x25, x0, loop",  // 76 → 72
    "halt: beq  x0, x0, halt",
  ].join("\n");
  assert.deepEqual(hexWords(withLabels), HARDWARE_PROGRAM.map(([, expected]) => expected));
});

// ---------- One vector per mnemonic (all 33) ----------

test("the vector list covers all 33 mnemonics", () => {
  const covered = new Set(ALL_MNEMONICS.map(([line]) => line.split(" ")[0]));
  assert.deepEqual([...covered].sort(), INSTRUCTIONS.map((ins) => ins.name).sort());
});

for (const [line, expected] of ALL_MNEMONICS) {
  test(`encodes ${line} → ${expected}`, () => {
    assert.deepEqual(hexWords(line), [expected]);
  });
}

test("sw x5, 0(x0) → 0x00502023 (DESIGN.md example)", () => {
  assert.deepEqual(hexWords("sw x5, 0(x0)"), ["0x00502023"]);
});

// ---------- Properties ----------

test("ABI names produce the same word as xN names", () => {
  assert.deepEqual(hexWords("add t0, t1, t2"), hexWords("add x5, x6, x7"));
  assert.deepEqual(hexWords("sw s1, -2048(a0)"), hexWords("sw x9, -2048(x10)"));
  assert.deepEqual(hexWords("bne zero, sp, -4"), hexWords("bne x0, x2, -4"));
});

test("words are always unsigned 32-bit numbers, even with bit 31 set", () => {
  const word = encode({ instruction: findByName("addi"), rd: 23, rs1: 0, rs2: null, imm: -1 });
  assert.equal(word, 0xFFF00B93);
  assert.ok(word > 0 && word <= 0xFFFFFFFF);
});
