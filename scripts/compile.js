// Command-line tool: compiles a C file and prints the generated assembly.
//
//   node scripts/compile.js <file.c> [--target riscv|mips|arm] [--machine]
//
//   --target   assembly language to generate (default: riscv)
//   --machine  also assemble the result and print address, hex word and instruction
//              (RISC-V only: the assembler exists only for RISC-V)
//
// Exit code: 0 = compiled, 1 = the program has errors, 2 = usage or file problem.
// Like src/ui/main.js, this tool connects modules (compile → assemble); no module imports it.

import { readFileSync } from "node:fs";
import { compile } from "../src/compiler/index.js";
import { assemble } from "../src/assembler/index.js";
import { TARGETS, DEFAULT_TARGET, findTarget } from "../src/shared/targets.js";

const TARGET_IDS = TARGETS.map((target) => target.id).join("|");
const USAGE = `Usage: node scripts/compile.js <file.c> [--target ${TARGET_IDS}] [--machine]`;

const options = parseArguments(process.argv.slice(2)); // argv = ["node", "scripts/compile.js", ...]
if (options.error) {
  console.error(options.error);
  console.error(USAGE);
  process.exit(2);
}

let source;
try {
  source = readFileSync(options.path, "utf8");
} catch (error) {
  console.error(`Cannot read "${options.path}": ${error.message}`);
  process.exit(2);
}

const { asm, errors } = compile(source, options.target);
if (errors.length > 0) {
  printErrors(errors, options.path);
  process.exit(1);
}

process.stdout.write(asm);

if (options.machine) {
  const assembled = assemble(asm);
  if (assembled.errors.length > 0) {
    // Should never happen: it would mean the compiler produced invalid assembly.
    console.log("\nThe generated assembly does not assemble (compiler bug):");
    printErrors(assembled.errors, "generated assembly");
    process.exit(1);
  }
  printMachineCode(assembled.program);
}

// ---------- helpers ----------

// ["prog.c", "--target", "riscv", "--machine"] → { path, target, machine } or { error }
function parseArguments(args) {
  const options = { path: null, target: DEFAULT_TARGET, machine: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--machine") {
      options.machine = true;
    } else if (arg === "--target") {
      options.target = args[++i]; // the value comes right after the flag
      if (!findTarget(options.target)) return { error: `Unknown target "${options.target ?? ""}"` };
    } else if (arg.startsWith("--")) {
      return { error: `Unknown option "${arg}"` };
    } else if (options.path === null) {
      options.path = arg;
    } else {
      return { error: `Only one file can be compiled at a time (got "${options.path}" and "${arg}")` };
    }
  }
  if (options.path === null) return { error: "Missing the C file to compile" };
  if (options.machine && options.target !== "riscv") {
    return { error: "--machine is only available for riscv (the assembler is RISC-V only)" };
  }
  return options;
}

function printErrors(errors, where) {
  console.log(`${errors.length} error(s) in ${where}:`);
  for (const { line, message } of errors) {
    console.log(line === null ? `  ${message}` : `  line ${line}: ${message}`);
  }
}

function printMachineCode(program) {
  const hex = (value, digits) => "0x" + value.toString(16).toUpperCase().padStart(digits, "0");
  console.log("\n# Machine code");
  console.log("# Address  Hex         Instruction");
  for (const { address, word, source } of program) {
    console.log(`# ${hex(address, 3)}    ${hex(word, 8)}  ${source}`);
  }
  console.log(`# ${program.length} instructions, ${program.length * 4} bytes.`);
}
