import { test } from "node:test";
import assert from "node:assert/strict";

import { compile } from "../../src/compiler/index.js";

const VALID = "int main() {\n  int a;\n  a = a + 5;\n}";

test("a valid program gives asm, symbols and no errors (target defaults to riscv)", () => {
  const result = compile(VALID);
  assert.deepEqual(result.errors, []);
  assert.match(result.asm, /^# Memory map\n/);
  assert.match(result.asm, /addi x5, x5, 5/);
  assert.match(result.asm, /halt:\n {4}beq {2}x0, x0, halt\n$/);
  assert.deepEqual(result.symbols, [{ name: "a", type: "int", address: 0, size: 4, length: null, line: 2 }]);
  assert.deepEqual(compile(VALID, "riscv"), result);
});

test("lexer errors stop compilation: the parser does not add false errors", () => {
  // "x = ;" is also a syntax error, but the lexer fails first
  assert.deepEqual(compile("int main() {\n  int a = 2 * 3;\n  x = ;\n}"), {
    asm: "",
    symbols: [],
    errors: [{ line: 2, message: "multiplication is not supported: the RV32I hardware has no mul; use << for powers of 2" }],
  });
});

test("parser errors stop compilation before semantic analysis", () => {
  // "y" is undeclared, but the missing ";" is reported alone
  assert.deepEqual(compile("int main() {\n  y = 1\n}").errors, [
    { line: 2, message: "expected ';' but found '}'" },
  ]);
});

test("semantic errors are reported", () => {
  assert.deepEqual(compile("int main() {\n  y = 1;\n}").errors, [{ line: 2, message: "'y' is not declared" }]);
});

test("backend errors are reported", () => {
  const lines = Array.from({ length: 200 }, () => "  a = 1;").join("\n");
  const { errors } = compile(`int main() {\n  int a;\n${lines}\n}`);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /instruction memory holds 256/);
});

test("an unknown target is rejected before compiling", () => {
  assert.deepEqual(compile("this is not C", "x86").errors, [{ line: null, message: 'unknown target "x86"' }]);
});

test("mips and arm: the C program is checked, then 'not implemented yet'", () => {
  for (const target of ["mips", "arm"]) {
    assert.deepEqual(compile(VALID, target).errors,
      [{ line: null, message: `target "${target}" is not implemented yet` }]);
    // errors in the C program are the same for every target
    assert.deepEqual(compile("int main() { y = 1; }", target).errors, compile("int main() { y = 1; }").errors);
  }
});
