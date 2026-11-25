import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenize } from "../../src/compiler/lexer.js";
import { parse } from "../../src/compiler/parser.js";
import { analyze } from "../../src/compiler/semantic.js";

// ---------- helpers ----------

// Parses "int main() { <code> }" (must be valid syntax) and returns the parser's AST.
function parsed(code) {
  const { tokens } = tokenize(`int main() {\n${code}\n}`);
  const result = parse(tokens);
  assert.deepEqual(result.errors, [], "the test program must have no syntax errors");
  return result.ast;
}

function analyzed(code) {
  return analyze(parsed(code));
}

function messages(code) {
  return analyzed(code).errors.map((e) => e.message);
}

// The expression assigned by the statement number `n` of main, after analysis.
function valueOf(code, n = 0) {
  const { ast, errors } = analyzed(code);
  assert.deepEqual(errors, []);
  return ast.body.statements[n].value;
}

// Every expression node of a tree (Number, VarRef, Unary, Binary), found by walking all fields.
function expressionsOf(node, found = []) {
  if (node === null || typeof node !== "object") return found;
  if (["Number", "VarRef", "Unary", "Binary"].includes(node.kind)) found.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => expressionsOf(child, found));
    else expressionsOf(value, found);
  }
  return found;
}

// ---------- memory layout ----------

test("variables get consecutive addresses in declaration order", () => {
  const { symbols, errors } = analyzed("int a;\nint v[4];\nint b;");
  assert.deepEqual(errors, []);
  assert.deepEqual(symbols, [
    { name: "a", type: "int", address: 0, size: 4, length: null, line: 2 },
    { name: "v", type: "int", address: 4, size: 4, length: 4, line: 3 },
    { name: "b", type: "int", address: 20, size: 4, length: null, line: 4 },
  ]);
});

test("a declaration inside a loop allocates its variable once", () => {
  const { symbols, errors } = analyzed("int i;\nwhile (i < 3) { int t = i; i++; }\nt = 5;");
  assert.deepEqual(errors, []); // one scope for all of main: t is still visible after the loop
  assert.deepEqual(symbols.map((s) => [s.name, s.address]), [["i", 0], ["t", 4]]);
});

test("exactly 1024 bytes fit; one more byte does not", () => {
  assert.deepEqual(messages("int v[256];"), []);
  assert.deepEqual(analyzed("int a;\nint v[256];").errors, [
    { line: 3, message: "variables need 1028 bytes but data memory has 1024 ('v' does not fit)" },
  ]);
});

test("symbols are frozen", () => {
  const { symbols } = analyzed("int a;");
  assert.ok(Object.isFrozen(symbols[0]));
});

// ---------- the output tree ----------

test("every expression node gets a type", () => {
  const { ast } = analyzed("int a; int v[2];\na = -a + v[a & 1] << 2;\nif (a < 3) v[0] = a == 1;\nwhile (a) a--;");
  const expressions = expressionsOf(ast);
  assert.ok(expressions.length > 10);
  for (const node of expressions) assert.equal(node.type, "int", `${node.kind} at line ${node.line}`);
});

test("the input tree is not modified (pure function)", () => {
  const input = parsed("int a; a = -5 + a;");
  const copy = structuredClone(input);
  analyze(input);
  assert.deepEqual(input, copy);
});

test("negative literals are folded into one Number", () => {
  assert.deepEqual(valueOf("int x;\nx = -5;", 1), { kind: "Number", value: -5, line: 3, type: "int" });
  assert.equal(valueOf("int x;\nx = -(-7);", 1).value, 7);
  assert.equal(valueOf("int x;\nx = - - -2;", 1).value, -2);
});

test("-0 folds to plain 0 (not JavaScript's negative zero)", () => {
  assert.ok(Object.is(valueOf("int x;\nx = -0;", 1).value, 0));
});

test("unary minus of a variable is kept as Unary", () => {
  const value = valueOf("int a; int x;\nx = -a;", 2);
  assert.equal(value.kind, "Unary");
  assert.equal(value.operand.kind, "VarRef");
});

// ---------- constants ----------

test("constants must be in [-2048, 2047]", () => {
  assert.deepEqual(messages("int x; x = 2047; x = -2048; x = 0x7FF;"), []);
  const outOfRange = (value) =>
    `constant ${value} is out of range [-2048, 2047] (larger constants would need lui, which the hardware does not have)`;
  assert.deepEqual(messages("int x; x = 2048;"), [outOfRange(2048)]);
  assert.deepEqual(messages("int x; x = -2049;"), [outOfRange(-2049)]);
  assert.deepEqual(messages("int x; x = -(-2048);"), [outOfRange(2048)]);
  assert.deepEqual(messages("int x; x = 0x800;"), [outOfRange(2048)]);
});

test("constant shift amounts must be in [0, 31]", () => {
  assert.deepEqual(messages("int a; a = a << 31; a = a >> 0; a = a << a;"), []);
  assert.deepEqual(messages("int a; a = a << 32;"), ["shift amount 32 is out of range [0, 31]"]);
  assert.deepEqual(messages("int a; a = a >> -1;"), ["shift amount -1 is out of range [0, 31]"]);
});

// ---------- symbols errors ----------

