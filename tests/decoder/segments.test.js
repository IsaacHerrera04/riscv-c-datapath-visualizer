import { test } from "node:test";
import assert from "node:assert/strict";

import { decode } from "../../src/decoder/index.js";
import { HARDWARE_PROGRAM, ALL_MNEMONICS, wordOf } from "../fixtures/vectors.js";

const fieldsOf = (word) => decode(word).segments.map((s) => s.field);

test("segments concatenate back to the 32-bit binary of the word", () => {
  for (const [line, hex] of [...HARDWARE_PROGRAM, ...ALL_MNEMONICS]) {
    const word = wordOf(hex);
    const joined = decode(word).segments.map((s) => s.bits).join("");
    assert.equal(joined, word.toString(2).padStart(32, "0"), line);
  }
});

test("each segment's value matches its bits", () => {
  for (const [line, hex] of ALL_MNEMONICS) {
    for (const { bits, value } of decode(wordOf(hex)).segments) {
      assert.equal(parseInt(bits, 2), value, line);
    }
  }
});

test("sw x5, 0(x0): S layout with field values", () => {
  assert.deepEqual(decode(0x00502023).segments, [
    { field: "imm[11:5]", bits: "0000000", value: 0 },
    { field: "rs2", bits: "00101", value: 5 },
    { field: "rs1", bits: "00000", value: 0 },
    { field: "funct3", bits: "010", value: 2 },
    { field: "imm[4:0]", bits: "00000", value: 0 },
    { field: "opcode", bits: "0100011", value: 0b0100011 },
  ]);
});

test("layout per format (most significant field first)", () => {
  assert.deepEqual(fieldsOf(0x007302B3), ["funct7", "rs2", "rs1", "funct3", "rd", "opcode"]);         // add
  assert.deepEqual(fieldsOf(0xFD630293), ["imm[11:0]", "rs1", "funct3", "rd", "opcode"]);             // addi
  assert.deepEqual(fieldsOf(0x40485793), ["funct7", "shamt", "rs1", "funct3", "rd", "opcode"]);       // srai
  assert.deepEqual(fieldsOf(0x7FF52483), ["imm[11:0]", "rs1", "funct3", "rd", "opcode"]);             // lw
  assert.deepEqual(fieldsOf(0xFE0C9EE3), ["imm[12|10:5]", "rs2", "rs1", "funct3", "imm[4:1|11]", "opcode"]); // bne
});
