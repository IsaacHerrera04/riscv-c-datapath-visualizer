# Design document

This document records every design decision of the project and the reason behind it.
It is the single source of truth: if code and this document disagree, one of them is a bug.

## 1. Goal

A web page (static, hosted on GitHub Pages) that:

1. Receives C source code (a small subset of C, see section 4).
2. Lets the user choose the **target assembly language**: RISC-V RV32I, MIPS32 or ARM (32-bit).
3. Compiles the C code to the chosen assembly language with **our own compiler**.
4. For RISC-V only: assembles each instruction to its 32-bit machine code.
5. For RISC-V only: decodes each machine word into its fields (opcode, rd, rs1, rs2, funct3, funct7,
   immediate).
6. For RISC-V only: shows the **single-cycle datapath** of each instruction (types R, I, L, S, B),
   highlighting the active components, wires and control-signal values.

The datapath reproduces a real hardware design built in Active-HDL (VHDL), described in section 7.
RISC-V is the main target: the assembler, decoder and datapath exist only for it. MIPS32 and ARM are
additional compiler outputs (section 4.1).

## 2. Architecture

```
            ┌──────────────────────── ASM mode skips the compiler ─────────────┐
            │                                                                   ▼
 Input (e) ──C text──► (a) Compiler ──asm text──► (b) Assembler ──32-bit words──► (c) Decoder
                             ▲                          ▲                               │
                        hardware.js              instructions.js ◄──────────────────────┤ fields
                                                        ▼                               ▼
                                                  (d) Datapath ◄────────────────────────┘
                                                        │ signals + active wires
                                                        ▼
                                                    View (e)
```

### Rules

1. **Every module is a pure function.** It receives data and returns data. It does not know other
   modules exist (it may only import the shared files in `src/shared/`).
2. **Only the UI orchestrator (`src/ui/main.js`) calls modules, in order**, passing the output of one
   as the input of the next. "ASM mode" simply skips the compiler call (ASM mode is RISC-V only).
   With the MIPS32 or ARM target the pipeline stops after the compiler: the page shows the
   generated assembly and explains that the datapath exists only for RISC-V.
3. **Errors are returned, not thrown.** Every module returns `{ ..., errors: [] }` where each error is
   `{ line, message }`. This lets the UI show all errors at once.
4. **Single source of truth.** Opcodes, funct fields and control values live only in
   `src/shared/instructions.js`. Hardware limits live only in `src/shared/hardware.js`.
   The list of target languages lives only in `src/shared/targets.js`.
   No magic numbers anywhere else.

### Compiler structure: one frontend, one backend per target

```
            frontend (target-independent)              backend (one per target)
 C text ──► tokenize ──► parse ──► analyze ──AST──►  riscv.js | mips.js | arm.js  ──► asm text
```

Checking that the C program is valid does not depend on the target, so the lexer, parser and
semantic analysis are written once. Only code generation changes per target. Real compilers
(GCC, LLVM) are organized the same way.

### Why the datapath reads the decoder output and not the assembler output

The hardware control unit only sees bits (opcode, funct3, funct7), never text. The datapath must start
from the same 32-bit pattern. Bonus: if the assembler encodes something wrong, the decoder exposes it.

## 3. Data contracts

