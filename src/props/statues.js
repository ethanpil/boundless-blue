// Sunken statuary: connected figures (limbs are tubes that start inside the torso/pelvis, with sphere joints
// at shoulders, elbows, hips and knees; hands and feet overlap their limbs), in many styles, materials
// (marble and limestone, red and black granite, sandstone, bronze with verdigris, gold), poses and damage
// states, plus fragments. Every figure rests on its plinth or on its own body, never on loose parts.
// makeStatue(kind, seed) builds one Template; the sunken cities generate the kinds their style needs.
import { Builder, TAU, vn3, sat, sstep, lerp, rotX, rotY, rotZ, mul3 } from './core.js';
import { stoneInto } from './shapes.js';
import { mulberry32 } from '../noise.js';

const STONE = [0.62, 0.58, 0.5], MARBLE = [0.8, 0.78, 0.74], BRONZE = [0.2, 0.36, 0.3], GOLDC = [0.75, 0.52, 0.22];
const GRANITE_R = [0.5, 0.28, 0.23], GRANITE_B = [0.22, 0.22, 0.24], SANDST = [0.72, 0.55, 0.38], LIMEST = [0.76, 0.72, 0.6], GREENSAND = [0.5, 0.5, 0.42];

// material: 'bronze' | 'gold' | an rgb stone colour
function mk(seed, mat = STONE) {
  const b = new Builder(), rng = mulberry32(seed * 7919 + 13), key = 6.05 + rng() * 0.9;
  const bronze = mat === 'bronze', gold = mat === 'gold', base = bronze ? BRONZE : gold ? GOLDC : mat;
  const mode = bronze ? 0 : gold ? 7 : key, grow = gold ? 0 : bronze ? 0.5 : 0.8;
  const tone = (x, y, z, o) => {
    const n = vn3(x * 4, y * 4, z * 4, seed);
    if (bronze) { // verdigris streaks running down the dark bronze
      const st = sstep(0.1, 0.7, vn3(x * 1.6, y * 5, z * 1.6, seed + 5));
      o[3] = base[0] * (0.7 + 0.3 * n) + st * 0.06; o[4] = base[1] * (0.75 + 0.3 * n) + st * 0.12; o[5] = base[2] * (0.75 + 0.3 * n) + st * 0.08;
    } else { const c = (gold ? 0.92 : 0.82) + (gold ? 0.1 : 0.22) * n; o[3] = base[0] * c; o[4] = base[1] * c; o[5] = base[2] * c; }
    o[6] = grow; o[7] = mode;
  };
  const paint = (v, a, x, y, z, o) => tone(x, y, z, o);
  const ball = (p, r, sx = 1, sy = 1, sz = 1, det = 1) => b.blob(det, (x, y, z, o) => {
    o[0] = p[0] + x * r * sx; o[1] = p[1] + y * r * sy; o[2] = p[2] + z * r * sz; tone(o[0], o[1], o[2], o);
  });
  // limb through joints; joints get spheres so segments read as one surface
  const limb = (pts, radii, joints = true) => {
    b.tube(pts, radii, 7, paint, { cap: true });
    if (joints) for (let i = 0; i < pts.length; i++) ball(pts[i], radii[i] * 1.04);
  };
  const block = (sx, sy, sz, R, x, y, z, p = 6) => {
    const v0 = b.vc;
    stoneInto(b, { sx, sy, sz, p, rough: 0.04, seed, detail: 2, col: base, growth: grow, mode });
    b.xform(v0, R || [1, 0, 0, 0, 1, 0, 0, 0, 1], x, y, z);
  };
  const lathe = (prof, rad, nu = 14, nv = 8) => b.lathe(nu, nv, prof, rad, paint);
  // carved head facing +z: brow ridge, eye sockets, nose, lips, chin, ears, a hair cap and an optional beard
  const face = (p, r, o = {}) => b.blob(3, (x, y, z, out) => {
    let px = x * 0.88, py = y * 1.12, pz = z * 0.98, dark = 0;
    if (z > 0) {
      pz += 0.1 * z * sstep(0.12, 0.3, y) * sstep(0.5, 0.36, y);                                     // brow
      const eye = Math.exp(-(((Math.abs(x) - 0.33) ** 2) + (y - 0.12) ** 2) / 0.012);
      pz -= 0.09 * eye; dark += 0.35 * eye;                                                         // sockets
      pz += 0.2 * Math.exp(-(x * x) / 0.01) * sstep(-0.32, 0.12, y) * sstep(0.2, 0.06, y);       // nose
      const lip = Math.exp(-(x * x) / 0.05) * Math.exp(-((y + 0.42) ** 2) / 0.004);
      pz += 0.03 * lip; dark += 0.25 * Math.exp(-(x * x) / 0.04) * Math.exp(-((y + 0.42) ** 2) / 0.0008);
      pz += 0.08 * z * sstep(-0.55, -0.72, y) * sstep(-0.95, -0.78, y);                            // chin
      if (o.smile) pz += 0.03 * Math.exp(-((Math.abs(x) - 0.2) ** 2) / 0.004) * Math.exp(-((y + 0.38) ** 2) / 0.004);
    }
    px *= 1 + 0.1 * Math.exp(-(z * z) / 0.03) * sstep(-0.2, 0.05, y) * sstep(0.35, 0.15, y);     // ears
    if (o.lobes) py -= 0.35 * Math.exp(-(z * z) / 0.02) * sstep(0.7, 0.95, Math.abs(x)) * sstep(0.1, -0.5, y); // long earlobes
    const hair = sstep(0.25, 0.55, y - 0.35 * z);                                                   // hair cap over the crown
    let bump = hair * (o.curls ? 0.06 * Math.abs(Math.sin(x * 14) * Math.sin(y * 13) * Math.sin(z * 12)) + 0.04 : 0.03);
    if (o.beard) { // full curly beard over the jaw and chin
      const bd = sstep(-0.1, -0.45, y) * sstep(-0.35, 0.15, z);
      pz += 0.22 * bd * Math.max(0, z); py -= 0.25 * bd * sstep(-0.5, -0.9, y);
      bump += bd * (0.05 + 0.06 * Math.abs(Math.sin(x * 12) * Math.sin(y * 15)));
    }
    if (o.ushnisha) py += 0.35 * sstep(0.75, 0.98, y);                                             // the Buddha's crown bump
    out[0] = p[0] + px * r * (1 + bump); out[1] = p[1] + py * r * (1 + bump); out[2] = p[2] + pz * r * (1 + bump);
    tone(out[0], out[1], out[2], out);
    out[3] *= 1 - dark; out[4] *= 1 - dark; out[5] *= 1 - dark;
  });
  // fresh break: a short jagged stump with lighter, unweathered stone at the fracture
  const stump = (p, d, r, len) => {
    const q = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
    b.tube([p, q], [r, r * 0.95], 7, paint);
    b.blob(1, (x, y, z, o) => {
      const j = 0.55 + 0.6 * Math.abs(vn3(x * 3 + seed, y * 3, z * 3, seed + 7));
      o[0] = q[0] + x * r * j; o[1] = q[1] + y * r * j; o[2] = q[2] + z * r * j;
      tone(o[0], o[1], o[2], o); o[3] *= 1.18; o[4] *= 1.18; o[5] *= 1.15; o[6] = 0.1;
    });
  };
  return { b, rng, limb, ball, block, lathe, paint, key, face, stump, base, bronze, gold };
}

