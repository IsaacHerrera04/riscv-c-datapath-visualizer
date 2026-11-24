import { test } from "node:test";
import assert from "node:assert/strict";

import { decode } from "../../src/decoder/index.js";
import { parseLine, parseOperands } from "../../src/assembler/parser.js";
import { INSTRUCTIONS } from "../../src/shared/instructions.js";
import { HARDWARE_PROGRAM, ALL_MNEMONICS, wordOf } from "../fixtures/vectors.js";

// Fields read from the TEXT of an instruction by the assembler's parser
// (which never sees bits): an independent check of what decode reads from the bits.
function fieldsFromText(line) {
  const { mnemonic, operands } = parseLine(line);
  const { instruction, rd, rs1, rs2, imm } = parseOperands(mnemonic, operands);
  return { name: instruction.name, type: instruction.type, rd, rs1, rs2, imm };
}

const pick = ({ name, type, rd, rs1, rs2, imm }) => ({ name, type, rd, rs1, rs2, imm });

for (const [line, hex] of [...HARDWARE_PROGRAM, ...ALL_MNEMONICS]) {
  test(`decodes ${hex} → ${line}`, () => {
    const decoded = decode(wordOf(hex));
    assert.equal(decoded.error, undefined);
    assert.deepEqual(pick(decoded), fieldsFromText(line));
  });
}

test("every one of the 33 instructions is decoded at least once", () => {
  const names = new Set(ALL_MNEMONICS.map(([, hex]) => decode(wordOf(hex)).name));
  assert.equal(names.size, INSTRUCTIONS.length);
});

test("addi x23, x0, -1 (0xFFF00B93): don't-care funct7 and sign extension", () => {
  const decoded = decode(0xFFF00B93);
  assert.equal(decoded.name, "addi");
  assert.equal(decoded.rd, 23);
  assert.equal(decoded.imm, -1);
  assert.equal(decoded.funct7, 0b1111111); // the raw bits 31..25, part of the immediate here
});

test("srli and srai are told apart by funct7", () => {
  assert.equal(decode(0x01F75693).name, "srli"); // srli x13, x14, 31
  assert.equal(decode(0x40485793).name, "srai"); // srai x15, x16, 4
  assert.equal(decode(0x40485793).imm, 4);
});

test("full result for sw x5, 0(x0) = 0x00502023 (DESIGN.md example)", () => {
  const { segments, ...fields } = decode(0x00502023);
  assert.deepEqual(fields, {
    name: "sw", type: "S", opcode: 0b0100011, funct3: 0b010, funct7: 0,
    rd: null, rs1: 0, rs2: 5, imm: 0,
  });
  assert.equal(segments.length, 6);
});

test("unused register fields are null; R type has no immediate", () => {
  const r = decode(0x007302B3); // add x5, x6, x7
  assert.equal(r.imm, null);
  const b = decode(0xFE0C9EE3); // bne x25, x0, -4
  assert.equal(b.rd, null);
  const i = decode(0xFD630293); // addi x5, x6, -42
  assert.equal(i.rs2, null);
});

test("words that are not one of the 33 instructions give an error", () => {
  const cases = {
    0x00000000: "all zeros (opcode 0000000)",
    0x0000006F: "jal x0, 0 (type J, not in our hardware)",
    0x02B50533: "mul x10, x10, x11 (R type with funct7 0000001, M extension)",
    0x40031293: "slli with funct7 0100000",
    0x00002063: "branch with unused funct3 010",
    0x00003003: "load with unused funct3 011 (ld is RV64)",
  };
  for (const [word, why] of Object.entries(cases)) {
    const hex = "0x" + Number(word).toString(16).toUpperCase().padStart(8, "0");
    assert.deepEqual(decode(Number(word)), { error: `Unknown instruction ${hex}` }, why);
  }
});

test("inputs that are not unsigned 32-bit numbers give an error", () => {
  for (const input of [-1, 2 ** 32, 1.5, NaN, "0x00502023", null, undefined]) {
    assert.match(decode(input).error, /^Invalid word .* \(expected an unsigned 32-bit number\)$/);
  }
});