```js
// (a) Compiler
compile(sourceC, target)   // target: "riscv" (default) | "mips" | "arm"
                           // → { asm: string, symbols: [...], errors: [{ line, message }] }
                           //    symbols: [{ name, type, address, size, length, line }]
                           //    (size = bytes per element; length = null for scalars)
                           //    an unknown target is reported as { line: null, message }

// (b) Assembler
assemble(asmText)  // → { program: [{ address, source, line, word }], errors: [...] }
                   //    word is an unsigned 32-bit number, e.g. 0x00502023

// (c) Decoder
decode(word)       // → { name, type, opcode, rd, rs1, rs2, funct3, funct7, imm, segments }
                   //    rd/rs1/rs2 are null when the format does not use them
                   //    imm is the sign-extended immediate as a JS number (or null for type R)
                   //    funct7 is bits 31–25 as present in the word
                   //    segments: [{ field, bits, value }], the 32 bits split by field
                   //    returns { error } if the word is not one of the 33 instructions
disassemble(fields) // → canonical text, e.g. "sw x5, 0(x0)" (xN names, numeric offsets)

// (d) Datapath
datapath(fields)   // → { signals: { regWrite, memWrite, aluSrc, memToReg, immSrc,
                   //                branch, branchInvert, aluControl },
                   //     activeComponents: [...], activeWires: [...] }
```

Example for `sw x5, 0(x0)`:

```js
assemble("sw x5, 0(x0)").program[0].word      // 0x00502023
decode(0x00502023)  // { name: "sw", type: "S", opcode: 0b0100011, funct3: 0b010, rs1: 0, rs2: 5, imm: 0 }
```

## 4. Supported C subset

### Accepted

| Feature | Details |
|---|---|
| Types | `int`, `unsigned` / `unsigned int`, `short`, `unsigned short`, `char`, `unsigned char` |
| Declarations | scalars with optional initializer (`int x = 5;`), fixed-size arrays (`char c[8];`) |
| Program shape | a single `int main() { ... }` |
| Arithmetic / bitwise | `+ - & \| ^ << >>`, unary `-` |
| Comparisons | `< > <= >= == !=` in `if` / `while` / `for` conditions **and** as values (`int x = a < b;`) |
| Control flow | `if`, `if/else`, `while`, `for` (desugared to `while`) |
| Constants | decimal (`42`) or hexadecimal (`0x2A`) integers in `[-2048, 2047]` |
| Comments | `// ...` and `/* ... */` |

### Rejected (with a clear error message)

| Feature | Reason |
|---|---|
| `*` `/` `%` | RV32I has no multiply/divide (that is the M extension); the subset is the same for every target |
| `&&` `\|\|` `!` | need short-circuit evaluation; out of scope |
| functions other than `main`, calls | need a stack, `jal`/`jalr` (types J/I-jump not in our hardware set) |
| pointers, structs, floats | out of scope |
| constants outside `[-2048, 2047]` | would need `lui` (type U) |
| octal constants (`017`) | in C a leading zero means octal (`017` = 15); rejected to avoid surprises |
| `x = i++;`, `++i;`, `a = b = c;` | `++`, `--` and assignments are statements only (`i++;`), never values |
| `for (int i = 0; ...)` | declare the variable before the loop; all variables share one scope |

### Type rules (follow real C semantics)

- **Integer promotion:** `char`, `unsigned char`, `short`, `unsigned short` are promoted to `int`
  before any operation. Registers always hold 32-bit values.
- The type only matters in three places:
  1. **Memory access width and sign:** load with `lb/lbu/lh/lhu/lw`, store with `sb/sh/sw`.
  2. **Array element size:** address = base + (index << log2(size)) — shifts, because there is no `mul`.
  3. **Signedness of comparisons and `>>`:** a comparison is unsigned if either operand (after
     promotion) is `unsigned int` → `sltu/sltiu/bltu/bgeu`; otherwise `slt/slti/blt/bge`.
     A shift takes the type of its **left** operand only: `>>` on `unsigned int` → `srl/srli`,
     on `int` → `sra/srai` (`-8 >> u` stays arithmetic).
- `unsigned char` and `unsigned short` promote to `int` (not `unsigned int`), because `int` can hold
  all their values. Constants are `int`; in `u < -1` the `-1` is converted to `unsigned int`, as in C.
- The rules live in `src/compiler/types.js` (frontend), so every target applies them identically.
  Each `Binary` node carries `type` (type of the result) and `operandType` (type the operation works
  in). They differ only for comparisons: `u < 5` compares as `unsigned int` but yields an `int`.

