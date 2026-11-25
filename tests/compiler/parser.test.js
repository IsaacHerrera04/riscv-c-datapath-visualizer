import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenize } from "../../src/compiler/lexer.js";
import { parse } from "../../src/compiler/parser.js";

// ---------- helpers ----------

function parseSource(source) {
  const lexed = tokenize(source);
  assert.deepEqual(lexed.errors, [], "the test program must have no lexer errors");
  return parse(lexed.tokens);
}

// Expression → fully parenthesized text, so the shape of the tree is visible:
// a + b << c  →  "((a + b) << c)"
function show(node) {
  switch (node.kind) {
    case "Number": return String(node.value);
    case "VarRef": return node.index ? `${node.name}[${show(node.index)}]` : node.name;
    case "Unary": return `(-${show(node.operand)})`;
    case "Binary": return `(${show(node.left)} ${node.op} ${show(node.right)})`;
    default: throw new Error(`not an expression: ${node.kind}`);
  }
}

// Statement → compact text: "x = (x + 2);", "while (i < 4) { ... }"
function showStatement(node) {
  switch (node.kind) {
    case "Block": return `{ ${node.statements.map(showStatement).join(" ")} }`.replace("{  }", "{ }");
    case "VarDecl": {
      const length = node.length === null ? "" : `[${node.length}]`;
      const init = node.init ? ` = ${show(node.init)}` : "";
      return `${node.varType} ${node.name}${length}${init};`;
    }
    case "Assign": {
      const target = node.target.index ? `${node.target.name}[${show(node.target.index)}]` : node.target.name;
      return `${target} = ${show(node.value)};`;
    }
    case "If": {
      const otherwise = node.else ? ` else ${showStatement(node.else)}` : "";
      return `if ${show(node.cond)} ${showStatement(node.then)}${otherwise}`;
    }
    case "While": return `while ${show(node.cond)} ${showStatement(node.body)}`;
    case "Return": return node.value ? `return ${show(node.value)};` : "return;";
    default: throw new Error(`not a statement: ${node.kind}`);
  }
}

// Statements of main, as text. The program must have no errors.
function body(code) {
  const { ast, errors } = parseSource(`int main() {\n${code}\n}`);
  assert.deepEqual(errors, []);
  return ast.body.statements.map(showStatement);
}

// The expression assigned in "x = <code>;", as text.
function expr(code) {
  const [statement] = body(`x = ${code};`);
  return statement.replace(/^x = /, "").replace(/;$/, "");
}

function errorsOf(source) {
  return parseSource(source).errors;
}

function messagesOf(code) {
  return errorsOf(`int main() {\n${code}\n}`).map((e) => e.message);
}

// ---------- program shape ----------

test("the smallest program is int main() with an empty block", () => {
  const { ast, errors } = parseSource("int main() { }");
  assert.deepEqual(errors, []);
  assert.deepEqual(ast, {
    kind: "Program",
    line: 1,
    body: { kind: "Block", statements: [], line: 1 },
  });
});

test("int main(void) is accepted", () => {
  assert.deepEqual(errorsOf("int main(void) { }"), []);
});

test("a full assignment node has the documented shape", () => {
  const { ast } = parseSource("int main() { x = a + 1; }");
  assert.deepEqual(ast.body.statements[0], {
    kind: "Assign",
    line: 1,
    target: { kind: "LValue", name: "x", index: null, line: 1 },
    value: {
      kind: "Binary", op: "+", line: 1, type: null,
      left: { kind: "VarRef", name: "a", index: null, line: 1, type: null },
      right: { kind: "Number", value: 1, line: 1, type: null },
    },
  });
});

// ---------- declarations ----------

test("declarations: scalar, scalar with initializer, array", () => {
  assert.deepEqual(body("int a; int b = 2 + a; int v[4];"), ["int a;", "int b = (2 + a);", "int v[4];"]);
});

test("a declaration node keeps name, type, length and initializer", () => {
  const { ast } = parseSource("int main() { int v[8]; }");
  assert.deepEqual(ast.body.statements[0], {
    kind: "VarDecl", name: "v", varType: "int", length: 8, init: null, line: 1,
  });
});

