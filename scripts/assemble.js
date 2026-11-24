// Command-line tool: assembles a RISC-V file and prints address, hex word and source.
//
//   node scripts/assemble.js <file.s>
//
// Exit code: 0 = assembled, 1 = the program has errors, 2 = usage or file problem.
// Like the tests, this is an external tool: it uses the assembler module, but no
// project module imports it.

import { readFileSync } from "node:fs";
import { assemble } from "../src/assembler/index.js";

const path = process.argv[2]; // argv = ["node", "scripts/assemble.js", "<file.s>"]
if (!path) {
  console.error("Usage: node scripts/assemble.js <file.s>");
  process.exit(2);
}

let text;
try {
  text = readFileSync(path, "utf8");
} catch (error) {
  // fs throws (it is not one of our modules); turn it into a clear message.
  console.error(`Cannot read "${path}": ${error.message}`);
  process.exit(2);
}

const { program, errors } = assemble(text);

if (errors.length > 0) {
  console.log(`${errors.length} error(s) in ${path}:`);
  for (const { line, message } of errors) {
    console.log(`  line ${line}: ${message}`);
  }
  process.exit(1);
}

const hex = (value, digits) => "0x" + value.toString(16).toUpperCase().padStart(digits, "0");

console.log("Address  Hex         Source");
for (const { address, word, source } of program) {
  console.log(`${hex(address, 3)}    ${hex(word, 8)}  ${source}`);
}
const bytes = program.length * 4;
console.log(`\n${program.length} instructions, ${bytes} bytes.`);
