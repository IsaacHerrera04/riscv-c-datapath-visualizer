// Physical limits of the hardware design and of the RV32I instruction formats
// (docs/DESIGN.md section 7.5). Single source of truth: no other file may
// write these numbers directly.

export const HARDWARE = Object.freeze({
  // Memories
  INSTRUCTION_MEMORY_WORDS: 256, // MEMORIA_PROGRAMA.vhd: rom 0 to 255
  DATA_MEMORY_BYTES: 1024,       // MEMORIAA_S.vhd: 256 words, addr(9 downto 2)

  // Immediate ranges
  IMM12_MIN: -2048,              // 12-bit signed immediate (types I, L, S): -2^11
  IMM12_MAX: 2047,               //                                           2^11 - 1
  SHAMT_MAX: 31,                 // slli/srli/srai: 5-bit shift amount, 0..31
  BRANCH_OFFSET_MIN: -4096,      // 13-bit signed branch offset (type B): -2^12
  BRANCH_OFFSET_MAX: 4094,       // largest even value below 2^12

  // Program counter and program shape
  PC_INCREMENT: 4,               // CONST input of the diagram: next instruction = PC + 4
  HALT_LABEL: "halt",            // every program ends with  halt: beq x0, x0, halt
});
