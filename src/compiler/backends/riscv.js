// RISC-V backend: checked AST + symbols → RV32I assembly text (last phase of the compiler).
//
//   generateRiscv(ast, symbols, "int main() { int a; a = a + 5; }") → {
//     asm: "# Memory map\n#   a      int      0x000\n\n# line 1: ...\n    lw   x5, 0(x0)\n" +
//          "    addi x5, x5, 5\n    sw   x5, 0(x0)\n\nhalt:\n    beq  x0, x0, halt\n",
//     errors: [],
//   }
//
// Uses only the 33 instructions of docs/DESIGN.md section 6, following the conventions of
// section 5: every variable lives in data memory (address = immediate, base register x0), loops
// jump back with "beq x0, x0, label", and the program ends with "halt: beq x0, x0, halt".
//
// `source` (the C text) is only used to write "# line N: <code>" comments.

import { HARDWARE } from "../../shared/hardware.js";
import { registerName } from "../../shared/registers.js";
import { isUnsigned } from "../types.js";

const ZERO = registerName(0);

// Temporary registers, in the order they are handed out. x1–x4 (ra, sp, gp, tp) and x8–x9
// (s0, s1) are never used, so the output stays easy to read.
const TEMPORARIES = Object.freeze([5, 6, 7, ...range(10, 31)].map(registerName));

// Binary operator → register form / immediate form, in their SIGNED version.
// withSign() swaps in the unsigned twin when the operation works in unsigned int.
const REGISTER_FORM = new Map([
  ["+", "add"], ["-", "sub"], ["&", "and"], ["|", "or"], ["^", "xor"], ["<<", "sll"], [">>", "sra"],
]);
const IMMEDIATE_FORM = new Map([
  ["+", "addi"], ["&", "andi"], ["|", "ori"], ["^", "xori"], ["<<", "slli"], [">>", "srai"],
]);

// Condition → branch that jumps when the condition is FALSE (to skip the then-part or leave
// the loop). swap = compare the operands in the other order, because there is no bgt/ble:
//   a > b is false when a <= b, i.e. b >= a → bge b, a
const BRANCH_IF_FALSE = new Map([
  ["<", { op: "bge", swap: false }],
  [">=", { op: "blt", swap: false }],
  [">", { op: "bge", swap: true }],
  ["<=", { op: "blt", swap: true }],
  ["==", { op: "bne", swap: false }],
  ["!=", { op: "beq", swap: false }],
]);

// Signed instruction → its unsigned twin. Instructions without a twin (add, sub, xor, beq, ...)
// give the same bits signed or unsigned in two's complement, so they are used as they are.
const UNSIGNED_TWIN = new Map([
  ["slt", "sltu"], ["slti", "sltiu"], ["blt", "bltu"], ["bge", "bgeu"], ["sra", "srl"], ["srai", "srli"],
]);

// Memory access by the declared type of the variable. Loads must know the sign to fill the upper
// bits (lb copies bit 7, lbu fills with zeros); stores only keep the low 8/16 bits, so the sign
// does not matter (char c = 300 stores 300 & 0xFF = 44, as in C).
const LOAD = new Map([
  ["int", "lw"], ["unsigned int", "lw"],
  ["short", "lh"], ["unsigned short", "lhu"],
  ["char", "lb"], ["unsigned char", "lbu"],
]);
const STORE = new Map([
  ["int", "sw"], ["unsigned int", "sw"],
  ["short", "sh"], ["unsigned short", "sh"],
  ["char", "sb"], ["unsigned char", "sb"],
]);

const HALT = HARDWARE.HALT_LABEL;

// Thrown only inside this file to stop generation; generateRiscv turns it into an error entry.
class CodegenError extends Error {
  constructor(line, message) {
    super(message);
    this.line = line;
  }
}

export function generateRiscv(ast, symbols, source = "") {
  const generator = new RiscvGenerator(symbols, source);
  const errors = [];
  try {
    generator.generateProgram(ast);
  } catch (error) {
    if (!(error instanceof CodegenError)) throw error; // a bug in the backend: let it surface
    errors.push({ line: error.line, message: error.message });
  }
  if (errors.length === 0 && generator.instructionCount > HARDWARE.INSTRUCTION_MEMORY_WORDS) {
    errors.push({
      line: generator.overflowLine,
      message: `the program needs ${generator.instructionCount} instructions but instruction memory ` +
        `holds ${HARDWARE.INSTRUCTION_MEMORY_WORDS}`,
    });
  }
  return { asm: generator.lines.join("\n") + "\n", errors };
}

