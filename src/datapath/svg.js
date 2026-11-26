// The datapath drawing, as one SVG string the page inserts once and then highlights.
//
//   DATAPATH_SVG  →  '<svg class="datapath" viewBox="0 0 1400 870" ...>...</svg>'
//
// Same components, ports and connections as the Active-HDL schematic
// (docs/img/active-hdl-schematic.png), rearranged so data flows left to right and few lines cross:
//
//   top:     next-PC logic (PCIncrementMux, PCAdder, BranchImmGen)
//   middle:  PC → instruction memory → registers → ALU → data memory → write back
//   bottom:  control unit, and the branch decision (ConditionBit → invert → AND → back to the PC)
//
// Reading the drawing: every arrow points INTO the block that receives the value, and every input
// port has its name written inside the block (like the port names of the VHDL entities).
//
// Nothing here changes per instruction. Every part has a stable id the page uses to highlight it:
//   comp-<Name>   one per component        (COMPONENTS in activity.js)
//   wire-<name>   one per data wire        (WIRES in activity.js)
//   ctrl-<name>   one per control signal   (CONTROL_SIGNALS in control.js)
//   label-<name>  a text slot for a value  (LABEL_SLOTS below), empty until the page fills it
// The page adds the classes "active", "inactive" or "conditional"; the styles are inside the SVG.
// Animation: the page sets --step on each part (see flow.js) and adds "playing" to the <svg>;
// "neon" switches to the glowing palette. Users who ask the system for less motion get none.

import { COMPONENTS, WIRES } from "./activity.js";
import { CONTROL_SIGNALS } from "./control.js";

export const SVG_WIDTH = 1400;
export const SVG_HEIGHT = 870;

// ---------- components: shape, bounding box, name and port names ----------

