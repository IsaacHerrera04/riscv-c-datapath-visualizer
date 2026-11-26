// Which parts of the hardware an instruction uses (static view: nothing is executed).
//
//   activePaths(decode(word of "lb x5, 12(x0)"))
//   → { components: ["PCRegister", ..., "DataMemory", "LoadExtender", "WriteBackMux"],
//       wires: ["pc", "instruction", ..., "memWord", "loadData", "writeBackData"],
//       conditionalWires: [] }
//
// Like the control unit, this depends only on the instruction TYPE. A branch cannot know whether
// it is taken without the register values, so its two possible PC increments are "conditional".

import { findByName } from "../shared/instructions.js";

// ---------- the hardware (docs/DESIGN.md section 7) ----------

// The 17 components of the schematic, with their VHDL names.
export const COMPONENTS = Object.freeze([
  component("PCRegister", "registro_pc"),
  component("InstructionMemory", "fibona"),
  component("PCAdder", "sumador_pc"),
  component("PCIncrementMux", "mux_pc"),
  component("BranchImmGen", "extensor_b"),
  component("ControlUnit", "control_04"),
  component("RegisterFile", "BancoDeRegistros"),
  component("ImmSelector", "selector_imm"),
  component("SignExtender", "Extensor_01"),
  component("ALUSrcMux", "MUX_01"),
  component("ALU", "ALU_B"),
  component("ConditionBit", "Extraer_Bit"),
  component("BranchInvertMux", "mux_1bit + NOT"),
  component("BranchAnd", "AND"),
  component("DataMemory", "memoria_datos_s"),
  component("LoadExtender", "extensor_ccarga"),
  component("WriteBackMux", "MUXL"),
]);

function component(name, vhdlName) {
  return Object.freeze({ name, vhdlName });
}

// Data wires: where each one starts and where it ends. A VHDL net that goes to several places
// is split into one wire per destination, so only the branch that matters lights up
// (in sw, rs2 goes to memory, not through the ALU mux).
// from: null = a constant input of the diagram.
export const WIRES = Object.freeze([
  // instruction fetch and next PC
  wire("pc", "BUS3492", "PCRegister", ["InstructionMemory", "PCAdder"]),
  wire("instruction", "INST", "InstructionMemory", []), // the 32 bits; the fields below fan out
  wire("const4", "CONST", null, ["PCIncrementMux"]),
  wire("branchOffset", "BUS1748", "BranchImmGen", ["PCIncrementMux"]),
  wire("pcIncrement", "BUS1914", "PCIncrementMux", ["PCAdder"]),
  wire("pcNext", "BUS3424", "PCAdder", ["PCRegister"]),

  // fields of the instruction (slices of INST)
  wire("instControl", "INST(6:0), INST(14:12), INST(31:25)", "InstructionMemory", ["ControlUnit"]),
  wire("instRs1", "INST(19:15)", "InstructionMemory", ["RegisterFile"]),
  wire("instRs2", "INST(24:20)", "InstructionMemory", ["RegisterFile"]),
  wire("instRd", "INST(11:7)", "InstructionMemory", ["RegisterFile"]),
  wire("instImm", "INST(31:25), INST(24:20), INST(11:7)", "InstructionMemory", ["ImmSelector"]),
  wire("instBranchImm", "INST(31:25), INST(11:7)", "InstructionMemory", ["BranchImmGen"]),
  wire("instStoreSize", "INST(14:12)", "InstructionMemory", ["DataMemory"]),
  wire("instLoadSize", "INST(14:12)", "InstructionMemory", ["LoadExtender"]),

  // register file, immediate and ALU
  wire("rs1Data", "BUS72", "RegisterFile", ["ALU"]),
  wire("rs2Data", "BUS78", "RegisterFile", ["ALUSrcMux"]),
  wire("storeData", "BUS78 (branch to di)", "RegisterFile", ["DataMemory"]),
  wire("imm12", "BUS325", "ImmSelector", ["SignExtender"]),
  wire("immExt", "BUS90", "SignExtender", ["ALUSrcMux"]),
  wire("aluB", "BUS113", "ALUSrcMux", ["ALU"]),
  wire("aluResult", "BUS1408", "ALU", ["WriteBackMux"]),
  wire("memAddress", "BUS1408 (branch to addr)", "ALU", ["DataMemory", "LoadExtender"]),
  wire("aluCompare", "BUS1408 (branch to Extraer_Bit)", "ALU", ["ConditionBit"]),

  // memory and write back
  wire("memWord", "BUS146", "DataMemory", ["LoadExtender"]),
  wire("loadData", "BUS159", "LoadExtender", ["WriteBackMux"]),
  wire("writeBackData", "BUS137", "WriteBackMux", ["RegisterFile"]),

  // branch decision
  wire("condBit", "NET1535", "ConditionBit", ["BranchInvertMux"]),
  wire("condition", "NET1574", "BranchInvertMux", ["BranchAnd"]),
  wire("branchTaken", "NET1715", "BranchAnd", ["PCIncrementMux"]),
]);

