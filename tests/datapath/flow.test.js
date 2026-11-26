import { test } from "node:test";
import assert from "node:assert/strict";

import { flowSteps, CONTROL_TARGETS } from "../../src/datapath/flow.js";
import { activePaths } from "../../src/datapath/activity.js";
import { CONTROL_SIGNALS } from "../../src/datapath/control.js";
import { INSTRUCTIONS } from "../../src/shared/instructions.js";
import { assemble } from "../../src/assembler/index.js";
import { decode } from "../../src/decoder/index.js";

const stepsOf = (source) => flowSteps(activePaths(decode(assemble(source).program[0].word)));

// a < b < c < ... in time
function inOrder(steps, names) {
  names.slice(1).forEach((name, i) =>
    assert.ok(steps[names[i]] < steps[name], `${names[i]} (${steps[names[i]]}) before ${name} (${steps[name]})`));
}

test("R: fetch, read registers, ALU, write back — in that order", () => {
  const { components, wires, total } = stepsOf("add x5, x6, x7");
  assert.equal(components.PCRegister, 0);
  inOrder(components, ["PCRegister", "InstructionMemory", "RegisterFile", "ALUSrcMux", "ALU", "WriteBackMux"]);
  assert.equal(wires.writeBackData + 1, total, "the value written back is the last to arrive");
});

test("a block waits for its latest input (ALU waits for the mux, the mux for the immediate)", () => {
  const { components } = stepsOf("lw x5, 8(x6)");
  inOrder(components, ["ImmSelector", "SignExtender", "ALUSrcMux", "ALU", "DataMemory", "LoadExtender", "WriteBackMux"]);
  assert.equal(components.ALU, components.ALUSrcMux + 1);
});

test("B: the next PC is computed last, after the branch decision", () => {
  const { components, wires, total } = stepsOf("bne x5, x6, 8");
  inOrder(components, ["ALU", "ConditionBit", "BranchInvertMux", "BranchAnd", "PCIncrementMux", "PCAdder"]);
  assert.equal(wires.pcNext + 1, total);
});

test("not a branch: the next PC (PC + 4) is ready early, in parallel with the rest", () => {
  const { components } = stepsOf("add x5, x6, x7");
  assert.ok(components.PCAdder < components.ALU);
});

test("every active part has a step and the others have none, for all 33 instructions", () => {
  for (const { name, type } of INSTRUCTIONS) {
    const operands = { R: "x5, x6, x7", I: "x5, x6, 3", L: "x5, 8(x6)", S: "x7, 8(x6)", B: "x5, x6, 8" }[type];
    const paths = activePaths(decode(assemble(`${name} ${operands}`).program[0].word));
    const steps = flowSteps(paths); // would throw if the drawing had a loop
    assert.deepEqual(Object.keys(steps.components), paths.components, name);
    assert.deepEqual(Object.keys(steps.wires).sort(), [...paths.wires, ...paths.conditionalWires].sort(), name);
    for (const [wire, step] of Object.entries(steps.wires)) assert.ok(step < steps.total, `${name}: ${wire}`);
  }
});

test("control lines leave when the control unit has decoded the instruction", () => {
  const { components, controls } = stepsOf("sw x7, 8(x6)");
  assert.deepEqual(Object.keys(controls).sort(), CONTROL_SIGNALS.map((s) => s.name).sort());
  assert.ok(Object.values(controls).every((step) => step === components.ControlUnit));
});

test("CONTROL_TARGETS names a real target for every signal; no paths → null", () => {
  assert.deepEqual(Object.keys(CONTROL_TARGETS).sort(), CONTROL_SIGNALS.map((s) => s.name).sort());
  assert.equal(flowSteps(null), null);
  assert.ok(Object.isFrozen(stepsOf("add x1, x2, x3")));
});