// kind: rect | mux | alu | adder | and. box: the area the shape occupies (wires end on its edge).
// lines: the name split in lines when it does not fit; label: where the name is written.
// ports: [x, y, text, anchor] port names written inside the block, next to where each wire arrives.
export const COMPONENT_LAYOUT = Object.freeze({
  PCRegister: { kind: "rect", box: box(50, 300, 90, 90), lines: ["PC"] },
  InstructionMemory: {
    kind: "rect", box: box(200, 270, 130, 150), lines: ["Instruction", "Memory"], label: { x: 272, y: 335 },
    ports: [port(206, 349, "address", "start")],
  },
  PCAdder: { kind: "adder", box: box(73, 178, 44, 44), label: { x: 125, y: 163, anchor: "start" } },
  PCIncrementMux: {
    kind: "mux", box: box(55, 100, 80, 30), points: "55,100 135,100 120,130 70,130",
    label: { x: 142, y: 122, anchor: "start" },
    ports: [port(75, 112, "0"), port(115, 112, "1")],
  },
  BranchImmGen: {
    kind: "rect", box: box(170, 50, 150, 50), label: { x: 222, y: 72 },
    ports: [port(315, 66, "[31:25]", "end"), port(315, 92, "[11:7]", "end")],
  },
  ControlUnit: {
    kind: "rect", box: box(420, 595, 220, 110), lines: ["Control Unit"], label: { x: 545, y: 645 },
    ports: [port(426, 624, "opcode", "start"), port(426, 654, "funct3", "start"),
      port(426, 684, "funct7", "start")],
  },
  RegisterFile: {
    kind: "rect", box: box(450, 230, 150, 200), lines: ["Register", "File"], label: { x: 540, y: 320 },
    ports: [
      port(525, 246, "write data"),
      port(456, 269, "read reg 1", "start"), port(456, 304, "read reg 2", "start"),
      port(456, 339, "write reg", "start"), port(585, 422, "write enable", "end"),
      port(594, 274, "read data 1", "end"), port(594, 364, "read data 2", "end"),
    ],
  },
  ImmSelector: {
    kind: "rect", box: box(450, 455, 130, 90), lines: ["Imm", "Selector"], label: { x: 540, y: 492 },
    ports: [port(456, 474, "[31:25]", "start"), port(456, 499, "[24:20]", "start"),
      port(456, 524, "[11:7]", "start"), port(500, 540, "select")],
  },
  SignExtender: { kind: "rect", box: box(605, 470, 110, 60) },
  ALUSrcMux: {
    kind: "mux", box: box(760, 330, 34, 100), points: "760,330 794,345 794,415 760,430",
    label: { x: 777, y: 306 },
    ports: [port(767, 364, "0"), port(767, 409, "1")],
  },
  ALU: {
    kind: "alu", box: box(840, 240, 80, 180),
    points: "840,240 920,280 920,380 840,420 840,350 856,330 840,310",
    label: { x: 890, y: 318 },
    ports: [port(846, 279, "A", "start"), port(846, 384, "B", "start"), port(880, 392, "op")],
  },
  DataMemory: {
    kind: "rect", box: box(990, 250, 130, 170), lines: ["Data", "Memory"], label: { x: 1055, y: 355 },
    ports: [
      port(996, 284, "write data", "start"), port(996, 334, "address", "start"),
      port(1080, 264, "size"), port(1055, 414, "write enable"), port(1114, 324, "read data", "end"),
    ],
  },
  LoadExtender: {
    kind: "rect", box: box(1160, 265, 130, 130), lines: ["Load", "Extender"], label: { x: 1232, y: 320 },
    ports: [port(1220, 279, "size"), port(1166, 324, "word", "start"), port(1166, 374, "address", "start"),
      port(1284, 324, "data", "end")],
  },
  WriteBackMux: {
    kind: "mux", box: box(1310, 260, 34, 120), points: "1310,260 1344,275 1344,365 1310,380",
    label: { x: 1322, y: 238 },
    ports: [port(1317, 294, "1"), port(1317, 354, "0")],
  },
  ConditionBit: { kind: "rect", box: box(240, 776, 90, 40), label: { x: 285, y: 793 } },
  // mux_1bit + NOT: the condition bit goes to input 0 as it is and to input 1 inverted;
  // branchInvert (br_neg) chooses. Drawn inside one box because the project treats it as one block.
  BranchInvertMux: {
    kind: "rect", box: box(140, 763, 85, 66), label: { x: 182, y: 846 },
    inner: [
      `<path class="inner-line" d="M225 796 H210 M210 777 V815 M210 777 H180 M210 815 H203 M185 815 H180 M160 796 H140"/>`,
      `<polygon class="inner" points="180,769 180,823 160,811 160,781"/>`,
      `<polygon class="inner" points="203,808 203,822 191,815"/>`,
      `<circle class="inner" cx="188" cy="815" r="3"/>`,
    ].join(""),
    ports: [port(175, 782, "0"), port(175, 814, "1")],
  },
  BranchAnd: { kind: "and", box: box(60, 774, 45, 44), label: { x: 82, y: 846 } },
});

function box(x, y, w, h) {
  return Object.freeze({ x, y, w, h });
}

function port(x, y, text, anchor = "middle") {
  return Object.freeze([x, y, text, anchor]);
}

// ---------- wires: one path per wire (M = move, H = horizontal line, V = vertical line) ----------

// Each "M" starts a piece; each piece ends with an arrow at the port it feeds.
// A wire that goes to two places branches (two pieces); an instruction field cut from several
// slices of INST has one piece per slice, like the separate ports of the VHDL entity.
// Instruction fields start on the instruction bus (the vertical line at x = 370).
export const WIRE_PATHS = Object.freeze({
  pc: "M140 345 H200 M165 345 V200 H117",
  instruction: "M330 345 H370 M370 30 V680",
  const4: "M75 68 V100",
  branchOffset: "M170 75 H115 V100",
  pcIncrement: "M95 130 V178",
  pcNext: "M95 222 V300",

  instControl: "M370 620 H420 M370 650 H420 M370 680 H420",
  instRs1: "M370 265 H450",
  instRs2: "M370 300 H450",
  instRd: "M370 335 H450",
  instImm: "M370 470 H450 M370 495 H450 M370 520 H450",
  instBranchImm: "M370 62 H320 M370 88 H320",
  instStoreSize: "M370 44 H1080 V250",
  instLoadSize: "M370 30 H1220 V265",

  rs1Data: "M600 270 H840",
  rs2Data: "M600 360 H760",
  storeData: "M600 360 H615 V222 H975 V280 H990",
  imm12: "M580 500 H605",
  immExt: "M715 500 H740 V405 H760",
  aluB: "M794 380 H840",
  aluResult: "M920 330 H950 V450 H1300 V350 H1310",
  memAddress: "M920 330 H990 M965 330 V435 H1145 V370 H1160",
  aluCompare: "M920 330 H935 V796 H330",

  memWord: "M1120 320 H1160",
  loadData: "M1290 320 H1300 V290 H1310",
  writeBackData: "M1344 320 H1385 V200 H525 V230",

  condBit: "M240 796 H225",
  condition: "M140 796 H105",
  branchTaken: "M60 796 H25 V115 H62",
});