### How C maps to the 33 instructions

| C | Instructions |
|---|---|
| `+ - & \| ^ <<` | `add sub and or xor sll` + immediate forms `addi andi ori xori slli` |
| `>>` signed / unsigned | `sra srai` / `srl srli` |
| comparison as a value | `slt slti sltu sltiu` (`a == 0` → `sltiu rd, a, 1`; `a != b` → `xor` + `sltu rd, x0, t`) |
| read `int` / `short` / `unsigned short` / `char` / `unsigned char` | `lw` / `lh` / `lhu` / `lb` / `lbu` |
| write `int` / `short` / `char` | `sw` / `sh` / `sb` |
| `if` / `while` signed / unsigned | `beq bne blt bge` / `bltu bgeu` |

`a > b` is emitted as `blt b, a` and `a <= b` as `bge b, a` (RISC-V has no `bgt`/`ble`).

### 4.1 Target languages

| Target | Variant | Compiler output | Assembler, decoder, datapath |
|---|---|---|---|
| RISC-V | RV32I, the 33 instructions of section 6 | assembly text | yes |
| MIPS | MIPS32 | assembly text | no |
| ARM | ARM 32-bit (A32) | assembly text | no |

- **The C subset is the same for every target.** It is defined by the RISC-V hardware: MIPS32 and ARM
  do have multiply instructions, but `*` `/` `%` stay rejected so the three outputs compile the same
  programs.
- MIPS32 and ARM use only the instructions equivalent to the RISC-V set (add/subtract, logic,
  shifts, set-less-than, byte/halfword/word loads and stores, conditional branches). Their exact
  instruction lists are defined when those backends are built.
- The same limits apply to every target (1024 bytes of data, 256 instructions, constants in
  `[-2048, 2047]`), so a program that compiles for one target compiles for all three.

## 5. Code generation conventions (RISC-V target)

- **All variables and arrays live in data memory** at fixed addresses starting at 0, accessed with
  `x0` as base (`lw x5, 8(x0)`). Every address fits in the 12-bit immediate because data memory is
  1024 bytes. Consequences: no register allocation needed, and most programs naturally produce
  loads and stores.
- **Alignment:** `int` at multiples of 4, `short` at multiples of 2. The hardware silently ignores the
  low address bits, so misaligned accesses would read wrong data.
- **Array access with a variable index:** compute `index << log2(size)` into a register, then use the
  array base as the immediate offset: `lw rd, base(rIndex)`.
- **Registers:** expression temporaries come from the pool `x5 x6 x7 x10–x31`, are released right
  after use, and the result reuses the left operand's register. More than 25 live values →
  "expression too complex". The constant `0` is `x0`.
- **Immediate forms** whenever the right operand is a constant (`addi andi ori xori slli srai slti`);
  `a - k` is `addi rd, a, -k` because there is no `subi`.
- **Conditions** branch to the end of the `if`/loop when they are **false** (`a < b` → `bge a, b, L`);
  `a > b` and `a <= b` swap the operands (`bge b, a, L` / `blt b, a, L`).
- **Loops** jump back with `beq x0, x0, label` (always taken) so no `jal` is needed.
- **Every program ends with `beq x0, x0, 0`** (jump to itself = halt), same convention as the
  original hardware test program.
- Errors if the program needs more than 1024 bytes of data or more than 256 instructions.
- **Types in the backend:** loads follow the declared type (`int`/`unsigned int` → `lw`, `short` →
  `lh`, `unsigned short` → `lhu`, `char` → `lb`, `unsigned char` → `lbu`); stores follow the size only
  (`sw`/`sh`/`sb`, the low bits are kept). A variable index is scaled with `slli` by 2 (`int`), 1
  (`short`) or not at all (`char`). When a `Binary` node's `operandType` is `unsigned int`, every
  signed instruction is replaced by its unsigned twin: `slt→sltu`, `slti→sltiu`, `blt→bltu`,
  `bge→bgeu`, `sra→srl`, `srai→srli`. The others (`add`, `sub`, `xor`, `beq`, ...) give the same bits
  in two's complement, so they are shared.