// weathering: erosion pits and chipped edges displaced inward along the normal, pits darkened
function erode(b, seed, k = 1) {
  for (let i = 0; i < b.vc; i++) {
    const x = b.P[i * 3], y = b.P[i * 3 + 1], z = b.P[i * 3 + 2];
    const pit = sstep(0.62, 0.86, vn3(x * 7.3, y * 7.3, z * 7.3, seed + 21)), chip = sstep(0.68, 0.9, vn3(x * 2.2, y * 2.2, z * 2.2, seed + 33));
    const d = -(0.022 * pit + 0.035 * chip) * k;
    b.P[i * 3] += b.N[i * 3] * d; b.P[i * 3 + 1] += b.N[i * 3 + 1] * d; b.P[i * 3 + 2] += b.N[i * 3 + 2] * d;
    const c = 1 - 0.3 * pit * k + 0.08 * chip;
    b.C[i * 3] *= c; b.C[i * 3 + 1] *= c; b.C[i * 3 + 2] *= c;
  }
}

// normalise: lift so the lowest point is at y = 0 and centre in xz
function settle(b) {
  let mn = 1e9, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < b.P.length; i += 3) { mn = Math.min(mn, b.P[i + 1]); x0 = Math.min(x0, b.P[i]); x1 = Math.max(x1, b.P[i]); z0 = Math.min(z0, b.P[i + 2]); z1 = Math.max(z1, b.P[i + 2]); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < b.P.length; i += 3) { b.P[i] -= cx; b.P[i + 1] -= mn; b.P[i + 2] -= cz; }
}

// articulated human figure; pose angles in radians. Returns the joint table for attributes.
function human(F, o) {
  const { limb, ball, lathe, block } = F, k = o.slim ?? 1, H = o.h ?? 2;
  const s = H / 2, hipY = (o.seated ? 0.55 : o.kneel ? 0.62 : 1.0) * s, lean = o.lean ?? 0;
  const pel = [0, hipY, 0], chest = [0, hipY + 0.55 * s, lean], neck = [0, hipY + 0.72 * s, lean * 1.2];
  // torso: waist, ribcage and (male) pectorals, slightly flattened front/back
  const v0 = F.b.vc, pecs = o.female ? 0 : 0.06;
  lathe((v) => [s * (0.165 - 0.025 * Math.sin(v * Math.PI) + 0.075 * Math.pow(Math.max(0, (v - 0.35) / 0.65), 1.2) - 0.06 * Math.max(0, v - 0.88) / 0.12) * k, hipY - 0.06 * s + v * 0.7 * s],
    (a, v) => (1 - 0.22 * Math.abs(Math.sin(a))) * (1 + pecs * sstep(0.55, 0.75, v) * sstep(0.95, 0.8, v) * Math.max(0, Math.sin(a)) * (0.6 + 0.4 * Math.abs(Math.cos(2 * a)))));
  for (let i = v0; i < F.b.vc; i++) F.b.P[i * 3 + 2] += lean * sat((F.b.P[i * 3 + 1] - hipY) / (0.6 * s));
  ball(pel, 0.17 * s * k, 1.15, 0.8, 0.9);
  ball(chest, 0.19 * s * k, 1.3, 0.75, 0.72);
  if (o.female) for (const sd of [-1, 1]) ball([sd * 0.075 * s * k, hipY + 0.5 * s, lean + 0.11 * s], 0.065 * s);
  if (o.belly) ball([0, hipY + 0.25 * s, 0.07 * s], 0.2 * s * k, 1.1, 0.95, 1);
  const headC = [0, neck[1] + 0.19 * s, neck[2] + 0.01 * s];
  if (!o.headless) {
    limb([neck, [0, neck[1] + 0.08 * s, neck[2]]], [0.06 * s, 0.06 * s]);
    if (o.blockHead) block(0.26 * s, 0.32 * s, 0.26 * s, null, 0, neck[1] + 0.22 * s, neck[2], 4);
    else F.face(headC, 0.115 * s, { curls: o.curls, beard: o.beard, ushnisha: o.ushnisha, lobes: o.lobes, smile: o.smile });
    if (o.helmet) { // a Corinthian helmet pushed back on the head, with a crest
      ball([0, headC[1] + 0.06 * s, headC[2] - 0.02 * s], 0.13 * s, 1, 0.85, 1.1);
      F.limb([[0, headC[1] + 0.15 * s, headC[2] + 0.08 * s], [0, headC[1] + 0.2 * s, headC[2] - 0.05 * s], [0, headC[1] + 0.12 * s, headC[2] - 0.2 * s]], [0.025 * s, 0.035 * s, 0.025 * s], false);
    }
  } else F.stump(neck, [0, 1, 0], 0.062 * s, 0.07 * s);
  const shY = hipY + 0.6 * s, J = { s, hipY, neck, shY, chest, head: headC, hands: {} };
  for (const sd of [-1, 1]) {
    if (o.missingArm === sd) { F.stump([sd * 0.2 * s * k, shY, chest[2]], [sd * 0.8, -0.6, 0], 0.07 * s, 0.06 * s); continue; }
    const sh = [sd * 0.22 * s * k, shY, chest[2]];
    const a = o.arms?.(sd) || { up: 0, fwd: 0.05, elbow: 0.1, out: 0.12 };
    const ua = [Math.sin(a.out) * sd, -Math.cos(a.up), Math.sin(a.fwd)], l1 = 0.3 * s;
    const n1 = Math.hypot(...ua); const el = [sh[0] + ua[0] / n1 * l1, sh[1] + ua[1] / n1 * l1, sh[2] + ua[2] / n1 * l1];
    const fa = [ua[0] / n1 * Math.cos(a.elbow), ua[1] / n1 * Math.cos(a.elbow) + Math.sin(a.elbow) * (a.up > 1.5 ? -0.2 : 0.8), ua[2] / n1 + Math.sin(a.elbow) * 0.9];
    const n2 = Math.hypot(...fa), wr = [el[0] + fa[0] / n2 * 0.27 * s, el[1] + fa[1] / n2 * 0.27 * s, el[2] + fa[2] / n2 * 0.27 * s];
    limb([sh, el, wr], [0.072 * s * k, 0.056 * s * k, 0.045 * s * k]);
    // the hand, overlapping the wrist and carried along the forearm
    const hd = [wr[0] + fa[0] / n2 * 0.06 * s, wr[1] + fa[1] / n2 * 0.06 * s, wr[2] + fa[2] / n2 * 0.06 * s];
    ball(hd, 0.055 * s, 0.75, 1.15, 0.65);
    J.hands[sd] = hd; J['el' + sd] = el;
  }
  for (const sd of [-1, 1]) {
    const hip = [sd * 0.1 * s * k * (o.wide ? 1.4 : 1), hipY - 0.03 * s, 0];
    let kn, an;
    if (o.seated) { kn = [hip[0], hipY + 0.02 * s, 0.42 * s]; an = [hip[0], 0.06 * s, 0.45 * s]; }
    else if (o.kneel) { kn = [hip[0], 0.06 * s, 0.12 * s]; an = [hip[0], 0.06 * s, -0.3 * s]; }
    else {
      const f = o.stride ? (sd === o.stride ? 0.12 : -0.05) : 0, bend = o.contra === sd ? 0.08 : 0, wide = o.wide ? 0.1 * s * sd : 0;
      kn = [hip[0] * 1.05 + wide * 0.5, hipY * 0.52, f * s + bend * s]; an = [hip[0] * 1.08 + wide, 0.08 * s, f * 1.6 * s];
    }
    if (o.brokenLegs) { F.stump(hip, [0, -1, 0.1], 0.09 * s * k, (hip[1] - kn[1]) * 0.5); continue; }
    limb([hip, kn, an], [0.105 * s * k, 0.07 * s * k, 0.05 * s * k]);
    if (!o.noFeet) block(0.11 * s, 0.08 * s, 0.25 * s, null, an[0], an[1] - 0.035 * s, an[2] + 0.07 * s, 5); // the foot, around the ankle
  }
  return J;
}

