// Pen-and-ink drawing for the wine portraits.
//
// Every mark is a filled SVG path in one ink. Tone comes from how close the
// lines sit, never from grey fills or gradients, so a page looks the same on
// an e-ink screen as it does on a laptop.

export type Point = [number, number];
export type Random = () => number;
export type WineType = 'red' | 'white' | 'rosé' | 'sparkling' | 'fortified';
export type BottleForm = 'bordeaux' | 'burgundy' | 'champagne' | 'flute' | 'port';
export type BottlePart = 'capsule' | 'neck' | 'shoulder' | 'label' | 'glass' | 'base';

interface PenStyle {
  width?: number;
  wobble?: number;
  taper?: number;
}

// Seeded random numbers: the same seed always gives the same drawing.
export function seededRandom(seed: string): Random {
  let a = 2166136261;
  for (const ch of seed) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function escapeHtml(text: string | number): string {
  return String(text).replace(/[&<>"]/g, (c) => ENTITIES[c]);
}

// An SVG drawing. The pen marks sit in one group so that they can boil (see
// BOIL_FILTERS). Any words go outside that group and stay still.
export function svg(width: number, height: number, marks: string, className = '', words = ''): string {
  return `<svg class="${className}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="currentColor" aria-hidden="true"><g class="boil">${marks}</g>${words}</svg>`;
}

// Line boil: three slightly different wobbles of the same lines. On screens
// that animate smoothly, style.css cycles through them, so the pen lines move
// a little, as in hand-drawn animation. The display adds them to the page once.
export const BOIL_FILTERS = `<svg width="0" height="0" style="position: absolute" aria-hidden="true">${[1, 2, 3]
  .map(
    (seed) =>
      `<filter id="boil-${seed}" x="-50%" y="-50%" width="200%" height="200%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.035" seed="${seed}"/>` +
      `<feDisplacementMap in="SourceGraphic" scale="3"/></filter>`
  )
  .join('')}</svg>`;

function pathData(points: Point[]): string {
  return 'M' + points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L');
}

// Points every `step` units along a line.
function resample(points: Point[], step: number): Point[] {
  const out: Point[] = [points[0]];
  let since = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const length = Math.hypot(x1 - x0, y1 - y0);
    let d = step - since;
    for (; d < length; d += step) out.push([x0 + ((x1 - x0) * d) / length, y0 + ((y1 - y0) * d) / length]);
    since = length - (d - step);
  }
  out.push(points[points.length - 1]);
  return out;
}

// One stroke of a dip pen along `points`. The line wanders a little and is
// thinner where the pen touches down and lifts off: `taper` is the share of
// the stroke, at each end, that thins out.
function pen(points: Point[], rand: Random, { width = 1.5, wobble = 0.6, taper = 0.2 }: PenStyle = {}): string {
  const pts = resample(points, 3);
  const last = pts.length - 1;
  const phase = [rand() * 7, rand() * 7, rand() * 7];
  const left: Point[] = [];
  const right: Point[] = [];
  pts.forEach(([px, py], i) => {
    const t = i / last;
    const s = i * 3;
    const [ax, ay] = pts[Math.max(i - 1, 0)];
    const [bx, by] = pts[Math.min(i + 1, last)];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (ay - by) / length;
    const ny = (bx - ax) / length;
    const drift = wobble * (0.65 * Math.sin(s / 40 + phase[0]) + 0.35 * Math.sin(s / 11 + phase[1]));
    const lift = Math.min(1, t / taper, (1 - t) / taper);
    const half = (width / 2) * (0.25 + 0.75 * Math.sqrt(lift)) * (1 + 0.15 * Math.sin(s / 17 + phase[2]));
    const x = px + nx * drift;
    const y = py + ny * drift;
    left.push([x + nx * half, y + ny * half]);
    right.push([x - nx * half, y - ny * half]);
  });
  return `<path d="${pathData(left.concat(right.reverse()))}Z"/>`;
}

// A pen line along `points` that ends in an arrowhead.
function arrow(points: Point[], rand: Random, width = 0.9): string {
  const [x1, y1] = points[points.length - 1];
  const [x0, y0] = points[points.length - 2];
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const barb = (turn: number) =>
    pen([[x1, y1], [x1 - 7 * Math.cos(angle + turn), y1 - 7 * Math.sin(angle + turn)]], rand, { width, wobble: 0.1, taper: 0.5 });
  return pen(points, rand, { width, wobble: 0.4, taper: 0.2 }) + barb(0.45) + barb(-0.45);
}

// Points around an ellipse from angle a0 to a1, in radians (y points down).
function ellipsePoints(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, count = 40): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const a = a0 + ((a1 - a0) * i) / count;
    points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return points;
}

// A freehand loop. It overshoots a little where it closes.
export function handLoop(cx: number, cy: number, rx: number, ry: number, rand: Random, style?: PenStyle): string {
  const start = rand() * Math.PI * 2;
  const points = ellipsePoints(0, 0, rx, ry, start, start + Math.PI * 2.15, 60).map(
    ([x, y], i): Point => [cx + x * (1 + i / 1000), cy + y * (1 + i / 1000)]
  );
  return pen(points, rand, { taper: 0.08, ...style });
}

// Straight-line interpolation in a table of [x, y] pairs.
function lookup(table: Point[], x: number): number {
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return table[table.length - 1][1];
}

// A smooth curve through the points (xs[i], ys[i]) that never bulges past
// them (monotone cubic interpolation). Returns a function of x.
function smoothCurve(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) slope.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  m.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      m[i] = (3 * a * slope[i]) / h;
      m[i + 1] = (3 * b * slope[i]) / h;
    }
  }
  return (x) => {
    const at = Math.min(Math.max(x, xs[0]), xs[n - 1]);
    let i = 0;
    while (i < n - 2 && at > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (at - xs[i]) / h;
    return (
      (2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] +
      (t ** 3 - 2 * t ** 2 + t) * h * m[i] +
      (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] +
      (t ** 3 - t ** 2) * h * m[i + 1]
    );
  };
}

