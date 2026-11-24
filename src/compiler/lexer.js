// Lexer: C source text → tokens (first phase of the compiler frontend).
//
//   tokenize("int x = 5;") → {
//     tokens: [ { kind: "keyword", value: "int", line: 1 }, { kind: "identifier", value: "x", line: 1 },
//               { kind: "operator", value: "=", line: 1 }, { kind: "number", value: 5, line: 1 },
//               { kind: "punct", value: ";", line: 1 }, { kind: "eof", value: null, line: 1 } ],
//     errors: [],
//   }
//
// The lexer only splits and classifies text. It does not check whether the program makes sense
// (that is the parser's job) nor whether numbers are in range (semantic analysis).
// Errors do not stop the lexer: it records them and keeps reading, so the user sees all of them.

const KEYWORDS = new Set([
  "int", "unsigned", "short", "char", "void", "if", "else", "while", "for", "return",
]);

// Messages for operators that exist in C but not in our subset (docs/DESIGN.md section 4).
const MESSAGES = Object.freeze({
  MULTIPLY: "multiplication is not supported: the RV32I hardware has no mul; use << for powers of 2",
  DIVIDE: "division is not supported: the RV32I hardware has no div; use >> for powers of 2",
  REMAINDER: "remainder is not supported: the RV32I hardware has no rem; use & (2^k - 1) for powers of 2",
  LOGICAL: "logical operators are not supported; use nested if",
});

const OPERATORS = [
  "<<=", ">>=",
  "<<", ">>", "<=", ">=", "==", "!=", "+=", "-=", "&=", "|=", "^=", "++", "--",
  "+", "-", "&", "|", "^", "<", ">", "=",
];

const PUNCTUATION = ["(", ")", "{", "}", "[", "]", ";", ","];

const REJECTED = [
  { text: "*=", error: MESSAGES.MULTIPLY },
  { text: "/=", error: MESSAGES.DIVIDE },
  { text: "%=", error: MESSAGES.REMAINDER },
  { text: "&&", error: MESSAGES.LOGICAL },
  { text: "||", error: MESSAGES.LOGICAL },
  { text: "*", error: MESSAGES.MULTIPLY },
  { text: "/", error: MESSAGES.DIVIDE },
  { text: "%", error: MESSAGES.REMAINDER },
  { text: "!", error: MESSAGES.LOGICAL },
];

// One table with every symbol, LONGEST FIRST, so the first match is the longest one:
// "<<=" wins over "<<" and "<"; "!=" (valid) wins over "!" (rejected);
// "&&" (rejected) wins over "&" (valid). Rejected symbols must be in the same table,
// otherwise "&&" would be read as two valid "&" tokens and no error would appear.
const SYMBOLS = Object.freeze(
  [
    ...OPERATORS.map((text) => ({ text, kind: "operator" })),
    ...PUNCTUATION.map((text) => ({ text, kind: "punct" })),
    ...REJECTED,
  ].sort((a, b) => b.text.length - a.text.length),
);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/;
// A number starts with a digit. Letters right after it are read too ("12abc", "0x1F"),
// so the whole word is validated at once instead of being split into "12" and "abc".
const NUMBER_WORD = /^[0-9][A-Za-z0-9_]*/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const HEXADECIMAL = /^0[xX][0-9A-Fa-f]+$/;
const OCTAL = /^0[0-9]+$/;
const WHITESPACE = /\s/;

export function tokenize(source) {
  const tokens = [];
  const errors = [];
  let pos = 0;   // index of the next character to read
  let line = 1;  // line of that character (1-based)

  while (pos < source.length) {
    const char = source[pos];

    // 1. Newlines and other whitespace: no token.
    if (char === "\n") {
      line++;
      pos++;
      continue;
    }
    if (WHITESPACE.test(char)) {
      pos++;
      continue;
    }

    // 2. Comments (checked before symbols, so "/" is not reported as division).
    if (source.startsWith("//", pos)) {
      const end = source.indexOf("\n", pos);
      pos = end === -1 ? source.length : end; // the "\n" itself is handled by step 1
      continue;
    }
    if (source.startsWith("/*", pos)) {
      const end = source.indexOf("*/", pos + 2);
      if (end === -1) {
        errors.push({ line, message: "unterminated comment: missing */" });
        break; // the rest of the file is inside the comment
      }
      line += countNewlines(source.slice(pos, end));
      pos = end + 2;
      continue;
    }

    const rest = source.slice(pos);

    // 3. Keywords and identifiers.
    const word = IDENTIFIER.exec(rest);
    if (word) {
      const text = word[0];
      tokens.push({ kind: KEYWORDS.has(text) ? "keyword" : "identifier", value: text, line });
      pos += text.length;
      continue;
    }

    // 4. Numbers.
    const numberWord = NUMBER_WORD.exec(rest);
    if (numberWord) {
      const text = numberWord[0];
      const error = numberError(text);
      if (error) errors.push({ line, message: error });
      else tokens.push({ kind: "number", value: Number(text), line });
      pos += text.length;
      continue;
    }

    // 5. Operators, punctuation and rejected symbols (longest match first).
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate.text, pos));
    if (symbol) {
      if (symbol.error) errors.push({ line, message: symbol.error });
      else tokens.push({ kind: symbol.kind, value: symbol.text, line });
      pos += symbol.text.length;
      continue;
    }

    // 6. Anything else.
    errors.push({ line, message: `unexpected character '${char}'` });
    pos++;
  }

  tokens.push({ kind: "eof", value: null, line });
  return { tokens, errors };
}

// Returns an error message for an invalid number word, or null if it is valid.
function numberError(text) {
  if (DECIMAL.test(text) || HEXADECIMAL.test(text)) return null;
  if (OCTAL.test(text)) {
    return `octal numbers are not supported: '${text}' has a leading zero (in C, 017 means 15)`;
  }
  return `invalid number '${text}'`;
}

function countNewlines(text) {
  return text.split("\n").length - 1;
}
