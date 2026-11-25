// C type rules of the subset (docs/DESIGN.md section 4): sizes, integer promotion and the type of
// each operation. Part of the frontend, so every target follows exactly the same rules.

export const INT = "int";
export const UNSIGNED_INT = "unsigned int";

// The six types of the subset, with their size in bytes (alignment = size).
export const TYPE_SIZES = Object.freeze({
  "int": 4, "unsigned int": 4,
  "short": 2, "unsigned short": 2,
  "char": 1, "unsigned char": 1,
});

// Integer promotion: before any operation, char and short (signed or unsigned) become int,
// because int can hold all their values. Only unsigned int stays as it is.
//   promote("unsigned char") → "int"      promote("unsigned int") → "unsigned int"
export function promote(type) {
  return type === UNSIGNED_INT ? UNSIGNED_INT : INT;
}

// Type of + - & | ^ and of the comparison of two operands: after promotion,
// unsigned int wins over int.   commonType("int", "unsigned int") → "unsigned int"
export function commonType(left, right) {
  return promote(left) === UNSIGNED_INT || promote(right) === UNSIGNED_INT ? UNSIGNED_INT : INT;
}

// Type of << and >>: the promoted LEFT operand only. The shift amount never changes it.
//   shiftType("int", "unsigned int") → "int"   (so -8 >> u is still arithmetic)
export function shiftType(left) {
  return promote(left);
}

// For promoted types: does this operation use the unsigned instructions?
export function isUnsigned(type) {
  return type === UNSIGNED_INT;
}