// ---- Bottles ------------------------------------------------------------

interface BottleShape {
  name: string;
  height: number;
  capsule: number;
  label: [number, number];
  dome?: number;
  profile: Point[];
}

// Bottle shapes, in centimetres. `profile` runs down one side of the bottle
// as [depth from the top, radius] pairs. `capsule` is how far down the foil
// reaches, and `label` is where the label starts and ends.
export const BOTTLES: Record<BottleForm, BottleShape> = {
  bordeaux: {
    name: 'Bordeaux',
    height: 30,
    capsule: 4.8,
    label: [17, 26.5],
    profile: [[0, 1.55], [0.8, 1.55], [1.05, 1.42], [5, 1.44], [8.8, 1.52], [9.9, 1.8], [10.9, 2.55], [11.8, 3.35], [12.6, 3.72], [13.2, 3.75], [29.5, 3.75], [30, 3.55]],
  },
  burgundy: {
    name: 'Burgundy',
    height: 29.5,
    capsule: 5,
    label: [18.5, 27],
    profile: [[0, 1.55], [0.8, 1.55], [1.05, 1.42], [5.5, 1.45], [8, 1.62], [10, 2.2], [12, 3.05], [14, 3.7], [15.6, 3.98], [16.5, 4], [29.1, 4], [29.5, 3.8]],
  },
  champagne: {
    name: 'Champagne',
    height: 30.5,
    dome: 1.3,
    capsule: 11,
    label: [19.5, 26.5],
    profile: [[1.3, 1.62], [2.1, 1.62], [2.35, 1.5], [7, 1.55], [10, 1.9], [12.5, 2.9], [14.5, 3.8], [16, 4.3], [17, 4.4], [30.1, 4.4], [30.5, 4.15]],
  },
  flute: {
    name: 'Flute',
    height: 35,
    capsule: 4.5,
    label: [22.5, 30],
    profile: [[0, 1.5], [0.8, 1.5], [1.05, 1.38], [5, 1.42], [8, 1.7], [11, 2.45], [14, 3.25], [16.5, 3.7], [18, 3.8], [34.6, 3.8], [35, 3.6]],
  },
  port: {
    name: 'Port',
    height: 29.5,
    capsule: 3.8,
    label: [16, 25],
    profile: [[0, 1.6], [0.9, 1.6], [1.15, 1.45], [3.2, 1.5], [4.6, 1.85], [5.8, 1.9], [7, 1.55], [8.6, 1.6], [9.6, 2], [10.6, 2.9], [11.4, 3.6], [12.1, 3.9], [29, 3.9], [29.5, 3.7]],
  },
};