## 6. Instruction set (33 instructions)

`aluControl` and `branchInvert` come from the hardware control unit (`control_04`).
`funct7: —` means "don't care": those bits belong to the immediate.

| Name | Type | Opcode | funct3 | funct7 | aluControl | branchInvert |
|---|---|---|---|---|---|---|
| add  | R | 0110011 | 000 | 0000000 | 0000 ADD  | |
| sub  | R | 0110011 | 000 | 0100000 | 0001 SUB  | |
| sll  | R | 0110011 | 001 | 0000000 | 0111 SLL  | |
| slt  | R | 0110011 | 010 | 0000000 | 0101 SLT  | |
| sltu | R | 0110011 | 011 | 0000000 | 0110 SLTU | |
| xor  | R | 0110011 | 100 | 0000000 | 0100 XOR  | |
| srl  | R | 0110011 | 101 | 0000000 | 1000 SRL  | |
| sra  | R | 0110011 | 101 | 0100000 | 1001 SRA  | |
| or   | R | 0110011 | 110 | 0000000 | 0011 OR   | |
| and  | R | 0110011 | 111 | 0000000 | 0010 AND  | |
| addi  | I | 0010011 | 000 | —       | 0000 ADD  | |
| slli  | I | 0010011 | 001 | 0000000 | 0111 SLL  | |
| slti  | I | 0010011 | 010 | —       | 0101 SLT  | |
| sltiu | I | 0010011 | 011 | —       | 0110 SLTU | |
| xori  | I | 0010011 | 100 | —       | 0100 XOR  | |
| srli  | I | 0010011 | 101 | 0000000 | 1000 SRL  | |
| srai  | I | 0010011 | 101 | 0100000 | 1001 SRA  | |
| ori   | I | 0010011 | 110 | —       | 0011 OR   | |
| andi  | I | 0010011 | 111 | —       | 0010 AND  | |
| lb  | L | 0000011 | 000 | — | 0000 ADD | |
| lh  | L | 0000011 | 001 | — | 0000 ADD | |
| lw  | L | 0000011 | 010 | — | 0000 ADD | |
| lbu | L | 0000011 | 100 | — | 0000 ADD | |
| lhu | L | 0000011 | 101 | — | 0000 ADD | |
| sb | S | 0100011 | 000 | — | 0000 ADD | |
| sh | S | 0100011 | 001 | — | 0000 ADD | |
| sw | S | 0100011 | 010 | — | 0000 ADD | |
| beq  | B | 1100011 | 000 | — | 1010 SEQ  | 0 |
| bne  | B | 1100011 | 001 | — | 1010 SEQ  | 1 |
| blt  | B | 1100011 | 100 | — | 0101 SLT  | 0 |
| bge  | B | 1100011 | 101 | — | 0101 SLT  | 1 |
| bltu | B | 1100011 | 110 | — | 0110 SLTU | 0 |
| bgeu | B | 1100011 | 111 | — | 0110 SLTU | 1 |

Shift immediates (`slli/srli/srai`) use only 5 bits (shamt 0–31); bits 31–25 act as funct7.

## 7. Hardware reference (Active-HDL design `DIAGRAM_B`)

The web datapath uses descriptive English names. The original VHDL names are kept here so the
correspondence with the hardware project is always visible.

### 7.1 Components