// Control lines are outputs of the control unit: they leave by the top, right and bottom edges
// (the left edge only receives the instruction fields). Lines on the same edge are stacked so
// they never cross each other.
export const CONTROL_PATHS = Object.freeze({
  regWrite: "M592 595 V430",
  memWrite: "M640 644 H1055 V420",
  aluSrc: "M640 612 H777 V423",
  memToReg: "M640 660 H1327 V373",
  immSrc: "M500 595 V545",
  aluControl: "M640 628 H880 V400",
  branch: "M450 705 V725 H118 V785 H105",
  branchInvert: "M470 705 V735 H170 V775",
});

// ---------- text ----------

// Fixed hints that belong to no block.
const NOTES = [
  note(75, 62, "4", "constant"),
  note(1085, 130, "funct3"), note(1225, 130, "funct3"),
];

function note(x, y, text, kind = "field") {
  return { x, y, text, kind };
}

// Empty text slots the page fills with the values of one instruction (register numbers, the
// immediate, the ALU operation, the value of each control signal).
export const LABEL_SLOTS = Object.freeze({
  rs1: { x: 410, y: 260 },
  rs2: { x: 410, y: 295 },
  rd: { x: 410, y: 330 },
  imm: { x: 410, y: 486 },
  branchImm: { x: 345, y: 79 },
  aluOperation: { x: 890, y: 354, kind: "operation" },
  regWrite: { x: 597, y: 585, anchor: "start", kind: "signal" },
  immSrc: { x: 495, y: 585, anchor: "end", kind: "signal" },
  aluSrc: { x: 782, y: 560, anchor: "start", kind: "signal" },
  aluControl: { x: 875, y: 480, anchor: "end", kind: "signal" },
  memWrite: { x: 1060, y: 560, anchor: "start", kind: "signal" },
  memToReg: { x: 1322, y: 560, anchor: "end", kind: "signal" },
  branch: { x: 300, y: 720, kind: "signal" },
  branchInvert: { x: 320, y: 750, kind: "signal" },
});

// ---------- styles (light and dark) ----------