// How dark the glass, with the wine inside it, looks.
export const GLASS_DARKNESS: Record<WineType, number> = { red: 1, fortified: 1, sparkling: 0.85, white: 0.6, rosé: 0.4 };

// Ink across a glass bottle, from its left edge (-1) to its right edge (1).
// Light comes from the upper left: a bright streak on the left, a dark band
// on the right, then a thin reflected rim.
const GLASS_SHADE: Point[] = [[-1, 0.55], [-0.82, 0.45], [-0.66, 0], [-0.4, 0], [-0.22, 0.3], [0.25, 0.55], [0.5, 0.9], [0.8, 0.95], [0.9, 0.5], [1, 0.62]];

// Hatch line k is drawn when the shade is above DITHER[k % 8]. The order
// keeps the drawn lines evenly spaced at every shade.
const DITHER = [0.05, 0.55, 0.3, 0.8, 0.17, 0.67, 0.42, 0.92];

interface BottleOptions {
  form: BottleForm;
  darkness: number;
  label?: { producer: string; name: string; vintage: string | number };
  cx: number;
  ground: number;
  scale: number;
  rand: Random;
  id?: string;
}

interface Bottle {
  marks: string;
  words: string;
  left: number;
  anchors: Record<BottlePart, Point>;
}

// A bottle in pen and ink, standing with the middle of its base at
// (cx, ground). `scale` is drawing units per centimetre, so every bottle
// keeps its true size. `label` holds the words for the label (optional).
// Returns the pen marks, the words on the label, and the points that margin
// notes can point to.
export function drawBottle({ form, darkness, label, cx, ground, scale, rand, id }: BottleOptions): Bottle {
  const f = BOTTLES[form];
  const radius = smoothCurve(f.profile.map((p) => p[0]), f.profile.map((p) => p[1]));
  const top = f.profile[0][0];
  const height = f.height;
  const body = radius(height - 1);
  const [labelTop, labelBottom] = f.label;
  const capsule = f.capsule;
  const capsuleRadius = (y: number) => radius(Math.max(y, top)) + 0.07;
  const outlineAt = (y: number) => (y < capsule ? capsuleRadius(y) : radius(y));
  const X = (x: number) => cx + x * scale;
  const Y = (y: number) => ground - (height - y) * scale;
  // We look down on the bottle a little, so the circles around it show as
  // ellipses that get rounder towards the base.
  const bow = (y: number) => radius(y) * (0.1 + (0.2 * y) / height);
  // The front half of the circle around the bottle at depth y, across the
  // middle `w` of its width.
  const front = (y: number, w = 1, r = radius) =>
    ellipsePoints(cx, Y(y), r(y) * scale, bow(y) * scale, Math.acos(-w), Math.acos(w), 32);
  const shade = (u: number) => lookup(GLASS_SHADE, u) * darkness;
  const foilShade = (u: number) => Math.min(1, lookup(GLASS_SHADE, u) + 0.4);

  const ink: string[] = [];
  const line = (points: Point[], style: PenStyle) => {
    ink.push(pen(points, rand, style));
  };
  // A hatch line down the bottle at u (-1 left edge … 1 right edge) that
  // follows its curves from depth y0 to y1.
  const follow = (u: number, y0: number, y1: number, r: (y: number) => number, style: PenStyle) => {
    const points: Point[] = [];
    for (let y = y0; y < y1; y += 0.3) points.push([X(u * r(y)), Y(y)]);
    points.push([X(u * r(y1)), Y(y1)]);
    line(points, style);
  };
  // A short arc around the bottle at depth y, from u0 to u1, tilted so that
  // it crosses the hatching.
  const wrap = (y: number, u0: number, u1: number, r: (y: number) => number) => {
    const points: Point[] = [];
    for (let u = u0; u <= u1; u += 0.04) points.push([X(u * r(y)), Y(y + bow(y) * Math.sqrt(1 - u * u) - 0.35 * u)]);
    if (points.length > 2) line(points, { width: 0.5, wobble: 0.2, taper: 0.3 });
  };
  // The stretches of u where `shadeAt` is above `threshold`.
  const darkStretches = (shadeAt: (u: number) => number, threshold: number) => {
    const stretches: Point[] = [];
    let start: number | null = null;
    for (let u = -0.98; u <= 0.98; u += 0.02) {
      if (shadeAt(u) > threshold) {
        if (start === null) start = u;
      } else if (start !== null) {
        stretches.push([start, u - 0.02]);
        start = null;
      }
    }
    if (start !== null) stretches.push([start, 0.98]);
    return stretches;
  };
  // A straight line down the label at u, from the arc at depth y0 to the arc at y1.
  const down = (u: number, y0: number, y1: number): Point[] => [
    [X(u * body), Y(y0 + bow(y0) * Math.sqrt(1 - u * u))],
    [X(u * body), Y(y1 + bow(y1) * Math.sqrt(1 - u * u))],
  ];

  // Where the shoulder starts to widen, and where it meets the body.
  let shoulder = top;
  while (radius(shoulder) < body * 0.55) shoulder += 0.1;
  let bodyTop = shoulder;
  while (radius(bodyTop) < body * 0.97) bodyTop += 0.1;

  // 1. The shadow on the ground, cast to the lower right.
  const shadowRy = bow(height);
  for (let dy = -shadowRy; dy <= shadowRy; dy += 3.4 / scale) {
    const half = body * 1.1 * Math.sqrt(Math.max(0, 1 - (dy / shadowRy) ** 2));
    line([[X(body * 0.5 - half), Y(height + dy)], [X(body * 0.5 + half), Y(height + dy)]], { width: 0.8, wobble: 0.3, taper: 0.3 });
  }

  // 2. Paper inside the outline, so the shadow does not show through the glass.
  const depths: number[] = [];
  for (let y = top; y < height; y += 0.2) depths.push(y);
  depths.push(height);
  const left = depths.map((y): Point => [X(-outlineAt(y)), Y(y)]);
  const right = depths.map((y): Point => [X(outlineAt(y)), Y(y)]);
  const base = ellipsePoints(cx, Y(height), radius(height) * scale, bow(height) * scale, Math.PI, 0, 32);
  const dome = f.dome ? ellipsePoints(cx, Y(top), capsuleRadius(top) * scale, f.dome * scale, 0, -Math.PI, 24) : [];
  ink.push(`<path class="paper" d="${pathData([...left, ...base, ...right.slice().reverse(), ...dome])}Z"/>`);

  // 3. Hatching down the glass, following its curves, then the neck.
  const columns = Math.round((2 * body * scale) / 3.2);
  for (let k = 0; k < columns; k++) {
    const u = -1 + (2 * (k + 0.5 + (rand() - 0.5) * 0.4)) / columns;
    const s = shade(u);
    if (s <= DITHER[k % DITHER.length]) continue;
    const style = { width: 0.45 + 0.8 * s, wobble: 0.3, taper: 0.35 };
    follow(u, shoulder + rand() * (bodyTop - shoulder) * 0.7, labelTop + 0.3, radius, style);
    follow(u, labelBottom - 0.2, height - 0.2 - rand() * 0.8, radius, style);
  }
  const neckColumns = Math.round((2 * radius(capsule + 0.5) * scale) / 3.2);
  for (let k = 0; k < neckColumns; k++) {
    const u = -1 + (2 * (k + 0.5)) / neckColumns;
    const s = Math.min(1, shade(u) * 1.15);
    if (s <= DITHER[(k + 3) % DITHER.length]) continue;
    const start = capsule + bow(capsule) * Math.sqrt(1 - u * u) + 0.1;
    follow(u, start, shoulder + 1 + rand(), radius, { width: 0.45 + 0.5 * s, wobble: 0.2, taper: 0.35 });
  }
  // Cross-hatching around the bottle where the glass is darkest.
  const darkGlass = darkStretches(shade, 0.58);
  for (let y = shoulder + 0.4; y < height - 0.6; y += 6.5 / scale) {
    if (y > labelTop - 0.3 && y < labelBottom + 0.2) continue;
    for (const [u0, u1] of darkGlass) wrap(y, u0 + rand() * 0.06, u1 - rand() * 0.06, radius);
  }

  // 4. The label: paper wrapped round the bottle, with a printed frame.
  ink.push(`<path class="paper" d="${pathData([...front(labelTop), ...front(labelBottom).reverse()])}Z"/>`);
  const faint = { width: 0.45, wobble: 0.2, taper: 0.3 };
  for (let u = 0.72; u < 0.98; u += 3 / (body * scale)) line(down(u, labelTop, labelBottom), faint);
  line(down(-0.95, labelTop, labelBottom), faint);
  const frameTop = labelTop + 0.45;
  const frameBottom = labelBottom - 0.45;
  const frame = { width: 0.5, wobble: 0.15 };
  line(front(frameTop, 0.8), frame);
  line(front(frameBottom, 0.8), frame);
  line(down(-0.8, frameTop, frameBottom), frame);
  line(down(0.8, frameTop, frameBottom), frame);
  const words: string[] = [];
  if (label) {
    const room = 2 * body * 0.7 * scale;
    const write = (at: number, size: number, className: string, text: string | number) => {
      const pathId = `${id}-${className}`;
      const y = labelTop + (labelBottom - labelTop) * at;
      words.push(
        `<path id="${pathId}" d="${pathData(front(y, 0.9))}" fill="none"/>` +
          `<text class="${className}" font-size="${size.toFixed(1)}" text-anchor="middle">` +
          `<textPath href="#${pathId}" startOffset="50%">${escapeHtml(text)}</textPath></text>`
      );
    };
    write(0.3, Math.min(11, room / (label.producer.length * 0.6)), 'label-producer', label.producer);
    line(front(labelTop + (labelBottom - labelTop) * 0.38, 0.25), { width: 0.5, wobble: 0.1 });
    write(0.57, Math.min(14, room / (label.name.length * 0.45)), 'label-name', label.name);
    write(0.83, 13, 'label-vintage', label.vintage);
  }

  // 5. The foil capsule over the cork.
  const capDepths = depths.filter((y) => y < capsule).concat(capsule);
  const capLeft = capDepths.map((y): Point => [X(-capsuleRadius(y)), Y(y)]);
  const capRight = capDepths.map((y): Point => [X(capsuleRadius(y)), Y(y)]);
  const capEdge = front(capsule, 1, capsuleRadius);
  ink.push(`<path class="paper" d="${pathData([...capLeft, ...capEdge, ...capRight.slice().reverse(), ...dome])}Z"/>`);
  const capColumns = Math.round((2 * capsuleRadius(capsule) * scale) / 3);
  for (let k = 0; k < capColumns; k++) {
    const u = -1 + (2 * (k + 0.5)) / capColumns;
    const s = foilShade(u);
    if (s <= DITHER[k % DITHER.length]) continue;
    const rim = Math.sqrt(1 - u * u);
    const start = f.dome ? top - f.dome * rim : top + bow(top) * rim;
    follow(u, start, capsule + bow(capsule) * rim - 0.1, capsuleRadius, { width: 0.5 + 0.5 * s, wobble: 0.2, taper: 0.3 });
  }
  const darkFoil = darkStretches(foilShade, 0.75);
  for (let y = top + 0.3; y < capsule - 0.2; y += 6 / scale) {
    for (const [u0, u1] of darkFoil) wrap(y, u0, u1, capsuleRadius);
  }
  line(front(capsule - 0.5, 1, capsuleRadius), { width: 0.6, wobble: 0.2 });
  if (f.dome) {
    line(dome, { width: 1.4, taper: 0.1 });
    // The wire cage shows through the foil.
    line(front(top + 0.5, 1, capsuleRadius), { width: 0.7, wobble: 0.2 });
    for (const side of [-1, 1]) {
      line([[X(side * capsuleRadius(top) * 0.55), Y(top - f.dome * 0.35)], [X(side * 0.15), Y(top - f.dome * 0.95)]], { width: 0.8, wobble: 0.2, taper: 0.3 });
    }
  } else {
    const r = capsuleRadius(top) * scale;
    line(ellipsePoints(cx, Y(top), r, bow(top) * scale, 0, Math.PI * 2), { width: 1.1, taper: 0.05 });
    line(ellipsePoints(cx, Y(top), r * 0.55, bow(top) * scale * 0.55, 0, Math.PI * 2, 30), { width: 0.5, taper: 0.1 });
  }

  // 6. Outlines last, heavier on the shadow side.
  line(capLeft, { width: 1.3, taper: 0.08 });
  line(capRight, { width: 1.7, taper: 0.08 });
  line(capEdge, { width: 1.1, taper: 0.1 });
  const below = depths.filter((y) => y >= capsule - 0.1);
  line(below.map((y): Point => [X(-radius(y)), Y(y)]), { width: 1.5, taper: 0.05 });
  line(below.map((y): Point => [X(radius(y)), Y(y)]), { width: 2.1, taper: 0.05 });
  line(base, { width: 1.8, taper: 0.1 });
  line(front(labelTop), { width: 1, taper: 0.1 });
  line(front(labelBottom), { width: 1, taper: 0.1 });
  // A second, lighter pass down the dark side, as a quick sketch has.
  const from = bodyTop + rand() * 3;
  const to = Math.min(height - 1, from + 9 + rand() * 6);
  line(depths.filter((y) => y > from && y < to).map((y): Point => [X(radius(y)) + 1.3, Y(y)]), { width: 0.6, wobble: 0.5, taper: 0.4 });

  const at = (y: number): Point => [X(-outlineAt(y)) - 4, Y(y)];
  return {
    marks: ink.join(''),
    words: words.join(''),
    left: X(-body),
    anchors: {
      capsule: at(top + Math.min(2, capsule / 2)),
      neck: at((capsule + shoulder) / 2),
      shoulder: at((shoulder + bodyTop) / 2),
      label: at((labelTop + labelBottom) / 2),
      glass: at((labelBottom + height) / 2),
      base: [X(-body * 0.55) - 2, Y(height) + bow(height) * scale * 0.8 + 3],
    },
  };
}

