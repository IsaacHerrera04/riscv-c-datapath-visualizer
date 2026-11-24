import { test } from "node:test";
import assert from "node:assert/strict";

import { bits, extractFields, signExtend, immediateOf } from "../../src/decoder/fields.js";
import { findByName } from "../../src/shared/instructions.js";

test("bits takes word[high:low] as an unsigned number", () => {
  assert.equal(bits(0x00502023, 6, 0), 0b0100011);
  assert.equal(bits(0xFFF00B93, 31, 20), 0xFFF);
  assert.equal(bits(0x80000000, 31, 31), 1);
  assert.equal(bits(0xFFFFFFFF, 31, 0), 0xFFFFFFFF); // full word stays positive
});

test("extractFields: sw x5, 0(x0) = 0x00502023", () => {
  assert.deepEqual(extractFields(0x00502023), {
    opcode: 0b0100011, rd: 0, funct3: 0b010, rs1: 0, rs2: 5, funct7: 0,
  });
});

test("extractFields: sub x21, x19, x20 = 0x41498AB3", () => {
  assert.deepEqual(extractFields(0x41498AB3), {
    opcode: 0b0110011, rd: 21, funct3: 0b000, rs1: 19, rs2: 20, funct7: 0b0100000,
  });
});

test("signExtend: positive values stay, a 1 in the top bit makes them negative", () => {
  assert.equal(signExtend(0x7FF, 12), 2047);
  assert.equal(signExtend(0x800, 12), -2048);
  assert.equal(signExtend(0xFFF, 12), -1);
  assert.equal(signExtend(0, 12), 0);
  assert.equal(signExtend(0x0FFE, 13), 4094);
  assert.equal(signExtend(0x1000, 13), -4096);
  assert.equal(signExtend(0x1FFC, 13), -4);
});

test("immediateOf: one case per format", () => {
  const imm = (name, word) => immediateOf(word, findByName(name));
  assert.equal(imm("add", 0x007302B3), null);
  assert.equal(imm("addi", 0xFFF00B93), -1);      // addi x23, x0, -1
  assert.equal(imm("addi", 0xFD630293), -42);     // addi x5, x6, -42
  assert.equal(imm("srai", 0x40485793), 4);       // shamt only, funct7 not included
  assert.equal(imm("lbu", 0x80064583), -2048);    // lbu x11, -2048(x12)
  assert.equal(imm("sh", 0x00741323), 6);         // sh x7, 6(x8)
  assert.equal(imm("sb", 0xFE530FA3), -1);        // sb x5, -1(x6)
  assert.equal(imm("bne", 0xFE0C9EE3), -4);       // bne x25, x0, -4
  assert.equal(imm("blt", 0x00A4C0E3), 2048);     // bit 11 of the offset set
  assert.equal(imm("bgeu", 0x8107F063), -4096);   // only bit 12 set
  assert.equal(imm("bltu", 0x7EE6EFE3), 4094);
});