const STYLE = `
.datapath { --dp-block: #ffffff; --dp-edge: #c3c9d2; --dp-text: #1d2330; --dp-muted: #7b8597;
  --dp-idle: #d5dae1; --dp-data: #e8590c; --dp-data-fill: #fff4e6; --dp-ctrl: #1971c2;
  --dp-ctrl-fill: #e7f1fb; --dp-spark: #ffffff; --dp-glow: rgba(232, 89, 12, .45);
  --dp-ctrl-glow: rgba(25, 113, 194, .4); --dp-step: .55s;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) {
  .datapath { --dp-block: #1b2029; --dp-edge: #3a4250; --dp-text: #e6e9ef; --dp-muted: #98a2b3;
    --dp-idle: #333a46; --dp-data: #ff8a4c; --dp-data-fill: #3a2414; --dp-ctrl: #5aa9ff;
    --dp-ctrl-fill: #14263b; --dp-spark: #fff6d5; --dp-glow: rgba(255, 138, 76, .6);
    --dp-ctrl-glow: rgba(90, 169, 255, .55); }
}
/* neon: dark background and glowing lines, whatever the system theme */
.datapath.neon { --dp-block: #0b1120; --dp-edge: #26324a; --dp-text: #eaf2ff; --dp-muted: #8193b2;
  --dp-idle: #1a2338; --dp-data: #ff9d2e; --dp-data-fill: #2b1705; --dp-ctrl: #2de2ff;
  --dp-ctrl-fill: #04222c; --dp-spark: #fffbe8; --dp-glow: #ff9d2e; --dp-ctrl-glow: #2de2ff; }
.datapath .backdrop { fill: none; }
.datapath.neon .backdrop { fill: #060a14; }

.datapath .block { fill: var(--dp-block); stroke: var(--dp-edge); stroke-width: 1.5; }
.datapath .inner { fill: var(--dp-block); stroke: var(--dp-edge); stroke-width: 1.3; }
.datapath .inner-line { fill: none; stroke: var(--dp-edge); stroke-width: 1.5; }
.datapath .name { fill: var(--dp-text); font-size: 12.5px; font-weight: 600; }
.datapath .vhdl { fill: var(--dp-muted); font-size: 10px; font-family: ui-monospace, Menlo, Consolas, monospace; }
.datapath .port { fill: var(--dp-muted); font-size: 9px; font-weight: 600; }
.datapath .adder-sign { fill: var(--dp-text); font-size: 20px; font-weight: 600; }
.datapath .note { fill: var(--dp-muted); font-size: 10px; }
.datapath .note.constant { fill: var(--dp-text); font-size: 13px; font-weight: 700; }
.datapath .label { font-size: 10.5px; font-weight: 700; font-family: ui-monospace, Menlo, Consolas, monospace; fill: var(--dp-data); }
.datapath .label.signal { fill: var(--dp-ctrl); }
.datapath .label.operation { font-size: 11px; }
.datapath .arrow-idle { fill: var(--dp-idle); }
.datapath .arrow-data { fill: var(--dp-data); }
.datapath .arrow-ctrl { fill: var(--dp-ctrl); }

/* every line has three layers: base (grey, always), energy (colored, when used), spark (moving dots) */
.datapath .wire path, .datapath .ctrl path { fill: none; stroke-linejoin: round; }
.datapath .wire .base { stroke: var(--dp-idle); stroke-width: 4; }
.datapath .wire.directed .base { marker-end: url(#dp-arrow-idle); }
.datapath .ctrl .base { stroke: var(--dp-idle); stroke-width: 1.8; marker-end: url(#dp-arrow-ctrl-idle); }
.datapath .energy, .datapath .spark { display: none; }
.datapath .wire.active .energy { display: inline; stroke: var(--dp-data); stroke-width: 4;
  filter: drop-shadow(0 0 3px var(--dp-glow)); }
.datapath .wire.directed.active .energy { marker-end: url(#dp-arrow-data); }
.datapath .ctrl.active .energy { display: inline; stroke: var(--dp-ctrl); stroke-width: 2.2;
  marker-end: url(#dp-arrow-ctrl); filter: drop-shadow(0 0 2px var(--dp-ctrl-glow)); }
.datapath .wire.conditional .base { stroke: var(--dp-data); stroke-dasharray: 7 6; }
.datapath .wire.directed.conditional .base { marker-end: url(#dp-arrow-data); }
.datapath .wire.active .spark, .datapath .ctrl.active .spark { display: inline; stroke: var(--dp-spark);
  stroke-linecap: round; stroke-dasharray: 2 26; animation: dp-spark-move .8s linear infinite; }
.datapath .wire.active .spark { stroke-width: 2; }
.datapath .ctrl.active .spark { stroke-width: 1.2; }
.datapath .wire.inactive { opacity: .55; }
.datapath .ctrl.inactive { opacity: .6; }

.datapath .component.active .block { stroke: var(--dp-data); stroke-width: 2.2; fill: var(--dp-data-fill); }
.datapath .component.active .inner, .datapath .component.active .inner-line { stroke: var(--dp-data); }
.datapath #comp-ControlUnit.active .block { stroke: var(--dp-ctrl); fill: var(--dp-ctrl-fill); }
.datapath .component.inactive { opacity: .38; }
.datapath.neon .component.active .block { filter: drop-shadow(0 0 5px var(--dp-glow)); }
.datapath.neon #comp-ControlUnit.active .block { filter: drop-shadow(0 0 5px var(--dp-ctrl-glow)); }
.datapath.neon .wire.active .energy { filter: drop-shadow(0 0 3px var(--dp-glow)) drop-shadow(0 0 9px var(--dp-glow)); }
.datapath.neon .ctrl.active .energy { filter: drop-shadow(0 0 2px var(--dp-ctrl-glow)) drop-shadow(0 0 7px var(--dp-ctrl-glow)); }

/* the trace: with the class "playing", every part waits for its step (--step, set by the page) */
.datapath.playing .wire.active .energy, .datapath.playing .ctrl.active .energy {
  stroke-dasharray: 100 100; animation: dp-draw var(--dp-step) ease-in-out both;
  animation-delay: calc(var(--step, 0) * var(--dp-step)); }
.datapath.playing .wire.active .spark, .datapath.playing .ctrl.active .spark {
  animation: dp-spark-move .8s linear infinite, dp-appear .3s both;
  animation-delay: 0s, calc((var(--step, 0) + 1) * var(--dp-step)); }
.datapath.playing .wire.conditional .base { animation: dp-appear .4s both;
  animation-delay: calc(var(--step, 0) * var(--dp-step)); }
.datapath.playing .component.active .block { animation: dp-light .35s ease-out both;
  animation-delay: calc(var(--step, 0) * var(--dp-step)); }
.datapath.playing #comp-ControlUnit.active .block { animation-name: dp-light-ctrl; }
@keyframes dp-draw { 0% { stroke-dashoffset: 100; opacity: 0; } 1% { opacity: 1; } 100% { stroke-dashoffset: 0; opacity: 1; } }
@keyframes dp-spark-move { from { stroke-dashoffset: 28; } to { stroke-dashoffset: 0; } }
@keyframes dp-appear { from { opacity: 0; } to { opacity: 1; } }
@keyframes dp-light { from { fill: var(--dp-block); stroke: var(--dp-edge); } to { fill: var(--dp-data-fill); stroke: var(--dp-data); } }
@keyframes dp-light-ctrl { from { fill: var(--dp-block); stroke: var(--dp-edge); } to { fill: var(--dp-ctrl-fill); stroke: var(--dp-ctrl); } }
@media (prefers-reduced-motion: reduce) {
  .datapath *, .datapath.playing * { animation: none !important; }
  .datapath .spark { display: none !important; }
}
`;

