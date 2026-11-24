// Segments: the 32 bits of an instruction split by field, most significant first.
// The page shows them as colored groups in the binary column.
//   sw x5, 0(x0) → imm[11:5] 0000000 | rs2 00101 | rs1 00000 | funct3 010 | imm[4:0] 00000 | opcode 0100011

import { isShiftImmediate } from "../shared/instructions.js";
import { bits } from "./fields.js";

// [field name, high bit, low bit] for each format.
const OPCODE = ["opcode", 6, 0];
const FUNCT3 = ["funct3", 14, 12];
const RS1 = ["rs1", 19, 15];
const RS2 = ["rs2", 24, 20];
const RD = ["rd", 11, 7];

const LAYOUTS = Object.freeze({
  R: [["funct7", 31, 25], RS2, RS1, FUNCT3, RD, OPCODE],
  I: [["imm[11:0]", 31, 20], RS1, FUNCT3, RD, OPCODE],
  SHIFT: [["funct7", 31, 25], ["shamt", 24, 20], RS1, FUNCT3, RD, OPCODE],
  L: [["imm[11:0]", 31, 20], RS1, FUNCT3, RD, OPCODE],
  S: [["imm[11:5]", 31, 25], RS2, RS1, FUNCT3, ["imm[4:0]", 11, 7], OPCODE],
  B: [["imm[12|10:5]", 31, 25], RS2, RS1, FUNCT3, ["imm[4:1|11]", 11, 7], OPCODE],
});

// → [{ field, bits, value }], e.g. { field: "rs2", bits: "00101", value: 5 }
export function segmentsOf(word, instruction) {
  const layout = isShiftImmediate(instruction) ? LAYOUTS.SHIFT : LAYOUTS[instruction.type];
  return layout.map(([field, high, low]) => {
    const value = bits(word, high, low);
    return { field, bits: value.toString(2).padStart(high - low + 1, "0"), value };
  });
}
