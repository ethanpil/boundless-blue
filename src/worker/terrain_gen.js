// The pure part of world building: terrain chunk heightfields and vertex data, and the sky-visibility map.
// Run by the world workers (world.worker.js) and, as a fallback, time-sliced on the main thread (terrain.js).
// No three.js in this module graph (workers cannot rely on the import map): results are plain typed arrays.
// Generators yield between slices of work and return their result.
import { BIOMES, sv } from '../biomes.js';
import { noise2, smoothstep, clamp } from '../noise.js';

export const CHUNK = 64;          // metres of travel per chunk
export const DX = 1.5;            // lateral grid spacing (globally aligned)
const HALF_W = 165;               // half width of a chunk around the path
export const NZ = 43;             // rows per chunk (spacing 64/42)
export const NO_CEIL = 60;

// Encrusting life on the seabed per zone: [amount 0..1, palette 0 tropical .. 0.5 temperate .. 1 bacterial mats].
const LIFE = {
  reef: [1, 0], softcoral: [0.9, 0], wall: [1, 0.05], kelp: [0.8, 0.5], seagrass: [0.45, 0.2], mangrove: [0.35, 0.45],
  sandflat: [0.2, 0.1], pelagic: [0, 0], cave: [0.15, 0.4], wreck: [0.55, 0.35], ruins: [0.6, 0.2], vents: [0.75, 1],
  deepplain: [0.12, 0.85], tidepool: [1, 0.15], abyss: [0, 0], polar: [0.3, 0.6], seamount: [0.85, 0.1],
  sargassum: [0, 0], champagne: [0.65, 0.05], jellylake: [0.4, 0.4], sunkenforest: [0.45, 0.5], anemone: [0.8, 0],
  bluehole: [0.7, 0.05], otterkelp: [0.85, 0.5], whaleshark: [0.15, 0.1], biobay: [0.3, 0.45], iceedge: [0.25, 0.6],
  hadal: [0.08, 0.9],
};
const TINT = new Float32Array(6);

// Travel distance of row j (-1 .. NZ) of chunk idx: the rows a chunk build samples.
export const rowS = (idx, j) => idx * CHUNK + (j * CHUNK) / (NZ - 1);

// Row data depends only on s.
function row(shape, seq, s) {
  const ws = seq.weights(s);
  return { s, ws, px: shape.pathX(s), py: shape.pathY(s), hasCeil: ws.some((e) => BIOMES[e.key].ceil) };
}

// Heightfields (floor hf and ceiling hc, one extra row and column all round for normals) and the vertex data of
// chunk idx. The ceiling mesh is only made where it comes within 0.5 m of the surface (surfaceY).
// Returns { hf, hc, x0, NX, W, anyCeil, floor, ceil } with floor/ceil = { pos, nor, col, det, idx } or ceil = null.
export function* chunkData(shape, seq, idx, surfaceY) {
  const s0 = idx * CHUNK;
  const rows = [];
  for (let j = -1; j <= NZ; j++) rows.push(row(shape, seq, rowS(idx, j)));
  const pxMid = rows[(NZ / 2) | 0].px;
  const x0 = Math.floor((pxMid - HALF_W) / DX) * DX;
  const NX = Math.round((2 * HALF_W) / DX) + 1;
  const W = NX + 2, H = NZ + 2;
  const hf = new Float32Array(W * H);
  const hc = new Float32Array(W * H);
  let anyCeil = false, minCeil = 1e9;
  for (let j = 0; j < H; j++) {
    const r = rows[j];
    for (let i = 0; i < W; i++) {
      const x = x0 + (i - 1) * DX;
      const dx = x - r.px, ad = Math.abs(dx);
      let h = 0;
      for (const e of r.ws) { const b = BIOMES[e.key]; h += (r.py - b.clearance + b.floor(x, r.s, ad, e.g, dx)) * e.w; }
      hf[j * W + i] = Math.min(h, r.py - 2.2 + Math.max(0, ad - 4) * 2.5);
      if (r.hasCeil) {
        let c = 0;
        for (const e of r.ws) { const b = BIOMES[e.key]; c += (b.ceil ? r.py + b.ceil(x, r.s, ad, e.g, dx) : NO_CEIL) * e.w; }
        c = Math.max(c, r.py + 2.4 - Math.max(0, ad - 4) * 2.5);
        hc[j * W + i] = c; anyCeil = true; if (c < minCeil) minCeil = c;
      } else hc[j * W + i] = NO_CEIL;
    }
    if ((j & 7) === 7) yield;
  }
  const floor = gridData(hf, rows, x0, NX, false, s0);
  yield;
  let ceil = null;
  if (anyCeil && minCeil < surfaceY + 0.5) {
    ceil = gridData(hc, rows, x0, NX, true, s0);
    yield;
  }
  return { hf, hc, x0, NX, W, anyCeil, floor, ceil };
}

