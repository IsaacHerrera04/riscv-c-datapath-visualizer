// The 33 RV32I instructions supported by the hardware (docs/DESIGN.md section 6).
// This is the single source of truth: opcodes, funct3/funct7, aluControl and
// branchInvert must not be written anywhere else in the project.

// One opcode per instruction type (bits 6..0 of the instruction word).
const OPCODES = Object.freeze({
  R: 0b0110011,
  I: 0b0010011,
  L: 0b0000011,
  S: 0b0100011,
  B: 0b1100011,
});

// 4-bit ALU operation codes produced by the control unit (control_04).
export const ALU_OPERATIONS = Object.freeze({
  0b0000: "ADD",
  0b0001: "SUB",
  0b0010: "AND",
  0b0011: "OR",
  0b0100: "XOR",
  0b0101: "SLT",
  0b0110: "SLTU",
  0b0111: "SLL",
  0b1000: "SRL",
  0b1001: "SRA",
  0b1010: "SEQ",
  0b1111: "INVALID",
});

// Builds one frozen table row. The opcode is taken from the type, so it
// cannot be mistyped row by row.
// funct7 = null means "don't care": those bits belong to the immediate.
function row(name, type, funct3, funct7, aluControl, branchInvert = 0) {
  return Object.freeze({
    name,
    type,
    opcode: OPCODES[type],
    funct3,
    funct7,
    aluControl,
    branchInvert,
  });
}

export const INSTRUCTIONS = Object.freeze([
  //   name     type  funct3  funct7     aluControl  branchInvert
  // R type: register-register
  row("add",   "R",  0b000,  0b0000000, 0b0000),
  row("sub",   "R",  0b000,  0b0100000, 0b0001),
  row("sll",   "R",  0b001,  0b0000000, 0b0111),
  row("slt",   "R",  0b010,  0b0000000, 0b0101),
  row("sltu",  "R",  0b011,  0b0000000, 0b0110),
  row("xor",   "R",  0b100,  0b0000000, 0b0100),
  row("srl",   "R",  0b101,  0b0000000, 0b1000),
  row("sra",   "R",  0b101,  0b0100000, 0b1001),
  row("or",    "R",  0b110,  0b0000000, 0b0011),
  row("and",   "R",  0b111,  0b0000000, 0b0010),

  // I type: register-immediate (shifts use bits 31..25 as funct7)
  row("addi",  "I",  0b000,  null,      0b0000),
  row("slli",  "I",  0b001,  0b0000000, 0b0111),
  row("slti",  "I",  0b010,  null,      0b0101),
  row("sltiu", "I",  0b011,  null,      0b0110),
  row("xori",  "I",  0b100,  null,      0b0100),
  row("srli",  "I",  0b101,  0b0000000, 0b1000),
  row("srai",  "I",  0b101,  0b0100000, 0b1001),
  row("ori",   "I",  0b110,  null,      0b0011),
  row("andi",  "I",  0b111,  null,      0b0010),

  // L type: loads (the ALU adds base + offset)
  row("lb",    "L",  0b000,  null,      0b0000),
  row("lh",    "L",  0b001,  null,      0b0000),
  row("lw",    "L",  0b010,  null,      0b0000),
  row("lbu",   "L",  0b100,  null,      0b0000),
  row("lhu",   "L",  0b101,  null,      0b0000),

  // S type: stores (the ALU adds base + offset)
  row("sb",    "S",  0b000,  null,      0b0000),
  row("sh",    "S",  0b001,  null,      0b0000),
  row("sw",    "S",  0b010,  null,      0b0000),

  // B type: branches (the ALU compares; branchInvert negates the result)
  row("beq",   "B",  0b000,  null,      0b1010,     0),
  row("bne",   "B",  0b001,  null,      0b1010,     1),
  row("blt",   "B",  0b100,  null,      0b0101,     0),
  row("bge",   "B",  0b101,  null,      0b0101,     1),
  row("bltu",  "B",  0b110,  null,      0b0110,     0),
  row("bgeu",  "B",  0b111,  null,      0b0110,     1),
]);

// Lookup maps, built once when the module is loaded.

// "addi" -> row
const BY_NAME = new Map(INSTRUCTIONS.map((ins) => [ins.name, ins]));

// "opcode:funct3" -> [rows]. Usually one row; two when funct7 decides
// (add/sub, srl/sra, srli/srai).
const BY_OPCODE_FUNCT3 = new Map();
for (const ins of INSTRUCTIONS) {
  const key = encodingKey(ins.opcode, ins.funct3);
  if (!BY_OPCODE_FUNCT3.has(key)) BY_OPCODE_FUNCT3.set(key, []);
  BY_OPCODE_FUNCT3.get(key).push(ins);
}

function encodingKey(opcode, funct3) {
  return `${opcode}:${funct3}`;
}

// Returns the row for a mnemonic (case-insensitive), or undefined.
export function findByName(name) {
  if (typeof name !== "string") return undefined;
  return BY_NAME.get(name.toLowerCase());
}

// Returns the row whose encoding matches, or undefined.
// funct7 is compared only when the row defines it (not null): for addi,
// bits 31..25 are part of the immediate and can hold any value.
export function findByEncoding(opcode, funct3, funct7) {
  const candidates = BY_OPCODE_FUNCT3.get(encodingKey(opcode, funct3)) ?? [];
  return candidates.find((ins) => ins.funct7 === null || ins.funct7 === funct7);
}
