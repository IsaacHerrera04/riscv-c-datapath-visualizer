import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INSTRUCTIONS,
  ALU_OPERATIONS,
  findByName,
  findByEncoding,
  isShiftImmediate,
} from "../src/shared/instructions.js";
import { REGISTER_COUNT, ABI_NAMES, parseRegister, registerName } from "../src/shared/registers.js";
import { HARDWARE } from "../src/shared/hardware.js";

// ---------- instructions.js ----------

test("there are exactly 33 instructions with unique names", () => {
  assert.equal(INSTRUCTIONS.length, 33);
  const names = new Set(INSTRUCTIONS.map((ins) => ins.name));
  assert.equal(names.size, 33);
});

test("instruction count per type is R 10, I 9, L 5, S 3, B 6", () => {
  const counts = {};
  for (const ins of INSTRUCTIONS) counts[ins.type] = (counts[ins.type] ?? 0) + 1;
  assert.deepEqual(counts, { R: 10, I: 9, L: 5, S: 3, B: 6 });
});

test("no two instructions share the same encoding", () => {
  for (let i = 0; i < INSTRUCTIONS.length; i++) {
    for (let j = i + 1; j < INSTRUCTIONS.length; j++) {
      const a = INSTRUCTIONS[i];
      const b = INSTRUCTIONS[j];
      if (a.opcode !== b.opcode || a.funct3 !== b.funct3) continue;
      // Same opcode and funct3: only funct7 can tell them apart,
      // so both must define it and it must be different.
      assert.notEqual(a.funct7, null, `${a.name} collides with ${b.name}`);
      assert.notEqual(b.funct7, null, `${b.name} collides with ${a.name}`);
      assert.notEqual(a.funct7, b.funct7, `${a.name} collides with ${b.name}`);
    }
  }
});

test("every aluControl is a known ALU operation", () => {
  for (const ins of INSTRUCTIONS) {
    assert.ok(ins.aluControl in ALU_OPERATIONS, `${ins.name}: ${ins.aluControl}`);
  }
});

test("branchInvert is 1 only for bne, bge and bgeu", () => {
  const inverted = INSTRUCTIONS.filter((ins) => ins.branchInvert === 1).map((ins) => ins.name);
  assert.deepEqual(inverted, ["bne", "bge", "bgeu"]);
});

test("rows and the table are frozen", () => {
  assert.ok(Object.isFrozen(INSTRUCTIONS));
  assert.ok(INSTRUCTIONS.every((ins) => Object.isFrozen(ins)));
  assert.ok(Object.isFrozen(ALU_OPERATIONS));
});

test("findByName is case-insensitive and returns undefined for unknown names", () => {
  assert.equal(findByName("addi").opcode, 0b0010011);
  assert.equal(findByName("ADDI"), findByName("addi"));
  assert.equal(findByName("jal"), undefined);
  assert.equal(findByName(42), undefined);
});

test("findByEncoding ignores funct7 when it is don't care (addi x1, x0, -1)", () => {
  assert.equal(findByEncoding(0b0010011, 0b000, 0b1111111).name, "addi");
});

test("findByEncoding uses funct7 when it matters", () => {
  assert.equal(findByEncoding(0b0010011, 0b101, 0b0100000).name, "srai");
  assert.equal(findByEncoding(0b0010011, 0b101, 0b0000000).name, "srli");
  assert.equal(findByEncoding(0b0110011, 0b000, 0b0000000).name, "add");
  assert.equal(findByEncoding(0b0110011, 0b000, 0b0100000).name, "sub");
});

test("findByEncoding returns undefined for encodings outside the 33", () => {
  assert.equal(findByEncoding(0b1101111, 0b000, 0b0000000), undefined); // jal
  assert.equal(findByEncoding(0b0110011, 0b000, 0b0000001), undefined); // mul (M extension)
  assert.equal(findByEncoding(0b1100011, 0b010, 0b0000000), undefined); // unused branch funct3
});

test("isShiftImmediate is true only for slli, srli and srai", () => {
  const shifts = INSTRUCTIONS.filter(isShiftImmediate).map((ins) => ins.name);
  assert.deepEqual(shifts, ["slli", "srli", "srai"]);
});

