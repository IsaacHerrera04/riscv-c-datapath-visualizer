import { test } from "node:test";
import assert from "node:assert/strict";

import { TYPE_SIZES, promote, commonType, shiftType, isUnsigned } from "../../src/compiler/types.js";

const ALL = ["int", "unsigned int", "short", "unsigned short", "char", "unsigned char"];

test("sizes: char 1, short 2, int 4 (signed or not)", () => {
  assert.deepEqual(ALL.map((type) => TYPE_SIZES[type]), [4, 4, 2, 2, 1, 1]);
  assert.ok(Object.isFrozen(TYPE_SIZES));
});

test("integer promotion: everything smaller than int becomes int; unsigned int stays", () => {
  assert.deepEqual(ALL.map(promote), ["int", "unsigned int", "int", "int", "int", "int"]);
});

test("common type: unsigned int wins over int, after promotion", () => {
  assert.equal(commonType("int", "int"), "int");
  assert.equal(commonType("int", "unsigned int"), "unsigned int");
  assert.equal(commonType("unsigned int", "char"), "unsigned int");
  // unsigned char and unsigned short are promoted to int first, so they do NOT make it unsigned
  assert.equal(commonType("unsigned char", "unsigned short"), "int");
});

test("shift type: only the left operand decides", () => {
  assert.equal(shiftType("int"), "int");
  assert.equal(shiftType("unsigned int"), "unsigned int");
  assert.equal(shiftType("unsigned char"), "int");
});

test("isUnsigned is true only for unsigned int (types are promoted before asking)", () => {
  assert.deepEqual(["int", "unsigned int"].map(isUnsigned), [false, true]);
});
