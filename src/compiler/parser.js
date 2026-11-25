// Parser: tokens → AST (second phase of the compiler frontend).
//
//   parse(tokenize("int main() { x = a + 1; }").tokens) → {
//     ast: { kind: "Program", line: 1, body: { kind: "Block", line: 1, statements: [
//            { kind: "Assign", line: 1,
//              target: { kind: "LValue", name: "x", index: null, line: 1 },
//              value: { kind: "Binary", op: "+", line: 1, type: null,
//                       left: { kind: "VarRef", name: "a", index: null, line: 1, type: null },
//                       right: { kind: "Number", value: 1, line: 1, type: null } } } ] } },
//     errors: [],
//   }
//
// Technique: recursive descent. Every grammar rule (docs/DESIGN.md section 4) is one method, and
// methods call each other the way the rules refer to each other.
//
// Syntactic sugar is removed here, so later phases (and every backend) see fewer node kinds:
//   x += e  →  x = x + e        i++  →  i = i + 1
//   for (init; cond; step) body  →  { init; while (cond) { body; step } }
//
// Expression nodes carry `type: null`; semantic analysis fills it in.

// Binary operators from LOWEST to HIGHEST precedence (same order as in C).
// Level n takes its operands from level n + 1, so the order of this table IS the precedence.
const BINARY_LEVELS = Object.freeze([
  ["|"],
  ["^"],
  ["&"],
  ["==", "!="],
  ["<", ">", "<=", ">="],
  ["<<", ">>"],
  ["+", "-"],
]);

// Assignment operator → binary operator it stands for (null = plain assignment).
const ASSIGNMENT_OPERATORS = new Map([
  ["=", null], ["+=", "+"], ["-=", "-"], ["&=", "&"], ["|=", "|"], ["^=", "^"],
  ["<<=", "<<"], [">>=", ">>"],
]);

// i++ → i = i + 1 ; i-- → i = i - 1
const STEP_OPERATORS = new Map([["++", "+"], ["--", "-"]]);

const TYPE_KEYWORDS = new Set(["int", "short", "char", "unsigned"]);

// Types the compiler can generate code for. Stage 5 (all types) adds the rest.
const SUPPORTED_TYPES = new Set(["int"]);

// Used only inside this file to jump out of a broken statement. parse() catches it and turns it
// into an entry of `errors`, so callers never see an exception.
class ParseError extends Error {
  constructor(line, message) {
    super(message);
    this.line = line;
  }
}