// back pillar of Egyptian standing statues (also what keeps them standing): plinth to the shoulders
const backPillar = (F, J, w = 0.42) => F.block(w * J.s, J.shY + 0.1 * J.s, 0.22 * J.s, null, 0, (J.shY + 0.1 * J.s) / 2, -0.17 * J.s, 6);
const nemes = (F, J) => { // the striped royal headcloth with its lappets
  const hy = J.head[1];
  F.lathe((v) => [J.s * (0.12 + 0.12 * v), hy + 0.13 * J.s - v * 0.32 * J.s], (a) => 1 + 0.4 * Math.max(0, -Math.sin(a)) - 0.1 * Math.abs(Math.cos(a)), 14, 4);
  for (const sd of [-1, 1]) F.block(0.07 * J.s, 0.3 * J.s, 0.05 * J.s, null, sd * 0.12 * J.s, hy - 0.25 * J.s, 0.1 * J.s, 6);
};
const plinthBlock = (F, w, h, d, rng) => F.block(w, h + 0.12, d, rotY((rng() - 0.5) * 0.1), 0, h / 2 - 0.1, 0.05, 8);

// --- kinds ---
const MATS = {
  kouros: [MARBLE, LIMEST], kore: [MARBLE, LIMEST], roman: [MARBLE, STONE], orator: [MARBLE, STONE], bronze: ['bronze'], poseidon: ['bronze', MARBLE, 'bronze'],
  triton: [MARBLE, STONE, 'bronze'], pharaoh: [GRANITE_R, GRANITE_B, SANDST], striding: [GRANITE_B, GRANITE_R, SANDST], hapi: [GRANITE_R], queen: [GRANITE_B, GRANITE_R],
  sphinx: [SANDST, GRANITE_R, LIMEST], falcon: [GRANITE_B, SANDST], meso: [LIMEST, STONE], chacmool: [LIMEST], jaguar: [[0.55, 0.22, 0.16]], serpent: [LIMEST, STONE],
  moai: [[0.45, 0.42, 0.4]], buddha: [GREENSAND, STONE, 'gold'], dvarapala: [GREENSAND, SANDST], guardian: [[0.5, 0.5, 0.52]], lion: [[0.5, 0.5, 0.52], GREENSAND, SANDST],
  snakegoddess: [[0.82, 0.76, 0.62]], bull: ['bronze', STONE], seahorse: [MARBLE, [0.3, 0.5, 0.52]], fragment: [MARBLE, STONE],
};
export const STATUE_KINDS = Object.keys(MATS);
const HUMAN_DMG = new Set(['kouros', 'kore', 'roman', 'orator', 'bronze', 'meso', 'striding', 'queen', 'dvarapala', 'guardian', 'snakegoddess']);

