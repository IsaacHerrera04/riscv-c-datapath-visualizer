// Shared test vectors (not a test file: node --test only runs *.test.js).
// Each entry is [assembly line, expected hex word].

// Test program of the hardware design (MEMORIA_PROGRAMA.vhd), addresses 0..80.
// Numeric branch offsets are relative to the branch's own address.
export const HARDWARE_PROGRAM = Object.freeze([
  ["addi x19, x0, 8",   "0x00800993"], // 0
  ["addi x20, x0, 3",   "0x00300A13"], // 4
  ["bne x20, x19, 12",  "0x013A1663"], // 8
  ["add x21, x20, x19", "0x013A0AB3"], // 12
  ["beq x0, x0, 0",     "0x00000063"], // 16
  ["sub x21, x19, x20", "0x41498AB3"], // 20
  ["blt x20, x19, 8",   "0x013A4463"], // 24
  ["addi x22, x0, 99",  "0x06300B13"], // 28
  ["bge x20, x19, 8",   "0x013A5463"], // 32
  ["addi x22, x0, 1",   "0x00100B13"], // 36
  ["addi x23, x0, -1",  "0xFFF00B93"], // 40
  ["bltu x19, x23, 8",  "0x0179E463"], // 44
  ["addi x24, x0, 99",  "0x06300C13"], // 48
  ["blt x23, x19, 8",   "0x013BC463"], // 52
  ["addi x24, x0, 99",  "0x06300C13"], // 56
  ["bgeu x23, x19, 8",  "0x013BF463"], // 60
  ["addi x24, x0, 99",  "0x06300C13"], // 64
  ["addi x25, x0, 3",   "0x00300C93"], // 68
  ["addi x25, x25, -1", "0xFFFC8C93"], // 72
  ["bne x25, x0, -4",   "0xFE0C9EE3"], // 76
  ["beq x0, x0, 0",     "0x00000063"], // 80
]);

// One vector per mnemonic (all 33). Expected values computed with an independent
// bit-string reference encoder, itself checked against HARDWARE_PROGRAM.
// Operands chosen to hit the hard cases: negative values, -2048, 2047, and branch
// offsets that set bit 11 and bit 12 of the immediate.
export const ALL_MNEMONICS = Object.freeze([
  // R
  ["add x5, x6, x7",        "0x007302B3"],
  ["sub x5, x6, x7",        "0x407302B3"],
  ["sll x10, x11, x12",     "0x00C59533"],
  ["slt x13, x14, x15",     "0x00F726B3"],
  ["sltu x16, x17, x18",    "0x0128B833"],
  ["xor x19, x20, x21",     "0x015A49B3"],
  ["srl x22, x23, x24",     "0x018BDB33"],
  ["sra x25, x26, x27",     "0x41BD5CB3"],
  ["or x28, x29, x30",      "0x01EEEE33"],
  ["and x31, x1, x2",       "0x0020FFB3"],
  // I
  ["addi x5, x6, -42",      "0xFD630293"],
  ["slli x5, x6, 3",        "0x00331293"],
  ["slti x7, x8, 100",      "0x06442393"],
  ["sltiu x9, x10, 1",      "0x00153493"],
  ["xori x11, x12, -1",     "0xFFF64593"],
  ["srli x13, x14, 31",     "0x01F75693"],
  ["srai x15, x16, 4",      "0x40485793"],
  ["ori x17, x18, 0x7FF",   "0x7FF96893"],
  ["andi x19, x20, 255",    "0x0FFA7993"],
  // L
  ["lb x5, -1(x6)",         "0xFFF30283"],
  ["lh x7, 2(x8)",          "0x00241383"],
  ["lw x9, 2047(x10)",      "0x7FF52483"],
  ["lbu x11, -2048(x12)",   "0x80064583"],
  ["lhu x13, 0x10(x14)",    "0x01075683"],
  // S
  ["sb x5, -1(x6)",         "0xFE530FA3"],
  ["sh x7, 6(x8)",          "0x00741323"],
  ["sw x9, -2048(x10)",     "0x80952023"],
  // B
  ["beq x5, x6, 16",        "0x00628863"],
  ["bne x7, x8, -4",        "0xFE839EE3"],
  ["blt x9, x10, 2048",     "0x00A4C0E3"],
  ["bge x11, x12, -2048",   "0x80C5D0E3"],
  ["bltu x13, x14, 4094",   "0x7EE6EFE3"],
  ["bgeu x15, x16, -4096",  "0x8107F063"],
]);

// "0x00800993" → 0x00800993 (number)
export const wordOf = (hexText) => Number(hexText);