export function parse(tokens) {
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  return { ast, errors: parser.errors };
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;      // index of the current token
    this.errors = [];
  }

  // ---------- program and statements ----------

  // program := "int" "main" "(" ["void"] ")" block EOF
  parseProgram() {
    try {
      const start = this.expect("keyword", "int");
      const name = this.expect("identifier", undefined, "'main'");
      if (name.value !== "main") {
        throw new ParseError(name.line,
          `only 'int main()' is supported: functions other than main are not allowed (found '${name.value}')`);
      }
      this.expectPunct("(");
      this.match("keyword", "void");
      this.expectPunct(")");
      const body = this.parseBlock();
      if (!this.check("eof")) {
        throw new ParseError(this.peek().line,
          `only one function (main) is supported, but found ${describe(this.peek())} after it`);
      }
      return { kind: "Program", body, line: start.line };
    } catch (error) {
      this.report(error);
      return null;
    }
  }

  // block := "{" statement* "}"
  parseBlock() {
    const open = this.expectPunct("{");
    const statements = [];
    while (!this.checkPunct("}") && !this.check("eof")) {
      const statement = this.parseStatementOrRecover();
      if (statement) statements.push(statement);
    }
    this.expectPunct("}");
    return { kind: "Block", statements, line: open.line };
  }

  // Parses one statement. If it is broken, records the error, skips to a safe point and returns
  // null, so the rest of the program is still checked (several errors in one run).
  parseStatementOrRecover() {
    try {
      return this.parseStatement();
    } catch (error) {
      this.report(error);
      this.synchronize();
      return null;
    }
  }

  // Skip tokens until just after the next ";" or just before the next "}" (panic mode).
  synchronize() {
    while (!this.check("eof")) {
      if (this.matchPunct(";")) return;
      if (this.checkPunct("}")) return;
      this.advance();
    }
  }

  // Returns a statement node, or null for the empty statement ";".
  parseStatement() {
    const token = this.peek();

    if (this.matchPunct(";")) return null;
    if (this.checkPunct("{")) return this.parseBlock();

    if (token.kind === "keyword") {
      if (TYPE_KEYWORDS.has(token.value)) return this.parseDeclaration();
      switch (token.value) {
        case "if": return this.parseIf();
        case "while": return this.parseWhile();
        case "for": return this.parseFor();
        case "return": return this.parseReturn();
        case "else": throw new ParseError(token.line, "'else' without a matching 'if'");
        case "void": throw new ParseError(token.line, "'void' is only allowed in 'int main(void)'");
      }
    }

    if (token.kind === "identifier") {
      const statement = this.parseSimpleStatement();
      this.expectSemicolon();
      return statement;
    }

    if (token.kind === "operator" && STEP_OPERATORS.has(token.value)) {
      throw new ParseError(token.line, `prefix ${token.value} is not supported; write i${token.value} instead`);
    }
    throw new ParseError(token.line, `expected a statement but found ${describe(token)}`);
  }

  // Body of if / while / for: one statement, never null (";" becomes an empty block).
  parseBody() {
    const token = this.peek();
    if (token.kind === "keyword" && TYPE_KEYWORDS.has(token.value)) {
      throw new ParseError(token.line, "a declaration cannot be the body of if/while/for; use { }");
    }
    return this.parseStatement() ?? { kind: "Block", statements: [], line: token.line };
  }

  // declaration := type IDENT ["[" NUMBER "]"] ["=" expr] ";"
  parseDeclaration() {
    const start = this.peek();
    const varType = this.parseType();
    const name = this.expect("identifier", undefined, "a variable name");

    let length = null;
    if (this.matchPunct("[")) {
      const size = this.peek();
      if (size.kind !== "number") {
        throw new ParseError(size.line, `array length must be a constant number, but found ${describe(size)}`);
      }
      this.advance();
      length = size.value;
      this.expectPunct("]");
    }

    let init = null;
    if (this.match("operator", "=")) {
      if (length !== null) {
        throw new ParseError(name.line, "arrays cannot have an initializer; assign each element instead");
      }
      init = this.parseExpression();
    }

    this.expectSemicolon();
    return { kind: "VarDecl", name: name.value, varType, length, init, line: start.line };
  }

  // type := "int" | "short" | "char" | "unsigned" ["int" | "short" | "char"]
  // Returns the full name: "int", "short", "char", "unsigned int", "unsigned short", "unsigned char".
  parseType() {
    const first = this.advance();
    let varType = first.value;
    if (first.value === "unsigned") {
      const next = this.peek();
      const hasSize = next.kind === "keyword" && ["int", "short", "char"].includes(next.value);
      if (hasSize) this.advance();
      varType = hasSize ? `unsigned ${next.value}` : "unsigned int";
    }
    if (!SUPPORTED_TYPES.has(varType)) {
      // Not fatal: the declaration is still parsed so later errors are found too.
      this.report(new ParseError(first.line, `type '${varType}' is not supported yet (only int for now)`));
    }
    return varType;
  }

  // simpleStmt := lvalue ("=" | "+=" | ... | ">>=") expr  |  lvalue ("++" | "--")
  // Compound forms are desugared: x += e → x = x + e ; i++ → i = i + 1.
  parseSimpleStatement() {
    const target = this.parseLValue();
    const token = this.peek();

    if (token.kind === "operator" && ASSIGNMENT_OPERATORS.has(token.value)) {
      this.advance();
      const value = this.parseExpression();
      const op = ASSIGNMENT_OPERATORS.get(token.value);
      return assign(target, op === null ? value : binary(op, readOf(target), value, token.line));
    }

    if (token.kind === "operator" && STEP_OPERATORS.has(token.value)) {
      this.advance();
      const op = STEP_OPERATORS.get(token.value);
      return assign(target, binary(op, readOf(target), number(1, token.line), token.line));
    }

    throw new ParseError(token.line,
      `expected an assignment (=, +=, -=, &=, |=, ^=, <<=, >>=, ++, --) after '${target.name}', ` +
      `but found ${describe(token)}`);
  }

  // lvalue := IDENT ["[" expr "]"]
  parseLValue() {
    const name = this.expect("identifier", undefined, "a variable name");
    let index = null;
    if (this.matchPunct("[")) {
      index = this.parseExpression();
      this.expectPunct("]");
    }
    return { kind: "LValue", name: name.value, index, line: name.line };
  }

  // "if" "(" expr ")" statement ["else" statement]
  // A dangling else belongs to the nearest if, because the inner if takes it first.
  parseIf() {
    const keyword = this.advance();
    const cond = this.parseCondition();
    const then = this.parseBody();
    const otherwise = this.match("keyword", "else") ? this.parseBody() : null;
    return { kind: "If", cond, then, else: otherwise, line: keyword.line };
  }

  // "while" "(" expr ")" statement
  parseWhile() {
    const keyword = this.advance();
    const cond = this.parseCondition();
    const body = this.parseBody();
    return { kind: "While", cond, body, line: keyword.line };
  }

  // "for" "(" [simpleStmt] ";" [expr] ";" [simpleStmt] ")" statement
  //   → { init; while (cond) { body; step } }      (empty cond = always true)
  parseFor() {
    const keyword = this.advance();
    const line = keyword.line;
    this.expectPunct("(");

    // Not fatal: report it, skip the type and keep parsing "i = 0" as the init. Throwing here would
    // make panic mode stop at the first ";" inside the parentheses and cause a cascade of errors.
    const first = this.peek();
    if (first.kind === "keyword" && TYPE_KEYWORDS.has(first.value)) {
      this.report(new ParseError(first.line,
        "declarations inside for are not supported; declare the variable before the loop: int i; for (i = 0; ...)"));
      this.parseType();
    }
    const init = this.checkPunct(";") ? null : this.parseSimpleStatement();
    this.expectSemicolon();
    const cond = this.checkPunct(";") ? number(1, line) : this.parseExpression();
    this.expectSemicolon();
    const step = this.checkPunct(")") ? null : this.parseSimpleStatement();
    this.expectPunct(")");
    const body = this.parseBody();

    const loopBody = { kind: "Block", statements: [body, step].filter(Boolean), line };
    const loop = { kind: "While", cond, body: loopBody, line };
    return { kind: "Block", statements: [init, loop].filter(Boolean), line };
  }

  // "return" [expr] ";"
  parseReturn() {
    const keyword = this.advance();
    const value = this.checkPunct(";") ? null : this.parseExpression();
    this.expectSemicolon();
    return { kind: "Return", value, line: keyword.line };
  }

  // "(" expr ")" of if / while
  parseCondition() {
    this.expectPunct("(");
    const cond = this.parseExpression();
    this.expectPunct(")");
    return cond;
  }

  // ---------- expressions ----------

  parseExpression() {
    return this.parseBinaryLevel(0);
  }

  // level := nextLevel (op nextLevel)*     — left-associative: a - b - c = (a - b) - c
  parseBinaryLevel(level) {
    if (level === BINARY_LEVELS.length) return this.parseUnary();
    const operators = BINARY_LEVELS[level];

    let left = this.parseBinaryLevel(level + 1);
    while (this.peek().kind === "operator" && operators.includes(this.peek().value)) {
      const op = this.advance();
      const right = this.parseBinaryLevel(level + 1);
      left = binary(op.value, left, right, op.line);
    }
    return left;
  }

  // unary := "-" unary | primary
  parseUnary() {
    if (this.check("operator", "-")) {
      const minus = this.advance();
      return { kind: "Unary", op: "-", operand: this.parseUnary(), line: minus.line, type: null };
    }
    return this.parsePrimary();
  }

  // primary := NUMBER | IDENT ["[" expr "]"] | "(" expr ")"
  parsePrimary() {
    const token = this.peek();
    if (token.kind === "number") {
      this.advance();
      return number(token.value, token.line);
    }
    if (token.kind === "identifier") {
      return readOf(this.parseLValue());
    }
    if (this.matchPunct("(")) {
      const inner = this.parseExpression();
      this.expectPunct(")");
      return inner;
    }
    throw new ParseError(token.line, `expected an expression but found ${describe(token)}`);
  }

  // ---------- token helpers ----------

  peek() {
    return this.tokens[this.pos];
  }

  previous() {
    return this.tokens[this.pos - 1];
  }

  // Returns the current token and moves to the next one (never past eof).
  advance() {
    const token = this.peek();
    if (token.kind !== "eof") this.pos++;
    return token;
  }

  // Is the current token of this kind (and, if given, this value)?
  check(kind, value) {
    const token = this.peek();
    return token.kind === kind && (value === undefined || token.value === value);
  }

  // Like check, but also consumes the token. Returns the token or null.
  match(kind, value) {
    return this.check(kind, value) ? this.advance() : null;
  }

  // Like match, but the token is required.
  expect(kind, value, description = `'${value}'`) {
    if (this.check(kind, value)) return this.advance();
    const found = this.peek();
    throw new ParseError(found.line, `expected ${description} but found ${describe(found)}`);
  }

  checkPunct(value) {
    return this.check("punct", value);
  }

  matchPunct(value) {
    return this.match("punct", value);
  }

  expectPunct(value) {
    return this.expect("punct", value);
  }

  // A missing ";" is reported on the line of the token BEFORE it (where the ";" should be),
  // not on the next line where the parser notices it.
  expectSemicolon() {
    if (this.matchPunct(";")) return;
    const line = this.pos > 0 ? this.previous().line : this.peek().line;
    throw new ParseError(line, `expected ';' but found ${describe(this.peek())}`);
  }

  report(error) {
    if (!(error instanceof ParseError)) throw error; // a real bug in the parser: let it surface
    const last = this.errors.at(-1);
    // A missing "}" at end of file is noticed once per open block; report it only once.
    if (last && last.line === error.line && last.message === error.message) return;
    this.errors.push({ line: error.line, message: error.message });
  }
}

// ---------- node builders ----------

function number(value, line) {
  return { kind: "Number", value, line, type: null };
}

function binary(op, left, right, line) {
  return { kind: "Binary", op, left, right, line, type: null };
}

function assign(target, value) {
  return { kind: "Assign", target, value, line: target.line };
}

// The value stored in an lvalue, as an expression: LValue x[i] → VarRef x[i].
// The index node is shared, which is safe: expressions in our subset have no side effects.
function readOf(target) {
  return { kind: "VarRef", name: target.name, index: target.index, line: target.line, type: null };
}

function describe(token) {
  return token.kind === "eof" ? "end of file" : `'${token.value}'`;
}
