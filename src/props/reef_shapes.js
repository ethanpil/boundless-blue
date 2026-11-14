// Reef-only coral templates (the shared T.stag etc. are also used by other zones and keep their look).
import { Builder, TAU, sat, lerp } from './core.js';
import { branchesInto } from './shapes.js';
import { mulberry32 } from '../noise.js';

// Drop the downward-facing triangles of a template's flattened base (all three corners at y <= yMax): the
// hemispheres of domes and the squashed underside of rock pads lie on or inside the floor or the framework
// pad, never seen, and were up to half of each mound's triangles. Only for upright supports and colonies
// fused into one (never tilted or rolled). Unused vertices go too (merged slices are cut by vertex count);
// the contact band then is the rim, which sits at the same height.
export function cullBase(b, yMax) {
  const P = b.P, I = b.I, keep = [];
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, c = I[k + 1] * 3, d = I[k + 2] * 3;
    if (P[a + 1] <= yMax && P[c + 1] <= yMax && P[d + 1] <= yMax) {
      const e1x = P[c] - P[a], e1y = P[c + 1] - P[a + 1], e1z = P[c + 2] - P[a + 2];
      const e2x = P[d] - P[a], e2y = P[d + 1] - P[a + 1], e2z = P[d + 2] - P[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (ny <= 0.3 * Math.hypot(nx, ny, nz)) continue; // faces down or is degenerate (flattened to a disc)
    }
    keep.push(I[k], I[k + 1], I[k + 2]);
  }
  const map = new Int32Array(b.vc).fill(-1), Pn = [], Nn = [], Cn = [], Fn = [];
  for (const i of keep) if (map[i] < 0) {
    map[i] = Pn.length / 3;
    Pn.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); Nn.push(b.N[i * 3], b.N[i * 3 + 1], b.N[i * 3 + 2]);
    Cn.push(b.C[i * 3], b.C[i * 3 + 1], b.C[i * 3 + 2]); Fn.push(b.F[i * 2], b.F[i * 2 + 1]);
  }
  b.P = Pn; b.N = Nn; b.C = Cn; b.F = Fn; b.I = keep.map((i) => map[i]);
}

// Canopy normals (bent up) for vertices >= v0: thin branches lit by their side normals came out as dark
// sticks against the bright sand; a thicket is lit like a canopy (the trick grass uses).
export function canopyNormals(b, v0, k = 1.1) {
  const N = b.N;
  for (let i = v0 * 3; i < N.length; i += 3) { const x = N[i], y = N[i + 1] + k, z = N[i + 2], l = Math.hypot(x, y, z); N[i] = x / l; N[i + 1] = y / l; N[i + 2] = z / l; }
}

// Staghorn / bottlebrush Acropora thicket: many short, densely forking branches on triangular sections
// (about the old staghorn's triangle count, three times the branches), the body darker at the base and
// each growing tip pale or coloured (tipC: cream, violet, blue, lime). A mass of branches with bright tips
// reads as a living thicket; a few long bare twigs read as dead sticks.
export function acroThicket(seed, tipC) {
  const b = new Builder(), rng = mulberry32(seed), n = 6 + Math.floor(rng() * 4), R0 = 0.14 + rng() * 0.12;
  const up = 0.1 + rng() * 0.12, rad = 0.036 + rng() * 0.012, H = 0.6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rng() * 0.8, r = k ? R0 * (0.4 + 0.6 * rng()) : 0, out = k ? 0.35 + rng() * 0.55 : 0.15;
    branchesInto(b, rng, {
      depth: 2, len: 0.16 + rng() * 0.09, rad, radial: 3, segs: 1, kids: [2, 3], spread: 0.45 + rng() * 0.3, up, wiggle: 0.25,
      lenK: 0.82, radK: 0.8, tipK: 0.6, childAt: [0.45, 1],
      paint(level, v, x, y, z, o) {
        const t = sat(y / H), tip = level === 2 ? v : 0, c = 0.62 + 0.38 * t;
        for (let i = 0; i < 3; i++) o[3 + i] = lerp(c, tipC[i], tip);
        o[6] = 0; o[7] = 2;
      },
    }, [Math.cos(a) * r, 0, Math.sin(a) * r], [Math.cos(a) * out, 1, Math.sin(a) * out]);
  }
  canopyNormals(b, 0);
  const t = b.build(); t.label = 'Staghorn coral'; return t;
}
