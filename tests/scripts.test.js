import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { HARDWARE_PROGRAM } from "./fixtures/vectors.js";
import { assemble } from "../src/assembler/index.js";

// Runs "node scripts/<script> <args>" exactly as a user would in the terminal.
function runScript(script, ...args) {
  const result = spawnSync(process.execPath, [`scripts/${script}`, ...args], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const run = (...args) => runScript("assemble.js", ...args);
const runCompile = (...args) => runScript("compile.js", ...args);

// The Hex column of the printed table, in order (comments may contain other hex numbers).
const words = (out) => [...out.matchAll(/^0x[0-9A-F]{3} {4}(0x[0-9A-F]{8})/gm)].map((m) => m[1]);

const HARDWARE_WORDS = HARDWARE_PROGRAM.map(([, hex]) => hex);

test("demo: hardware test program prints the VHDL hex words", () => {
  const { code, out } = run("scripts/demo/hardware-test.s");
  assert.equal(code, 0);
  assert.deepEqual(words(out), HARDWARE_WORDS);
  assert.match(out, /^0x000 {4}0x00800993 {2}addi x19, x0, 8/m);
  assert.match(out, /21 instructions, 84 bytes\./);
});

test("demo: the labels version prints the same words", () => {
  const { code, out } = run("scripts/demo/hardware-test-labels.s");
  assert.equal(code, 0);
  assert.deepEqual(words(out), HARDWARE_WORDS);
});

test("demo: errors are listed with their lines and exit code 1", () => {
  const { code, out } = run("scripts/demo/errors.s");
  assert.equal(code, 1);
  assert.equal(
    out,
    "5 error(s) in scripts/demo/errors.s:\n" +
    "  line 5: add expects 3 operands (add rd, rs1, rs2) but found 2\n" +
    "  line 6: immediate 5000 out of range [-2048, 2047]\n" +
    '  line 7: unknown instruction "mul"\n' +
    '  line 8: malformed memory operand "8x0" (expected offset(register), e.g. 8(x0))\n' +
    '  line 9: undefined label "nowhere"\n',
  );
});

test("missing argument or unreadable file exit with code 2", () => {
  const noArgs = run();
  assert.equal(noArgs.code, 2);
  assert.match(noArgs.err, /^Usage: node scripts\/assemble\.js <file\.s>/);

  const missing = run("scripts/demo/does-not-exist.s");
  assert.equal(missing.code, 2);
  assert.match(missing.err, /^Cannot read "scripts\/demo\/does-not-exist\.s"/);
});

// ---------- scripts/compile.js ----------

test("compile: prints the assembly of a C file, ending with halt", () => {
  const { code, out } = runCompile("scripts/demo/sum-array.c");
  assert.equal(code, 0);
  assert.match(out, /^# Memory map\n#   v\[5\]   int      0x000\.\.0x013\n/);
  assert.match(out, /# line 9: v\[i\] = i \+ 1;/);
  assert.match(out, /halt:\n {4}beq {2}x0, x0, halt\n$/);
});

test("compile --machine: adds address and hex word as comments; the output still assembles", () => {
  const { code, out } = runCompile("scripts/demo/count-bits.c", "--machine");
  assert.equal(code, 0);
  assert.match(out, /^# 0x000 {4}0x5A300293 {2}addi x5, x0, 1443$/m);
  assert.match(out, /^# 17 instructions, 68 bytes\.$/m);
  assert.deepEqual(assemble(out).errors, []); // the machine code lines are comments
});

test("compile: errors are listed with their lines and exit code 1", () => {
  const { code, out } = runCompile("scripts/demo/errors.c");
  assert.equal(code, 1);
  assert.match(out, /^5 error\(s\) in scripts\/demo\/errors\.c:\n {2}line 6: 'b' is not declared\n/);
});

test("compile --target mips: the program is checked, then not implemented yet", () => {
  const { code, out } = runCompile("scripts/demo/sum-array.c", "--target", "mips");
  assert.equal(code, 1);
  assert.equal(out, '1 error(s) in scripts/demo/sum-array.c:\n  target "mips" is not implemented yet\n');
});

test("compile: usage problems exit with code 2", () => {
  const cases = [
    [[], /^Missing the C file to compile/],
    [["a.c", "--target", "x86"], /^Unknown target "x86"/],
    [["a.c", "--target"], /^Unknown target ""/],
    [["a.c", "--fast"], /^Unknown option "--fast"/],
    [["a.c", "b.c"], /^Only one file can be compiled at a time/],
    [["a.c", "--target", "arm", "--machine"], /^--machine is only available for riscv/],
    [["scripts/demo/nope.c"], /^Cannot read "scripts\/demo\/nope\.c"/],
  ];
  for (const [args, message] of cases) {
    const { code, err } = runCompile(...args);
    assert.equal(code, 2, args.join(" "));
    assert.match(err, message);
  }
});
