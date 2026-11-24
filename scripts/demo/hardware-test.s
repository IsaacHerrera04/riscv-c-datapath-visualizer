# Test program of the hardware design (MEMORIA_PROGRAMA.vhd), written exactly
# as in the VHDL: numeric branch offsets, relative to the branch's own address.
# The assembler must produce the same 21 hex words as the instruction memory.

addi x19, x0, 8       # x19 = 8
addi x20, x0, 3       # x20 = 3
bne  x20, x19, 12     # 3 != 8 → skip to sub
add  x21, x20, x19
beq  x0, x0, 0        # (skipped) stop
sub  x21, x19, x20    # x21 = 5
blt  x20, x19, 8      # 3 < 8 → skip
addi x22, x0, 99
bge  x20, x19, 8      # 3 >= 8 is false → fall through
addi x22, x0, 1       # x22 = 1
addi x23, x0, -1      # x23 = -1 (0xFFFFFFFF)
bltu x19, x23, 8      # unsigned: 8 < 0xFFFFFFFF → skip
addi x24, x0, 99
blt  x23, x19, 8      # signed: -1 < 8 → skip
addi x24, x0, 99
bgeu x23, x19, 8      # unsigned: 0xFFFFFFFF >= 8 → skip
addi x24, x0, 99
addi x25, x0, 3       # loop counter = 3
addi x25, x25, -1     # loop: counter--
bne  x25, x0, -4      # repeat while counter != 0
beq  x0, x0, 0        # halt: jump to itself