class RiscvGenerator {
  constructor(symbols, source) {
    this.symbols = new Map(symbols.map((symbol) => [symbol.name, symbol]));
    this.symbolList = symbols;
    this.sourceLines = source.split("\n");
    this.lines = [];               // output, one string per line
    this.free = [...TEMPORARIES];  // registers not in use right now
    this.labelCount = 0;
    this.instructionCount = 0;
    this.currentLine = null;       // C line being translated (for comments and errors)
    this.commentedLine = null;     // last C line that got a "# line N" comment
    this.overflowLine = null;      // C line of the first instruction that does not fit
  }

  // ---------- program and statements ----------

  generateProgram(program) {
    this.writeMemoryMap();
    this.generateStatement(program.body);
    this.lines.push("");
    this.label(HALT);
    this.emit("beq", ZERO, ZERO, HALT); // jump to itself: the processor stays here
  }

  generateStatement(node) {
    switch (node.kind) {
      case "Block":
        for (const statement of node.statements) this.generateStatement(statement);
        return;

      case "VarDecl":
        // Without initializer there is no code: this hardware's data memory starts at zero.
        if (node.init !== null) {
          this.startLine(node.line);
          this.store(node.name, null, node.init);
        }
        return;

      case "Assign":
        this.startLine(node.line);
        this.store(node.target.name, node.target.index, node.value);
        return;

      case "If":
        this.generateIf(node);
        return;

      case "While":
        this.generateWhile(node);
        return;

      case "Return":
        // No caller to return to: the value (if any) is computed and the program stops.
        this.startLine(node.line);
        if (node.value !== null) this.release(this.genExpr(node.value));
        this.emit("beq", ZERO, ZERO, HALT);
        return;

      default:
        throw new Error(`riscv: unknown statement kind '${node.kind}'`);
    }
  }

  //     <branch if false> Lelse          (without else: <branch if false> Lend)
  //     <then>
  //     beq x0, x0, Lend
  // Lelse:
  //     <else>
  // Lend:
  generateIf(node) {
    this.startLine(node.line);
    // Labels are numbered in the order they appear in the output: Lelse before Lend.
    const elseLabel = node.else === null ? null : this.newLabel();
    const endLabel = this.newLabel();
    if (node.else === null) {
      this.branchIfFalse(node.cond, endLabel);
      this.generateStatement(node.then);
    } else {
      this.branchIfFalse(node.cond, elseLabel);
      this.generateStatement(node.then);
      this.emit("beq", ZERO, ZERO, endLabel);
      this.label(elseLabel);
      this.generateStatement(node.else);
    }
    this.label(endLabel);
  }

  // Lstart:
  //     <branch if false> Lend
  //     <body>
  //     beq x0, x0, Lstart
  // Lend:
  generateWhile(node) {
    this.startLine(node.line);
    const startLabel = this.newLabel();
    const endLabel = this.newLabel();
    this.label(startLabel);
    this.branchIfFalse(node.cond, endLabel);
    this.generateStatement(node.body);
    this.emit("beq", ZERO, ZERO, startLabel);
    this.label(endLabel);
  }

  // Jumps to `label` when `cond` is false; falls through when it is true.
  branchIfFalse(cond, label) {
    const branch = cond.kind === "Binary" ? BRANCH_IF_FALSE.get(cond.op) : undefined;
    if (branch) {
      const left = this.genExpr(cond.left);
      const right = this.genExpr(cond.right);
      const [first, second] = branch.swap ? [right, left] : [left, right];
      this.emit(withSign(branch.op, cond.operandType), first, second, label); // bge → bgeu if unsigned
      this.release(left, right);
      return;
    }
    if (cond.kind === "Number") {
      // Constant condition, e.g. for (;;): true → no code at all; false → always jump.
      if (cond.value === 0) this.emit("beq", ZERO, ZERO, label);
      return;
    }
    const value = this.genExpr(cond); // any other expression: false means "equal to zero"
    this.emit("beq", value, ZERO, label);
    this.release(value);
  }

  // name = value  or  name[index] = value
  store(name, index, value) {
    const symbol = this.symbols.get(name);
    const register = this.genExpr(value);
    const store = STORE.get(symbol.type);
    if (index === null) {
      this.emit(store, register, memory(symbol.address, ZERO));
    } else if (index.kind === "Number") {
      this.emit(store, register, memory(symbol.address + index.value * symbol.size, ZERO));
    } else {
      const offset = this.indexOffset(index, symbol);
      this.emit(store, register, memory(symbol.address, offset));
      this.release(offset);
    }
    this.release(register);
  }