function wire(name, vhdlName, from, to) {
  return Object.freeze({ name, vhdlName, from, to: Object.freeze(to) });
}

// ---------- what each type uses ----------

// Used by every instruction: fetch, PC update and decoding.
const ALWAYS = {
  components: ["PCRegister", "InstructionMemory", "PCAdder", "PCIncrementMux", "ControlUnit"],
  wires: ["pc", "instruction", "pcIncrement", "pcNext", "instControl"],
};

const BY_TYPE = {
  // rd = rs1 op rs2
  R: {
    components: ["RegisterFile", "ALUSrcMux", "ALU", "WriteBackMux"],
    wires: ["const4", "instRs1", "instRs2", "instRd", "rs1Data", "rs2Data", "aluB", "aluResult",
      "writeBackData"],
  },
  // rd = rs1 op immediate
  I: {
    components: ["RegisterFile", "ImmSelector", "SignExtender", "ALUSrcMux", "ALU", "WriteBackMux"],
    wires: ["const4", "instRs1", "instRd", "instImm", "rs1Data", "imm12", "immExt", "aluB", "aluResult",
      "writeBackData"],
  },
  // rd = memory[rs1 + immediate]: the ALU computes the address, the value comes from memory
  L: {
    components: ["RegisterFile", "ImmSelector", "SignExtender", "ALUSrcMux", "ALU", "DataMemory",
      "LoadExtender", "WriteBackMux"],
    wires: ["const4", "instRs1", "instRd", "instImm", "instLoadSize", "rs1Data", "imm12", "immExt", "aluB",
      "memAddress", "memWord", "loadData", "writeBackData"],
  },
  // memory[rs1 + immediate] = rs2: no register is written
  S: {
    components: ["RegisterFile", "ImmSelector", "SignExtender", "ALUSrcMux", "ALU", "DataMemory"],
    wires: ["const4", "instRs1", "instRs2", "instImm", "instStoreSize", "rs1Data", "storeData", "imm12",
      "immExt", "aluB", "memAddress"],
  },
  // compare rs1 with rs2; the PC gets +4 or the offset depending on the result
  B: {
    components: ["RegisterFile", "ALUSrcMux", "ALU", "ConditionBit", "BranchInvertMux", "BranchAnd",
      "BranchImmGen"],
    wires: ["instRs1", "instRs2", "instBranchImm", "rs1Data", "rs2Data", "aluB", "aluCompare", "condBit",
      "condition", "branchTaken"],
    conditionalWires: ["const4", "branchOffset"], // taken → offset, not taken → 4
  },
};

// Parts of the hardware used by a decoded instruction, or null if it is not one of the 33.
// Lists follow the order of COMPONENTS and WIRES, so the result is always the same.
export function activePaths(decoded) {
  const instruction = decoded && !decoded.error ? findByName(decoded.name) : undefined;
  if (!instruction) return null;
  const used = BY_TYPE[instruction.type];
  return Object.freeze({
    components: inOrder(COMPONENTS, [...ALWAYS.components, ...used.components]),
    wires: inOrder(WIRES, [...ALWAYS.wires, ...used.wires]),
    conditionalWires: inOrder(WIRES, used.conditionalWires ?? []),
  });
}

// The names of `all` that appear in `names`, in the order of `all`.
function inOrder(all, names) {
  const wanted = new Set(names);
  return Object.freeze(all.map((item) => item.name).filter((name) => wanted.has(name)));
}