// Arrowheads: the tip sits on the end of the line (refX), the size does not grow with the stroke.
function arrowMarker(id, className, size) {
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${size}" ` +
    `markerHeight="${size}" markerUnits="userSpaceOnUse" orient="auto">` +
    `<path class="${className}" d="M0 0 L10 5 L0 10 Z"/></marker>`;
}

const MARKERS = [
  arrowMarker("dp-arrow-idle", "arrow-idle", 12),
  arrowMarker("dp-arrow-data", "arrow-data", 12),
  arrowMarker("dp-arrow-ctrl-idle", "arrow-idle", 8),
  arrowMarker("dp-arrow-ctrl", "arrow-ctrl", 8),
];

// ---------- building the string ----------

const NAMES = new Map(COMPONENTS.map((c) => [c.name, c.vhdlName]));
const WIRE_INFO = new Map(WIRES.map((w) => [w.name, w]));
const SIGNAL_INFO = new Map(CONTROL_SIGNALS.map((s) => [s.name, s]));

function componentMarkup(name) {
  const layout = COMPONENT_LAYOUT[name];
  const { x, y, w, h } = layout.box;
  const vhdlName = NAMES.get(name);
  const shape = {
    rect: () => `<rect class="block" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>`,
    mux: () => `<polygon class="block" points="${layout.points}"/>`,
    alu: () => `<polygon class="block" points="${layout.points}"/>`,
    adder: () => `<circle class="block" cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}"/>` +
      `<text class="adder-sign" x="${x + w / 2}" y="${y + h / 2 + 7}" text-anchor="middle">+</text>`,
    and: () => `<path class="block" d="M${x + w} ${y} H${x + 22} A22 22 0 0 0 ${x + 22} ${y + h} H${x + w} Z"/>`,
  }[layout.kind]();

  // Name lines and the small VHDL name below them; by default centered in the box.
  const lines = layout.lines ?? [name];
  const label = layout.label ?? { x: x + w / 2, y: y + h / 2 - (lines.length - 1) * 8 - 2 };
  const anchor = label.anchor ?? "middle";
  const texts = lines.map((line, i) =>
    `<text class="name" x="${label.x}" y="${label.y + i * 15}" text-anchor="${anchor}">${line}</text>`);
  texts.push(`<text class="vhdl" x="${label.x}" y="${label.y + lines.length * 15 - 1}" ` +
    `text-anchor="${anchor}">${vhdlName}</text>`);
  const ports = (layout.ports ?? []).map(([px, py, text, portAnchor]) =>
    `<text class="port" x="${px}" y="${py}" text-anchor="${portAnchor}">${text}</text>`);

  return `<g id="comp-${name}" class="component"><title>${name} (${vhdlName})</title>` +
    `${shape}${layout.inner ?? ""}${ports.join("")}${texts.join("")}</g>`;
}