| Original (VHDL) | Name in this project | Function |
|---|---|---|
| `registro_pc` | `PCRegister` | Holds the address of the current instruction |
| `fibona` / `memoria_programa` | `InstructionMemory` | Outputs the instruction at address PC |
| `sumador_pc` | `PCAdder` | Computes the next PC (single adder) |
| `mux_pc` | `PCIncrementMux` | Chooses +4 or the branch offset |
| `extensor_b` | `BranchImmGen` | Builds and sign-extends the B-type offset (bit 0 = 0) |
| `control_04` | `ControlUnit` | Generates control signals |
| `BancoDeRegistros` | `RegisterFile` | Registers x0–x31 |
| `selector_imm` | `ImmSelector` | Chooses the I-type or S-type 12-bit immediate |
| `Extensor_01` | `SignExtender` | Sign-extends 12 → 32 bits |
| `MUX_01` | `ALUSrcMux` | Chooses rs2 or the immediate as ALU input B |
| `ALU_B` | `ALU` | Arithmetic-logic unit |
| `Extraer_Bit` | `ConditionBit` | Takes bit 0 of the ALU result |
| `mux_1bit` + NOT | `BranchInvertMux` | Optionally inverts the condition |
| AND gate | `BranchAnd` | `branchTaken = condition AND branch` |
| `memoria_datos_s` | `DataMemory` | Data memory with byte/halfword stores |
| `extensor_ccarga` | `LoadExtender` | Extracts and extends byte/halfword on loads |
| `MUXL` | `WriteBackMux` | Chooses ALU result or memory data for rd |

### 7.2 Control signals

| Original | Name | Meaning |
|---|---|---|
| `wer` | `regWrite` | Write rd in the register file |
| `wem` | `memWrite` | Write data memory |
| `sel_B` | `aluSrc` | 0 = rs2, 1 = immediate |
| `mem_to_reg` | `memToReg` | 0 = ALU result, 1 = loaded data |
| `imm_rd` | `immSrc` | 0 = I-type immediate (bits 31–20), 1 = S-type (bits 31–25 + 11–7) |
| `operacion` | `aluControl` | Final 4-bit ALU operation (no separate ALU-control unit) |
| `branch` | `branch` | Instruction is a branch |
| `br_neg` | `branchInvert` | Invert the condition bit (`bne`, `bge`, `bgeu`) |

| Type | regWrite | memWrite | aluSrc | memToReg | immSrc | branch | aluControl |
|---|---|---|---|---|---|---|---|
| R | 1 | 0 | 0 | 0 | 0 | 0 | from funct3/funct7 |
| I | 1 | 0 | 1 | 0 | 0 | 0 | from funct3 (+funct7 for shifts) |
| L | 1 | 0 | 1 | 1 | 0 | 0 | ADD |
| S | 0 | 1 | 1 | 0 | 1 | 0 | ADD |
| B | 0 | 0 | 0 | 0 | 0 | 1 | SEQ / SLT / SLTU |

(Values are the actual VHDL outputs; for R, L, B `immSrc` is 0 but unused, for S/B `memToReg` is 0 but unused.)

### 7.3 Wires (buses)

| Original | Name | Original | Name |
|---|---|---|---|
| `BUS3492` | `pc` | `BUS113` | `aluB` |
| `BUS3424` | `pcNext` | `BUS1408` | `aluResult` |
| `BUS1914` | `pcIncrement` | `BUS146` | `memWord` |
| `BUS1748` | `branchOffset` | `BUS159` | `loadData` |
| `BUS72` | `rs1Data` | `BUS137` | `writeBackData` |
| `BUS78` | `rs2Data` | `NET1535` | `condBit` |
| `BUS325` | `imm12` | `NET1574` | `condition` |
| `BUS90` | `immExt` | `NET1715` | `branchTaken` |
| `INST` | `instruction` | `CONST` | constant 4 |

### 7.4 ALU operation codes

| Code | Op | Code | Op |
|---|---|---|---|
| 0000 | ADD | 0110 | SLTU |
| 0001 | SUB | 0111 | SLL |
| 0010 | AND | 1000 | SRL |
| 0011 | OR  | 1001 | SRA |
| 0100 | XOR | 1010 | SEQ (1 if A = B; internal, used by `beq`/`bne`) |
| 0101 | SLT | 1111 | invalid (result 0) |

