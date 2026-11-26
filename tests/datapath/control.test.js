import { test } from "node:test";
import assert from "node:assert/strict";

import { controlSignals, aluControlBits, CONTROL_SIGNALS } from "../../src/datapath/control.js";
import { INSTRUCTIONS } from "../../src/shared/instructions.js";
import { assemble } from "../../src/assembler/index.js";
import { decode } from "../../src/decoder/index.js";

// Expected outputs of control_04, written by hand from docs/DESIGN.md section 7.2 (NOT read from
// instructions.js, so a mistake in the table would be caught here).
const BY_TYPE = {
  //   regWrite memWrite aluSrc memToReg immSrc branch
  R: [1, 0, 0, 0, 0, 0],
  I: [1, 0, 1, 0, 0, 0],
  L: [1, 0, 1, 1, 0, 0],
  S: [0, 1, 1, 0, 1, 0],
  B: [0, 0, 0, 0, 0, 1],
};

// name: [type, ALU operation, aluControl bits, branchInvert]
const EXPECTED = {
  add: ["R", "ADD", "0000", 0], sub: ["R", "SUB", "0001", 0], sll: ["R", "SLL", "0111", 0],
  slt: ["R", "SLT", "0101", 0], sltu: ["R", "SLTU", "0110", 0], xor: ["R", "XOR", "0100", 0],
  srl: ["R", "SRL", "1000", 0], sra: ["R", "SRA", "1001", 0], or: ["R", "OR", "0011", 0],
  and: ["R", "AND", "0010", 0],
  addi: ["I", "ADD", "0000", 0], slli: ["I", "SLL", "0111", 0], slti: ["I", "SLT", "0101", 0],
  sltiu: ["I", "SLTU", "0110", 0], xori: ["I", "XOR", "0100", 0], srli: ["I", "SRL", "1000", 0],
  srai: ["I", "SRA", "1001", 0], ori: ["I", "OR", "0011", 0], andi: ["I", "AND", "0010", 0],
  lb: ["L", "ADD", "0000", 0], lh: ["L", "ADD", "0000", 0], lw: ["L", "ADD", "0000", 0],
  lbu: ["L", "ADD", "0000", 0], lhu: ["L", "ADD", "0000", 0],
  sb: ["S", "ADD", "0000", 0], sh: ["S", "ADD", "0000", 0], sw: ["S", "ADD", "0000", 0],
  // branches: the ALU only knows SEQ, SLT, SLTU; branchInvert gives the other three
  beq: ["B", "SEQ", "1010", 0], bne: ["B", "SEQ", "1010", 1],
  blt: ["B", "SLT", "0101", 0], bge: ["B", "SLT", "0101", 1],
  bltu: ["B", "SLTU", "0110", 0], bgeu: ["B", "SLTU", "0110", 1],
};

// One real instruction of each name, assembled and decoded (the same path the page will use).
function sampleOf({ name, type }) {
  const operands = {
    R: "x5, x6, x7",
    I: ["slli", "srli", "srai"].includes(name) ? "x5, x6, 3" : "x5, x6, -12",
    L: "x5, 8(x6)",
    S: "x7, 8(x6)",
    B: "x5, x6, 8",
  };
  const { program, errors } = assemble(`${name} ${operands[type]}`);
  assert.deepEqual(errors, []);
  return decode(program[0].word);
}

test("the expected table covers exactly the 33 instructions", () => {
  assert.deepEqual(Object.keys(EXPECTED).sort(), INSTRUCTIONS.map((i) => i.name).sort());
});

test("control signals of each of the 33 instructions match control_04", () => {
  for (const instruction of INSTRUCTIONS) {
    const [type, operation, bits, branchInvert] = EXPECTED[instruction.name];
    const [regWrite, memWrite, aluSrc, memToReg, immSrc, branch] = BY_TYPE[type];
    const result = controlSignals(sampleOf(instruction));
    assert.deepEqual(
      { ...result, aluControl: aluControlBits(result.aluControl) },
      { regWrite, memWrite, aluSrc, memToReg, immSrc, branch,
        aluControl: bits, branchInvert, aluOperationName: operation },
      instruction.name,
    );
  }
});

test("only the immediate fields change between two addi: the signals do not", () => {
  const a = controlSignals(sampleOf({ name: "addi", type: "I" }));
  const b = controlSignals(decode(assemble("addi x31, x0, 2047").program[0].word));
  assert.deepEqual(a, b);
});

test("an invalid instruction has no control signals", () => {
  assert.equal(controlSignals(decode(0xFFFFFFFF)), null);
  assert.equal(controlSignals(null), null);
});

test("the result is frozen", () => {
  assert.ok(Object.isFrozen(controlSignals(sampleOf({ name: "add", type: "R" }))));
});

test("aluControlBits shows the 4-bit code", () => {
  assert.deepEqual([0b0000, 0b0101, 0b1010, 0b1111].map(aluControlBits), ["0000", "0101", "1010", "1111"]);
});

test("CONTROL_SIGNALS lists the 8 signals with their VHDL names", () => {
  assert.deepEqual(CONTROL_SIGNALS.map((s) => `${s.name}:${s.vhdlName}`), [
    "regWrite:wer", "memWrite:wem", "aluSrc:sel_B", "memToReg:mem_to_reg",
    "immSrc:imm_rd", "aluControl:operacion", "branch:branch", "branchInvert:br_neg",
  ]);
});