// ---- Smaller marks --------------------------------------------------------

// A curved line from a margin note to the part of the bottle it describes.
export function drawLeader([x0, y0]: Point, [x1, y1]: Point, rand: Random): string {
  const cx = (x0 + x1) / 2;
  const cy = Math.min(y0, y1) - 8;
  const points: Point[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    points.push([(1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1]);
  }
  return arrow(points, rand);
}

// A 5 cm scale bar at the same scale as the bottle, as in an illustrated book.
// Returns the pen marks and the words separately.
export function drawScaleBar(x: number, y: number, scale: number, rand: Random): { marks: string; words: string } {
  const end = x + 5 * scale;
  let marks = '';
  for (let cm = 0; cm < 5; cm += 2) marks += `<rect x="${(x + cm * scale).toFixed(1)}" y="${y - 3}" width="${scale}" height="6"/>`;
  marks += pen([[x, y - 3], [end, y - 3]], rand, { width: 0.8, wobble: 0.2, taper: 0.05 });
  marks += pen([[x, y + 3], [end, y + 3]], rand, { width: 0.8, wobble: 0.2, taper: 0.05 });
  marks += pen([[end, y - 3], [end, y + 3]], rand, { width: 0.8, wobble: 0.1, taper: 0.1 });
  const words =
    `<text class="scale" x="${x - 6}" y="${y + 5}" text-anchor="end">0</text>` +
    `<text class="scale" x="${end + 6}" y="${y + 5}">5 cm</text>`;
  return { marks, words };
}

interface Timeline {
  vintage?: number | null;
  from: number;
  to: number;
  mark: number;
  markLabel: string;
}

// The drinking window on a hand-drawn line of years, with an arrow at
// `mark` (this year).
export function drawTimeline({ vintage, from, to, mark, markLabel }: Timeline, width: number, rand: Random): string {
  const known = [vintage, from, to, mark].filter((year): year is number => Boolean(year));
  const first = Math.min(...known) - 1;
  const last = Math.max(...known) + 1;
  const x = (year: number) => 10 + ((year - first) / (last - first)) * (width - 20);
  const axis = 50;
  let marks = pen([[x(first), axis], [x(last), axis]], rand, { width: 1.3, wobble: 0.5, taper: 0.04 });
  for (let year = first + 1; year < last; year++) {
    marks += pen([[x(year), axis - 3], [x(year), axis + 3]], rand, { width: 0.6, wobble: 0.1, taper: 0.3 });
  }
  // The window itself: a hatched bracket above the line.
  for (let hx = x(from) + 2; hx < x(to) - 3; hx += 4.5) {
    marks += pen([[hx, axis - 6], [hx + 3, axis - 19]], rand, { width: 0.6, wobble: 0.1, taper: 0.3 });
  }
  marks += pen([[x(from), axis - 4], [x(from), axis - 22], [x(to), axis - 22], [x(to), axis - 4]], rand, { width: 1.1, wobble: 0.3, taper: 0.04 });
  if (vintage) marks += handLoop(x(vintage), axis, 3.2, 3.2, rand, { width: 1.8 });
  // Years under the line, leaving out any that would crowd the one before.
  let words = '';
  let lastX = -Infinity;
  for (const year of [...new Set(known)].sort((a, b) => a - b)) {
    if (x(year) - lastX < 30) continue;
    words += `<text class="year" x="${x(year).toFixed(1)}" y="${axis + 22}" text-anchor="middle">${year}</text>`;
    lastX = x(year);
  }
  const mx = x(mark);
  marks += arrow([[mx + 12, axis - 42], [mx + 3, axis - 30], [mx, axis - 6]], rand, 1);
  words += `<text class="year" x="${mx + 16}" y="${axis - 36}">${markLabel}</text>`;
  return svg(width, 80, marks, '', words);
}

// A hand-drawn scale from 1 (low) to 5 (high), with a dot at `value`.
export function drawLevel(value: number, rand: Random): string {
  const x = (step: number) => 6 + (step - 1) * 29.5;
  let out = pen([[x(1), 10], [x(5), 10]], rand, { width: 1, wobble: 0.4, taper: 0.1 });
  for (let step = 1; step <= 5; step++) out += pen([[x(step), 6], [x(step), 14]], rand, { width: 0.7, wobble: 0.1, taper: 0.3 });
  out += handLoop(x(value), 10, 3, 3, rand, { width: 4.5, wobble: 0.2 });
  return svg(130, 20, out);
}

// Five hand-drawn circles, `score` of them filled in.
export function drawRating(score: number, rand: Random): string {
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += handLoop(10 + i * 21, 11, 7, 7, rand, { width: 1.1, wobble: 0.3 });
    if (i < score) out += handLoop(10 + i * 21, 11, 2.6, 2.6, rand, { width: 4.2, wobble: 0.2 });
  }
  return svg(106, 22, out, 'rating');
}

// A quick double underline.
export function drawUnderline(width: number, rand: Random): string {
  return svg(
    width,
    14,
    pen([[2, 8], [width * 0.45, 5.5], [width - 6, 7]], rand, { width: 2.2, wobble: 0.8, taper: 0.2 }) +
      pen([[width * 0.1, 11.5], [width * 0.6, 10]], rand, { width: 1, wobble: 0.5, taper: 0.4 }),
    'underline'
  );
}

// The ring a wet glass leaves on paper.
export function drawStain(rand: Random): string {
  const r = 48 + rand() * 10;
  return svg(
    150,
    150,
    handLoop(75, 75, r, r * 0.96, rand, { width: 5, wobble: 1.5 }) + handLoop(75, 75, r - 3, r * 0.93, rand, { width: 1.5, wobble: 1 }),
    'stain'
  );
}