test("using an undeclared variable is an error, reported once per line", () => {
  assert.deepEqual(analyzed("y = y + 1;").errors, [{ line: 2, message: "'y' is not declared" }]);
  assert.deepEqual(messages("int v[2]; v[k] = 1;"), ["'k' is not declared"]);
});

test("a variable must be declared before it is used", () => {
  assert.deepEqual(messages("x = 1; int x;"), ["'x' is not declared"]);
});

test("int x = x; is accepted, as in C", () => {
  assert.deepEqual(messages("int x = x;"), []);
});

test("redeclaration is an error that names the first line", () => {
  assert.deepEqual(analyzed("int a;\nint a;").errors, [
    { line: 3, message: "'a' is already declared (line 2)" },
  ]);
});

test("scalars cannot be indexed; arrays need an index", () => {
  assert.deepEqual(messages("int x; x[0] = 1;"), ["'x' is not an array, it cannot be indexed"]);
  assert.deepEqual(messages("int x; int y; y = x[1];"), ["'x' is not an array, it cannot be indexed"]);
  assert.deepEqual(messages("int v[3]; v = 1;"), ["array 'v' needs an index: v[i]"]);
  assert.deepEqual(messages("int v[3]; int y; y = v + 1;"), ["array 'v' needs an index: v[i]"]);
});

test("constant indexes must be inside the array; variable indexes are not checked", () => {
  assert.deepEqual(messages("int v[4]; int i; v[0] = 1; v[3] = 2; v[i] = v[i + 9];"), []);
  assert.deepEqual(messages("int v[4]; v[4] = 1;"), ["index 4 is out of bounds for 'v' (valid: 0..3)"]);
  assert.deepEqual(messages("int v[4]; int y; y = v[-1];"), ["index -1 is out of bounds for 'v' (valid: 0..3)"]);
});

test("an array needs at least one element", () => {
  assert.deepEqual(messages("int v[0];"), ["array 'v' must have at least 1 element"]);
});

test("all errors are reported in one run", () => {
  const { errors } = analyzed("int a;\nint a;\nb = 1;\na = 5000;\na = a << 40;");
  assert.deepEqual(errors.map((e) => e.line), [3, 4, 5, 6]);
});

// ---------- phase 2: every type ----------

// Type of the value assigned by statement n of main, after analysis.
function typesOf(code, n) {
  const value = valueOf(code, n);
  return { type: value.type, operandType: value.operandType };
}

test("sizes and alignment: each variable starts at a multiple of its own size", () => {
  const { symbols, errors } = analyzed("char c;\nint a;\nshort s;\nchar d;\nshort t;\nunsigned char u[3];\nunsigned v;");
  assert.deepEqual(errors, []);
  assert.deepEqual(symbols.map((s) => [s.name, s.type, s.address, s.size]), [
    ["c", "char", 0, 1],
    ["a", "int", 4, 4],            // 1, 2, 3 are skipped: an int must be at a multiple of 4
    ["s", "short", 8, 2],
    ["d", "char", 10, 1],
    ["t", "short", 12, 2],         // 11 is skipped: a short must be at a multiple of 2
    ["u", "unsigned char", 14, 1], // 14, 15, 16
    ["v", "unsigned int", 20, 4],  // 17..19 skipped
  ]);
});

test("the memory limit counts bytes, not variables", () => {
  assert.deepEqual(messages("char s[1024];"), []);
  assert.deepEqual(messages("char s[1024]; char x;"),
    ["variables need 1025 bytes but data memory has 1024 ('x' does not fit)"]);
});

test("reading a char or short gives an int (integer promotion)", () => {
  const { ast } = analyzed("char c; unsigned short h; int x;\nx = c;\nx = h;");
  assert.equal(ast.body.statements[3].value.type, "int");
  assert.equal(ast.body.statements[4].value.type, "int");
});

test("arithmetic: unsigned int wins; small unsigned types do not", () => {
  const decl = "unsigned u; int a; unsigned char b; int x;\n";
  assert.deepEqual(typesOf(decl + "x = u + a;", 4), { type: "unsigned int", operandType: "unsigned int" });
  assert.deepEqual(typesOf(decl + "x = a + 1;", 4), { type: "int", operandType: "int" });
  assert.deepEqual(typesOf(decl + "x = b + b;", 4), { type: "int", operandType: "int" });
  assert.deepEqual(typesOf(decl + "x = -u;", 4).type, "unsigned int");
});

test("comparisons: the result is int, the operands are compared in the common type", () => {
  const decl = "unsigned u; int a; int x;\n";
  assert.deepEqual(typesOf(decl + "x = u < 5;", 3), { type: "int", operandType: "unsigned int" });
  assert.deepEqual(typesOf(decl + "x = a < -1;", 3), { type: "int", operandType: "int" });
  // C rule: -1 is converted to unsigned (0xFFFFFFFF), so u < -1 is an unsigned comparison
  assert.deepEqual(typesOf(decl + "x = u < -1;", 3), { type: "int", operandType: "unsigned int" });
});

test("shifts take the type of the left operand only", () => {
  const decl = "unsigned u; int a; int x;\n";
  assert.deepEqual(typesOf(decl + "x = a >> u;", 3), { type: "int", operandType: "int" });
  assert.deepEqual(typesOf(decl + "x = u >> a;", 3), { type: "unsigned int", operandType: "unsigned int" });
});