// ---------- precedence and associativity (same as C) ----------

test("+ binds tighter than <<, and << tighter than &", () => {
  assert.equal(expr("a + b << c & d"), "(((a + b) << c) & d)");
});

test("bitwise precedence: & over ^ over |", () => {
  assert.equal(expr("a | b ^ c & d"), "(a | (b ^ (c & d)))");
});

test("== binds tighter than & (a real C trap)", () => {
  assert.equal(expr("a & b == c"), "(a & (b == c))");
});

test("relational binds tighter than equality", () => {
  assert.equal(expr("a < b == c > d"), "((a < b) == (c > d))");
});

test("binary operators are left-associative", () => {
  assert.equal(expr("a - b - c"), "((a - b) - c)");
  assert.equal(expr("a << 1 << 2"), "((a << 1) << 2)");
});

test("parentheses override precedence", () => {
  assert.equal(expr("(a + b) << 2"), "((a + b) << 2)");
  assert.equal(expr("a + (b << 2)"), "(a + (b << 2))");
});

test("unary minus binds tighter than binary operators and can repeat", () => {
  assert.equal(expr("-a + -(-b)"), "((-a) + (-(-b)))");
  assert.equal(expr("- -3"), "(-(-3))");
});

test("array reads take a full expression as index", () => {
  assert.equal(expr("v[i + 1] + 2"), "(v[(i + 1)] + 2)");
});

// ---------- desugaring ----------

test("compound assignments become plain assignments", () => {
  assert.deepEqual(body("x += 2; x -= y; x &= 1; x |= 1; x ^= 1; x <<= 1; x >>= 1;"), [
    "x = (x + 2);", "x = (x - y);", "x = (x & 1);", "x = (x | 1);",
    "x = (x ^ 1);", "x = (x << 1);", "x = (x >> 1);",
  ]);
});

test("compound assignment on an array element keeps the index on both sides", () => {
  assert.deepEqual(body("v[i] <<= 1;"), ["v[i] = (v[i] << 1);"]);
});

test("i++ and i-- become i = i + 1 and i = i - 1", () => {
  assert.deepEqual(body("i++; i--; v[0]++;"), ["i = (i + 1);", "i = (i - 1);", "v[0] = (v[0] + 1);"]);
});

test("for becomes init + while (cond) { body; step }", () => {
  assert.deepEqual(body("for (i = 0; i < 4; i++) s += i;"),
    ["{ i = 0; while (i < 4) { s = (s + i); i = (i + 1); } }"]);
});

test("for with empty clauses: no init, no step, condition always true", () => {
  assert.deepEqual(body("for (;;) ;"), ["{ while 1 { { } } }"]);
});

// ---------- control flow ----------

test("if, if/else and while", () => {
  assert.deepEqual(body("if (a < b) x = 1;"), ["if (a < b) x = 1;"]);
  assert.deepEqual(body("if (a) { x = 1; } else x = 2;"), ["if a { x = 1; } else x = 2;"]);
  assert.deepEqual(body("while (i != 0) i--;"), ["while (i != 0) i = (i - 1);"]);
});

test("a dangling else belongs to the nearest if", () => {
  assert.deepEqual(body("if (a) if (b) x = 1; else x = 2;"), ["if a if b x = 1; else x = 2;"]);
});

test("return with and without a value", () => {
  assert.deepEqual(body("return; return a + 1;"), ["return;", "return (a + 1);"]);
});

test("nested blocks are kept; empty statements disappear", () => {
  assert.deepEqual(body("; { x = 1; ; } ;"), ["{ x = 1; }"]);
});

test("an empty if body becomes an empty block", () => {
  assert.deepEqual(body("if (a) ;"), ["if a { }"]);
});

// ---------- line numbers ----------

