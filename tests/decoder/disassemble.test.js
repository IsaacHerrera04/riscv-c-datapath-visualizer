import { test } from "node:test";
import assert from "node:assert/strict";

import { decode, disassemble } from "../../src/decoder/index.js";
import { assemble } from "../../src/assembler/index.js";
import { HARDWARE_PROGRAM, ALL_MNEMONICS, wordOf } from "../fixtures/vectors.js";

test("canonical text: one example per format", () => {
  assert.equal(disassemble(decode(0x41498AB3)), "sub x21, x19, x20");
  assert.equal(disassemble(decode(0xFFF00B93)), "addi x23, x0, -1");
  assert.equal(disassemble(decode(0x40485793)), "srai x15, x16, 4");
  assert.equal(disassemble(decode(0x01075683)), "lhu x13, 16(x14)");  // written as 0x10(x14)
  assert.equal(disassemble(decode(0x00502023)), "sw x5, 0(x0)");
  assert.equal(disassemble(decode(0xFE0C9EE3)), "bne x25, x0, -4");
});

test("ABI names and hex immediates come back in canonical form", () => {
  const [{ word }] = assemble("ori t0, s1, 0x7FF").program;
  assert.equal(disassemble(decode(word)), "ori x5, x9, 2047");
});

test("a failed decoding disassembles to null", () => {
  assert.equal(disassemble(decode(0x00000000)), null);
  assert.equal(disassemble(undefined), null);
});

// ---------- Round trip: assembler and decoder check each other ----------
// text → assemble → word → decode → disassemble → text → assemble → the same word

for (const [line, hex] of [...HARDWARE_PROGRAM, ...ALL_MNEMONICS]) {
  test(`round trip: ${line}`, () => {
    const [{ word }] = assemble(line).program;
    assert.equal(word, wordOf(hex));

    const text = disassemble(decode(word));
    const again = assemble(text);
    assert.deepEqual(again.errors, [], text);
    assert.equal(again.program[0].word, word, text);
  });
}
