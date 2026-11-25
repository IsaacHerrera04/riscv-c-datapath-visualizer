// Tiny RV32I simulator, used ONLY by tests (never by the page).
//
//   const { registers, memory, halted } = run([0x00500293, 0x00502023, 0x00000063]);
//   // addi x5, x0, 5 ; sw x5, 0(x0) ; halt   →  readWord(memory, 0) === 5
//
// It lets tests check RESULTS ("after sum-array runs, sum is 15") instead of only comparing
// assembly text. Each word is understood through our own decoder, like the hardware's control
// unit, so the simulator also exercises the decoder.
//
// Memory is little-endian, like the hardware's DataMemory (memoria_datos_s): sb at address 24 writes
// bits 7..0 of word 6, sb at address 27 writes bits 31..24.

import { decode } from "../../src/decoder/index.js";
import { HARDWARE } from "../../src/shared/hardware.js";

// Runs until the halt instruction (beq x0, x0, 0: a jump to itself) or until maxSteps.
// Throws on anything a correct compiler never produces (unknown word, pc outside the program,
// misaligned or out-of-range access): in a test, that is a bug worth seeing.
export function run(words, { maxSteps = 100_000 } = {}) {
  const registers = new Array(32).fill(0);
  const memory = new Uint8Array(HARDWARE.DATA_MEMORY_BYTES);
  const program = words.map((word) => decode(word));
  let pc = 0;

  for (let steps = 1; steps <= maxSteps; steps++) {
    const instruction = program[pc / HARDWARE.PC_INCREMENT];
    if (instruction === undefined) throw new Error(`pc ${pc} is outside the program`);
    if (instruction.error) throw new Error(instruction.error);
    if (isHalt(instruction)) return { registers, memory, steps, halted: true };

    pc = execute(instruction, pc, registers, memory);
    registers[0] = 0; // x0 always reads 0, writes are ignored
  }
  return { registers, memory, steps: maxSteps, halted: false };
}

// Signed 32-bit word at a byte address.
export function readWord(memory, address) {
  checkAccess(address, 4);
  return memory[address] | (memory[address + 1] << 8) | (memory[address + 2] << 16) | (memory[address + 3] << 24);
}

function isHalt({ name, rs1, rs2, imm }) {
  return name === "beq" && rs1 === 0 && rs2 === 0 && imm === 0;
}

// Executes one instruction and returns the next pc.
function execute(instruction, pc, x, memory) {
  const { type, name, rd, rs1, rs2, imm } = instruction;
  switch (type) {
    case "R":
      x[rd] = alu(name, x[rs1], x[rs2]);
      return pc + HARDWARE.PC_INCREMENT;
    case "I":
      x[rd] = alu(name, x[rs1], imm);
      return pc + HARDWARE.PC_INCREMENT;
    case "L":
      x[rd] = load(name, memory, x[rs1] + imm);
      return pc + HARDWARE.PC_INCREMENT;
    case "S":
      store(name, memory, x[rs1] + imm, x[rs2]);
      return pc + HARDWARE.PC_INCREMENT;
    case "B":
      return branchTaken(name, x[rs1], x[rs2]) ? pc + imm : pc + HARDWARE.PC_INCREMENT;
    default:
      throw new Error(`unknown instruction type ${type}`);
  }
}

// Registers hold signed 32-bit numbers. "| 0" wraps a JS result back to 32 bits;
// ">>> 0" reads a value as unsigned (for sltu / bltu / bgeu).
function alu(name, a, b) {
  switch (name) {
    case "add": case "addi": return (a + b) | 0;
    case "sub": return (a - b) | 0;
    case "and": case "andi": return a & b;
    case "or": case "ori": return a | b;
    case "xor": case "xori": return a ^ b;
    case "sll": case "slli": return a << (b & 31);
    case "srl": case "srli": return (a >>> (b & 31)) | 0;
    case "sra": case "srai": return a >> (b & 31);
    case "slt": case "slti": return a < b ? 1 : 0;
    case "sltu": case "sltiu": return (a >>> 0) < (b >>> 0) ? 1 : 0;
    default: throw new Error(`alu: unknown instruction ${name}`);
  }
}

function branchTaken(name, a, b) {
  switch (name) {
    case "beq": return a === b;
    case "bne": return a !== b;
    case "blt": return a < b;
    case "bge": return a >= b;
    case "bltu": return (a >>> 0) < (b >>> 0);
    case "bgeu": return (a >>> 0) >= (b >>> 0);
    default: throw new Error(`branch: unknown instruction ${name}`);
  }
}

function load(name, memory, address) {
  switch (name) {
    case "lw": return readWord(memory, address);
    case "lh": return (readHalf(memory, address) << 16) >> 16; // sign-extend 16 → 32 bits
    case "lhu": return readHalf(memory, address);
    case "lb": checkAccess(address, 1); return (memory[address] << 24) >> 24; // sign-extend 8 → 32
    case "lbu": checkAccess(address, 1); return memory[address];
    default: throw new Error(`load: unknown instruction ${name}`);
  }
}

function store(name, memory, address, value) {
  const bytes = { sb: 1, sh: 2, sw: 4 }[name];
  checkAccess(address, bytes);
  for (let i = 0; i < bytes; i++) memory[address + i] = (value >>> (8 * i)) & 0xFF;
}

function readHalf(memory, address) {
  checkAccess(address, 2);
  return memory[address] | (memory[address + 1] << 8);
}

// The real hardware ignores the low address bits (DESIGN.md 7.5); the compiler must always align,
// so a misaligned access here means a compiler bug.
function checkAccess(address, bytes) {
  if (address < 0 || address + bytes > HARDWARE.DATA_MEMORY_BYTES) {
    throw new Error(`memory access at ${address} is outside data memory`);
  }
  if (address % bytes !== 0) throw new Error(`misaligned ${bytes}-byte access at ${address}`);
}