  // ---------- expressions: each returns the register that holds the value ----------

  genExpr(node) {
    switch (node.kind) {
      case "Number":
        return this.genNumber(node.value);
      case "VarRef":
        return this.genLoad(node);
      case "Unary": {
        const operand = this.genExpr(node.operand);
        const result = this.resultRegister(operand);
        this.emit("sub", result, ZERO, operand); // -a = 0 - a
        return result;
      }
      case "Binary":
        return REGISTER_FORM.has(node.op) ? this.genArithmetic(node) : this.genComparison(node);
      default:
        throw new Error(`riscv: unknown expression kind '${node.kind}'`);
    }
  }

  // 0 is already in x0; any other constant: addi rd, x0, k (fits: checked by analyze).
  genNumber(value) {
    if (value === 0) return ZERO;
    const result = this.allocate();
    this.emit("addi", result, ZERO, value);
    return result;
  }

  // a → lw rd, addr(x0) ;  v[2] → lw rd, (addr + 2*size)(x0) ;  v[i] → slli + lw rd, addr(offset)
  genLoad(node) {
    const symbol = this.symbols.get(node.name);
    const load = LOAD.get(symbol.type);
    if (node.index === null) {
      const result = this.allocate();
      this.emit(load, result, memory(symbol.address, ZERO));
      return result;
    }
    if (node.index.kind === "Number") {
      const result = this.allocate();
      this.emit(load, result, memory(symbol.address + node.index.value * symbol.size, ZERO));
      return result;
    }
    const offset = this.indexOffset(node.index, symbol);
    const result = this.resultRegister(offset);
    this.emit(load, result, memory(symbol.address, offset));
    return result;
  }

  // Byte offset of element `index`: index << log2(size). There is no mul instruction.
  indexOffset(index, symbol) {
    const register = this.genExpr(index);
    const shift = Math.log2(symbol.size);
    if (shift === 0) return register;
    const offset = this.resultRegister(register);
    this.emit("slli", offset, register, shift);
    return offset;
  }

  // + - & | ^ << >>, with the immediate form when the right operand is a constant that fits.
  genArithmetic(node) {
    const left = this.genExpr(node.left);
    const immediate = this.immediateOperand(node);
    if (immediate !== null) {
      const result = this.resultRegister(left);
      this.emit(withSign(immediate.op, node.operandType), result, left, immediate.value); // srai → srli
      return result;
    }
    const right = this.genExpr(node.right);
    const result = this.resultRegister(left, right);
    this.emit(withSign(REGISTER_FORM.get(node.op), node.operandType), result, left, right); // sra → srl
    return result;
  }

  // { op, value } for the immediate form of the node, or null if it needs the register form.
  // There is no subi: a - k is emitted as addi with -k (when -k fits: k = -2048 does not).
  immediateOperand(node) {
    if (node.right.kind !== "Number") return null;
    const k = node.right.value;
    if (node.op === "-") return fitsImm12(-k) ? { op: "addi", value: -k } : null;
    return { op: IMMEDIATE_FORM.get(node.op), value: k };
  }

  // Comparison used as a value: the result is 1 (true) or 0 (false).
  // slt/slti become sltu/sltiu when the operands are compared as unsigned int.
  genComparison(node) {
    const { op } = node;
    const lessThan = (signedOp) => withSign(signedOp, node.operandType);
    const k = node.right.kind === "Number" ? node.right.value : null;
    const left = this.genExpr(node.left);

    // a < b → slt (slti with a constant);  a >= b → the same, then flip the bit: xori rd, rd, 1
    if (op === "<" || op === ">=") {
      let result;
      if (k !== null) {
        result = this.resultRegister(left);
        this.emit(lessThan("slti"), result, left, k);
      } else {
        const right = this.genExpr(node.right);
        result = this.resultRegister(left, right);
        this.emit(lessThan("slt"), result, left, right);
      }
      if (op === ">=") this.emit("xori", result, result, 1);
      return result;
    }

    // a > b → slt rd, b, a (b < a);  a <= b → the same, then flip
    if (op === ">" || op === "<=") {
      const right = this.genExpr(node.right);
      const result = this.resultRegister(left, right);
      this.emit(lessThan("slt"), result, right, left);
      if (op === "<=") this.emit("xori", result, result, 1);
      return result;
    }

    // a == b ⇔ (a ^ b) == 0 → sltiu rd, diff, 1   (unsigned diff < 1 means diff is 0)
    // a != b ⇔ (a ^ b) != 0 → sltu rd, x0, diff   (0 < diff means diff is not 0)
    const difference = this.difference(left, node.right, k);
    const result = this.resultRegister(difference);
    if (op === "==") this.emit("sltiu", result, difference, 1);
    else this.emit("sltu", result, ZERO, difference);
    return result;
  }

