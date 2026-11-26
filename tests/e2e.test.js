// End-to-end: C → compile → assemble → decode → run in the simulator → check memory.
// Tests may connect several modules; production modules never import each other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compile } from "../src/compiler/index.js";
import { assemble } from "../src/assembler/index.js";
import { decode, disassemble } from "../src/decoder/index.js";
import { run, load } from "./helpers/rv32i-sim.js";

// How C reads a variable of each type (the same instruction the compiler uses).
const READ_AS = {
  "int": "lw", "unsigned int": "lw", "short": "lh", "unsigned short": "lhu", "char": "lb", "unsigned char": "lbu",
};

// Compiles and runs a C program. Returns a function to read variables by name after it halts.
function compileAndRun(source) {
  const compiled = compile(source);
  assert.deepEqual(compiled.errors, [], "compile errors");
  const assembled = assemble(compiled.asm);
  assert.deepEqual(assembled.errors, [], "the compiler output must assemble without errors");

  const words = assembled.program.map((instruction) => instruction.word);
  const { memory, halted } = run(words);
  assert.ok(halted, "the program must reach halt");

  const symbols = new Map(compiled.symbols.map((symbol) => [symbol.name, symbol]));
  const read = (name, index = 0) => {
    const symbol = symbols.get(name);
    const value = load(READ_AS[symbol.type], memory, symbol.address + index * symbol.size);
    return symbol.type === "unsigned int" ? value >>> 0 : value; // show unsigned int as unsigned
  };
  return { read, words, asm: compiled.asm };
}

const demo = (name) => readFileSync(`scripts/demo/${name}`, "utf8");

// ---------- demo programs (the same files the terminal tool uses) ----------

test("sum-array.c: sum = 15", () => {
  const { read } = compileAndRun(demo("sum-array.c"));
  assert.equal(read("sum"), 15);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => read("v", i)), [1, 2, 3, 4, 5]);
});

test("fibonacci.c: the first 12 Fibonacci numbers", () => {
  const { read } = compileAndRun(demo("fibonacci.c"));
  const fib = Array.from({ length: 12 }, (_, i) => read("fib", i));
  assert.deepEqual(fib, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
});

test("max-of-array.c: max = 42, with negative numbers in the array", () => {
  const { read } = compileAndRun(demo("max-of-array.c"));
  assert.equal(read("max"), 42);
  assert.equal(read("v", 5), -100);
});

test("count-bits.c: 0x5A3 has 6 bits set", () => {
  const { read } = compileAndRun(demo("count-bits.c"));
  assert.equal(read("count"), 6);
  assert.equal(read("x"), 0);
});

test("all-types.c: every type and every instruction give the values in its comments", () => {
  const { read, words } = compileAndRun(demo("all-types.c"));
  assert.deepEqual([0, 1, 2, 3].map((i) => read("c", i)), [-2, -1, 0, 1]);    // lb
  assert.deepEqual([0, 1, 2, 3].map((i) => read("b", i)), [254, 255, 0, 1]);  // lbu: the same bytes
  assert.deepEqual([read("s", 0), read("s", 1), read("h", 0), read("h", 1)], [-300, -600, 65236, 1000]);
  assert.deepEqual([read("sum"), read("big"), read("total"), read("flags")], [-2, 510, 65336, 7]);
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => read("r", i)),
    [1, 0, 1, 0, -1, -3, 16, 268435455, -1, 510, 510, 27]);
  assert.ok(words.length <= 256, `${words.length} instructions`);
});

test("errors.c: every semantic error is reported with its line", () => {
  assert.deepEqual(compile(demo("errors.c")).errors, [
    { line: 6, message: "'b' is not declared" },
    { line: 7, message: "constant 5000 is out of range [-2048, 2047] (larger constants would need lui, which the hardware does not have)" },
    { line: 8, message: "index 4 is out of bounds for 'v' (valid: 0..3)" },
    { line: 9, message: "shift amount 32 is out of range [0, 31]" },
    { line: 10, message: "'a' is not an array, it cannot be indexed" },
  ]);
});

// ---------- results of the language rules ----------

