// Coverage: the compiler can reach every one of the 33 instructions of the hardware from C.
// The instructions are counted from the MACHINE CODE (assembled, then decoded), which is what the
// processor actually receives, not from the assembly text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { compile } from "../../src/compiler/index.js";
import { assemble } from "../../src/assembler/index.js";
import { decode } from "../../src/decoder/index.js";
import { INSTRUCTIONS } from "../../src/shared/instructions.js";

const ALL_33 = INSTRUCTIONS.map((instruction) => instruction.name);

// Set of instruction names in the machine code of a C program.
function instructionsUsedBy(source) {
  const compiled = compile(source);
  assert.deepEqual(compiled.errors, []);
  const assembled = assemble(compiled.asm);
  assert.deepEqual(assembled.errors, []);
  return new Set(assembled.program.map(({ word }) => decode(word).name));
}

const demo = (name) => readFileSync(`scripts/demo/${name}`, "utf8");

test("the hardware has exactly 33 instructions", () => {
  assert.equal(new Set(ALL_33).size, 33);
});

test("all-types.c alone uses all 33 instructions", () => {
  const used = instructionsUsedBy(demo("all-types.c"));
  const missing = ALL_33.filter((name) => !used.has(name));
  assert.deepEqual(missing, [], `instructions the compiler did not generate: ${missing.join(", ")}`);
});

test("every demo program uses only the 33 instructions of the hardware", () => {
  const programs = readdirSync("scripts/demo").filter((file) => file.endsWith(".c") && file !== "errors.c");
  assert.ok(programs.length >= 5);
  for (const file of programs) {
    for (const name of instructionsUsedBy(demo(file))) {
      assert.ok(ALL_33.includes(name), `${file}: unknown instruction ${name}`);
    }
  }
});
