// (b) Assembler: RISC-V assembly text → program with the address and the
// 32-bit machine word of every instruction.
//
// Two passes over the text:
//   1. Give every instruction its address and record where each label is.
//   2. Check the operands of every instruction, resolve branch labels into
//      offsets (possible now, because all label addresses are known) and encode.

import { parseLine, parseOperands } from "./parser.js";
import { encode } from "./encoder.js";
import { HARDWARE } from "../shared/hardware.js";

// Every instruction takes one 32-bit word = 4 bytes, the same 4 the PC adds.
const INSTRUCTION_BYTES = HARDWARE.PC_INCREMENT;

export function assemble(text) {
  const lines = splitLines(text);
  const first = firstPass(lines);
  const second = secondPass(first.statements, first.labels);

  return {
    program: second.program,
    labels: Object.fromEntries(first.labels),
    errors: sortByLine([...first.errors, ...second.errors]),
  };
}

// "a\nb" → [{ line: 1, text: "a" }, { line: 2, text: "b" }]   (line numbers start at 1)
function splitLines(text) {
  return text.split(/\r?\n/).map((lineText, index) => ({ line: index + 1, text: lineText }));
}

// ---------- Pass 1: addresses and labels ----------

// → { statements: [{ line, source, address, mnemonic, operands }], labels: Map, errors }
function firstPass(lines) {
  const statements = [];   // only the lines that contain an instruction
  const labels = new Map(); // label name → address
  const errors = [];

  for (const { line, text } of lines) {
    const parsed = parseLine(text);
    if (parsed.error) {
      errors.push({ line, message: parsed.error });
      continue;
    }

    // The address of the next instruction. A label points to it, even when
    // the label is alone on its line (that line does not take an address).
    const address = statements.length * INSTRUCTION_BYTES;

    if (parsed.label !== null) {
      if (labels.has(parsed.label)) {
        errors.push({ line, message: `duplicate label "${parsed.label}"` });
      } else {
        labels.set(parsed.label, address);
      }
    }

    if (parsed.mnemonic !== null) {
      statements.push({
        line,
        source: text.trim(),
        address,
        mnemonic: parsed.mnemonic,
        operands: parsed.operands,
      });
    }
  }

  if (statements.length > HARDWARE.INSTRUCTION_MEMORY_WORDS) {
    errors.push({
      line: statements[HARDWARE.INSTRUCTION_MEMORY_WORDS].line, // first one that does not fit
      message: `program has ${statements.length} instructions; ` +
        `instruction memory holds ${HARDWARE.INSTRUCTION_MEMORY_WORDS}`,
    });
  }

  return { statements, labels, errors };
}

// ---------- Pass 2: operands and branch offsets ----------

// → { program: [{ address, line, source, word }], errors }
function secondPass(statements, labels) {
  const program = [];
  const errors = [];

  for (const { line, source, address, mnemonic, operands } of statements) {
    let fields = parseOperands(mnemonic, operands);
    if (fields.error) {
      errors.push({ line, message: fields.error });
      continue;
    }

    if (fields.instruction.type === "B") {
      const offset = resolveBranchOffset(fields, address, labels);
      if (offset.error) {
        errors.push({ line, message: offset.error });
        continue;
      }
      fields = { ...fields, imm: offset.value };
    }

    program.push({ address, line, source, word: encode(fields) });
  }

  return { program, errors };
}

// Branch target → offset in bytes, relative to the branch's own address.
// → { value } or { error }
function resolveBranchOffset(fields, address, labels) {
  let offset = fields.imm; // numeric offset written by the user...
  if (fields.label !== null) {
    if (!labels.has(fields.label)) return { error: `undefined label "${fields.label}"` };
    offset = labels.get(fields.label) - address; // ...or computed from the label
  }

  if (offset % 2 !== 0) return { error: `branch offset ${offset} is odd (must be even)` };
  if (offset < HARDWARE.BRANCH_OFFSET_MIN || offset > HARDWARE.BRANCH_OFFSET_MAX) {
    return {
      error: `branch offset ${offset} out of range ` +
        `[${HARDWARE.BRANCH_OFFSET_MIN}, ${HARDWARE.BRANCH_OFFSET_MAX}]`,
    };
  }
  return { value: offset };
}

// Errors of both passes, in source order (sort is stable: same line keeps its order).
function sortByLine(errors) {
  return [...errors].sort((a, b) => a.line - b.line);
}