test("ALU_OPERATIONS names the codes used by branches", () => {
  assert.equal(ALU_OPERATIONS[findByName("beq").aluControl], "SEQ");
  assert.equal(ALU_OPERATIONS[findByName("bltu").aluControl], "SLTU");
});

// ---------- registers.js ----------

test("there are 32 registers, each with one unique ABI name", () => {
  assert.equal(REGISTER_COUNT, 32);
  assert.equal(ABI_NAMES.length, REGISTER_COUNT);
  assert.equal(new Set(ABI_NAMES).size, REGISTER_COUNT);
  assert.ok(Object.isFrozen(ABI_NAMES));
});

test("parseRegister accepts numeric names x0..x31", () => {
  assert.equal(parseRegister("x0"), 0);
  assert.equal(parseRegister("x5"), 5);
  assert.equal(parseRegister("x31"), 31);
});

test("parseRegister accepts ABI names and the fp alias", () => {
  assert.equal(parseRegister("zero"), 0);
  assert.equal(parseRegister("t0"), 5);
  assert.equal(parseRegister("s0"), 8);
  assert.equal(parseRegister("fp"), 8);
  assert.equal(parseRegister("s11"), 27);
  assert.equal(parseRegister("t6"), 31);
});

test("every ABI name maps back to its own register number", () => {
  ABI_NAMES.forEach((name, number) => {
    assert.equal(parseRegister(name), number, name);
  });
});

test("parseRegister ignores case and surrounding whitespace", () => {
  assert.equal(parseRegister("X5"), 5);
  assert.equal(parseRegister("T0"), 5);
  assert.equal(parseRegister("  a0 "), 10);
});

test("parseRegister returns null for invalid names", () => {
  for (const text of ["x32", "x99", "x05", "x", "x-1", "foo", "", "t 0"]) {
    assert.equal(parseRegister(text), null, `"${text}"`);
  }
  assert.equal(parseRegister(5), null);
  assert.equal(parseRegister(undefined), null);
});

// ---------- hardware.js ----------

test("memory sizes match the VHDL design", () => {
  assert.equal(HARDWARE.INSTRUCTION_MEMORY_WORDS, 256);
  assert.equal(HARDWARE.DATA_MEMORY_BYTES, 1024);
  assert.equal(HARDWARE.DATA_MEMORY_BYTES % 4, 0); // whole 32-bit words
});

test("immediate limits match their bit widths", () => {
  // n-bit signed range: -2^(n-1) .. 2^(n-1) - 1
  assert.equal(HARDWARE.IMM12_MIN, -(2 ** 11));
  assert.equal(HARDWARE.IMM12_MAX, 2 ** 11 - 1);
  assert.equal(HARDWARE.SHAMT_MAX, 2 ** 5 - 1);
  // 13-bit signed and even (bit 0 is not stored)
  assert.equal(HARDWARE.BRANCH_OFFSET_MIN, -(2 ** 12));
  assert.equal(HARDWARE.BRANCH_OFFSET_MAX, 2 ** 12 - 2);
  assert.equal(HARDWARE.BRANCH_OFFSET_MAX % 2, 0);
});

test("every data address fits in the 12-bit immediate (base register x0)", () => {
  assert.ok(HARDWARE.DATA_MEMORY_BYTES - 1 <= HARDWARE.IMM12_MAX);
});

test("PC increment and halt label", () => {
  assert.equal(HARDWARE.PC_INCREMENT, 4);
  assert.equal(HARDWARE.HALT_LABEL, "halt");
});

test("HARDWARE is frozen", () => {
  assert.ok(Object.isFrozen(HARDWARE));
  assert.throws(() => { HARDWARE.DATA_MEMORY_BYTES = 2048; }, TypeError);
});

test("registerName gives the canonical xN name and round-trips with parseRegister", () => {
  assert.equal(registerName(0), "x0");
  assert.equal(registerName(31), "x31");
  for (let number = 0; number < REGISTER_COUNT; number++) {
    assert.equal(parseRegister(registerName(number)), number);
  }
});
