// A tour of every type. This one program uses all 33 RV32I instructions of the hardware.
// Each comment names the instruction a line needs and the value it leaves in memory.
int main() {
  char c[4];             // signed bytes:   read with lb
  unsigned char b[4];    // unsigned bytes: read with lbu
  short s[2];            // read with lh
  unsigned short h[2];   // read with lhu
  int r[12];             // results
  int i;
  int n = 4;
  int k = 1;
  unsigned u = -1;       // 0xFFFFFFFF: the largest unsigned int
  int sum = 0;
  unsigned big = 0;
  int total = 0;
  int flags = 0;

  // The same bits in both arrays: c = -2, -1, 0, 1   b = 254, 255, 0, 1
  for (i = 0; i < n; i++) {   // bge (leave the loop), beq x0 (jump back)
    c[i] = i - 2;              // sb: index not scaled (1 byte per element)
    b[i] = i - 2;
  }
  for (i = 0; i < n; i++) {
    sum = sum + c[i];          // lb, add: -2 - 1 + 0 + 1 = -2
    big = big + b[i];          // lbu:     254 + 255 + 0 + 1 = 510
  }

  // Halfwords: sh keeps the low 16 bits, lh / lhu extend them with or without sign
  s[0] = -300;                 // sh
  h[0] = -300;                 // the same bits 0xFED4, read as 65236
  s[1] = s[0] + h[0];          // lh, lhu: 64936 does not fit in a short → stored as -600
  h[1] = 1000;
  for (i = 0; i < 2; i++) {
    total = total + s[i] + h[i];   // slli by 1 (2 bytes per element): -300 + 65236 - 600 + 1000 = 65336
  }

  // Register forms and immediate forms
  r[0] = sum < k;              // slt:   -2 < 1 → 1
  r[1] = u < big;              // sltu:  4294967295 < 510 → 0
  r[2] = sum < 5;              // slti   → 1
  r[3] = u < 5;                // sltiu  → 0
  r[4] = sum ^ k;              // xor:   -2 ^ 1 = -1
  r[5] = sum - k;              // sub:   -3
  r[6] = k << n;               // sll:   16
  r[7] = u >> n;               // srl:   0x0FFFFFFF = 268435455
  r[8] = sum >> k;             // sra:   -1
  r[9] = (sum | k) & big;      // or, and: -1 & 510 = 510
  r[10] = (sum & 0xFF) | 0x100;                            // andi, ori: 254 | 256 = 510
  r[11] = (sum ^ 3) + (k << 4) + (u >> 28) + (sum >> 1);   // xori, slli, srli, srai: -3 + 16 + 15 - 1 = 27

  // Every kind of branch. Each if jumps over its body when the condition is FALSE.
  if (u > k) flags = flags | 1;     // bgeu: unsigned, true  → +1
  if (u >= big) flags = flags | 2;  // bltu: unsigned, true  → +2
  if (sum == -2) flags = flags | 4; // bne:  true            → +4
  if (sum >= k) flags = flags | 8;  // blt:  -2 >= 1 is false → skipped
  return flags;                     // flags = 7, sw and lw everywhere
}
