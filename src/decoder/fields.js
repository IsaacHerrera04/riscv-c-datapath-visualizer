// Field extraction: the inverse of the assembler's encoder.
// The encoder PUTS each field in place with << and |; here we TAKE each field
// out with >>> (move it down to bit 0) and & (keep only its bits).
//
//          31        25 24   20 19   15 14  12 11        7 6      0
//   R    | funct7      | rs2   | rs1   |funct3| rd         | opcode |
//   I/L  | imm[11:0]           | rs1   |funct3| rd         | opcode |
//   I sh | funct7      | shamt | rs1   |funct3| rd         | opcode |
//   S    | imm[11:5]   | rs2   | rs1   |funct3| imm[4:0]   | opcode |
//   B    |imm[12|10:5] | rs2   | rs1   |funct3| imm[4:1|11]| opcode |

import { isShiftImmediate } from "../shared/instructions.js";

// bits(word, high, low) = word[high:low] as an unsigned number (diagram notation).
// ">>>" (logical shift) so that bit 31 never brings a sign along.
export function bits(word, high, low) {
  const width = high - low + 1;
  const mask = width === 32 ? 0xFFFFFFFF : (1 << width) - 1;
  return ((word >>> low) & mask) >>> 0;
}

// The fields that are always in the same place, whatever the instruction is.
// The control unit reads these before it knows the instruction type.
export function extractFields(word) {
  return {
    opcode: bits(word, 6, 0),
    rd: bits(word, 11, 7),
    funct3: bits(word, 14, 12),
    rs1: bits(word, 19, 15),
    rs2: bits(word, 24, 20),
    funct7: bits(word, 31, 25),
  };
}

// Reads a width-bit two's complement value: 0xFFF (12 bits) → -1, 0x7FF → 2047.
// Move the field up until its sign bit is bit 31, then back down with ">>"
// (arithmetic shift), which fills the left side with copies of the sign bit.
// This is what the SignExtender (Extensor_01) does in the hardware.
export function signExtend(value, width) {
  const shift = 32 - width;
  return (value << shift) >> shift;
}

// The immediate of a known instruction, rebuilt and sign-extended; null for type R.
export function immediateOf(word, instruction) {
  switch (instruction.type) {
    case "R":
      return null;

    case "I":
      if (isShiftImmediate(instruction)) return bits(word, 24, 20); // shamt: 0..31, no sign
      return signExtend(bits(word, 31, 20), 12);

    case "L":
      return signExtend(bits(word, 31, 20), 12);

    case "S": // imm[11:5] in bits 31..25, imm[4:0] in bits 11..7
      return signExtend((bits(word, 31, 25) << 5) | bits(word, 11, 7), 12);

    case "B": // imm[12] bit 31, imm[11] bit 7, imm[10:5] bits 30..25, imm[4:1] bits 11..8
      return signExtend(
        (bits(word, 31, 31) << 12) |
        (bits(word, 7, 7) << 11) |
        (bits(word, 30, 25) << 5) |
        (bits(word, 11, 8) << 1), // imm[0] is always 0
        13,
      );

    default:
      return null;
  }
}
