import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Runs "node scripts/assemble.js <args>" exactly as a user would in the terminal.
function run(...args) {
  const result = spawnSync(process.execPath, ["scripts/assemble.js", ...args], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

// The Hex column of the printed table, in order (comments may contain other hex numbers).
const words = (out) => [...out.matchAll(/^0x[0-9A-F]{3} {4}(0x[0-9A-F]{8})/gm)].map((m) => m[1]);

const HARDWARE_WORDS = [
  "0x00800993", "0x00300A13", "0x013A1663", "0x013A0AB3", "0x00000063", "0x41498AB3",
  "0x013A4463", "0x06300B13", "0x013A5463", "0x00100B13", "0xFFF00B93", "0x0179E463",
  "0x06300C13", "0x013BC463", "0x06300C13", "0x013BF463", "0x06300C13", "0x00300C93",
  "0xFFFC8C93", "0xFE0C9EE3", "0x00000063",
];

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
