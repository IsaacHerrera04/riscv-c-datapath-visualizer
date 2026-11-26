import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DATAPATH_SVG, COMPONENT_LAYOUT, WIRE_PATHS, CONTROL_PATHS, LABEL_SLOTS, SVG_WIDTH, SVG_HEIGHT,
} from "../../src/datapath/svg.js";
import { COMPONENTS, WIRES } from "../../src/datapath/activity.js";
import { CONTROL_SIGNALS } from "../../src/datapath/control.js";

const ids = [...DATAPATH_SVG.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);

// Where each control signal of control_04 goes in the schematic (written by hand, not read from svg.js).
const CONTROL_TARGET = {
  regWrite: "RegisterFile", memWrite: "DataMemory", aluSrc: "ALUSrcMux", memToReg: "WriteBackMux",
  immSrc: "ImmSelector", aluControl: "ALU", branch: "BranchAnd", branchInvert: "BranchInvertMux",
};

// "M920 330 H990 M965 330 V420" → [[[920,330],[990,330]], [[965,330],[965,420]]]
// (one list of points per piece; only M, H and V are used in the drawing).
function pieces(d) {
  const tokens = d.match(/[MHV]|-?\d+(\.\d+)?/g);
  const result = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const command = tokens[i];
    if (command === "M") {
      x = Number(tokens[++i]);
      y = Number(tokens[++i]);
      result.push([[x, y]]);
    } else {
      if (command === "H") x = Number(tokens[++i]);
      else if (command === "V") y = Number(tokens[++i]);
      else throw new Error(`unexpected path command ${command}`);
      result.at(-1).push([x, y]);
    }
  }
  return result;
}

// Is the point on the edge of (or inside) the component's box? 1 px of tolerance.
function touches(name, [x, y]) {
  const { box } = COMPONENT_LAYOUT[name];
  return x >= box.x - 1 && x <= box.x + box.w + 1 && y >= box.y - 1 && y <= box.y + box.h + 1;
}

// Is the point on one of the straight segments of a piece (a list of points)?
function onPiece(points, [x, y]) {
  return points.slice(1).some(([x2, y2], i) => {
    const [x1, y1] = points[i];
    return x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
  });
}

function onPath(d, point) {
  return pieces(d).some((points) => onPiece(points, point));
}

test("every component, wire and control signal has exactly one element", () => {
  const expected = [
    ...COMPONENTS.map((c) => `comp-${c.name}`),
    ...WIRES.map((w) => `wire-${w.name}`),
    ...CONTROL_SIGNALS.map((s) => `ctrl-${s.name}`),
    ...Object.keys(LABEL_SLOTS).map((name) => `label-${name}`),
    "dp-arrow-idle", "dp-arrow-data", "dp-arrow-ctrl-idle", "dp-arrow-ctrl", // arrowheads
  ];
  assert.deepEqual([...ids].sort(), expected.sort(), "no missing, extra or repeated ids");
});

test("the layout describes exactly the hardware lists", () => {
  assert.deepEqual(Object.keys(COMPONENT_LAYOUT).sort(), COMPONENTS.map((c) => c.name).sort());
  assert.deepEqual(Object.keys(WIRE_PATHS).sort(), WIRES.map((w) => w.name).sort());
  assert.deepEqual(Object.keys(CONTROL_PATHS).sort(), CONTROL_SIGNALS.map((s) => s.name).sort());
});

test("every piece of a wire starts at its source and its arrow lands on a destination", () => {
  for (const { name, from, to } of WIRES) {
    const parts = pieces(WIRE_PATHS[name]);
    parts.forEach((points, i) => {
      const start = points[0];
      const end = points.at(-1);
      if (from !== null) {
        // a piece may also start on the instruction bus (same source) or branch off an earlier piece
        const onSourceBus = WIRES.some((other) =>
          other.name !== name && other.from === from && onPath(WIRE_PATHS[other.name], start));
        const branches = parts.slice(0, i).some((earlier) => onPiece(earlier, start));
        assert.ok(touches(from, start) || onSourceBus || branches, `${name} piece ${i} does not start at ${from}`);
      }
      // the instruction bus has no destination of its own: its fields are separate wires
      if (to.length > 0) {
        assert.ok(to.some((component) => touches(component, end)), `${name} piece ${i} ends on no destination`);
      }
    });
    for (const end of to) {
      assert.ok(parts.some((points) => touches(end, points.at(-1))), `${name} does not reach ${end}`);
    }
  }
});

test("an instruction field has one input per slice of INST, like the VHDL ports", () => {
  // e.g. instControl "INST(6:0), INST(14:12), INST(31:25)" → opcode, funct3 and funct7 inputs
  for (const { name, vhdlName, from } of WIRES) {
    if (from !== "InstructionMemory" || name === "instruction") continue;
    assert.equal(pieces(WIRE_PATHS[name]).length, vhdlName.split(", ").length, name);
  }
});

test("only wires with a destination draw arrowheads", () => {
  for (const { name, to } of WIRES) {
    const group = DATAPATH_SVG.match(new RegExp(`<g id="wire-${name}" class="([^"]+)"`))[1];
    assert.equal(group.includes("directed"), to.length > 0, name);
  }
});

test("every control line goes from the control unit to the right component", () => {
  for (const { name } of CONTROL_SIGNALS) {
    const parts = pieces(CONTROL_PATHS[name]);
    assert.equal(parts.length, 1, `${name} has one piece`);
    assert.ok(touches("ControlUnit", parts[0][0]), `${name} starts at the control unit`);
    assert.ok(touches(CONTROL_TARGET[name], parts[0].at(-1)), `${name} ends at ${CONTROL_TARGET[name]}`);
  }
});

test("the drawing fits the view and every label slot starts empty", () => {
  assert.ok(DATAPATH_SVG.startsWith(`<svg class="datapath" `));
  assert.ok(DATAPATH_SVG.includes(`viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}"`));
  for (const d of [...Object.values(WIRE_PATHS), ...Object.values(CONTROL_PATHS)]) {
    for (const [x, y] of pieces(d).flat()) {
      assert.ok(x >= 0 && x <= SVG_WIDTH && y >= 0 && y <= SVG_HEIGHT, `${d} leaves the view`);
    }
  }
  assert.ok(DATAPATH_SVG.endsWith("</svg>"));
  for (const name of Object.keys(LABEL_SLOTS)) {
    assert.match(DATAPATH_SVG, new RegExp(`id="label-${name}"[^>]*></text>`), name);
  }
});

test("labels show the descriptive name and the small VHDL name", () => {
  for (const { name, vhdlName } of COMPONENTS) {
    const group = DATAPATH_SVG.match(new RegExp(`<g id="comp-${name}".*?</g>`))[0];
    assert.ok(group.includes(`>${vhdlName}</text>`), `${name} shows ${vhdlName}`);
  }
});
