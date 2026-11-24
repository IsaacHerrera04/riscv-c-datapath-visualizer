# The same hardware test program, written with labels instead of numeric
# offsets. It must assemble to exactly the same 21 words as hardware-test.s.

      addi x19, x0, 8
      addi x20, x0, 3
      bne  x20, x19, L1
      add  x21, x20, x19
stop: beq  x0, x0, stop
L1:   sub  x21, x19, x20
      blt  x20, x19, L2
      addi x22, x0, 99
L2:   bge  x20, x19, L3
      addi x22, x0, 1
L3:   addi x23, x0, -1
      bltu x19, x23, L4
      addi x24, x0, 99
L4:   blt  x23, x19, L5
      addi x24, x0, 99
L5:   bgeu x23, x19, L6
      addi x24, x0, 99
L6:   addi x25, x0, 3
loop: addi x25, x25, -1
      bne  x25, x0, loop
halt: beq  x0, x0, halt
