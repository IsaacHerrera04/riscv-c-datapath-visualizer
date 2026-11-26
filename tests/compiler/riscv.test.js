import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenize } from "../../src/compiler/lexer.js";
import { parse } from "../../src/compiler/parser.js";
import { analyze } from "../../src/compiler/semantic.js";
import { generateRiscv } from "../../src/compiler/backends/riscv.js";

// ---------- helpers ----------

const HALT = ["halt:", "beq x0, x0, halt"];

// Runs the whole frontend + backend on "int main() { <code> }". The program must be valid.
function generate(code) {
  const source = `int main() {\n${code}\n}`;
  const parsed = parse(tokenize(source).tokens);
  assert.deepEqual(parsed.errors, [], "the test program must have no syntax errors");
  const checked = analyze(parsed.ast);
  assert.deepEqual(checked.errors, [], "the test program must have no semantic errors");
  return generateRiscv(checked.ast, checked.symbols, source);
}

// Instructions and labels only: no comments, no blank lines, single spaces.
//   "    addi x5, x5, 5   # comment" → "addi x5, x5, 5"
function code(asm) {
  return asm
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim().replace(/\s+/g, " "))
    .filter((line) => line !== "");
}

// Code of a program without the final halt (every program ends with it).
function body(source) {
  const { asm, errors } = generate(source);
  assert.deepEqual(errors, []);
  const lines = code(asm);
  assert.deepEqual(lines.slice(-2), HALT, "every program ends with halt");
  return lines.slice(0, -2);
}

// ---------- program shape ----------

test("an empty program is just the halt loop", () => {
  assert.deepEqual(code(generate("").asm), HALT);
});

test("full output: memory map, line comments, indentation", () => {
  const { asm } = generate("int a;\nint v[4];\na = a + 5;");
  assert.equal(asm, [
    "# Memory map",
    "#   a      int      0x000",
    "#   v[4]   int      0x004..0x013",
    "",
    "# line 4: a = a + 5;",
    "    lw   x5, 0(x0)",
    "    addi x5, x5, 5",
    "    sw   x5, 0(x0)",
    "",
    "halt:",
    "    beq  x0, x0, halt",
    "",
  ].join("\n"));
});

