// Pacing governor for the encounter director. A documentary needs quiet between its crescendos, but not too much:
// this watches what the viewer actually gets (a highlight: a big animal passing close, a hunt, play, somersaults, a
// set piece in view) and, once one is overdue, tilts the director toward the zone's own highlight-class cast and
// shortens the cooldowns of the delight behaviours. It adds no animals and no species: it only changes which of the
// zone's usual candidates come next, so the cost is one pass over the groups per second.
const HL_EV = new Set(['play', 'strike', 'lunge', 'flip', 'roll']);
// sparse by design (lamp-lit, a few animals): allowed a longer quiet before the nudge starts
const SPARSE = new Set(['abyss', 'hadal', 'deepplain', 'vents']);

export class Pacing {
  constructor(dir) { this.dir = dir; this.next = 0; this.lastHl = 0; this.urge = 0; }

  // zone jump: the new place starts with a clean slate (its prime spawn is busy anyway)
  reset() { this.lastHl = this.dir.clock; this.urge = 0; this.next = 0; }

  tick(c) {
    const d = this.dir;
    if (d.clock < this.next) return;
    this.next = d.clock + 1;
    for (const e of d.sys.enc) {
      if (e.done || !e.visible || e.fade < 0.9 || e.kind === 'attach') continue;
      const sz = e.baseSize, et = e.event && e.event.type;
      if ((sz >= 2 && e.dist < 15) || (sz >= 1.5 && e.dist < 8) || (et && HL_EV.has(et) && e.dist < 40) ||
        (et === 'curious' && sz >= 1 && e.dist < 12) || (e.plan.poi && e.dist < 25)) { this.lastHl = d.clock; break; }
    }
    const due = SPARSE.has(d.sys.seq.weights(c.s)[0].key) ? 150 : 100;
    const late = d.clock - this.lastHl - due;
    // ramps from 0 to 1 over a minute past due, so the nudge is gentle at first
    this.urge = late <= 0 ? 0 : Math.min(1, late / 60);
  }

  // weight multiplier for a highlight-class candidate (big, rare, curious or playful species of this zone)
  get boost() { return 1 + 4 * this.urge; }
  // delight-behaviour cooldowns shrink while a highlight is overdue (down to 40%)
  get cdMul() { return 1 - 0.6 * this.urge; }
}
