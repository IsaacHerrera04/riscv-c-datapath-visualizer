import { test } from "node:test";
import assert from "node:assert/strict";

import { activePaths, COMPONENTS, WIRES } from "../../src/datapath/activity.js";
import { INSTRUCTIONS } from "../../src/shared/instructions.js";
import { assemble } from "../../src/assembler/index.js";
import { decode } from "../../src/decoder/index.js";

const decoded = (source) => decode(assemble(source).program[0].word);

const COMPONENT_NAMES = COMPONENTS.map((c) => c.name);
const WIRE_BY_NAME = new Map(WIRES.map((w) => [w.name, w]));

// One example per type, and every instruction of the 33 (for the checks that apply to all).
const EXAMPLES = {
  R: "add x5, x6, x7", I: "addi x5, x6, -12", L: "lb x5, 12(x0)", S: "sw x7, 8(x6)", B: "bne x5, x6, 8",
};
const ALL_33 = INSTRUCTIONS.map(({ name, type }) =>
  decoded(`${name} ${{ R: "x5, x6, x7", I: "x5, x6, 3", L: "x5, 8(x6)", S: "x7, 8(x6)", B: "x5, x6, 8" }[type]}`));

const ALWAYS = ["PCRegister", "InstructionMemory", "PCAdder", "PCIncrementMux", "ControlUnit"];

test("the hardware has 17 components and names are unique", () => {
  assert.equal(COMPONENTS.length, 17);
  assert.equal(new Set(COMPONENT_NAMES).size, 17);
  assert.equal(new Set(WIRES.map((w) => w.name)).size, WIRES.length);
});

test("every wire connects real components", () => {
  for (const { name, from, to } of WIRES) {
    for (const end of [from, ...to].filter((end) => end !== null)) {
      assert.ok(COMPONENT_NAMES.includes(end), `${name}: unknown component ${end}`);
    }
  }
});

test("R: register file → ALU → write back; no memory, no immediate", () => {
  const { components, wires, conditionalWires } = activePaths(decoded(EXAMPLES.R));
  assert.deepEqual(components, [...ALWAYS, "RegisterFile", "ALUSrcMux", "ALU", "WriteBackMux"]);
  assert.ok(wires.includes("rs2Data") && wires.includes("aluResult") && wires.includes("instRd"));
  assert.ok(!wires.includes("imm12") && !wires.includes("memAddress"));
  assert.deepEqual(conditionalWires, []);
});

test("I: the immediate replaces rs2", () => {
  const { components, wires } = activePaths(decoded(EXAMPLES.I));
  assert.ok(components.includes("ImmSelector") && components.includes("SignExtender"));
  assert.ok(wires.includes("immExt") && !wires.includes("rs2Data") && !wires.includes("instRs2"));
});

test("L: the ALU result is an address; the value written back comes from memory", () => {
  const { components, wires } = activePaths(decoded(EXAMPLES.L));
  assert.ok(components.includes("DataMemory") && components.includes("LoadExtender"));
  assert.ok(wires.includes("memAddress") && wires.includes("loadData") && wires.includes("instLoadSize"));
  assert.ok(!wires.includes("aluResult"), "the ALU → WriteBackMux branch is not selected");
});

test("S: rs2 goes to memory, not through the ALU mux; nothing is written back", () => {
  const { components, wires } = activePaths(decoded(EXAMPLES.S));
  assert.ok(wires.includes("storeData") && wires.includes("instStoreSize") && wires.includes("instRs2"));
  assert.ok(!wires.includes("rs2Data") && !wires.includes("instRd") && !wires.includes("writeBackData"));
  assert.ok(!components.includes("WriteBackMux") && !components.includes("LoadExtender"));
});

test("B: comparison path active; the PC increment (4 or offset) is conditional", () => {
  const { components, wires, conditionalWires } = activePaths(decoded(EXAMPLES.B));
  for (const name of ["ConditionBit", "BranchInvertMux", "BranchAnd", "BranchImmGen"]) {
    assert.ok(components.includes(name), name);
  }
  assert.ok(wires.includes("aluCompare") && wires.includes("branchTaken"));
  assert.ok(!wires.includes("aluResult") && !wires.includes("writeBackData"));
  assert.deepEqual(conditionalWires, ["const4", "branchOffset"]);
  assert.ok(!wires.includes("const4"), "a wire is either active or conditional, not both");
});

test("every active or conditional wire connects active components", () => {
  for (const instruction of ALL_33) {
    const { components, wires, conditionalWires } = activePaths(instruction);
    for (const name of [...wires, ...conditionalWires]) {
      const { from, to } = WIRE_BY_NAME.get(name);
      // the source must be on (null = constant input); with several destinations, at least one
      if (from !== null) assert.ok(components.includes(from), `${instruction.name}: ${name} starts at ${from}`);
      if (to.length > 0) {
        assert.ok(to.some((end) => components.includes(end)), `${instruction.name}: ${name} goes nowhere active`);
      }
    }
  }
});

test("every component and every wire is used by some type", () => {
  const usedComponents = new Set();
  const usedWires = new Set();
  for (const instruction of ALL_33) {
    const paths = activePaths(instruction);
    paths.components.forEach((name) => usedComponents.add(name));
    [...paths.wires, ...paths.conditionalWires].forEach((name) => usedWires.add(name));
  }
  assert.deepEqual([...usedComponents].sort(), [...COMPONENT_NAMES].sort());
  assert.deepEqual([...usedWires].sort(), WIRES.map((w) => w.name).sort());
});

test("only the type matters: instructions of the same type use the same paths", () => {
  assert.deepEqual(activePaths(decoded("add x5, x6, x7")), activePaths(decoded("sra x1, x2, x3")));
  assert.deepEqual(activePaths(decoded("lw x5, 0(x0)")), activePaths(decoded("lhu x9, -4(x8)")));
});

test("an invalid instruction has no paths; the result is frozen", () => {
  assert.equal(activePaths(decode(0xFFFFFFFF)), null);
  const paths = activePaths(decoded(EXAMPLES.R));
  assert.ok(Object.isFrozen(paths) && Object.isFrozen(paths.wires));
});