// One <path> per piece, so every piece gets its own arrowhead.
function piecesOf(d) {
  return d.split(/(?=M)/).map((piece) => piece.trim());
}

// The three layers of a line, one <path> per piece in each. pathLength="100" lets the energy layer
// be "drawn in" with the same numbers whatever the real length of the piece.
function layers(d) {
  const parts = piecesOf(d);
  return [
    ...parts.map((piece) => `<path class="base" d="${piece}"/>`),
    ...parts.map((piece) => `<path class="energy" d="${piece}" pathLength="100"/>`),
    ...parts.map((piece) => `<path class="spark" d="${piece}"/>`),
  ].join("");
}

function wireMarkup(name) {
  const { vhdlName, to } = WIRE_INFO.get(name);
  const directed = to.length > 0 ? " directed" : ""; // the instruction bus itself has no arrow
  return `<g id="wire-${name}" class="wire${directed}"><title>${name} (${vhdlName})</title>` +
    `${layers(WIRE_PATHS[name])}</g>`;
}

function controlMarkup(name) {
  const { vhdlName, meaning } = SIGNAL_INFO.get(name);
  return `<g id="ctrl-${name}" class="ctrl"><title>${name} (${vhdlName}): ${meaning}</title>` +
    `${layers(CONTROL_PATHS[name])}</g>`;
}

function noteMarkup({ x, y, text, kind }) {
  return `<text class="note ${kind}" x="${x}" y="${y}" text-anchor="middle">${text}</text>`;
}

function labelMarkup([name, { x, y, anchor = "middle", kind = "value" }]) {
  return `<text id="label-${name}" class="label ${kind}" x="${x}" y="${y}" text-anchor="${anchor}"></text>`;
}

// Components first, then wires on top (so every arrowhead is visible on the edge of its block),
// then text.
export const DATAPATH_SVG = [
  `<svg class="datapath" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" ` +
    `role="img" aria-label="Single-cycle RISC-V datapath">`,
  `<style>${STYLE}</style>`,
  `<defs>${MARKERS.join("")}</defs>`,
  `<rect class="backdrop" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" rx="14"/>`,
  `<g class="components">${COMPONENTS.map((c) => componentMarkup(c.name)).join("")}</g>`,
  `<g class="wires">${WIRES.map((w) => wireMarkup(w.name)).join("")}</g>`,
  `<g class="controls">${CONTROL_SIGNALS.map((s) => controlMarkup(s.name)).join("")}</g>`,
  `<g class="notes">${NOTES.map(noteMarkup).join("")}</g>`,
  `<g class="labels">${Object.entries(LABEL_SLOTS).map(labelMarkup).join("")}</g>`,
].join("") + "</svg>";