test("comparisons as values give 0 or 1, signed", () => {
  const { read } = compileAndRun(`int main() {
    int a = -3; int b = 4; int r[8];
    r[0] = a < b;  r[1] = a > b;  r[2] = a <= -3;  r[3] = b >= 5;
    r[4] = a == -3; r[5] = a != -3; r[6] = b == 0; r[7] = b != 0;
  }`);
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => read("r", i)), [1, 0, 1, 0, 1, 0, 0, 1]);
});

test("arithmetic and shifts follow C semantics for int", () => {
  const { read } = compileAndRun(`int main() {
    int a = -16; int r[7];
    r[0] = a + 2047;  r[1] = a - -2048;  r[2] = a & 0xFF;  r[3] = a | 3;
    r[4] = a ^ -1;    r[5] = a >> 2;     r[6] = 1 << 10;
  }`);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => read("r", i)),
    [2031, 2032, 240, -13, 15, -4, 1024]); // >> on int is arithmetic: -16 >> 2 = -4
});

test("if/else, while and return", () => {
  const { read } = compileAndRun(`int main() {
    int n = 10; int evens = 0; int odds = 0; int stop = 0;
    while (n != 0) {
      if (n & 1) odds++; else evens++;
      n--;
    }
    return evens;
    stop = 1;  // never runs: return jumps to halt
  }`);
  assert.deepEqual([read("evens"), read("odds"), read("stop")], [5, 5, 0]);
});

// ---------- every compiled word goes through the whole chain ----------

test("every compiled word decodes, and disassembles back to the same word", () => {
  for (const name of ["sum-array.c", "fibonacci.c", "max-of-array.c", "count-bits.c", "all-types.c"]) {
    const { words } = compileAndRun(demo(name));
    for (const word of words) {
      const decoded = decode(word);
      assert.equal(decoded.error, undefined, `${name}: 0x${word.toString(16)}`);
      assert.equal(assemble(disassemble(decoded)).program[0].word, word);
    }
  }
});

// ---------- phase 2: every type (results checked in the simulator) ----------

test("stores keep only the low bits; loads extend with or without sign", () => {
  const { read } = compileAndRun(`int main() {
    char c = 300;           // 300 = 0x12C → stores 0x2C = 44
    char d = 200;           // 0xC8: bit 7 is 1 → reads -56
    unsigned char e = 200;  // the same byte read without sign → 200
    short s; unsigned short h;
    s = 1 << 15;            // 0x8000 → -32768
    h = 1 << 15;            //        → 32768
  }`);
  assert.deepEqual([read("c"), read("d"), read("e"), read("s"), read("h")], [44, -56, 200, -32768, 32768]);
});

test("unsigned comparisons and shifts: -1 is the largest unsigned number", () => {
  const { read } = compileAndRun(`int main() {
    unsigned u = -1;  int a = -1;  int r[6];
    r[0] = u < 1;     // unsigned: 4294967295 < 1 → 0
    r[1] = a < 1;     // signed:   -1 < 1        → 1
    r[2] = u >> 28;   // srli: 0xFFFFFFFF >> 28  → 15
    r[3] = a >> 28;   // srai: copies the sign   → -1
    r[4] = a < u;     // a is converted to unsigned: 0xFFFFFFFF < 0xFFFFFFFF → 0
    if (u > 5) r[5] = 1; else r[5] = 2;   // bltu/bgeu path
  }`);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => read("r", i)), [0, 1, 15, -1, 0, 1]);
  assert.equal(read("u"), 4294967295);
});

test("arrays of every element size are indexed with the right scaling", () => {
  const { read } = compileAndRun(`int main() {
    char c[5]; short s[5]; int w[5]; int i;
    for (i = 0; i < 5; i++) {
      c[i] = i - 2;     // index not scaled
      s[i] = i << 8;    // index << 1
      w[i] = c[i] + s[i];
    }
  }`);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => read("c", i)), [-2, -1, 0, 1, 2]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => read("s", i)), [0, 256, 512, 768, 1024]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => read("w", i)), [-2, 255, 512, 769, 1026]);
});
