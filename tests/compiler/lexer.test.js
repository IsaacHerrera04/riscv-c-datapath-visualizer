import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenize } from "../../src/compiler/lexer.js";

// "int x = 5;" → ["keyword int", "identifier x", "operator =", "number 5", "punct ;", "eof"]
// Compact form so expected token lists stay readable.
function summary(source) {
  return tokenize(source).tokens.map((t) => (t.kind === "eof" ? "eof" : `${t.kind} ${t.value}`));
}

function values(source) {
  return tokenize(source).tokens.filter((t) => t.kind !== "eof").map((t) => t.value);
}

function messages(source) {
  return tokenize(source).errors.map((e) => e.message);
}

// ---------- tokens ----------

test("a declaration becomes keyword, identifier, operator, number, punct, eof", () => {
  assert.deepEqual(summary("int x = 5;"), [
    "keyword int", "identifier x", "operator =", "number 5", "punct ;", "eof",
  ]);
  assert.deepEqual(tokenize("int x = 5;").errors, []);
});

test("keywords are recognized; similar names are identifiers", () => {
  assert.deepEqual(summary("int unsigned short char void if else while for return"),
    [..."int unsigned short char void if else while for return".split(" ").map((k) => `keyword ${k}`), "eof"]);
  assert.deepEqual(summary("integer while_ x1 _tmp Int"), [
    "identifier integer", "identifier while_", "identifier x1", "identifier _tmp", "identifier Int", "eof",
  ]);
});

test("decimal and hexadecimal numbers become JS numbers", () => {
  assert.deepEqual(values("0 7 2047 0x1F 0XfF 0x0"), [0, 7, 2047, 31, 255, 0]);
});

test("minus is an operator, not part of the number", () => {
  assert.deepEqual(summary("a-1"), ["identifier a", "operator -", "number 1", "eof"]);
});

test("longest match wins: <<= over << over <", () => {
  assert.deepEqual(values("a<<=b"), ["a", "<<=", "b"]);
  assert.deepEqual(values("a<<b"), ["a", "<<", "b"]);
  assert.deepEqual(values("a<=b"), ["a", "<=", "b"]);
  assert.deepEqual(values("a<b"), ["a", "<", "b"]);
});

test("every valid operator is one token", () => {
  const all = "<<= >>= << >> <= >= == != += -= &= |= ^= ++ -- + - & | ^ < > =";
  assert.deepEqual(values(all), all.split(" "));
  assert.deepEqual(tokenize(all).errors, []);
});

test("punctuation tokens", () => {
  assert.deepEqual(summary("( ) { } [ ] ; ,").slice(0, -1),
    "( ) { } [ ] ; ,".split(" ").map((p) => `punct ${p}`));
});

test("i++ and x+=1 without spaces", () => {
  assert.deepEqual(values("i++;"), ["i", "++", ";"]);
  assert.deepEqual(values("x+=1;"), ["x", "+=", 1, ";"]);
});

test("empty source gives only eof", () => {
  assert.deepEqual(tokenize(""), { tokens: [{ kind: "eof", value: null, line: 1 }], errors: [] });
});

// ---------- lines and comments ----------

test("every token records its line; eof has the last line", () => {
  const { tokens } = tokenize("int a;\n\nint b;\n");
  assert.deepEqual(tokens.map((t) => t.line), [1, 1, 1, 3, 3, 3, 4]);
});

test("line comments are ignored", () => {
  assert.deepEqual(values("a = 1; // a / b * c\nb = 2;"), ["a", "=", 1, ";", "b", "=", 2, ";"]);
  assert.deepEqual(tokenize("x // comment at end of file").errors, []);
});

test("block comments are ignored and their newlines still count", () => {
  const { tokens, errors } = tokenize("a /* one\ntwo\nthree */ b");
  assert.deepEqual(errors, []);
  assert.deepEqual(tokens.map((t) => [t.value, t.line]), [["a", 1], ["b", 3], [null, 3]]);
});

test("unterminated block comment is an error on the line where it starts", () => {
  assert.deepEqual(tokenize("a;\n/* never closed\n b;").errors, [
    { line: 2, message: "unterminated comment: missing */" },
  ]);
});

// ---------- rejected operators ----------

test("* and *= explain that there is no multiplication", () => {
  for (const source of ["a * b", "a *= 2"]) {
    assert.deepEqual(messages(source),
      ["multiplication is not supported: the RV32I hardware has no mul; use << for powers of 2"]);
  }
});

test("/ and /= explain that there is no division", () => {
  for (const source of ["a / b", "a /= 2"]) {
    assert.deepEqual(messages(source),
      ["division is not supported: the RV32I hardware has no div; use >> for powers of 2"]);
  }
});

test("% and %= explain that there is no remainder", () => {
  for (const source of ["a % b", "a %= 2"]) {
    assert.deepEqual(messages(source),
      ["remainder is not supported: the RV32I hardware has no rem; use & (2^k - 1) for powers of 2"]);
  }
});

test("&&, || and ! are rejected as logical operators", () => {
  for (const source of ["a && b", "a || b", "!a"]) {
    assert.deepEqual(messages(source), ["logical operators are not supported; use nested if"]);
  }
});

test("&& is one rejected symbol, not two valid & operators", () => {
  assert.deepEqual(values("a && b"), ["a", "b"]);
});

test("!= is valid even though ! is rejected", () => {
  assert.deepEqual(values("a != b"), ["a", "!=", "b"]);
  assert.deepEqual(messages("a != b"), []);
});

// ---------- other errors ----------

test("unexpected characters are reported and skipped", () => {
  assert.deepEqual(messages("a @ b"), ["unexpected character '@'"]);
  assert.deepEqual(values("a @ b"), ["a", "b"]);
  assert.deepEqual(messages('"hi"'), [`unexpected character '"'`, `unexpected character '"'`]);
});

test("invalid numbers are reported as a whole word", () => {
  assert.deepEqual(messages("12abc"), ["invalid number '12abc'"]);
  assert.deepEqual(messages("0x"), ["invalid number '0x'"]);
  assert.deepEqual(messages("0x1G"), ["invalid number '0x1G'"]);
});

test("octal numbers are rejected (017 is 15 in C)", () => {
  assert.deepEqual(messages("017"),
    ["octal numbers are not supported: '017' has a leading zero (in C, 017 means 15)"]);
});

test("several errors are all reported with their lines", () => {
  const { errors } = tokenize("int a = 2 * 3;\nint b = a / 2;\nif (!a) b = 1 @ 2;");
  assert.deepEqual(errors.map((e) => e.line), [1, 2, 3, 3]);
});
