import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseLine,
  parseImmediate,
  parseMemoryOperand,
  parseOperands,
} from "../../src/assembler/parser.js";

// ---------- parseLine ----------

test("parseLine: blank and comment-only lines are empty", () => {
  const empty = { label: null, mnemonic: null, operands: [] };
  assert.deepEqual(parseLine(""), empty);
  assert.deepEqual(parseLine("    "), empty);
  assert.deepEqual(parseLine("# only a comment"), empty);
});

test("parseLine: mnemonic and operands, any whitespace, comment removed", () => {
  assert.deepEqual(parseLine("addi x5, x0, -3"), {
    label: null, mnemonic: "addi", operands: ["x5", "x0", "-3"],
  });
  assert.deepEqual(parseLine("  ADD   x5 ,x6,   x7   # x5 = x6 + x7"), {
    label: null, mnemonic: "add", operands: ["x5", "x6", "x7"],
  });
});

test("parseLine: memory operand stays as one operand", () => {
  assert.deepEqual(parseLine("lw x5, 8(x0)").operands, ["x5", "8(x0)"]);
});

test("parseLine: labels alone or followed by an instruction", () => {
  assert.deepEqual(parseLine("loop:"), { label: "loop", mnemonic: null, operands: [] });
  assert.deepEqual(parseLine("loop: addi x5, x5, -1"), {
    label: "loop", mnemonic: "addi", operands: ["x5", "x5", "-1"],
  });
  assert.deepEqual(parseLine("halt:beq x0,x0,halt"), {
    label: "halt", mnemonic: "beq", operands: ["x0", "x0", "halt"],
  });
  assert.equal(parseLine("_end.1: # done").label, "_end.1");
});

test("parseLine: invalid label name is an error", () => {
  assert.deepEqual(parseLine("1abc: add x5, x6, x7"), { error: 'invalid label name "1abc"' });
  assert.deepEqual(parseLine(": add x5, x6, x7"), { error: 'invalid label name ""' });
});

test("parseLine: a trailing comma produces an empty operand (caught later)", () => {
  assert.deepEqual(parseLine("add x5, x6, x7,").operands, ["x5", "x6", "x7", ""]);
});

// ---------- parseImmediate ----------

test("parseImmediate: decimal, hex and binary, with optional minus", () => {
  assert.equal(parseImmediate("-12"), -12);
  assert.equal(parseImmediate("2047"), 2047);
  assert.equal(parseImmediate("0x1F"), 31);
  assert.equal(parseImmediate("0X1f"), 31);
  assert.equal(parseImmediate("-0x10"), -16);
  assert.equal(parseImmediate("0b101"), 5);
  assert.equal(parseImmediate(" 7 "), 7);
});

test("parseImmediate: -0 is returned as 0", () => {
  assert.ok(Object.is(parseImmediate("-0"), 0));
});

test("parseImmediate: invalid text returns null", () => {
  for (const text of ["", "abc", "12a", "0x", "0b2", "--1", "1.5", "- 1", "x5"]) {
    assert.equal(parseImmediate(text), null, `"${text}"`);
  }
  assert.equal(parseImmediate(undefined), null);
});

// ---------- parseMemoryOperand ----------

test("parseMemoryOperand: splits offset and base register", () => {
  assert.deepEqual(parseMemoryOperand("8(x0)"), { offsetText: "8", baseText: "x0" });
  assert.deepEqual(parseMemoryOperand(" -4 ( sp ) "), { offsetText: "-4", baseText: "sp" });
});

test("parseMemoryOperand: wrong shape returns null", () => {
  for (const text of ["8x0", "8(x0", "8 x0)", "(x0)", "8()", "8(x0)4", "8(x0)(x1)"]) {
    assert.equal(parseMemoryOperand(text), null, `"${text}"`);
  }
});

// ---------- parseOperands ----------

test("parseOperands: R type", () => {
  const result = parseOperands("add", ["x5", "x6", "x7"]);
  assert.equal(result.instruction.name, "add");
  assert.deepEqual(
    { rd: result.rd, rs1: result.rs1, rs2: result.rs2, imm: result.imm, label: result.label },
    { rd: 5, rs1: 6, rs2: 7, imm: null, label: null },
  );
});

