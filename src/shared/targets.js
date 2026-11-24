// Target assembly languages the compiler can produce (docs/DESIGN.md section 4.1).
// Single source of truth: the compiler validates its `target` argument with this list
// and the UI builds its target selector from it.

// id    → used by the code ("riscv")
// label → shown to the user ("RISC-V (RV32I)")
export const TARGETS = Object.freeze([
  Object.freeze({ id: "riscv", label: "RISC-V (RV32I)" }),
  Object.freeze({ id: "mips", label: "MIPS32" }),
  Object.freeze({ id: "arm", label: "ARM (32-bit)" }),
]);

// RISC-V is the main target: the only one with assembler, decoder and datapath.
export const DEFAULT_TARGET = "riscv";

// id → row, built once when the module is loaded.
const BY_ID = new Map(TARGETS.map((target) => [target.id, target]));

// Returns the target row for "riscv", "mips" or "arm", or undefined if unknown.
export function findTarget(id) {
  return BY_ID.get(id);
}