  // Register holding left ^ right (zero exactly when they are equal). Comparing with 0 needs no
  // instruction; with another constant, xori.
  difference(left, rightNode, k) {
    if (k === 0) return left;
    if (k !== null) {
      const result = this.resultRegister(left);
      this.emit("xori", result, left, k);
      return result;
    }
    const right = this.genExpr(rightNode);
    const result = this.resultRegister(left, right);
    this.emit("xor", result, left, right);
    return result;
  }

  // ---------- registers ----------

  allocate() {
    const register = this.free.shift();
    if (register === undefined) {
      throw new CodegenError(this.currentLine,
        `expression too complex: it needs more than ${TEMPORARIES.length} registers; split it into several statements`);
    }
    return register;
  }

  // Register for the result of an instruction whose operands are no longer needed: reuse the
  // first operand that is a temporary (the hardware reads operands before writing the result),
  // release the others, or take a new register if all operands are x0.
  resultRegister(...operands) {
    const reusable = operands.find((register) => register !== ZERO);
    const result = reusable ?? this.allocate();
    this.release(...operands.filter((register) => register !== result));
    return result;
  }

  release(...registers) {
    for (const register of registers) {
      if (register !== ZERO && !this.free.includes(register)) this.free.push(register);
    }
    this.free.sort((a, b) => TEMPORARIES.indexOf(a) - TEMPORARIES.indexOf(b)); // lowest first
  }

  // ---------- output ----------

  // "    addi x5, x5, 5": mnemonic padded to 4 characters, operands separated by ", ".
  emit(op, ...operands) {
    this.instructionCount++;
    if (this.instructionCount === HARDWARE.INSTRUCTION_MEMORY_WORDS + 1) this.overflowLine = this.currentLine;
    this.lines.push(`    ${op.padEnd(4)} ${operands.join(", ")}`);
  }

  label(name) {
    this.lines.push(`${name}:`);
  }

  newLabel() {
    return `L${this.labelCount++}`;
  }

  // Before the code of a statement: "# line N: <C code>", once per C line.
  startLine(line) {
    this.currentLine = line;
    if (line === this.commentedLine) return;
    this.commentedLine = line;
    const code = (this.sourceLines[line - 1] ?? "").trim();
    this.lines.push("");
    this.lines.push(code ? `# line ${line}: ${code}` : `# line ${line}`);
  }

  // # Memory map
  // #   a      int      0x000
  // #   v[4]   int      0x004..0x013
  writeMemoryMap() {
    if (this.symbolList.length === 0) {
      this.lines.push("# Memory map: no variables");
      return;
    }
    this.lines.push("# Memory map");
    const rows = this.symbolList.map((symbol) => {
      const isArray = symbol.length !== null;
      const name = isArray ? `${symbol.name}[${symbol.length}]` : symbol.name;
      const lastByte = symbol.address + symbol.size * (symbol.length ?? 1) - 1;
      const range = isArray ? `${hex(symbol.address)}..${hex(lastByte)}` : hex(symbol.address);
      return { name, type: symbol.type, range };
    });
    // Columns as wide as their longest entry ("unsigned short"), never narrower than before.
    const nameWidth = Math.max(6, ...rows.map((row) => row.name.length));
    const typeWidth = Math.max(8, ...rows.map((row) => row.type.length));
    for (const { name, type, range } of rows) {
      this.lines.push(`#   ${name.padEnd(nameWidth)} ${type.padEnd(typeWidth)} ${range}`);
    }
  }
}

// ---------- helpers ----------

// "bge" → "bgeu" when the operation works in unsigned int; any other instruction stays the same.
function withSign(op, operandType) {
  return isUnsigned(operandType) ? (UNSIGNED_TWIN.get(op) ?? op) : op;
}

// "8(x0)": memory operand of a load or store.
function memory(offset, base) {
  return `${offset}(${base})`;
}

function fitsImm12(value) {
  return value >= HARDWARE.IMM12_MIN && value <= HARDWARE.IMM12_MAX;
}

// 20 → "0x014"
function hex(address) {
  return `0x${address.toString(16).toUpperCase().padStart(3, "0")}`;
}

// range(10, 13) → [10, 11, 12, 13]
function range(first, last) {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
