// Parsing of ONE line of assembly text: syntax and value ranges only.
// It knows nothing about addresses (pass 1/2, index.js) or bits (encoder.js).
// Functions return data or { error }, never throw. Errors have no line number:
// the caller (index.js) knows which line is being parsed and adds it.

import { findByName } from "../shared/instructions.js";
import { parseRegister } from "../shared/registers.js";
import { HARDWARE } from "../shared/hardware.js";

export const LABEL_NAME = /^[A-Za-z_.][A-Za-z0-9_.]*$/;

const COMMENT_START = "#";

// Decimal, hex (0x) or binary (0b), with an optional minus sign. No spaces inside.
const IMMEDIATE = /^(-?)(0x[0-9a-f]+|0b[01]+|[0-9]+)$/;

// offset(register): text before "(", text inside "(...)", nothing after ")".
const MEMORY_OPERAND = /^([^()]*)\(([^()]*)\)$/;

// Operand syntax of each instruction type (count + text used in error messages).
const FORMATS = Object.freeze({
  R: Object.freeze({ count: 3, syntax: "rd, rs1, rs2" }),
  I: Object.freeze({ count: 3, syntax: "rd, rs1, imm" }),
  L: Object.freeze({ count: 2, syntax: "rd, offset(rs1)" }),
  S: Object.freeze({ count: 2, syntax: "rs2, offset(rs1)" }),
  B: Object.freeze({ count: 3, syntax: "rs1, rs2, label" }),
});

// ---------- Line ----------

// Splits a line into label, mnemonic and operand texts.
// Blank or comment-only line → { label: null, mnemonic: null, operands: [] }.
export function parseLine(text) {
  let rest = stripComment(text).trim();
  let label = null;

  const colon = rest.indexOf(":");
  if (colon !== -1) {
    label = rest.slice(0, colon).trim();
    if (!LABEL_NAME.test(label)) return { error: `invalid label name "${label}"` };
    rest = rest.slice(colon + 1).trim();
  }

  if (rest === "") return { label, mnemonic: null, operands: [] };

  // The mnemonic ends at the first whitespace; everything after it are the operands.
  const space = rest.search(/\s/);
  const mnemonic = (space === -1 ? rest : rest.slice(0, space)).toLowerCase();
  const operandText = space === -1 ? "" : rest.slice(space).trim();
  const operands = operandText === "" ? [] : operandText.split(",").map((op) => op.trim());

  return { label, mnemonic, operands };
}

function stripComment(text) {
  const start = text.indexOf(COMMENT_START);
  return start === -1 ? text : text.slice(0, start);
}

// ---------- Small operand parsers ----------

// "-12" → -12, "0x1F" → 31, "-0x10" → -16, "0b101" → 5; invalid → null.
// Range is NOT checked here: it depends on the instruction.
export function parseImmediate(text) {
  if (typeof text !== "string") return null;
  const match = IMMEDIATE.exec(text.trim().toLowerCase());
  if (!match) return null;

  const magnitude = Number(match[2]); // Number understands "31", "0x1f" and "0b101"
  // 0 - magnitude instead of -magnitude: in JS, -0 is a different value from 0.
  return match[1] === "-" ? 0 - magnitude : magnitude;
}

// "8(x0)" → { offsetText: "8", baseText: "x0" }; wrong shape → null.
export function parseMemoryOperand(text) {
  const match = MEMORY_OPERAND.exec(text.trim());
  if (!match) return null;

  const offsetText = match[1].trim();
  const baseText = match[2].trim();
  if (offsetText === "" || baseText === "") return null;
  return { offsetText, baseText };
}

// ---------- Instruction operands ----------

// Checks the operands of one instruction and converts them to numbers.
// → { instruction, rd, rs1, rs2, imm, label }   (unused fields are null)
// → { error }
// For branches, exactly one of imm (numeric offset) / label is set; the offset
// range is checked later, once labels have addresses (index.js).
export function parseOperands(mnemonic, operands) {
  const instruction = findByName(mnemonic);
  if (!instruction) return { error: `unknown instruction "${mnemonic}"` };

  const format = FORMATS[instruction.type];
  if (operands.length !== format.count) {
    return {
      error: `${instruction.name} expects ${format.count} operands ` +
        `(${instruction.name} ${format.syntax}) but found ${operands.length}`,
    };
  }

  const fields = OPERAND_PARSERS[instruction.type](operands, instruction);
  if (fields.error) return fields;

  return { instruction, rd: null, rs1: null, rs2: null, imm: null, label: null, ...fields };
}

const OPERAND_PARSERS = Object.freeze({
  R([rd, rs1, rs2]) {
    return collect({ rd: readRegister(rd), rs1: readRegister(rs1), rs2: readRegister(rs2) });
  },

  I([rd, rs1, imm], instruction) {
    const value = isShiftImmediate(instruction)
      ? readImmediate(imm, 0, HARDWARE.SHAMT_MAX, "shift amount")
      : readImmediate(imm, HARDWARE.IMM12_MIN, HARDWARE.IMM12_MAX, "immediate");
    return collect({ rd: readRegister(rd), rs1: readRegister(rs1), imm: value });
  },

  L([rd, memory]) {
    const address = readMemoryOperand(memory);
    if (address.error) return address;
    return collect({ rd: readRegister(rd), ...address.value });
  },

  S([rs2, memory]) {
    const address = readMemoryOperand(memory);
    if (address.error) return address;
    return collect({ rs2: readRegister(rs2), ...address.value });
  },

  B([rs1, rs2, target]) {
    return collect({ rs1: readRegister(rs1), rs2: readRegister(rs2), ...readBranchTarget(target) });
  },
});

// In type I, only the shifts (slli/srli/srai) define funct7: their bits 31..25
// are fixed, so the immediate is just the 5-bit shift amount.
function isShiftImmediate(instruction) {
  return instruction.type === "I" && instruction.funct7 !== null;
}

// ---------- Readers: { value } or { error } ----------

function readRegister(text) {
  const number = parseRegister(text);
  return number === null ? { error: `invalid register "${text}"` } : { value: number };
}

function readImmediate(text, min, max, what) {
  const value = parseImmediate(text);
  if (value === null) return { error: `invalid ${what} "${text}"` };
  if (value < min || value > max) return { error: `${what} ${value} out of range [${min}, ${max}]` };
  return { value };
}

// "8(x0)" → { value: { imm: { value: 8 }, rs1: { value: 0 } } } (readers, collected later)
function readMemoryOperand(text) {
  const parts = parseMemoryOperand(text);
  if (!parts) {
    return { error: `malformed memory operand "${text}" (expected offset(register), e.g. 8(x0))` };
  }
  return {
    value: {
      imm: readImmediate(parts.offsetText, HARDWARE.IMM12_MIN, HARDWARE.IMM12_MAX, "offset"),
      rs1: readRegister(parts.baseText),
    },
  };
}

// A number is an offset in bytes; a valid name is a label.
function readBranchTarget(text) {
  const offset = parseImmediate(text);
  if (offset !== null) return { imm: { value: offset }, label: { value: null } };
  if (LABEL_NAME.test(text)) return { imm: { value: null }, label: { value: text } };
  return { imm: { error: `invalid branch target "${text}"` } };
}

// { rd: { value: 5 }, imm: { error: "..." } } → { error: "..." }   (first error, in order)
// { rd: { value: 5 }, rs1: { value: 0 } }    → { rd: 5, rs1: 0 }
function collect(readers) {
  const fields = {};
  for (const [name, result] of Object.entries(readers)) {
    if (result.error) return { error: result.error };
    fields[name] = result.value;
  }
  return fields;
}
