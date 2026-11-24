import { test } from "node:test";
import assert from "node:assert/strict";

import { assemble } from "../../src/assembler/index.js";

// Joins lines with "\n" so each program reads like a source file.
const source = (...lines) => lines.join("\n");

// ---------- Addresses and lines (pass 1) ----------

test("empty text gives an empty program", () => {
  assert.deepEqual(assemble(""), { program: [], labels: {}, errors: [] });
});

test("each instruction gets address 4 × index; blank and comment lines take none", () => {
  const { program, errors } = assemble(source(
    "# sum two numbers",       // line 1
    "addi x5, x0, 3",          // line 2 → address 0
    "",                        // line 3
    "  addi x6, x0, 4  ",      // line 4 → address 4
    "add x7, x5, x6   # x7 = 7", // line 5 → address 8
  ));
  assert.deepEqual(errors, []);
  assert.deepEqual(
    program.map(({ address, line, source: text }) => ({ address, line, source: text })),
    [
      { address: 0, line: 2, source: "addi x5, x0, 3" },
      { address: 4, line: 4, source: "addi x6, x0, 4" },
      { address: 8, line: 5, source: "add x7, x5, x6   # x7 = 7" },
    ],
  );
});

test("labels point to the next instruction; a label-only line takes no address", () => {
  const { labels, program } = assemble(source(
    "start: addi x5, x0, 1", // address 0
    "loop:",                  // no address
    "  addi x5, x5, 1",       // address 4
    "halt: beq x0, x0, halt", // address 8
  ));
  assert.deepEqual(labels, { start: 0, loop: 4, halt: 8 });
  assert.equal(program.length, 3);
});

test("Windows line endings (\\r\\n) are accepted", () => {
  const { program, errors } = assemble("addi x5, x0, 1\r\naddi x6, x0, 2\r\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(program.map((ins) => ins.line), [1, 2]);
});

test("label names like constructor or __proto__ work as normal labels", () => {
  const { labels, errors } = assemble(source(
    "constructor: addi x5, x0, 1",
    "__proto__: beq x0, x0, constructor",
  ));
  assert.deepEqual(errors, []);
  assert.equal(labels.constructor, 0);
  assert.ok(Object.hasOwn(labels, "__proto__"));
  assert.equal(labels["__proto__"], 4);
});

// ---------- Branch offsets (pass 2) ----------

test("forward branch: offset = label address − branch address", () => {
  const { program, errors } = assemble(source(
    "beq x0, x0, end", // address 0
    "addi x5, x0, 1",  // address 4
    "end:",
    "addi x6, x0, 2",  // address 8
  ));
  assert.deepEqual(errors, []);
  assert.equal(program[0].fields.imm, 8);
});

test("backward branch gives a negative offset (hardware loop, addresses 68–76)", () => {
  // Same loop as the hardware test program, which writes the offset as -4.
  const { program, errors } = assemble(source(
    "addi x25, x0, 3",      // address 0
    "loop:",
    "addi x25, x25, -1",    // address 4
    "bne x25, x0, loop",    // address 8 → 4 − 8 = −4
  ));
  assert.deepEqual(errors, []);
  assert.equal(program[2].fields.imm, -4);
});

test("halt: a branch to itself has offset 0", () => {
  const { program } = assemble("halt: beq x0, x0, halt");
  assert.equal(program[0].fields.imm, 0);
});

test("numeric branch offsets are kept as written", () => {
  const { program, errors } = assemble(source("addi x5, x0, 1", "bne x5, x0, -4"));
  assert.deepEqual(errors, []);
  assert.equal(program[1].fields.imm, -4);
});

// ---------- Errors (with line numbers) ----------

test("parser errors get the line number of their line", () => {
  const { errors } = assemble(source(
    "addi x5, x0, 1",
    "foo x5, x6, x7",
    "addi x5, x0, 5000",
  ));
  assert.deepEqual(errors, [
    { line: 2, message: 'unknown instruction "foo"' },
    { line: 3, message: "immediate 5000 out of range [-2048, 2047]" },
  ]);
});

test("invalid label name is reported with its line", () => {
  const { errors } = assemble(source("addi x5, x0, 1", "9lives: addi x5, x0, 2"));
  assert.deepEqual(errors, [{ line: 2, message: 'invalid label name "9lives"' }]);
});

test("undefined label", () => {
  const { errors } = assemble(source("addi x5, x0, 1", "beq x5, x0, nowhere"));
  assert.deepEqual(errors, [{ line: 2, message: 'undefined label "nowhere"' }]);
});

test("duplicate label: error on the second one, the first one is kept", () => {
  const { errors, labels } = assemble(source(
    "loop: addi x5, x0, 1",
    "loop: addi x6, x0, 2",
  ));
  assert.deepEqual(errors, [{ line: 2, message: 'duplicate label "loop"' }]);
  assert.deepEqual(labels, { loop: 0 });
});

test("odd branch offset", () => {
  const { errors } = assemble("beq x0, x0, 3");
  assert.deepEqual(errors, [{ line: 1, message: "branch offset 3 is odd (must be even)" }]);
});

test("branch offset out of range [-4096, 4094]", () => {
  assert.deepEqual(assemble("beq x0, x0, 4094").errors, []);
  assert.deepEqual(assemble("beq x0, x0, -4096").errors, []);
  assert.deepEqual(assemble("beq x0, x0, 4096").errors, [
    { line: 1, message: "branch offset 4096 out of range [-4096, 4094]" },
  ]);
  assert.deepEqual(assemble("beq x0, x0, -4098").errors, [
    { line: 1, message: "branch offset -4098 out of range [-4096, 4094]" },
  ]);
});

test("program longer than 256 instructions", () => {
  const fits = Array(256).fill("addi x5, x5, 1").join("\n");
  assert.deepEqual(assemble(fits).errors, []);

  const tooLong = Array(257).fill("addi x5, x5, 1").join("\n");
  assert.deepEqual(assemble(tooLong).errors, [
    { line: 257, message: "program has 257 instructions; instruction memory holds 256" },
  ]);
});

test("several errors are all reported, sorted by line; valid lines stay in program", () => {
  const { errors, program } = assemble(source(
    "beq x0, x0, missing", // line 1: undefined label (pass 2)
    "addi x5, x0, 1",      // line 2: ok
    "2bad:",               // line 3: invalid label (pass 1)
    "add x5, x6",          // line 4: operand count (pass 2)
    "addi x6, x0, 2",      // line 5: ok
  ));
  assert.deepEqual(errors.map((e) => e.line), [1, 3, 4]);
  assert.deepEqual(program.map((ins) => ins.line), [2, 5]);
});