test("a program without variables says so in the memory map", () => {
  assert.match(generate("").asm, /^# Memory map: no variables\n/);
});

test("each C line gets one comment, even with several statements", () => {
  const { asm } = generate("int a; int b;\na = 1; b = 2;");
  assert.equal(asm.match(/# line 3: a = 1; b = 2;/g).length, 1);
});

// ---------- values ----------

test("constants: addi from x0; zero is x0 itself", () => {
  assert.deepEqual(body("int a;\na = 7;\na = -2048;\na = 0;"), [
    "addi x5, x0, 7", "sw x5, 0(x0)",
    "addi x5, x0, -2048", "sw x5, 0(x0)",
    "sw x0, 0(x0)",
  ]);
});

test("a declaration with initializer stores; without one emits nothing", () => {
  assert.deepEqual(body("int a;\nint b = 3;"), ["addi x5, x0, 3", "sw x5, 4(x0)"]);
});

test("variables are read with lw from their address", () => {
  assert.deepEqual(body("int a; int b;\nb = a;"), ["lw x5, 0(x0)", "sw x5, 4(x0)"]);
});

test("unary minus is 0 - a", () => {
  assert.deepEqual(body("int a;\na = -a;"), ["lw x5, 0(x0)", "sub x5, x0, x5", "sw x5, 0(x0)"]);
});

// ---------- arrays ----------

test("constant index: the offset is computed at compile time", () => {
  // v is at 4; v[2] is at 4 + 2*4 = 12
  assert.deepEqual(body("int a; int v[4];\nv[2] = a;\na = v[3];"), [
    "lw x5, 0(x0)", "sw x5, 12(x0)",
    "lw x5, 16(x0)", "sw x5, 0(x0)",
  ]);
});

test("variable index: index << 2, then the array base as immediate", () => {
  assert.deepEqual(body("int i; int v[4];\nv[i] = 9;\ni = v[i];"), [
    "addi x5, x0, 9", "lw x6, 0(x0)", "slli x6, x6, 2", "sw x5, 4(x6)",
    "lw x5, 0(x0)", "slli x5, x5, 2", "lw x5, 4(x5)", "sw x5, 0(x0)",
  ]);
});

// ---------- arithmetic ----------

test("register forms of every arithmetic operator", () => {
  const ops = { "+": "add", "-": "sub", "&": "and", "|": "or", "^": "xor", "<<": "sll", ">>": "sra" };
  for (const [c, asm] of Object.entries(ops)) {
    assert.deepEqual(body(`int a; int b;\na = a ${c} b;`),
      ["lw x5, 0(x0)", "lw x6, 4(x0)", `${asm} x5, x5, x6`, "sw x5, 0(x0)"], c);
  }
});

test("immediate forms when the right operand is a constant", () => {
  const ops = { "+": "addi", "&": "andi", "|": "ori", "^": "xori", "<<": "slli", ">>": "srai" };
  for (const [c, asm] of Object.entries(ops)) {
    assert.deepEqual(body(`int a;\na = a ${c} 3;`),
      ["lw x5, 0(x0)", `${asm} x5, x5, 3`, "sw x5, 0(x0)"], c);
  }
});

test("there is no subi: a - k is addi with -k", () => {
  assert.deepEqual(body("int a;\na = a - 3;"), ["lw x5, 0(x0)", "addi x5, x5, -3", "sw x5, 0(x0)"]);
});

test("a - (-2048) needs the register form, because 2048 does not fit", () => {
  assert.deepEqual(body("int a;\na = a - -2048;"),
    ["lw x5, 0(x0)", "addi x6, x0, -2048", "sub x5, x5, x6", "sw x5, 0(x0)"]);
});

test("a constant on the left is loaded into a register", () => {
  assert.deepEqual(body("int a;\na = 1 << a;"),
    ["addi x5, x0, 1", "lw x6, 0(x0)", "sll x5, x5, x6", "sw x5, 0(x0)"]);
});

test("nested expressions use the next free registers and release them", () => {
  assert.deepEqual(body("int a; int b; int c;\na = (a + b) ^ (b - c);\nc = a;"), [
    "lw x5, 0(x0)", "lw x6, 4(x0)", "add x5, x5, x6",
    "lw x6, 4(x0)", "lw x7, 8(x0)", "sub x6, x6, x7",
    "xor x5, x5, x6", "sw x5, 0(x0)",
    "lw x5, 0(x0)", "sw x5, 8(x0)", // the next statement starts at x5 again
  ]);
});

// ---------- comparisons as values (result 0 or 1) ----------

test("comparisons with registers", () => {
  const expected = {
    "<": ["slt x5, x5, x6"],
    ">": ["slt x5, x6, x5"],
    "<=": ["slt x5, x6, x5", "xori x5, x5, 1"],
    ">=": ["slt x5, x5, x6", "xori x5, x5, 1"],
    "==": ["xor x5, x5, x6", "sltiu x5, x5, 1"],
    "!=": ["xor x5, x5, x6", "sltu x5, x0, x5"],
  };
  for (const [op, instructions] of Object.entries(expected)) {
    assert.deepEqual(body(`int a; int b;\na = a ${op} b;`),
      ["lw x5, 0(x0)", "lw x6, 4(x0)", ...instructions, "sw x5, 0(x0)"], op);
  }
});

test("comparisons with constants use slti / xori; with 0 they need no xor", () => {
  assert.deepEqual(body("int a;\na = a < 5;"), ["lw x5, 0(x0)", "slti x5, x5, 5", "sw x5, 0(x0)"]);
  assert.deepEqual(body("int a;\na = a >= 5;"),
    ["lw x5, 0(x0)", "slti x5, x5, 5", "xori x5, x5, 1", "sw x5, 0(x0)"]);
  assert.deepEqual(body("int a;\na = a == 5;"),
    ["lw x5, 0(x0)", "xori x5, x5, 5", "sltiu x5, x5, 1", "sw x5, 0(x0)"]);
  assert.deepEqual(body("int a;\na = a == 0;"), ["lw x5, 0(x0)", "sltiu x5, x5, 1", "sw x5, 0(x0)"]);
  assert.deepEqual(body("int a;\na = a != 0;"), ["lw x5, 0(x0)", "sltu x5, x0, x5", "sw x5, 0(x0)"]);
});

// ---------- control flow ----------

test("if: branch over the then-part when the condition is false", () => {
  assert.deepEqual(body("int a; int b;\nif (a < b) a = 1;"), [
    "lw x5, 0(x0)", "lw x6, 4(x0)", "bge x5, x6, L0",
    "addi x5, x0, 1", "sw x5, 0(x0)",
    "L0:",
  ]);
});

test("if/else: jump over the else-part at the end of the then-part", () => {
  assert.deepEqual(body("int a;\nif (a == 2) a = 1; else a = 3;"), [
    "lw x5, 0(x0)", "addi x6, x0, 2", "bne x5, x6, L0",
    "addi x5, x0, 1", "sw x5, 0(x0)", "beq x0, x0, L1",
    "L0:",
    "addi x5, x0, 3", "sw x5, 0(x0)",
    "L1:",
  ]);
});

test("every condition branches with the inverted test (no bgt / ble: operands swapped)", () => {
  const expected = {
    "<": "bge x5, x6, L0",
    ">=": "blt x5, x6, L0",
    ">": "bge x6, x5, L0",
    "<=": "blt x6, x5, L0",
    "==": "bne x5, x6, L0",
    "!=": "beq x5, x6, L0",
  };
  for (const [op, branch] of Object.entries(expected)) {
    assert.deepEqual(body(`int a; int b;\nif (a ${op} b) ;`),
      ["lw x5, 0(x0)", "lw x6, 4(x0)", branch, "L0:"], op);
  }
});

test("comparing with 0 in a condition uses x0", () => {
  assert.deepEqual(body("int i;\nif (i != 0) ;"), ["lw x5, 0(x0)", "beq x5, x0, L0", "L0:"]);
});

test("any other condition means 'not zero'", () => {
  assert.deepEqual(body("int a;\nif (a & 1) ;"), ["lw x5, 0(x0)", "andi x5, x5, 1", "beq x5, x0, L0", "L0:"]);
});

test("while: test at the top, jump back with beq x0, x0", () => {
  assert.deepEqual(body("int i;\nwhile (i < 3) i++;"), [
    "L0:",
    "lw x5, 0(x0)", "addi x6, x0, 3", "bge x5, x6, L1",
    "lw x5, 0(x0)", "addi x5, x5, 1", "sw x5, 0(x0)",
    "beq x0, x0, L0",
    "L1:",
  ]);
});

test("for (;;) has no test at all; a false constant always jumps out", () => {
  assert.deepEqual(body("for (;;) ;"), ["L0:", "beq x0, x0, L0", "L1:"]);
  assert.deepEqual(body("while (0) ;"), ["L0:", "beq x0, x0, L1", "beq x0, x0, L0", "L1:"]);
});

test("return computes its value and jumps to halt", () => {
  assert.deepEqual(body("int a;\nreturn a + 1;"), ["lw x5, 0(x0)", "addi x5, x5, 1", "beq x0, x0, halt"]);
  assert.deepEqual(body("return;"), ["beq x0, x0, halt"]);
});

// ---------- limits ----------

test("an expression that needs more than 25 registers is an error", () => {
  // a + (a + (a + ...)): every pending left operand keeps one register busy
  let expression = "a";
  for (let i = 0; i < 26; i++) expression = `a + (${expression})`;
  const { errors } = generate(`int a;\na = ${expression};`);
  assert.deepEqual(errors, [{
    line: 3,
    message: "expression too complex: it needs more than 25 registers; split it into several statements",
  }]);
});

test("a program longer than 256 instructions is an error on the first line that does not fit", () => {
  // each "a = 1;" is 2 instructions; 128 of them = 256, + halt = 257
  const lines = Array.from({ length: 128 }, () => "a = 1;").join("\n");
  const { errors } = generate(`int a;\n${lines}`);
  assert.deepEqual(errors, [{
    line: 130, // the assignments are on lines 3..130; the halt (257th) is emitted after line 130
    message: "the program needs 257 instructions but instruction memory holds 256",
  }]);
});

test("exactly 256 instructions fit", () => {
  const lines = Array.from({ length: 127 }, () => "a = 1;").join("\n");
  assert.deepEqual(generate(`int a;\n${lines}\na = 0;`).errors, []); // 254 + 1 + halt = 256
});

// ---------- phase 2: every type ----------

test("loads by declared type: lw, lh, lhu, lb, lbu", () => {
  assert.deepEqual(
    body("int a; unsigned u; short s; unsigned short h; char c; unsigned char b; int x;\n" +
      "x = a; x = u; x = s; x = h; x = c; x = b;").filter((line) => line.startsWith("l")),
    ["lw x5, 0(x0)", "lw x5, 4(x0)", "lh x5, 8(x0)", "lhu x5, 10(x0)", "lb x5, 12(x0)", "lbu x5, 13(x0)"],
  );
});

test("stores by size only: sw, sh, sb (the sign does not matter when storing)", () => {
  assert.deepEqual(
    body("unsigned u = 1; short s = 1; unsigned short h = 1; char c = 1; unsigned char b = 1;")
      .filter((line) => line.startsWith("s")),
    ["sw x5, 0(x0)", "sh x5, 4(x0)", "sh x5, 6(x0)", "sb x5, 8(x0)", "sb x5, 9(x0)"],
  );
});

test("array index scaling by element size: << 2, << 1, none", () => {
  const scaled = (type) => body(`${type} v[4]; int i;\nv[i] = 1;`);
  assert.deepEqual(scaled("int"), ["addi x5, x0, 1", "lw x6, 16(x0)", "slli x6, x6, 2", "sw x5, 0(x6)"]);
  assert.deepEqual(scaled("short"), ["addi x5, x0, 1", "lw x6, 8(x0)", "slli x6, x6, 1", "sh x5, 0(x6)"]);
  assert.deepEqual(scaled("char"), ["addi x5, x0, 1", "lw x6, 4(x0)", "sb x5, 0(x6)"]);
});

test("constant index of a short array: offset = index * 2", () => {
  assert.deepEqual(body("short v[4]; int x;\nx = v[3];"), ["lh x5, 6(x0)", "sw x5, 8(x0)"]);
});

test("unsigned comparisons as values: sltu / sltiu", () => {
  const decl = "unsigned u; unsigned w; int x;\n";
  assert.deepEqual(body(decl + "x = u < w;").slice(2, 3), ["sltu x5, x5, x6"]);
  assert.deepEqual(body(decl + "x = u > w;").slice(2, 3), ["sltu x5, x6, x5"]);
  assert.deepEqual(body(decl + "x = u < 5;").slice(1, 2), ["sltiu x5, x5, 5"]);
  assert.deepEqual(body(decl + "x = u >= 5;").slice(1, 3), ["sltiu x5, x5, 5", "xori x5, x5, 1"]);
});

test("unsigned conditions branch with bltu / bgeu", () => {
  const branchOf = (cond) =>
    body(`unsigned u; unsigned w;\nif (${cond}) u = 1;`).find((line) => line.startsWith("b"));
  assert.equal(branchOf("u < w"), "bgeu x5, x6, L0");
  assert.equal(branchOf("u >= w"), "bltu x5, x6, L0");
  assert.equal(branchOf("u > w"), "bgeu x6, x5, L0");
  assert.equal(branchOf("u <= w"), "bltu x6, x5, L0");
  assert.equal(branchOf("u == w"), "bne x5, x6, L0"); // equality has no signed/unsigned version
});

test(">> on unsigned int is logical (srl / srli); on int it stays arithmetic", () => {
  assert.deepEqual(body("unsigned u; int a;\nu = u >> 3;").slice(1, 2), ["srli x5, x5, 3"]);
  assert.deepEqual(body("unsigned u; int a;\nu = u >> a;").slice(2, 3), ["srl x5, x5, x6"]);
  assert.deepEqual(body("unsigned u; int a;\na = a >> u;").slice(2, 3), ["sra x5, x5, x6"]);
});

test("small unsigned types are promoted to int: signed comparison", () => {
  // unsigned char → int, so b < 5 compares as int (slti), the C rule
  assert.deepEqual(body("unsigned char b; int x;\nx = b < 5;").slice(0, 2), ["lbu x5, 0(x0)", "slti x5, x5, 5"]);
});

test("the memory map widens its columns for long type names", () => {
  const { asm } = generate("unsigned short h;\nint a;");
  assert.match(asm, /^# Memory map\n# {3}h {6}unsigned short 0x000\n# {3}a {6}int {12}0x004\n/);
});
