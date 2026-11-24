// Disassembler: decoded fields → canonical assembly text.
// "Canonical" = one fixed way of writing it: xN register names, decimal
// immediates and numeric branch offsets (labels and comments are not in the bits).
//   decode(0xFE0C9EE3) → disassemble → "bne x25, x0, -4"

import { registerName as reg } from "../shared/registers.js";

// → "sw x5, 0(x0)"; null if the decoding failed.
export function disassemble(decoded) {
  if (!decoded || decoded.error) return null;
  const { name, type, rd, rs1, rs2, imm } = decoded;

  switch (type) {
    case "R": return `${name} ${reg(rd)}, ${reg(rs1)}, ${reg(rs2)}`;
    case "I": return `${name} ${reg(rd)}, ${reg(rs1)}, ${imm}`;
    case "L": return `${name} ${reg(rd)}, ${imm}(${reg(rs1)})`;
    case "S": return `${name} ${reg(rs2)}, ${imm}(${reg(rs1)})`;
    case "B": return `${name} ${reg(rs1)}, ${reg(rs2)}, ${imm}`;
    default: return null;
  }
}
