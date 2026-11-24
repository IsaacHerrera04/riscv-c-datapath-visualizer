// (c) Decoder: 32-bit machine word → instruction fields.
// It plays the role of the hardware's ControlUnit + immediate logic: it only
// sees bits (opcode, funct3, funct7) and works out which instruction they are.

import { findByEncoding } from "../shared/instructions.js";
import { extractFields, immediateOf } from "./fields.js";
import { segmentsOf } from "./segments.js";

export { disassemble } from "./disassemble.js";

// Register fields each format really uses (the others are null in the result).
const USES = Object.freeze({
  R: Object.freeze({ rd: true, rs1: true, rs2: true }),
  I: Object.freeze({ rd: true, rs1: true, rs2: false }),
  L: Object.freeze({ rd: true, rs1: true, rs2: false }),
  S: Object.freeze({ rd: false, rs1: true, rs2: true }),
  B: Object.freeze({ rd: false, rs1: true, rs2: true }),
});

const MAX_WORD = 0xFFFFFFFF;

// → { name, type, opcode, funct3, funct7, rd, rs1, rs2, imm, segments }
// → { error } if the input is not a 32-bit word or not one of the 33 instructions.
export function decode(word) {
  if (!Number.isInteger(word) || word < 0 || word > MAX_WORD) {
    return { error: `Invalid word ${String(word)} (expected an unsigned 32-bit number)` };
  }

  const raw = extractFields(word);
  const instruction = findByEncoding(raw.opcode, raw.funct3, raw.funct7);
  if (!instruction) return { error: `Unknown instruction ${toHex(word)}` };

  const uses = USES[instruction.type];
  return {
    name: instruction.name,
    type: instruction.type,
    opcode: raw.opcode,
    funct3: raw.funct3,
    funct7: raw.funct7, // bits 31..25 as present in the word, even when they are immediate bits
    rd: uses.rd ? raw.rd : null,
    rs1: uses.rs1 ? raw.rs1 : null,
    rs2: uses.rs2 ? raw.rs2 : null,
    imm: immediateOf(word, instruction),
    segments: segmentsOf(word, instruction),
  };
}

function toHex(word) {
  return "0x" + word.toString(16).toUpperCase().padStart(8, "0");
}