export function makeStatue(style, seed) {
  const mats = MATS[style] || [STONE], mrng = mulberry32(seed * 131 + 7), mat = mats[(mrng() * mats.length) | 0];
  const F = mk(seed, mat), { b, rng } = F;
  const dmg = HUMAN_DMG.has(style) ? rng() : 1;
  const headless = dmg < 0.13, missingArm = dmg > 0.13 && dmg < 0.35 ? (rng() < 0.5 ? -1 : 1) : 0, brokenLegs = dmg > 0.88 && style !== 'snakegoddess';
  let name = 'Stone statue', plinth = true, fall = rng(), noFall = false, pw = 0.85, ph = 0.35;
  if (style === 'kore') { // draped maiden: ankle-length chiton with deep vertical folds, a himation over one shoulder
    const J = human(F, { h: 1.7 + rng() * 0.5, slim: 0.85, female: true, headless, missingArm, curls: true, smile: true, noFeet: true, arms: (sd) => (sd === 1 ? { up: 0.5, fwd: 0.9, elbow: 1.1, out: 0.2 } : { up: 0.05, fwd: 0.05, elbow: 0.15, out: 0.1 }) });
    const folds = 11 + Math.floor(rng() * 6), top = J.hipY + 0.5 * J.s;
    F.lathe((v) => [J.s * (0.19 + 0.12 * v * v), top - v * (top + 0.02)], (a, v) => 1 + 0.09 * Math.sin(a * folds + v * 2) * (0.3 + v) - 0.14 * Math.abs(Math.sin(a)) * (1 - v), 20, 9);
    F.lathe((v) => [J.s * (0.215 + 0.04 * v), J.shY - v * 0.55 * J.s], (a, v) => 1 + 0.06 * Math.sin(a * 7 - v * 5) - 0.15 * Math.abs(Math.sin(a)), 16, 5);
    name = headless ? 'Headless kore' : 'Kore (draped maiden)';
  } else if (style === 'kouros' || style === 'orator' || style === 'roman' || style === 'bronze') {
    const pose = rng(), war = style === 'bronze';
    const arms = style === 'orator' ? (sd) => (sd === 1 ? { up: 2.2, fwd: 0.9, elbow: 0.3, out: 0.3 } : { up: 0.1, fwd: 0.1, elbow: 1.2, out: 0.1 })
      : war ? (sd) => (sd === 1 ? { up: 2.0 + rng() * 0.4, fwd: 0.4, elbow: 0.7, out: 0.4 } : { up: 0.5, fwd: 1.2, elbow: 1.5, out: 0.25 })
        : pose < 0.3 ? () => ({ up: 0.05, fwd: 0.05, elbow: 0.05, out: 0.08 })
          : pose < 0.55 ? (sd) => (sd === 1 ? { up: 0.3, fwd: 0.2, elbow: 1.4, out: 0.5 } : { up: 0.1, fwd: 0.1, elbow: 0.2, out: 0.1 })
            : pose < 0.75 ? () => ({ up: 2.6, fwd: 0.3, elbow: 0.4, out: 0.5 })
              : () => ({ up: 1.2, fwd: 1.2, elbow: 0.5, out: 0.2 });
    const kneel = pose > 0.9 && style === 'kouros';
    const J = human(F, { h: (war ? 2.0 : 1.8) + rng() * 0.6, slim: style === 'kouros' ? 0.9 : 1.05, stride: style === 'kouros' ? -1 : 0, contra: style !== 'kouros' ? 1 : 0, arms, headless, missingArm, brokenLegs, kneel, curls: style !== 'roman', beard: war || (style === 'orator' && rng() < 0.6), helmet: war && rng() < 0.6, lean: (rng() - 0.5) * 0.06 });
    if (war && missingArm !== -1 && J.hands[-1]) { // a round shield on the bent left arm
      const h = J.hands[-1], v0 = b.vc;
      F.lathe((v) => [0.36 * J.s * (1 - v * v * 0.15), v * 0.06 * J.s], null, 16, 2);
      b.xform(v0, rotX(Math.PI / 2 - 0.3), h[0] - 0.08 * J.s, h[1], h[2] + 0.02 * J.s);
    }
    if (style === 'orator' && !brokenLegs) { // himation wrapped from the left shoulder to the knees, diagonal folds
      F.lathe((v) => [J.s * (0.23 + 0.05 * v), J.shY + 0.02 * J.s - v * (J.shY - J.hipY * 0.5)], (a, v) => 1 + 0.08 * Math.sin(a * 9 + v * 6 + a * v * 3) - 0.16 * Math.abs(Math.sin(a)), 18, 8);
    }
    if (style === 'roman') { // draped robe to the plinth with folds, and a toga sash
      const folds = 9 + Math.floor(rng() * 7), top = J.hipY + 0.45 * J.s;
      F.lathe((v) => [J.s * (0.2 + 0.1 * v) * (1 + 0.05 * Math.sin(v * 7)), top - v * (top + 0.02)], (a, v) => 1 + 0.07 * Math.sin(a * folds + v * 3) * (0.4 + v) - 0.12 * Math.abs(Math.sin(a)) * (1 - v), 18, 8);
      F.limb([[0.19 * J.s, J.shY, 0.03], [0, J.hipY + 0.3 * J.s, 0.17 * J.s], [-0.17 * J.s, J.hipY + 0.05 * J.s, 0.1 * J.s]], [0.07 * J.s, 0.08 * J.s, 0.07 * J.s]);
      name = headless ? 'Headless Roman statue' : 'Roman draped statue';
    } else name = war ? (F.bronze ? 'Bronze warrior' : 'Warrior statue') : style === 'orator' ? 'Orator statue' : kneel ? 'Kneeling figure' : headless ? 'Headless kouros' : missingArm ? 'Kouros statue (arm lost)' : 'Kouros statue';
    if (brokenLegs) { name = F.bronze ? 'Bronze torso' : 'Statue torso'; plinth = false; }
  } else if (style === 'poseidon') { // the sea god: bearded, a cloak at the hips, trident raised
    const J = human(F, { h: 2.3 + rng() * 0.4, slim: 1.08, contra: 1, beard: true, curls: true, arms: (sd) => (sd === 1 ? { up: 2.5, fwd: 0.2, elbow: 0.25, out: 0.45 } : { up: 1.35, fwd: 0.5, elbow: 0.25, out: 0.9 }) });
    F.lathe((v) => [J.s * (0.2 + 0.07 * v), J.hipY + 0.08 * J.s - v * 0.62 * J.s], (a, v) => 1 + 0.08 * Math.sin(a * 8 + v * 4) - 0.12 * Math.abs(Math.sin(a)), 16, 5);
    const h = J.hands[1];
    if (h) { // the trident through the raised fist
      F.limb([[h[0], h[1] - 1.1 * J.s, h[2]], [h[0], h[1] + 0.9 * J.s, h[2]]], [0.025 * J.s, 0.025 * J.s], false);
      F.limb([[h[0] - 0.16 * J.s, h[1] + 0.85 * J.s, h[2]], [h[0], h[1] + 0.78 * J.s, h[2]], [h[0] + 0.16 * J.s, h[1] + 0.85 * J.s, h[2]]], [0.02 * J.s, 0.025 * J.s, 0.02 * J.s], false);
      for (const dx of [-0.16, 0, 0.16]) F.limb([[h[0] + dx * J.s, h[1] + (dx ? 0.84 : 0.88) * J.s, h[2]], [h[0] + dx * 1.05 * J.s, h[1] + 1.12 * J.s, h[2]]], [0.018 * J.s, 0.006 * J.s], false);
    }
    name = F.gold ? 'Golden Poseidon' : F.bronze ? 'Bronze Poseidon' : 'Statue of Poseidon';
  } else if (style === 'triton') { // merman: a bearded torso on a coiling fish tail, a conch raised to his lips
    const s = 1.0 + rng() * 0.35;
    F.block(1.4 * s, 0.5 * s, 1.1 * s, null, 0, 0.25 * s, 0, 4); // the rock he coils on
    const J = human(F, { h: 2.2 * s, slim: 1.05, beard: true, curls: true, brokenLegs: false, noFeet: true, arms: (sd) => (sd === 1 ? { up: 1.9, fwd: 1.2, elbow: 2.0, out: 0.1 } : { up: 0.3, fwd: 0.2, elbow: 1.2, out: 0.5 }) });
    // remove the legs' visual weight by wrapping them in the tail: a tapering spiral from the hips around the rock
    const pts = [], rad = [];
    for (let k = 0; k <= 14; k++) { const t = k / 14, a = t * TAU * 0.95, rr = 0.35 * s * (1 - 0.35 * t); pts.push([Math.sin(a) * rr, J.hipY * (1 - t) + 0.5 * s * t + 0.05 * s, Math.cos(a) * rr * 0.9 - 0.05 * s]); rad.push(0.16 * s * (1 - 0.7 * t) + 0.03 * s); }
    F.limb(pts, rad, false);
    const e = pts[pts.length - 1]; // the tail fin
    for (const sd of [-1, 1]) F.ball([e[0] + sd * 0.16 * s, e[1] + 0.08 * s, e[2]], 0.17 * s, 1.1, 0.25, 0.7);
    if (J.hands[1]) { const h = J.hands[1], v0 = b.vc; F.lathe((v) => [0.07 * s * (1 - v * 0.8) + 0.02 * s, v * 0.32 * s], (a, v) => 1 + 0.25 * Math.abs(Math.sin(a * 3 + v * 9)), 10, 4); b.xform(v0, rotZ(1.3), h[0] + 0.05 * s, h[1] + 0.02 * s, h[2] + 0.04 * s); } // the conch
    name = 'Triton'; plinth = false; noFall = true;
  } else if (style === 'pharaoh') {
    const J = human(F, { h: 2.2 + rng() * 0.8, seated: true, slim: 1.1, arms: () => ({ up: 0.35, fwd: 0.9, elbow: 1.2, out: 0.05 }) });
    F.block(0.95 * J.s, 0.62 * J.s, 0.95 * J.s, null, 0, 0.31 * J.s, -0.03 * J.s, 8);    // throne seat
    F.block(0.95 * J.s, 1.3 * J.s, 0.18 * J.s, null, 0, 0.65 * J.s, -0.42 * J.s, 8);   // throne back
    F.block(1.1 * J.s, 0.12 * J.s, 1.3 * J.s, null, 0, 0.0, 0.12 * J.s, 6);             // footrest base under the throne and feet
    nemes(F, J);
    name = 'Seated pharaoh statue'; plinth = false;
  } else if (style === 'striding' || style === 'queen' || style === 'hapi') { // Egyptian standing figures with a back pillar
    const queen = style === 'queen', hapi = style === 'hapi';
    const J = human(F, { h: (hapi ? 2.4 : 2.2) + rng() * 0.6, slim: hapi ? 1.35 : queen ? 0.85 : 1.05, female: queen, belly: hapi, stride: -1, headless: headless && !hapi, missingArm: hapi ? 0 : missingArm,
      arms: hapi ? () => ({ up: 0.6, fwd: 1.3, elbow: 1.2, out: 0.05 }) : queen ? (sd) => (sd === 1 ? { up: 0.5, fwd: 0.6, elbow: 1.9, out: 0.1 } : { up: 0.02, fwd: 0.05, elbow: 0.05, out: 0.04 }) : () => ({ up: 0.02, fwd: 0.05, elbow: 0.05, out: 0.04 }) });
    backPillar(F, J);
    if (queen) { // the sheath dress to the ankles and a heavy tripartite wig
      F.lathe((v) => [J.s * (0.17 + 0.03 * Math.sin(v * Math.PI)), J.shY - 0.05 * J.s - v * (J.shY - 0.08 * J.s)], (a) => 1 - 0.18 * Math.abs(Math.sin(a)), 16, 7);
      F.lathe((v) => [J.s * (0.14 + 0.05 * v), J.head[1] + 0.13 * J.s - v * 0.42 * J.s], (a) => 1 + 0.25 * Math.max(0, -Math.sin(a)), 14, 4);
      name = 'Ptolemaic queen as Isis';
    } else {
      F.lathe((v) => [J.s * (0.2 + 0.08 * v), J.hipY + 0.05 * J.s - v * 0.4 * J.s], (a, v) => 1 + 0.05 * Math.sin(a * 20) * v - 0.1 * Math.abs(Math.sin(a)), 20, 3); // pleated kilt
      if (hapi) { F.block(0.5 * J.s, 0.06 * J.s, 0.3 * J.s, null, 0, J.hipY + 0.38 * J.s, 0.38 * J.s, 4); for (let k = 0; k < 5; k++) F.limb([[(-0.08 + k * 0.04) * J.s, J.head[1] + 0.08 * J.s, J.head[2]], [(-0.12 + k * 0.06) * J.s, J.head[1] + 0.32 * J.s, J.head[2] + 0.02 * J.s]], [0.015 * J.s, 0.03 * J.s], false); name = 'Hapi, god of the Nile flood'; }
      else { nemes(F, J); name = headless ? 'Headless pharaoh' : 'Striding pharaoh'; }
    }
    pw = 0.55 * J.s * 2; ph = 0.3;
  } else if (style === 'meso') {
    const J = human(F, { h: 1.6 + rng() * 0.6, slim: 1.35, blockHead: true, arms: () => ({ up: 0.4, fwd: 1.0, elbow: 1.3, out: 0.05 }), headless, missingArm });
    F.block(0.55 * J.s, 0.22 * J.s, 0.32 * J.s, null, 0, J.neck[1] + 0.45 * J.s, 0, 3);  // headdress
    F.block(0.5 * J.s, 0.5 * J.s, 0.06 * J.s, null, 0, J.hipY + 0.35 * J.s, 0.18 * J.s, 4); // chest plaque
    name = 'Maya stone figure';
  } else if (style === 'chacmool') { // reclining on its elbows, knees up, head turned, a dish on its belly
    const s = 1.0 + rng() * 0.3;
    F.block(1.0 * s, 0.25 * s, 1.9 * s, null, 0, 0.12 * s, 0.05 * s, 4);
    const pel = [0, 0.38 * s, 0], ch = [0, 0.78 * s, -0.42 * s];
    F.limb([pel, ch], [0.2 * s, 0.21 * s]);
    for (const sd of [-1, 1]) {
      F.limb([[sd * 0.12 * s, 0.36 * s, 0.05 * s], [sd * 0.13 * s, 0.78 * s, 0.42 * s], [sd * 0.13 * s, 0.3 * s, 0.75 * s]], [0.09 * s, 0.07 * s, 0.055 * s]);
      F.block(0.11 * s, 0.1 * s, 0.24 * s, null, sd * 0.13 * s, 0.3 * s, 0.82 * s, 5);
      F.limb([[sd * 0.22 * s, 0.86 * s, -0.42 * s], [sd * 0.3 * s, 0.32 * s, -0.48 * s], [sd * 0.1 * s, 0.6 * s, 0.05 * s]], [0.06 * s, 0.05 * s, 0.045 * s]);
    }
    F.lathe((v) => [0.2 * s * Math.sin(v * Math.PI * 0.5) + 0.02 * s, 0.6 * s + v * 0.12 * s], null, 12, 3); // the offering dish
    const v0 = b.vc; F.face([0, 0, 0], 0.13 * s, {}); b.xform(v0, rotY(Math.PI / 2), 0, 1.02 * s, -0.5 * s);
    F.block(0.3 * s, 0.12 * s, 0.32 * s, null, 0, 1.15 * s, -0.5 * s, 3);
    name = 'Chac Mool'; plinth = false; noFall = true;
  } else if (style === 'jaguar') { // the red jaguar throne, spotted with jade
    const s = 1 + rng() * 0.3;
    F.block(0.8 * s, 0.25 * s, 1.9 * s, null, 0, 0.12 * s, 0, 4);
    F.limb([[0, 0.62 * s, -0.6 * s], [0, 0.66 * s, 0.1 * s], [0, 0.7 * s, 0.55 * s]], [0.25 * s, 0.27 * s, 0.24 * s]);
    for (const sd of [-1, 1]) for (const z of [-0.6, 0.55]) F.limb([[sd * 0.15 * s, 0.6 * s, z * s], [sd * 0.17 * s, 0.3 * s, (z + 0.05) * s], [sd * 0.17 * s, 0.2 * s, (z + 0.12) * s]], [0.09 * s, 0.07 * s, 0.07 * s]);
    F.ball([0, 0.92 * s, 0.82 * s], 0.24 * s, 1, 0.9, 1);
    for (const sd of [-1, 1]) F.ball([sd * 0.15 * s, 1.1 * s, 0.75 * s], 0.06 * s, 1, 1, 0.5);
    F.limb([[0, 0.65 * s, -0.8 * s], [0, 0.4 * s, -1.0 * s], [0, 0.22 * s, -0.85 * s]], [0.06 * s, 0.05 * s, 0.04 * s], false);
    for (let i = 0; i < b.vc; i++) { const x = b.P[i * 3], y = b.P[i * 3 + 1], z = b.P[i * 3 + 2]; if (y > 0.3 * s && vn3(x * 9, y * 9, z * 9, seed) > 0.45) { b.C[i * 3] = 0.15; b.C[i * 3 + 1] = 0.35; b.C[i * 3 + 2] = 0.22; } }
    name = 'Jaguar throne'; plinth = false; noFall = true;
  } else if (style === 'serpent') { // feathered serpent head, jaws open, lying where the balustrade fell
    const s = 1 + rng() * 0.5;
    b.blob(3, (x, y, z, o) => {
      let px = x * 0.5 * s, py = y * 0.42 * s, pz = z * 0.75 * s;
      if (py < -0.1 * s) py = -0.1 * s + (py + 0.1 * s) * 0.3;
      const scale = 1 + 0.05 * Math.abs(Math.sin(x * 9) * Math.sin(z * 9));
      o[0] = px * scale; o[1] = py * scale + 0.42 * s; o[2] = pz * scale; F.paint(0, 0, o[0], o[1], o[2], o);
    });
    F.block(0.85 * s, 0.22 * s, 0.75 * s, rotX(0.35), 0, 0.2 * s, 0.75 * s, 4); // the lower jaw dropped open
    for (const sd of [-1, 1]) { F.limb([[sd * 0.25 * s, 0.32 * s, 0.82 * s], [sd * 0.24 * s, 0.12 * s, 0.86 * s]], [0.05 * s, 0.01 * s], false); F.ball([sd * 0.28 * s, 0.72 * s, 0.35 * s], 0.09 * s); }
    for (let k = 0; k < 5; k++) F.block(0.85 * s, 0.35 * s, 0.12 * s, rotX(-0.5), 0, 0.85 * s, (-0.45 + k * 0.17) * s, 3); // feathered crest
    name = 'Feathered serpent head'; plinth = false; noFall = true;
  } else if (style === 'moai') {
    const s = 1 + rng() * 0.6;
    F.block(1.1 * s, 1.5 * s, 0.75 * s, null, 0, 0.75 * s, 0, 4);
    b.blob(4, (x, y, z, o) => {
      const px = x * 0.5 * s, pz0 = z * 0.45 * s;
      let py = y * 1.0 * s, pz = pz0;
      if (z > 0) { pz += 0.18 * s * Math.exp(-(x * x) / 0.015) * sat((y + 0.2) * 2) * sat((0.6 - y) * 3); pz += 0.08 * s * sat((y - 0.25) * 6) * sat((0.55 - y) * 6); }
      py = py > 0.85 * s ? 0.85 * s + (py - 0.85 * s) * 0.2 : py;
      o[0] = px; o[1] = py + 2.35 * s; o[2] = pz; F.paint(0, 0, o[0], o[1], o[2], o);
    });
    name = 'Moai'; plinth = false;
  } else if (style === 'sphinx') { // lion body on its plinth, the king's head in the nemes
    const s = 0.9 + rng() * 0.6;
    F.block(0.95 * s, 0.32 * s, 3.1 * s, null, 0, 0.06 * s, 0.25 * s, 6);
    F.limb([[0, 0.5 * s, -0.9 * s], [0, 0.55 * s, 0], [0, 0.57 * s, 0.7 * s]], [0.36 * s, 0.4 * s, 0.38 * s]);           // body
    for (const sd of [-1, 1]) {
      F.limb([[sd * 0.25 * s, 0.48 * s, 0.75 * s], [sd * 0.25 * s, 0.22 * s, 1.0 * s], [sd * 0.25 * s, 0.2 * s, 1.45 * s]], [0.13 * s, 0.11 * s, 0.1 * s]); // forelegs
      F.ball([sd * 0.3 * s, 0.38 * s, -0.8 * s], 0.33 * s, 0.7, 0.9, 1.2);                                               // haunch
    }
    F.limb([[0, 0.8 * s, 0.75 * s], [0, 1.2 * s, 0.95 * s]], [0.2 * s, 0.17 * s]);                                    // neck
    if (!headless && rng() > 0.25) {
      F.face([0, 1.38 * s, 1.0 * s], 0.2 * s, {});
      F.lathe((v) => [s * (0.17 + 0.18 * v), 1.58 * s - v * 0.45 * s], (a) => 1 + 0.35 * Math.max(0, -Math.sin(a)), 12, 3);
      name = 'Sphinx';
    } else name = 'Headless sphinx';
    plinth = false; noFall = true;
  } else if (style === 'falcon') { // Horus falcon wearing the double crown
    const s = 1 + rng() * 0.4;
    F.block(0.7 * s, 0.4 * s, 0.9 * s, null, 0, 0.12 * s, 0, 4);
    F.ball([0, 0.85 * s, 0], 0.32 * s, 0.85, 1.3, 0.95);
    for (const sd of [-1, 1]) { F.ball([sd * 0.22 * s, 0.8 * s, -0.08 * s], 0.3 * s, 0.35, 1.2, 0.9); F.limb([[sd * 0.1 * s, 0.5 * s, 0.05 * s], [sd * 0.1 * s, 0.3 * s, 0.1 * s]], [0.06 * s, 0.05 * s]); }
    F.block(0.25 * s, 0.55 * s, 0.12 * s, rotX(-0.35), 0, 0.55 * s, -0.3 * s, 3); // tail
    F.ball([0, 1.35 * s, 0.05 * s], 0.2 * s);
    F.limb([[0, 1.35 * s, 0.2 * s], [0, 1.3 * s, 0.3 * s], [0, 1.22 * s, 0.32 * s]], [0.06 * s, 0.04 * s, 0.015 * s], false); // hooked beak
    F.lathe((v) => [0.2 * s * (1 - 0.15 * v), 1.48 * s + v * 0.18 * s], null, 12, 1);
    F.lathe((v) => [0.12 * s * (1 - 0.5 * v * v), 1.64 * s + v * 0.35 * s], null, 12, 3);
    name = 'Horus falcon'; plinth = false; noFall = true;
  } else if (style === 'buddha') { // seated in meditation, robe over one shoulder; in Khmer cities sheltered by the naga
    const J = human(F, { h: 2.0 + rng() * 0.3, seated: true, slim: 1.05, ushnisha: true, lobes: true, curls: true, smile: true, noFeet: true, arms: () => ({ up: 0.4, fwd: 0.9, elbow: 1.35, out: 0.15 }) });
    for (const sd of [-1, 1]) F.limb([[sd * 0.32 * J.s, 0.16 * J.s, 0.32 * J.s], [0, 0.18 * J.s, 0.48 * J.s], [-sd * 0.3 * J.s, 0.14 * J.s, 0.25 * J.s]], [0.11 * J.s, 0.1 * J.s, 0.09 * J.s]); // crossed legs
    F.lathe((v) => [J.s * (0.5 - 0.1 * v), v * 0.2 * J.s], (a) => 1 + 0.05 * Math.sin(a * 16), 18, 2); // the folds of the robe on the seat
    F.lathe((v) => [J.s * (0.2 + 0.03 * v), J.shY + 0.02 * J.s - v * 0.55 * J.s], (a, v) => 1 + 0.05 * Math.sin(a * 9 - v * 4) - 0.14 * Math.abs(Math.sin(a)), 16, 5);
    if (rng() < 0.45) { // Mucalinda: coils as a seat and a fan of seven hoods behind the head
      for (let k = 0; k < 3; k++) F.lathe((v) => [J.s * (0.62 - k * 0.05) + 0.12 * J.s * Math.sin(v * Math.PI), -0.36 * J.s + k * 0.13 * J.s + v * 0.14 * J.s], null, 18, 3);
      F.limb([[0, 0.1 * J.s, -0.55 * J.s], [0, J.shY * 0.9, -0.42 * J.s], [0, J.head[1] + 0.1 * J.s, -0.3 * J.s]], [0.13 * J.s, 0.12 * J.s, 0.1 * J.s], false);
      for (let k = 0; k < 7; k++) { const a = -1.2 + 2.4 * k / 6, c = [Math.sin(a) * 0.32 * J.s, J.head[1] + 0.15 * J.s + Math.cos(a) * 0.3 * J.s, -0.24 * J.s]; F.limb([[0, J.head[1] + 0.05 * J.s, -0.3 * J.s], c, [c[0] * 1.05, c[1] + 0.05 * J.s, c[2] + 0.12 * J.s]], [0.06 * J.s, 0.055 * J.s, 0.045 * J.s], false); }
      name = 'Buddha sheltered by the naga';
    } else name = F.gold ? 'Golden Buddha' : 'Seated Buddha';
    plinth = true; pw = 1.3 * J.s; ph = 0.35; noFall = true;
  } else if (style === 'dvarapala' || style === 'guardian') { // temple guardian leaning on a club / armoured warrior with a sword
    const club = style === 'dvarapala';
    const J = human(F, { h: 2.1 + rng() * 0.5, slim: 1.25, wide: true, beard: !club, headless, missingArm: 0, arms: () => ({ up: 0.45, fwd: 1.0, elbow: 0.7, out: 0.0 }) });
    const h = J.hands[1] || J.hands[-1];
    if (h) {
      const x = 0, z = (h[2] + (J.hands[-1] || h)[2]) / 2 + 0.03 * J.s;
      if (club) F.limb([[x, 0.05 * J.s, z + 0.25 * J.s], [x, h[1] + 0.1 * J.s, z]], [0.1 * J.s, 0.05 * J.s], false);
      else F.block(0.08 * J.s, h[1] + 0.05 * J.s, 0.03 * J.s, null, x, (h[1] + 0.05 * J.s) / 2, z, 4);
    }
    F.lathe((v) => [J.s * (0.22 + 0.06 * v), J.hipY + 0.05 * J.s - v * 0.35 * J.s], (a) => 1 - 0.1 * Math.abs(Math.sin(a)), 14, 3);
    if (club) F.lathe((v) => [J.s * 0.12 * (1 - v * 0.75), J.head[1] + 0.06 * J.s + v * 0.32 * J.s], (a, v) => 1 + 0.1 * Math.abs(Math.sin(a * 6 + v * 5)), 12, 4); // conical crown
    else { F.lathe((v) => [J.s * (0.25 - 0.05 * v), J.shY - v * 0.4 * J.s], (a) => 1 - 0.12 * Math.abs(Math.sin(a)), 14, 3); F.ball([0, J.head[1] + 0.05 * J.s, J.head[2]], 0.135 * J.s, 1, 0.9, 1); }
    name = club ? 'Dvarapala (temple guardian)' : 'Guardian warrior';
  } else if (style === 'lion') { // seated guardian lion, one paw on a ball
    const s = 0.9 + rng() * 0.4;
    F.block(0.9 * s, 0.25 * s, 1.35 * s, null, 0, 0.12 * s, 0.05 * s, 6);
    for (const sd of [-1, 1]) { F.ball([sd * 0.22 * s, 0.48 * s, -0.25 * s], 0.28 * s, 0.75, 0.9, 1.1); F.limb([[sd * 0.18 * s, 0.85 * s, 0.25 * s], [sd * 0.18 * s, 0.5 * s, 0.35 * s], [sd * 0.18 * s, 0.28 * s, 0.4 * s]], [0.1 * s, 0.08 * s, 0.08 * s]); }
    F.limb([[0, 0.5 * s, -0.25 * s], [0, 0.9 * s, 0.1 * s], [0, 1.05 * s, 0.22 * s]], [0.3 * s, 0.27 * s, 0.24 * s]);
    b.blob(2, (x, y, z, o) => { const r = 0.32 * s * (1 + 0.12 * Math.abs(Math.sin(x * 10) * Math.sin(y * 10) * Math.sin(z * 10))); o[0] = x * r; o[1] = 1.32 * s + y * r * 0.95; o[2] = 0.28 * s + z * r; F.paint(0, 0, o[0], o[1], o[2], o); }); // maned head
    F.ball([0, 1.25 * s, 0.56 * s], 0.13 * s, 1.2, 0.8, 0.9); // muzzle
    if (rng() < 0.6) F.ball([0.18 * s, 0.37 * s, 0.55 * s], 0.13 * s);
    name = 'Guardian lion'; plinth = false; noFall = true;
  } else if (style === 'snakegoddess') { // flounced bell skirt, arms raised holding snakes, a tall headdress
    const J = human(F, { h: 1.6 + rng() * 0.4, slim: 0.82, female: true, curls: true, noFeet: true, missingArm, headless, arms: () => ({ up: 1.45, fwd: 0.25, elbow: -0.6, out: 0.55 }) });
    for (let k = 0; k < 5; k++) F.lathe((v) => [J.s * (0.2 + k * 0.05 + 0.04 * v), J.hipY + 0.05 * J.s - (k + v) * (J.hipY + 0.06 * J.s) / 5], (a) => 1 - 0.1 * Math.abs(Math.sin(a)), 16, 2);
    for (const sd of [-1, 1]) { const h = J.hands[sd]; if (!h) continue; const pts = []; for (let q = 0; q <= 6; q++) pts.push([h[0] + Math.sin(q * 1.6) * 0.04 * J.s, h[1] - 0.25 * J.s + q * 0.09 * J.s, h[2] + 0.02 * J.s]); F.limb(pts, pts.map((_, q) => 0.018 * J.s * (1 - q / 9)), false); }
    if (!headless) F.lathe((v) => [J.s * 0.1, J.head[1] + 0.08 * J.s + v * 0.3 * J.s], null, 10, 1);
    name = 'Snake goddess';
  } else if (style === 'bull') { // a standing bull with lyre horns
    const s = 0.9 + rng() * 0.4;
    F.block(0.8 * s, 0.22 * s, 2.0 * s, null, 0, 0.11 * s, 0, 6);
    F.ball([0, 0.95 * s, 0], 0.5 * s, 0.75, 0.75, 1.5);
    F.ball([0, 1.15 * s, 0.35 * s], 0.32 * s, 0.9, 0.8, 0.9); // shoulder hump
    for (const sd of [-1, 1]) for (const z of [-0.5, 0.45]) F.limb([[sd * 0.2 * s, 0.85 * s, z * s], [sd * 0.2 * s, 0.45 * s, z * s], [sd * 0.2 * s, 0.18 * s, (z + 0.03) * s]], [0.11 * s, 0.08 * s, 0.07 * s]);
    F.limb([[0, 1.05 * s, 0.6 * s], [0, 1.05 * s, 0.85 * s], [0, 0.85 * s, 1.05 * s]], [0.22 * s, 0.2 * s, 0.17 * s]);
    for (const sd of [-1, 1]) F.limb([[sd * 0.12 * s, 1.1 * s, 0.92 * s], [sd * 0.38 * s, 1.25 * s, 0.9 * s], [sd * 0.42 * s, 1.55 * s, 0.98 * s]], [0.06 * s, 0.045 * s, 0.02 * s], false);
    F.limb([[0, 1.0 * s, -0.7 * s], [0, 0.6 * s, -0.85 * s], [0, 0.2 * s, -0.82 * s]], [0.04 * s, 0.03 * s, 0.05 * s], false); // the tail reaches the plinth
    name = F.bronze ? 'Bronze bull' : 'Bull statue'; plinth = false; noFall = true;
  } else if (style === 'seahorse') {
    const s = 1 + rng() * 0.4;
    F.block(0.7 * s, 0.3 * s, 0.7 * s, null, 0, 0.12 * s, 0, 4);
    const pts = [], rad = [];
    for (let k = 0; k <= 16; k++) { const t = k / 16; if (t < 0.45) { const a = (0.45 - t) / 0.45 * TAU * 1.1; pts.push([Math.sin(a) * 0.18 * s * (0.4 + t), 0.3 * s + Math.cos(a) * 0.12 * s + t * 0.9 * s, 0]); } else pts.push([0.05 * s * Math.sin((t - 0.45) * 5), 0.3 * s + t * 1.6 * s, 0.08 * s * Math.sin((t - 0.45) * 4)]); rad.push(0.05 * s + 0.16 * s * Math.sin(Math.min(1, t * 1.1) * Math.PI) * (t > 0.45 ? 1 : 0.4)); }
    F.limb(pts, rad, false);
    const top = pts[pts.length - 1];
    F.ball([top[0], top[1] + 0.05 * s, top[2] + 0.02 * s], 0.13 * s, 0.8, 1, 1);
    F.limb([[top[0], top[1] + 0.02 * s, top[2] + 0.1 * s], [top[0], top[1] - 0.05 * s, top[2] + 0.35 * s]], [0.05 * s, 0.035 * s]);
    for (let k = 0; k < 6; k++) { const p = pts[9 + Math.min(6, k)]; F.ball([p[0] - 0.12 * s, p[1], p[2] - 0.08 * s], 0.07 * s, 0.4, 1, 0.6); }
    name = 'Seahorse sculpture'; plinth = false; noFall = true;
  } else { // fragments: colossal hand or foot, or torso
    const r = rng(), s = 1 + rng() * 1.5;
    if (r < 0.4) {
      F.block(0.5 * s, 0.16 * s, 0.6 * s, null, 0, 0.08 * s, 0, 4);
      for (let k = 0; k < 4; k++) F.limb([[(-0.18 + k * 0.12) * s, 0.1 * s, 0.22 * s], [(-0.18 + k * 0.12) * s, 0.1 * s + rng() * 0.05 * s, (0.5 + 0.05 * (k % 3)) * s]], [0.055 * s, 0.05 * s]);
      F.limb([[0.2 * s, 0.1 * s, 0.05 * s], [0.42 * s, 0.11 * s, 0.25 * s]], [0.06 * s, 0.05 * s]);
      name = 'Colossal hand fragment';
    } else if (r < 0.75) {
      F.block(0.45 * s, 0.3 * s, 0.9 * s, null, 0, 0.15 * s, 0, 4);
      F.limb([[0, 0.25 * s, -0.3 * s], [0, 0.75 * s, -0.38 * s]], [0.2 * s, 0.17 * s]);
      for (let k = 0; k < 5; k++) F.ball([(-0.16 + k * 0.08) * s, 0.07 * s, (0.43 - Math.abs(k - 1) * 0.02) * s], 0.055 * s * (k === 0 ? 1.4 : 1));
      name = 'Colossal foot fragment';
    } else {
      human(F, { h: 2.4, brokenLegs: true, headless: true, missingArm: 1, arms: () => ({ up: 0.1, fwd: 0.2, elbow: 0.3, out: 0.1 }) });
      name = 'Marble torso';
    }
    plinth = false; noFall = true;
  }
  if (plinth) plinthBlock(F, pw + rng() * 0.3, ph + rng() * 0.25, Math.max(0.7, pw * 0.85) + rng() * 0.2, rng);
  // ~25% of figures have toppled: lying on the back or on a side
  if (!noFall && fall < 0.25) {
    b.xform(0, fall < 0.13 ? rotX(-Math.PI / 2) : rotZ(Math.PI / 2 * (fall < 0.19 ? 1 : -1)), 0, 0, 0);
    name = 'Fallen ' + name.charAt(0).toLowerCase() + name.slice(1);
  }
  erode(b, seed, F.gold ? 0.3 : 1);
  settle(b);
  const t = b.build();
  t.label = name; t.style = style; t.bronze = F.bronze || F.gold;
  return t;
}

// the legacy mix (startup set used for scattered statuary and as a fallback)
const LEGACY = ['kouros', 'roman', 'pharaoh', 'meso', 'moai', 'sphinx', 'fragment', 'kore', 'roman', 'orator'];
export function statue(seed) { return makeStatue(LEGACY[seed % LEGACY.length], seed); }
export function statueSet() {
  return Array.from({ length: 40 }, (_, i) => statue(i + 1));
}
