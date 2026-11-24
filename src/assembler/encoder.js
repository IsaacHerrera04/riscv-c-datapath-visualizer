// Encoding: validated instruction fields → 32-bit machine word.
// Fields come from parser.js (and the resolved branch offset from index.js),
// so every value here is already known to be in range.
//
// Bit layout of the formats (bit 31 on the left):
//
//          31        25 24   20 19   15 14  12 11        7 6      0
//   R    | funct7      | rs2   | rs1   |funct3| rd         | opcode |
//   I/L  | imm[11:0]           | rs1   |funct3| rd         | opcode |
//   I sh | funct7      | shamt | rs1   |funct3| rd         | opcode |
//   S    | imm[11:5]   | rs2   | rs1   |funct3| imm[4:0]   | opcode |
//   B    |imm[12|10:5] | rs2   | rs1   |funct3| imm[4:1|11]| opcode |
//
// rs1, rs2, rd and funct3 are always in the same place; only the immediate
// moves. The bit positions (7, 12, 15, 20, 25) are fixed by the RV32I format.

import { isShiftImmediate } from "../shared/instructions.js";

// → unsigned 32-bit number, e.g. 0x00502023 for sw x5, 0(x0)
export function encode({ instruction, rd, rs1, rs2, imm }) {
  const word = ENCODERS[instruction.type](instruction, { rd, rs1, rs2, imm });
  // JS bitwise operators give SIGNED 32-bit results: if bit 31 is 1 the number
  // is negative. ">>> 0" reinterprets the same 32 bits as an unsigned number.
  return word >>> 0;
}

const ENCODERS = Object.freeze({
  R({ opcode, funct3, funct7 }, { rd, rs1, rs2 }) {
    return (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode;
  },

  I(instruction, { rd, rs1, imm }) {
    const { opcode, funct3, funct7 } = instruction;
    const upper = isShiftImmediate(instruction)
      ? (funct7 << 25) | (bits(imm, 4, 0) << 20) // funct7 + 5-bit shamt
      : bits(imm, 11, 0) << 20;                  // 12-bit immediate
    return upper | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode;
  },

  L({ opcode, funct3 }, { rd, rs1, imm }) {
    return (bits(imm, 11, 0) << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode;
  },

  S({ opcode, funct3 }, { rs1, rs2, imm }) {
    return (bits(imm, 11, 5) << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) |
      (bits(imm, 4, 0) << 7) | opcode;
  },

  // Bit 0 of the offset is not stored: branch targets are always even.
  B({ opcode, funct3 }, { rs1, rs2, imm }) {
    return (bits(imm, 12, 12) << 31) | (bits(imm, 10, 5) << 25) | (rs2 << 20) | (rs1 << 15) |
      (funct3 << 12) | (bits(imm, 4, 1) << 8) | (bits(imm, 11, 11) << 7) | opcode;
  },
});

// bits(value, high, low) = value[high:low], the same notation as the diagram.
// Works for negative values: ">>" keeps the sign (two's complement) and the
// mask keeps only the requested bits.
//   bits(-1, 11, 0) = 0xFFF      bits(0b110100, 5, 4) = 0b11
function bits(value, high, low) {
  const width = high - low + 1;
  const mask = (1 << width) - 1; // width ones, e.g. width 3 → 0b111
  return (value >> low) & mask;
}
