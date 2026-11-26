// In what order the parts of the datapath receive their values: the "steps" of the trace animation.
//
//   flowSteps(activePaths(decode(word of "add x5, x6, x7")))
//   → { components: { PCRegister: 0, InstructionMemory: 1, ..., ALU: 4, WriteBackMux: 5 },
//       wires: { pc: 0, instruction: 1, ..., aluResult: 4, writeBackData: 5 },
//       controls: { regWrite: 2, ... }, total: 6 }   // total: when the last value arrives
//
// Rule (like a real combinational circuit): a block has its output ready one step after the LAST
// of its inputs arrives. A wire starts moving at the step of the block it comes from.
// Still a static view: the steps depend only on which parts the instruction type uses.

import { WIRES } from "./activity.js";

// Where each control line of the control unit goes.
export const CONTROL_TARGETS = Object.freeze({
  regWrite: "RegisterFile",
  memWrite: "DataMemory",
  aluSrc: "ALUSrcMux",
  memToReg: "WriteBackMux",
  immSrc: "ImmSelector",
  aluControl: "ALU",
  branch: "BranchAnd",
  branchInvert: "BranchInvertMux",
});

// Inputs that are only stored at the end of the cycle (the clock edge), so they do not delay the
// block: the register file is read before rd is written, and the PC changes at the next edge.
// Without this, the drawing would be a loop (PC → ... → PC, registers → ... → registers).
const STORED_AT_CLOCK_EDGE = new Set(["pcNext", "writeBackData", "instRd", "regWrite"]);

const WIRE_BY_NAME = new Map(WIRES.map((w) => [w.name, w]));

// Steps for the result of activePaths(), or null if there is none.
export function flowSteps(paths) {
  if (!paths) return null;
  const wires = [...paths.wires, ...paths.conditionalWires];

  // For each active component, the blocks its inputs come from (null = a constant).
  const sources = new Map(paths.components.map((name) => [name, []]));
  for (const name of wires) {
    const { from, to } = WIRE_BY_NAME.get(name);
    if (STORED_AT_CLOCK_EDGE.has(name)) continue;
    to.filter((end) => sources.has(end)).forEach((end) => sources.get(end).push(from));
  }
  for (const [signal, target] of Object.entries(CONTROL_TARGETS)) {
    if (!STORED_AT_CLOCK_EDGE.has(signal) && sources.has(target)) sources.get(target).push("ControlUnit");
  }

  // step(block) = 1 + the latest step among its sources; a block with no inputs starts at 0.
  const steps = new Map();
  const stepOf = (name, path = []) => {
    if (name === null) return 0;
    if (steps.has(name)) return steps.get(name);
    if (path.includes(name)) throw new Error(`the datapath has a loop: ${[...path, name].join(" → ")}`);
    const inputs = sources.get(name);
    const step = inputs.length === 0 ? 0 : 1 + Math.max(...inputs.map((s) => stepOf(s, [...path, name])));
    steps.set(name, step);
    return step;
  };

  const components = Object.fromEntries(paths.components.map((name) => [name, stepOf(name)]));
  const wireSteps = Object.fromEntries(wires.map((name) => [name, stepOf(WIRE_BY_NAME.get(name).from)]));
  const controlStep = components.ControlUnit;
  const controls = Object.fromEntries(Object.keys(CONTROL_TARGETS).map((signal) => [signal, controlStep]));
  // the step when the last value arrives (a wire arrives one step after it starts)
  const total = Math.max(...Object.values(components), ...Object.values(wireSteps).map((s) => s + 1));

  return Object.freeze({
    components: Object.freeze(components),
    wires: Object.freeze(wireSteps),
    controls: Object.freeze(controls),
    total,
  });
}
