// Register names of RV32I: numeric names (x0..x31) and ABI names (zero, ra, t0, ...).
// Single source of truth for register names in the whole project.

export const REGISTER_COUNT = 32;

// ABI_NAMES[i] is the ABI name of register xi.
export const ABI_NAMES = Object.freeze([
  "zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2",   // x0  - x7
  "s0", "s1", "a0", "a1", "a2", "a3", "a4", "a5",     // x8  - x15
  "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7",     // x16 - x23
  "s8", "s9", "s10", "s11", "t3", "t4", "t5", "t6",   // x24 - x31
]);

// Extra names that are not in ABI_NAMES: fp (frame pointer) is another name for s0.
const ALIASES = Object.freeze({ fp: 8 });

// ABI name -> register number, built once when the module is loaded.
const BY_ABI_NAME = new Map(ABI_NAMES.map((name, number) => [name, number]));
for (const [name, number] of Object.entries(ALIASES)) BY_ABI_NAME.set(name, number);

// "x" followed by a number without leading zeros: x0, x7, x31, x99 (range checked below).
const NUMERIC_NAME = /^x(0|[1-9][0-9]?)$/;

// Returns the register number (0..31) for "x5", "t0", "fp", ... or null if invalid.
// Case-insensitive; surrounding whitespace is ignored.
export function parseRegister(text) {
  if (typeof text !== "string") return null;
  const name = text.trim().toLowerCase();

  const match = NUMERIC_NAME.exec(name);
  if (match) {
    const number = Number(match[1]);
    return number < REGISTER_COUNT ? number : null;
  }

  return BY_ABI_NAME.get(name) ?? null;
}