test("parseOperands: ABI names give the same numbers", () => {
  const result = parseOperands("add", ["t0", "t1", "t2"]);
  assert.deepEqual([result.rd, result.rs1, result.rs2], [5, 6, 7]);
});

test("parseOperands: I type with 12-bit immediate limits", () => {
  const result = parseOperands("addi", ["x5", "x0", "-3"]);
  assert.deepEqual([result.rd, result.rs1, result.rs2, result.imm], [5, 0, null, -3]);
  assert.equal(parseOperands("addi", ["x5", "x0", "-2048"]).imm, -2048);
  assert.equal(parseOperands("addi", ["x5", "x0", "2047"]).imm, 2047);
  assert.deepEqual(parseOperands("addi", ["x5", "x0", "2048"]), {
    error: "immediate 2048 out of range [-2048, 2047]",
  });
});

test("parseOperands: shift amount must be 0..31", () => {
  assert.equal(parseOperands("srai", ["x5", "x5", "2"]).imm, 2);
  assert.equal(parseOperands("slli", ["x5", "x5", "31"]).imm, 31);
  assert.deepEqual(parseOperands("slli", ["x5", "x5", "32"]), {
    error: "shift amount 32 out of range [0, 31]",
  });
  assert.deepEqual(parseOperands("srli", ["x5", "x5", "-1"]), {
    error: "shift amount -1 out of range [0, 31]",
  });
});

test("parseOperands: L and S types use offset(rs1)", () => {
  const load = parseOperands("lw", ["x5", "8(x0)"]);
  assert.deepEqual([load.rd, load.rs1, load.rs2, load.imm], [5, 0, null, 8]);

  const store = parseOperands("sw", ["x5", "-4(x2)"]);
  assert.deepEqual([store.rd, store.rs1, store.rs2, store.imm], [null, 2, 5, -4]);
});

test("parseOperands: memory operand errors", () => {
  assert.deepEqual(parseOperands("lw", ["x5", "8x0"]), {
    error: 'malformed memory operand "8x0" (expected offset(register), e.g. 8(x0))',
  });
  assert.deepEqual(parseOperands("lw", ["x5", "4096(x0)"]), {
    error: "offset 4096 out of range [-2048, 2047]",
  });
  assert.deepEqual(parseOperands("sw", ["x5", "8(x99)"]), { error: 'invalid register "x99"' });
});

test("parseOperands: B type with a label or a numeric offset", () => {
  const withLabel = parseOperands("bne", ["x5", "x0", "loop"]);
  assert.deepEqual([withLabel.rs1, withLabel.rs2, withLabel.imm, withLabel.label], [5, 0, null, "loop"]);

  const withOffset = parseOperands("bne", ["x5", "x0", "-8"]);
  assert.deepEqual([withOffset.imm, withOffset.label], [-8, null]);

  assert.deepEqual(parseOperands("beq", ["x0", "x0", "1abc"]), {
    error: 'invalid branch target "1abc"',
  });
});

test("parseOperands: unknown mnemonic", () => {
  assert.deepEqual(parseOperands("jal", ["x1", "loop"]), { error: 'unknown instruction "jal"' });
  assert.deepEqual(parseOperands("mul", ["x5", "x6", "x7"]), { error: 'unknown instruction "mul"' });
});

test("parseOperands: wrong number of operands shows the expected syntax", () => {
  assert.deepEqual(parseOperands("add", ["x5", "x6"]), {
    error: "add expects 3 operands (add rd, rs1, rs2) but found 2",
  });
  assert.deepEqual(parseOperands("sw", ["x5", "0", "x0"]), {
    error: "sw expects 2 operands (sw rs2, offset(rs1)) but found 3",
  });
  assert.deepEqual(parseOperands("add", parseLine("add x5, x6, x7,").operands), {
    error: "add expects 3 operands (add rd, rs1, rs2) but found 4",
  });
});

test("parseOperands: invalid register reports the first bad operand", () => {
  assert.deepEqual(parseOperands("add", ["x5", "x32", "foo"]), { error: 'invalid register "x32"' });
  assert.deepEqual(parseOperands("addi", ["x5", "x0", "abc"]), { error: 'invalid immediate "abc"' });
});
