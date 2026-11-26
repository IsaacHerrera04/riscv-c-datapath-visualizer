// Control unit (control_04 in the VHDL design): decoded instruction → control signals.
//
//   controlSignals(decode(0x00629463))   // bne x5, x6, 8
//   → { regWrite: 0, memWrite: 0, aluSrc: 0, memToReg: 0, immSrc: 0, branch: 1,
//       aluControl: 0b1010, branchInvert: 1, aluOperationName: "SEQ" }
//
// Like the hardware, six signals depend only on the instruction TYPE, and two (aluControl,
// branchInvert) on the exact instruction. Those two live in the instruction table
// (src/shared/instructions.js), the single source of truth; this file only reads them.

import { findByName, ALU_OPERATIONS } from "../shared/instructions.js";

// Outputs of control_04 by type (docs/DESIGN.md section 7.2). These are the real VHDL values,
// also for signals the type does not use (immSrc of R/L/B, memToReg of S/B): 0, not "don't care".
const SIGNALS_BY_TYPE = Object.freeze({
  //            regWrite  memWrite  aluSrc  memToReg  immSrc  branch
  R: signals(1, 0, 0, 0, 0, 0), // rd = rs1 op rs2
  I: signals(1, 0, 1, 0, 0, 0), // rd = rs1 op immediate
  L: signals(1, 0, 1, 1, 0, 0), // rd = memory[rs1 + immediate]
  S: signals(0, 1, 1, 0, 1, 0), // memory[rs1 + immediate] = rs2 (S-type immediate)
  B: signals(0, 0, 0, 0, 0, 1), // compare rs1 with rs2, maybe jump
});

function signals(regWrite, memWrite, aluSrc, memToReg, immSrc, branch) {
  return Object.freeze({ regWrite, memWrite, aluSrc, memToReg, immSrc, branch });
}

// Every signal, in display order, with its name in the VHDL design and what it means.
export const CONTROL_SIGNALS = Object.freeze([
  signalInfo("regWrite", "wer", "Write the result into register rd"),
  signalInfo("memWrite", "wem", "Write into data memory"),
  signalInfo("aluSrc", "sel_B", "ALU input B: 0 = rs2, 1 = immediate"),
  signalInfo("memToReg", "mem_to_reg", "Value for rd: 0 = ALU result, 1 = loaded data"),
  signalInfo("immSrc", "imm_rd", "Immediate bits: 0 = I-type (31..20), 1 = S-type (31..25, 11..7)"),
  signalInfo("aluControl", "operacion", "Operation the ALU performs (4 bits)"),
  signalInfo("branch", "branch", "The instruction is a branch"),
  signalInfo("branchInvert", "br_neg", "Invert the condition bit (bne, bge, bgeu)"),
]);

function signalInfo(name, vhdlName, meaning) {
  return Object.freeze({ name, vhdlName, meaning });
}

// Control signals for a decoded instruction, or null if it is not one of the 33.
export function controlSignals(decoded) {
  const instruction = decoded && !decoded.error ? findByName(decoded.name) : undefined;
  if (!instruction) return null;
  return Object.freeze({
    ...SIGNALS_BY_TYPE[instruction.type],
    aluControl: instruction.aluControl,
    branchInvert: instruction.branchInvert,
    aluOperationName: ALU_OPERATIONS[instruction.aluControl],
  });
}

// 0b1010 → "1010": how the 4-bit code looks on the wire.
export function aluControlBits(aluControl) {
  return aluControl.toString(2).padStart(4, "0");
}
