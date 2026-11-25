// Semantic analysis: AST → checked AST + symbol table (third phase of the compiler frontend).
//
//   analyze(parse(tokenize("int main() { int a; int v[2]; a = -5; }").tokens).ast) → {
//     ast: <a NEW tree: every expression has its type, "-5" is folded to Number -5>,
//     symbols: [ { name: "a", type: "int", address: 0, size: 4, length: null, line: 1 },
//                { name: "v", type: "int", address: 4, size: 4, length: 2, line: 1 } ],
//     errors: [],
//   }
//
// The parser checks the SHAPE of the program; this phase checks its MEANING (is every variable
// declared? is an array used with an index? does every constant fit?) and decides where every
// variable lives in data memory.
//
// Pure function: the input tree is never modified. Every node is copied ({ ...node, type }).

import { HARDWARE } from "../shared/hardware.js";
import { INT, TYPE_SIZES, promote, commonType, shiftType } from "./types.js";

const SHIFT_OPERATORS = new Set(["<<", ">>"]);
const COMPARISONS = new Set(["<", ">", "<=", ">=", "==", "!="]);

export function analyze(program) {
  const analyzer = new Analyzer();
  const ast = analyzer.analyzeProgram(program);
  return { ast, symbols: analyzer.symbols, errors: analyzer.errors };
}

class Analyzer {
  constructor() {
    this.symbols = [];          // in declaration order (the memory map)
    this.byName = new Map();    // name → symbol, for lookups
    this.nextAddress = 0;       // first free byte of data memory
    this.firstOverflow = null;  // first symbol that does not fit in data memory
    this.errors = [];
    this.reported = new Set();  // "line:message" keys, so the same error is not repeated
  }

  analyzeProgram(program) {
    const body = this.analyzeStatement(program.body);
    if (this.firstOverflow) {
      const { name, line } = this.firstOverflow;
      this.report(line,
        `variables need ${this.nextAddress} bytes but data memory has ${HARDWARE.DATA_MEMORY_BYTES} ` +
        `('${name}' does not fit)`);
    }
    return { ...program, body };
  }

  // ---------- statements ----------

  analyzeStatement(node) {
    switch (node.kind) {
      case "Block":
        return { ...node, statements: node.statements.map((statement) => this.analyzeStatement(statement)) };
      case "VarDecl":
        return this.analyzeDeclaration(node);
      case "Assign":
        return { ...node, target: this.analyzeLValue(node.target), value: this.analyzeExpression(node.value) };
      case "If":
        return {
          ...node,
          cond: this.analyzeExpression(node.cond),
          then: this.analyzeStatement(node.then),
          else: node.else === null ? null : this.analyzeStatement(node.else),
        };
      case "While":
        return { ...node, cond: this.analyzeExpression(node.cond), body: this.analyzeStatement(node.body) };
      case "Return":
        return { ...node, value: node.value === null ? null : this.analyzeExpression(node.value) };
      default:
        throw new Error(`analyze: unknown statement kind '${node.kind}'`); // a bug, not a user error
    }
  }

  // One single scope for all of main: a declaration inside a loop or block allocates its variable
  // once, and the variable is visible until the end of main (documented limitation).
  analyzeDeclaration(node) {
    const previous = this.byName.get(node.name);
    if (previous) {
      this.report(node.line, `'${node.name}' is already declared (line ${previous.line})`);
    } else {
      if (node.length !== null && node.length < 1) {
        this.report(node.line, `array '${node.name}' must have at least 1 element`);
      }
      this.allocate(node);
    }
    // Declared BEFORE its initializer is checked, as in C: "int x = x;" is legal (x reads 0 here,
    // because this hardware's data memory starts at zero).
    const init = node.init === null ? null : this.analyzeExpression(node.init);
    return { ...node, init };
  }

  // Gives the variable the next free address, aligned to its element size.
  allocate(node) {
    const size = TYPE_SIZES[node.varType];
    const address = alignUp(this.nextAddress, size);
    const symbol = Object.freeze({
      name: node.name, type: node.varType, address, size, length: node.length, line: node.line,
    });
    this.nextAddress = address + size * (node.length ?? 1);
    if (this.nextAddress > HARDWARE.DATA_MEMORY_BYTES && this.firstOverflow === null) {
      this.firstOverflow = symbol;
    }
    this.symbols.push(symbol);
    this.byName.set(node.name, symbol);
  }

