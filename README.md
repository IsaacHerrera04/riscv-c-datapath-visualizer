# RISC-V C Datapath Visualizer

> Work in progress — full README coming with the first release.

A web page that compiles a small subset of C to RISC-V RV32I assembly with its own compiler,
assembles it to 32-bit machine code, decodes every field and visualizes the single-cycle datapath
of each instruction (types R, I, L, S, B).

See [`docs/DESIGN.md`](docs/DESIGN.md) for the architecture and all design decisions.