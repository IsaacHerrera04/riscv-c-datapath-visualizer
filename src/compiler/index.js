// (a) Compiler: C source → assembly text for the chosen target language.
//
//   compile("int main() { int a; a = a + 5; }")  // target defaults to "riscv"
//     → { asm: "# Memory map\n...", symbols: [{ name: "a", type: "int", address: 0, ... }], errors: [] }
//
// Frontend (target-independent):  tokenize → parse → analyze
// Backend (one per target):       generateRiscv  (stage 8 adds MIPS32 and ARM)
//
// Stops after the first phase that reports errors: later phases would only produce false errors
// caused by the first ones. On error, asm is "" and symbols is [].

import { DEFAULT_TARGET, findTarget } from "../shared/targets.js";
import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";
import { analyze } from "./semantic.js";
import { generateRiscv } from "./backends/riscv.js";

// Target id → code generator. A target listed in TARGETS but missing here is "not implemented yet".
const BACKENDS = new Map([
  ["riscv", generateRiscv],
]);

export function compile(source, target = DEFAULT_TARGET) {
  if (!findTarget(target)) return failed([{ line: null, message: `unknown target "${target}"` }]);

  const lexed = tokenize(source);
  if (lexed.errors.length > 0) return failed(lexed.errors);

  const parsed = parse(lexed.tokens);
  if (parsed.errors.length > 0) return failed(parsed.errors);

  const checked = analyze(parsed.ast);
  if (checked.errors.length > 0) return failed(checked.errors);

  // Checked AFTER the frontend: errors in the C program are the same for every target.
  const generate = BACKENDS.get(target);
  if (!generate) return failed([{ line: null, message: `target "${target}" is not implemented yet` }]);

  const generated = generate(checked.ast, checked.symbols, source);
  if (generated.errors.length > 0) return failed(generated.errors);

  return { asm: generated.asm, symbols: checked.symbols, errors: [] };
}

function failed(errors) {
  return { asm: "", symbols: [], errors };
}