  // Target of an assignment: x or v[i].
  analyzeLValue(node) {
    const index = node.index === null ? null : this.analyzeExpression(node.index);
    const symbol = this.lookup(node);
    if (symbol) this.checkIndexing(node, symbol, index);
    return { ...node, index };
  }

  // ---------- expressions ----------

  analyzeExpression(node) {
    switch (node.kind) {
      case "Number":
        return this.literal(node.value, node.line);

      case "VarRef": {
        const index = node.index === null ? null : this.analyzeExpression(node.index);
        const symbol = this.lookup(node);
        if (symbol) this.checkIndexing(node, symbol, index);
        // The value read from a char/short variable is already promoted to int.
        return { ...node, index, type: symbol ? promote(symbol.type) : INT };
      }

      case "Unary": {
        // -5, -(-5), - -2048: fold the whole chain into one literal BEFORE checking its range,
        // otherwise -2048 would be rejected because 2048 alone is out of range.
        const folded = foldNegation(node);
        if (folded !== null) return this.literal(folded, node.line);
        const operand = this.analyzeExpression(node.operand);
        return { ...node, operand, type: promote(operand.type) };
      }

      case "Binary": {
        const left = this.analyzeExpression(node.left);
        const right = this.analyzeExpression(node.right);
        const isShift = SHIFT_OPERATORS.has(node.op);
        if (isShift && right.kind === "Number") this.checkShiftAmount(right);
        // operandType: the type the operation works in (decides signed vs unsigned instructions).
        // type: the type of the result. They differ only for comparisons: u < 5 compares as
        // unsigned int, but its result (0 or 1) is an int.
        const operandType = isShift ? shiftType(left.type) : commonType(left.type, right.type);
        const type = COMPARISONS.has(node.op) ? INT : operandType;
        return { ...node, left, right, operandType, type };
      }

      default:
        throw new Error(`analyze: unknown expression kind '${node.kind}'`);
    }
  }

  // A constant must fit in the 12-bit immediate of addi (no lui in our hardware).
  literal(value, line) {
    if (value < HARDWARE.IMM12_MIN || value > HARDWARE.IMM12_MAX) {
      this.report(line,
        `constant ${value} is out of range [${HARDWARE.IMM12_MIN}, ${HARDWARE.IMM12_MAX}] ` +
        "(larger constants would need lui, which the hardware does not have)");
    }
    return { kind: "Number", value, line, type: INT }; // a constant like 5 is an int in C
  }

  // a << 40 is undefined behavior in C on every processor, so it is checked here (frontend)
  // and every target reports the same error.
  checkShiftAmount(amount) {
    if (amount.value < 0 || amount.value > HARDWARE.SHAMT_MAX) {
      this.report(amount.line, `shift amount ${amount.value} is out of range [0, ${HARDWARE.SHAMT_MAX}]`);
    }
  }

  // ---------- symbols ----------

  lookup(node) {
    const symbol = this.byName.get(node.name);
    if (!symbol) this.report(node.line, `'${node.name}' is not declared`);
    return symbol;
  }

  // Scalars are used without index, arrays always with one. A constant index must be in bounds.
  checkIndexing(node, symbol, index) {
    const isArray = symbol.length !== null;
    if (!isArray && index !== null) {
      this.report(node.line, `'${node.name}' is not an array, it cannot be indexed`);
    } else if (isArray && index === null) {
      this.report(node.line, `array '${node.name}' needs an index: ${node.name}[i]`);
    } else if (isArray && index.kind === "Number" && (index.value < 0 || index.value >= symbol.length)) {
      this.report(node.line,
        `index ${index.value} is out of bounds for '${node.name}' (valid: 0..${symbol.length - 1})`);
    }
  }

  report(line, message) {
    const key = `${line}:${message}`;
    if (this.reported.has(key)) return; // "y = y + 1" with y undeclared: one error, not two
    this.reported.add(key);
    this.errors.push({ line, message });
  }
}

// If the node is a chain of unary minus ending in a number, returns its value; otherwise null.
//   -5 → -5      -(-5) → 5      -a → null
function foldNegation(node) {
  if (node.kind === "Number") return node.value;
  if (node.kind !== "Unary" || node.op !== "-") return null;
  const inner = foldNegation(node.operand);
  return inner === null ? null : 0 - inner; // 0 - x instead of -x: -0 would become JS's "negative zero"
}

// Smallest multiple of `alignment` that is >= address:  alignUp(5, 4) = 8, alignUp(8, 4) = 8.
function alignUp(address, alignment) {
  return Math.ceil(address / alignment) * alignment;
}