// Vertex data of one heightfield: positions in the chunk's local frame (z = -(s - s0)), normals, colours,
// detail (floor: aDetail xyzw) or ice (ceiling: aIce) and the triangle indices.
function gridData(hgt, rows, x0, NX, isCeil, s0) {
  const W = NX + 2;
  const n = NX * NZ;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const det = isCeil ? new Float32Array(n) : new Float32Array(n * 4);
  const dz = CHUNK / (NZ - 1);
  let k = 0;
  for (let j = 0; j < NZ; j++) {
    const r = rows[j + 1];
    for (let i = 0; i < NX; i++, k++) {
      const g = (j + 1) * W + (i + 1);
      const h = hgt[g];
      const x = x0 + i * DX;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -(r.s - s0);
      // normal from central differences (z = -s)
      const hx = hgt[g + 1] - hgt[g - 1];
      const hs = hgt[g + W] - hgt[g - W];
      let nx = -hx / (2 * DX), ny = 1, nz = hs / (2 * dz);
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      if (isCeil) { nx = -nx; ny = -ny; nz = -nz; }
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      // occlusion from local concavity
      const mean = (hgt[g + 1] + hgt[g - 1] + hgt[g + W] + hgt[g - W]) * 0.25;
      const conc = isCeil ? h - mean : mean - h;
      const ao = clamp(1 - conc * 0.35, 0.45, 1.1);
      // colour blend across biomes
      const slope = 1 - Math.abs(ny);
      const nn = noise2(x / 7, r.s / 7, 5);
      const rocky = smoothstep(0.2, 0.5, slope + nn * 0.12);
      let cr = 0, cg = 0, cb = 0, ice = 0, rip = 0, life = 0, hue = 0;
      for (const e of r.ws) {
        const b = BIOMES[e.key];
        if (isCeil) {
          if (b.iceCeiling) { cr += 0.72 * e.w; cg += 0.86 * e.w; cb += 0.95 * e.w; ice += e.w; }
          else { cr += b.rock[0] * 0.8 * e.w; cg += b.rock[1] * 0.8 * e.w; cb += b.rock[2] * 0.8 * e.w; }
          continue;
        }
        // biome seabed colours plus its optional tint (see floorTint in biomes.js)
        const T = TINT;
        T[0] = b.sand[0]; T[1] = b.sand[1]; T[2] = b.sand[2]; T[3] = b.rock[0]; T[4] = b.rock[1]; T[5] = b.rock[2];
        if (b.floorTint) b.floorTint(x, r.s, nn, T);
        cr += (T[0] + (T[3] - T[0]) * rocky) * e.w;
        cg += (T[1] + (T[4] - T[1]) * rocky) * e.w;
        cb += (T[2] + (T[5] - T[2]) * rocky) * e.w;
        rip += (b.ripple ?? 1) * e.w;
        const L = LIFE[e.key];
        if (L) { life += L[0] * (0.65 + 0.7 * sv(e.g, 21)) * e.w; hue += L[1] * e.w; }
      }
      const v = 0.9 + 0.2 * nn;
      col[k * 3] = cr * ao * v; col[k * 3 + 1] = cg * ao * v; col[k * 3 + 2] = cb * ao * v;
      if (isCeil) det[k] = ice;
      else {
        det[k * 4] = rip * (1 - rocky) * smoothstep(0.08, 0.0, slope - 0.05); det[k * 4 + 1] = rocky;
        det[k * 4 + 2] = Math.min(1, life); det[k * 4 + 3] = hue;
      }
    }
  }
  const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
  let t = 0;
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
    // rows advance toward -z; winding chosen so floor faces +y
    if (!isCeil) { idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c; }
    else { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
  }
  return { pos, nor, col, det, idx };
}

// Sky visibility of N x N texels of `cell` m with row 0 at global (ox, os) (rows advance with s): 1 = open sky,
// less under rock or ice roofs and canopies. Returns RGBA bytes, 3x3 blurred, rows flipped so v increases with z.
export function* skyData(shape, seq, ox, os, N, cell, surf) {
  const buf = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const s = os + j * cell;
    const ws = seq.weights(s);
    const hasCeil = ws.some((e) => BIOMES[e.key].ceil);
    const hasCanopy = ws.some((e) => BIOMES[e.key].canopy);
    const iceT = ws.reduce((a, e) => a + (BIOMES[e.key].iceLight || 0) * e.w, 0); // light through sea ice
    for (let i = 0; i < N; i++) {
      let v = 1;
      if (hasCeil) {
        const c = shape.ceilingExact(ox + i * cell, s);
        v = Math.max(smoothstep(-1.2, 0.6, c - surf), iceT + 0.03);
      }
      if (hasCanopy) v *= shape.canopyAt(ox + i * cell, s);
      buf[j * N + i] = v;
    }
    if ((j & 15) === 15) yield;
  }
  // 3x3 blur for soft light pools
  const out = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let a = 0, n = 0;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const ii = i + x, jj = j + y;
      if (ii >= 0 && jj >= 0 && ii < N && jj < N) { a += buf[jj * N + ii]; n++; }
    }
    // texel (i, j): u -> x, v -> render z. Row j is at s = os + j*cell, i.e. z = -s,
    // so store rows flipped so that v increases with z.
    const o = ((N - 1 - j) * N + i) * 4;
    out[o] = out[o + 1] = out[o + 2] = (a / n) * 255; out[o + 3] = 255;
  }
  return out;
}