### 7.5 Hardware limits and quirks

| Fact | Source | Consequence |
|---|---|---|
| Instruction memory: 256 words | `MEMORIA_PROGRAMA.vhd` | Max 256 instructions per program |
| Data memory: 256 words = 1024 bytes, uses `addr(9 downto 2)` | `MEMORIAA_S.vhd` | Max 1024 bytes of variables |
| Misaligned accesses ignore low address bits | `MEMORIAA_S.vhd` | Compiler always aligns |
| Little-endian: `sb` writes the byte selected by `addr(1:0)` (00 → bits 7..0), `sh` the half selected by `addr(1)` | `MEMORIAA_S.vhd` | Same byte order as standard RISC-V; the test simulator uses it |
| Store width comes from `funct3(1:0)`: 00 `sb`, 01 `sh`, 10 `sw` (read-modify-write of the word) | `MEMORIAA_S.vhd` | `DataMemory` receives `funct3` |
| Reads are asynchronous and return the whole word; `LoadExtender` picks the byte/half and extends it | `MEMORIAA_S.vhd` | Loads are combinational in the single-cycle view |
| Data memory starts with every word at zero (the old test value at address 24 was removed) | `MEMORIAA_S.vhd` | A variable without initializer reads 0. This is a guarantee of this hardware, not of standard C |
| x0 always reads 0, writes ignored | `BancoDeRegistros.vhd` | Standard RISC-V behavior |
| `CONST` input = 4 | `MUX_PC.vhd` comment | `PC_INCREMENT = 4` |
| Halt convention: `beq x0, x0, 0` | test program | Compiler ends every program with it |

The hardware test program in `MEMORIA_PROGRAMA.vhd` (21 instructions with real hex encodings) is used
as a test vector set for the assembler.

## 8. Repository layout

```
index.html                 entry page (GitHub Pages serves the repo root)
src/
  shared/instructions.js   the 33-row instruction table
  shared/registers.js      register names (x0–x31 and ABI names)
  shared/hardware.js       hardware limits (section 7.5)
  shared/targets.js        target languages: riscv, mips, arm
  compiler/                (a) lexer.js, parser.js, semantic.js, index.js
  compiler/backends/       (a) riscv.js, mips.js, arm.js (code generation per target)
  assembler/               (b)
  decoder/                 (c) fields.js, segments.js, disassemble.js, index.js
  datapath/                (d) control.js, activity.js, svg.js, index.js
  ui/                      (e) main.js orchestrator, styles.css, examples.js
tests/                     node --test, one file per module (+ end-to-end and coverage)
tests/helpers/rv32i-sim.js tiny RV32I simulator used only by tests (checks results of compiled programs)
scripts/assemble.js        command-line tool: node scripts/assemble.js <file.s>
scripts/compile.js         command-line tool: node scripts/compile.js <file.c> [--target riscv|mips|arm] [--machine]
scripts/demo/              demo programs (.s for the assembler, .c for the compiler)
docs/DESIGN.md             this file
docs/img/                  schematic screenshot of the Active-HDL design
```

Technology: vanilla JavaScript ES modules, no framework, no build step, no dependencies,
tests with the built-in `node --test` runner.

## 9. Roadmap

| Dates (2026) | Stage |
|---|---|
| Nov 19–20 | Design and repository |
| Nov 21–26 | Shared instruction table, (b) assembler, (c) decoder |
| Nov 27 – Dec 2 | (a) Compiler phase 1 (`int`) |
| Dec 3–4 | (a) Compiler phase 2 (all types, 33-instruction coverage) |
| Dec 5–6 | (d) Datapath visualization |
| Dec 7 | (e) Web interface, GitHub Pages |
| Dec 8–9 | (a) MIPS32 and ARM backends, target selector; README, final tests |
| Dec 10 | Delivery |
