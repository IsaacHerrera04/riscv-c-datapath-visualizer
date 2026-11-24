# A program with several mistakes: the assembler reports all of them at once,
# each with its line number.

      addi x5, x0, 10
      add  x6, x5             # missing operand
      addi x7, x0, 5000       # immediate does not fit in 12 bits
      mul  x8, x5, x6         # not in RV32I (M extension)
      lw   x9, 8x0            # malformed memory operand
      beq  x5, x0, nowhere    # label is never defined
halt: beq  x0, x0, halt