test("every node records the line where it starts", () => {
  const { ast } = parseSource("int main() {\n  int a = 1;\n  while (a < 3)\n    a = a\n      + 1;\n}");
  const [decl, loop] = ast.body.statements;
  assert.equal(decl.line, 2);
  assert.equal(loop.line, 3);
  assert.equal(loop.cond.line, 3);
  const assignment = loop.body;
  assert.equal(assignment.line, 4);
  assert.equal(assignment.value.line, 5); // the "+" is on line 5
});

// ---------- errors ----------

test("a missing ; is reported on the line where it should be", () => {
  assert.deepEqual(errorsOf("int main() {\n  x = 1\n  y = 2;\n}"), [
    { line: 2, message: "expected ';' but found 'y'" },
  ]);
});

test("a missing ) is reported", () => {
  assert.deepEqual(messagesOf("if (a < b x = 1;"), ["expected ')' but found 'x'"]);
});

test("after an error the parser recovers and reports later errors too", () => {
  const errors = errorsOf("int main() {\n  x = ;\n  y = 1;\n  if (a) z = );\n  w = 2 +;\n}");
  assert.deepEqual(errors.map((e) => e.line), [2, 4, 5]);
});

test("statements that are not assignments are rejected", () => {
  assert.deepEqual(messagesOf("a + 1;"), [
    "expected an assignment (=, +=, -=, &=, |=, ^=, <<=, >>=, ++, --) after 'a', but found '+'",
  ]);
  assert.deepEqual(messagesOf("5;"), ["expected a statement but found '5'"]);
});

test("++ and -- are statements, not expressions", () => {
  assert.deepEqual(messagesOf("x = i++;"), ["expected ';' but found '++'"]);
  assert.deepEqual(messagesOf("++i;"), ["prefix ++ is not supported; write i++ instead"]);
});

test("types other than int are not supported yet, but the rest is still parsed", () => {
  assert.deepEqual(messagesOf("char c; unsigned u; unsigned char b; short s = 1 +;"), [
    "type 'char' is not supported yet (only int for now)",
    "type 'unsigned int' is not supported yet (only int for now)",
    "type 'unsigned char' is not supported yet (only int for now)",
    "type 'short' is not supported yet (only int for now)",
    "expected an expression but found ';'",
  ]);
});

test("array declarations: constant length, no initializer", () => {
  assert.deepEqual(messagesOf("int v[n];"), ["array length must be a constant number, but found 'n'"]);
  assert.deepEqual(messagesOf("int v[2] = 1;"), ["arrays cannot have an initializer; assign each element instead"]);
});

test("only a single int main() is allowed", () => {
  assert.deepEqual(errorsOf("int foo() { }").map((e) => e.message),
    ["only 'int main()' is supported: functions other than main are not allowed (found 'foo')"]);
  assert.deepEqual(errorsOf("void main() { }").map((e) => e.message), ["expected 'int' but found 'void'"]);
  assert.deepEqual(errorsOf("int main() { }\nint g() { }"), [
    { line: 2, message: "only one function (main) is supported, but found 'int' after it" },
  ]);
});

test("a missing } at end of file is reported once", () => {
  assert.deepEqual(errorsOf("int main() {\n  while (a) {\n    x = 1;\n"), [
    { line: 4, message: "expected '}' but found end of file" },
  ]);
});

test("misplaced else, void and declarations", () => {
  assert.deepEqual(messagesOf("else x = 1;"), ["'else' without a matching 'if'"]);
  assert.deepEqual(messagesOf("void x;"), ["'void' is only allowed in 'int main(void)'"]);
  assert.deepEqual(messagesOf("if (a) int x = 1;"), ["a declaration cannot be the body of if/while/for; use { }"]);
  assert.deepEqual(messagesOf("for (int i = 0; i < 3; i++) ;"), [
    "declarations inside for are not supported; declare the variable before the loop: int i; for (i = 0; ...)",
  ]);
});

test("parse never throws, even on garbage", () => {
  const garbage = ["", "int", "int main(", "int main() { ] ) ( ; } } }", "} {", "int main() { if ( ; }"];
  for (const source of garbage) {
    const result = parseSource(source);
    assert.ok(result.errors.length > 0, `expected errors for ${JSON.stringify(source)}`);
  }
});
