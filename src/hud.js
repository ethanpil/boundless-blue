// Submarine control deck: tap/click anywhere on the view to show it (M or Tab on a keyboard, Esc closes).
// Instruments read app.info() at 5 Hz (the slower readouts in 1 Hz slices); the sonar and compass canvases draw
// at <= 20 fps; while the deck is hidden only a 1 Hz check of the sightings log runs (for the toasts). Every
// control works by touch, pen or mouse, and buttons are keyboard-focusable. Styles: index.html ("control deck").
// Perf note: each DOM write costs style/layout time on weak GPUs/CPUs, so writes are cached (txt/tf) and the
// gauges have no CSS transitions (restarting ~10 transitions per refresh cost 1-2 ms on an HD 4600 laptop).
import { icon } from './hud/icons.js';
import { deckHTML, depthFrac, DEPTH_ZONES, WEATHER_INFO, esc } from './hud/markup.js';
import { Sonar } from './hud/sonar.js';
import { CompassTape } from './hud/compass.js';

const UI_MS = 200;                 // refresh period: fast instruments at 5 Hz, the rest in 1 Hz slices
const IDLE_MS = 8000, IDLE_SHEET_MS = 20000;
const TOAST_MS = 4800;
const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const LAMP_NEXT = { auto: 'on', on: 'off', off: 'auto' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: keep the in-memory value */ } },
};
const pad2 = (n) => (n < 10 ? '0' : '') + n;
const pad3 = (n) => (n < 10 ? '00' : n < 100 ? '0' : '') + n;
function hms(sec) {
  const t = Math.max(0, Math.floor(sec));
  return pad2(Math.floor(t / 3600)) + ':' + pad2(Math.floor(t / 60) % 60) + ':' + pad2(t % 60);
}
// cached DOM writes: only touch the DOM when the value changes
function txt(el, s) { if (el.__v !== s) { el.__v = s; el.textContent = s; } }
function tf(el, s) { if (el.__t !== s) { el.__t = s; el.style.transform = s; } }
function flag(el, cls, on) { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); }
const speedAngle = (v) => Math.round(-90 + 180 * Math.sqrt(Math.min(16, Math.max(0, v)) / 16)); // dial: sqrt scale 0..16 m/s
function pressed(el, on) { const v = on ? 'true' : 'false'; if (el.getAttribute('aria-pressed') !== v) el.setAttribute('aria-pressed', v); }

export class Hud {
  constructor(app) {
    this.app = app;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.narrow = matchMedia('(max-width: 599px) and (orientation: portrait)'); // must match index.html
    this.open = false;
    this.pinned = store.get('ocean.deck.pinned') === '1';
    this.sheet = null; this.sheetOpener = null;
    this.lastPoke = 0; this.nextUI = 0; this.forceFull = true; this.nextSight = 0; this.sizeDirty = true;
    this.cost = 0;
    this.head = null;                // newest entry of app.recent already seen
    this.events = [];                // narrative notes for the log: { name, t, ev: true }
    this.rare = new Set();           // names logged as rare encounters
    this.tq = []; this.toastUntil = 0;
    this.logDirty = true; this.armed = null;
    this.dPrev = null; this.tPrev = 0; this.vs = 0; this.slice = 0;
    this.last = null;                // last info() snapshot
    this._build();
    this._bind();
    this.sonar = new Sonar(this.R.sonar, app, this.reduced);
    this.tape = new CompassTape(this.R.tape, this.reduced);
    pressed(this.R.pin, this.pinned);
    const ft = this.deck.querySelector('[data-tog="full"]');
    if (ft && app.canFullscreen === false) ft.hidden = true;   // e.g. iPhone Safari has no element fullscreen
    if (app.onNote) app.onNote((text) => this._onNote(text));
    if (window.__ocean) window.__ocean.hud = this;              // debugging: __ocean.hud.show(), .cost
    // first-load hint, after the loader has faded
    setTimeout(() => { if (!this.open && !this.everOpened) this.hint.classList.add('on'); }, 3800);
    setTimeout(() => this.hint.classList.remove('on'), 11500);
  }

  // ---------- DOM ----------
  _build() {
    const deck = this.deck = document.createElement('div');
    deck.id = 'deck';
    deck.setAttribute('role', 'region');
    deck.setAttribute('aria-label', 'Control deck');
    deck.innerHTML = deckHTML(this.app);
    deck.inert = true;
    document.body.appendChild(deck);

    this.hint = document.createElement('div');
    this.hint.id = 'dk-hint';
    this.hint.setAttribute('aria-hidden', 'true');
    this.hint.innerHTML = `<i></i>${this.coarse ? 'tap anywhere for controls' : 'click anywhere for controls <kbd>M</kbd>'}`;
    document.body.appendChild(this.hint);

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'dk-toast';
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.toastEl);

    this.fade = document.createElement('div');
    this.fade.id = 'dk-fade';
    document.body.appendChild(this.fade);

    const $ = (id) => deck.querySelector('#dk-' + id);
    const ids = ['zone', 'sub', 'prog', 'next', 'tonext', 'dive', 'dist', 'species', 'tape', 'hor', 'hdg', 'card', 'pitch',
      'watchrow', 'watch', 'hh', 'mh', 'clock', 'todg', 'tod', 'wxg', 'wx', 'smk', 'dmk', 'depth', 'dzone', 'seabed', 'alt', 'vs',
      'sonar', 'rangev', 'ncont', 'temp', 'vis', 'light', 'lightv', 'lamp', 'lampv', 'lampled', 'cura', 'curv', 'curd',
      'pause', 'needle', 'setm', 'spd', 'kn', 'paused', 'pin', 'logn', 'loglist', 'qnote', 'sharest', 'shareurl',
      'fps', 'res', 'tier', 'cost', 'gpu', 'seed', 'tg-wake'];
    this.R = {};
    for (const id of ids) this.R[id.replace('-', '_')] = $(id);
    this.sheets = {};
    for (const el of deck.querySelectorAll('.dk-sheet')) this.sheets[el.id.slice(6)] = el;
    this.menuBtns = deck.querySelectorAll('.dk-menu [data-sheet]');
    this.togs = deck.querySelectorAll('[data-tog]');
    this.lampBtns = deck.querySelectorAll('[data-lamp]');
    this.camBtns = deck.querySelectorAll('[data-cam]');
    this.qBtns = deck.querySelectorAll('[data-q]');
    this.timeBtns = deck.querySelectorAll('[data-time]');
    this.wxBtns = deck.querySelectorAll('[data-weather]');
    this.zoneBtns = deck.querySelectorAll('[data-zone]');
    this.topPanels = deck.querySelectorAll('.dk-nav, .dk-compass, .dk-time');
    this.barPanels = deck.querySelectorAll('.dk-helm, .dk-menu');
    this.glyph = { tod: '', wx: '', pause: null };
  }

  _bind() {
    const deck = this.deck;
    const inUI = (t) => !!(t && t.closest && t.closest('.dk-p, .dk-sheet, #dk-toast'));
    // A tap on the view (not on the deck) toggles the deck. Pointer events cover mouse, touch and pen.
    let down = null;
    addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button > 0) { down = null; return; }
      if (inUI(e.target)) { down = null; this.poke(); return; }
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    }, { passive: true });
    addEventListener('pointerup', (e) => {
      const d = down; down = null;
      if (!d || e.pointerId !== d.id || inUI(e.target)) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14 || performance.now() - d.t > 800) return;
      if (this.open && this.sheet) { this.closeSheet(false); this.poke(); return; }
      this.toggle(false);
    }, { passive: true });
    addEventListener('pointercancel', () => { down = null; }, { passive: true });

    deck.addEventListener('click', (e) => this._onClick(e));
    this.toastEl.addEventListener('click', () => { this.show(false); this.openSheet('log', null, false); });

    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (this.sheet) this.closeSheet(true);
        else if (this.open) this.hide();
        return;
      }
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'm' || e.key === 'M') { this.toggle(true); return; }
      if (e.key === 'Tab' && !this.open) { e.preventDefault(); this.show(true); return; }
      if (this.open) this.poke();
    });
    addEventListener('resize', () => { this.sizeDirty = true; });
    document.addEventListener('fullscreenchange', () => { this.nextUI = 0; this.forceFull = true; });
  }

  // Reads layout (on open and resize only): the top row and bottom bar heights position the sheets, the
  // toast and the lifted caption (CSS --dk-top-m / --dk-bar-m).
  _measure() {
    const H = this.deck.clientHeight || innerHeight;
    let top = 0, bar = H;
    for (const el of this.topPanels) top = Math.max(top, el.offsetTop + el.offsetHeight);
    for (const el of this.barPanels) bar = Math.min(bar, el.offsetTop);
    const t = Math.round(top) + 'px', b = Math.round(H - bar) + 'px', rs = document.documentElement.style;
    if (t !== this.mTop) { this.mTop = t; rs.setProperty('--dk-top-m', t); }
    if (b !== this.mBar) { this.mBar = b; rs.setProperty('--dk-bar-m', b); }
  }

  // ---------- open / close ----------
  poke() { this.lastPoke = performance.now(); }
  toggle(kb) { if (this.open) this.hide(); else this.show(kb); }
  show(kb) {
    if (this.open) return;
    this.open = true; this.everOpened = true;
    this.deck.inert = false;
    this.deck.classList.add('open');
    document.body.classList.add('deck-open');
    this.hint.classList.remove('on');
    this.sizeDirty = true; this.nextUI = 0; this.forceFull = true; this.zoneKey = null;
    this.poke();
    if (kb) { const b = this.deck.querySelector('#dk-pause'); if (b) b.focus(); }
  }
  hide() {
    if (!this.open) return;
    this.closeSheet(false);
    this.open = false;
    if (this.deck.contains(document.activeElement)) document.activeElement.blur();
    this.deck.classList.remove('open');
    document.body.classList.remove('deck-open');
    this.deck.inert = true;
  }
  openSheet(name, opener, kb) {
    const el = this.sheets[name];
    if (!el) return;
    if (this.sheet === name) { this.closeSheet(kb); return; }
    this.closeSheet(false);
    this.sheet = name; this.sheetOpener = opener;
    el.classList.add('on');
    this.toastEl.classList.remove('on');
    this.deck.classList.add('sheet-open');
    document.body.classList.add('dk-sheet-open');
    for (const b of this.menuBtns) b.setAttribute('aria-expanded', b.dataset.sheet === name ? 'true' : 'false');
    if (name === 'log') { this.logDirty = true; this._renderLog(); }
    if (name === 'zones') this._arm(null);
    this.nextUI = 0; this.forceFull = true;
    this.poke();
    if (kb) { const f = el.querySelector('.dk-sh-b button'); if (f) f.focus(); }
  }
  closeSheet(restoreFocus) {
    if (!this.sheet) return;
    const el = this.sheets[this.sheet];
    el.classList.remove('on');
    this.deck.classList.remove('sheet-open');
    document.body.classList.remove('dk-sheet-open');
    for (const b of this.menuBtns) b.setAttribute('aria-expanded', 'false');
    if (el.contains(document.activeElement)) {
      if (restoreFocus && this.sheetOpener) this.sheetOpener.focus(); else document.activeElement.blur();
    }
    this.sheet = null; this.sheetOpener = null;
  }

  // ---------- controls ----------
  _onClick(e) {
    const b = e.target.closest('button');
    if (!b || !this.deck.contains(b)) return;
    const a = this.app, kb = e.detail === 0, ds = b.dataset;
    this.poke();
    if (!kb) b.blur();               // pointer use: keep Space for pause, not for re-pressing this button
    if (ds.sheet) this.openSheet(ds.sheet, b, kb);
    else if ('close' in ds) this.closeSheet(true);
    else if (ds.zone) this._zone(ds.zone, b);
    else if (ds.time) a.setTime(ds.time);
    else if (ds.weather) a.setWeather(ds.weather);
    else if (ds.lamp) a.setLamp(ds.lamp);
    else if (ds.cam) a.setCuriosity(ds.cam === '1' ? 1 : 0);
    else if (ds.q) { if (ds.q !== a.quality) this._reload(() => a.setQuality(ds.q)); }
    else if (ds.tog) this._toggle(ds.tog);
    else if (ds.act === 'next') { a.nextZone(); this.closeSheet(false); }
    else if (ds.act === 'skiptime') a.skipTime();
    else if (ds.act === 'nextwx') a.nextWeather();
    else {
      switch (b.id) {
        case 'dk-pause': a.togglePause(); break;
        case 'dk-slower': a.slower(); break;
        case 'dk-faster': a.faster(); break;
        case 'dk-nextz': a.nextZone(); break;
        case 'dk-lamp': a.setLamp(LAMP_NEXT[a.lampMode] || 'auto'); break;
        case 'dk-range': txt(this.R.rangev, this.sonar.cycleRange() + ' m'); break;
        case 'dk-pin': this.pinned = !this.pinned; store.set('ocean.deck.pinned', this.pinned ? '1' : '0'); pressed(b, this.pinned); break;
        case 'dk-close': this.hide(); return;
        case 'dk-share': this._share(); break;
        default: break;
      }
    }
    this.nextUI = 0; this.forceFull = true;                 // reflect the change at the next update
  }
  _toggle(k) {
    const a = this.app;
    if (k === 'labels') a.toggleLabels();
    else if (k === 'captions') a.toggleCaptions();
    else if (k === 'stats') a.toggleStats();
    else if (k === 'full') a.toggleFullscreen();
    else if (k === 'wake') a.setWakeLock(!a.wakeLock);
  }
  _arm(key) {
    this.armed = key;
    for (const z of this.zoneBtns) flag(z, 'armed', z.dataset.zone === key);
  }
  _zone(key, b) {
    if (this.armed !== key) { this._arm(key); return; }
    b.classList.add('go');
    this._reload(() => this.app.jumpTo(key));
  }
  // fade to the loader colour, then let the app reload the page
  _reload(fn) {
    this.fade.classList.add('on');
    setTimeout(fn, this.reduced.matches ? 60 : 650);
  }
  async _share() {
    const url = this.app.shareUrl();
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { ok = false; }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:0;top:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
    }
    txt(this.R.sharest, ok ? 'copied: paste it anywhere to share this dive' : 'copy it from the box below');
    flag(this.R.sharest, 'ok', ok);
    const box = this.R.shareurl;            // clipboard refused: show the link selected, ready to copy
    box.hidden = ok;
    if (!ok) { box.value = url; box.focus(); box.select(); }
    clearTimeout(this.shareT);
    this.shareT = setTimeout(() => { txt(this.R.sharest, 'same seed and starting zone'); flag(this.R.sharest, 'ok', false); }, ok ? 6000 : 20000);
  }

  // ---------- sightings, notes, toasts ----------
  // Toast queue entries: { kind: 'new' | 'rare' | 'note' | 'zone', name, fact }. New species may be merged
  // into one toast; the others show one at a time. Nothing shows while a sheet is open (they wait).
  _onNote(text) {
    if (!text) return;
    const t = this.app.info().diveTime;
    this.events.unshift({ name: text, t, ev: true });
    if (this.events.length > 24) this.events.pop();
    this.logDirty = true;
    // narrow portrait: the caption area is behind the open deck, so the note comes up as a toast instead
    if (this.open && this.narrow.matches && this.app.captionsOn) this.tq.push({ kind: 'note', name: text, fact: '' });
  }
  _checkSightings() {
    const r = this.app.recent;
    if (!r || !r.length || r[0] === this.head) return;
    let i = 0;
    while (i < r.length && r[i] !== this.head) i++;
    for (let j = i - 1; j >= 0; j--) {      // oldest first
      const e = r[j], rare = !!(this.app.isRare && this.app.isRare(e.name));
      if (rare) this.rare.add(e.name);
      this.tq.push({ kind: rare ? 'rare' : 'new', name: e.name, fact: e.fact || '' });
    }
    if (this.tq.length > 10) this.tq.splice(0, this.tq.length - 10);
    this.head = r[0];
    this.logDirty = true;
  }
  _toastTick(now) {
    if (now < this.toastUntil) return;
    if (this.toastEl.classList.contains('on')) { this.toastEl.classList.remove('on'); this.toastUntil = now + 700; return; }
    if (!this.tq.length || this.sheet) return;
    if (!this.open && !this.app.captionsOn) { this.tq.length = 0; return; }
    let i = 0;
    while (i < this.tq.length && this.tq[i].kind === 'new') i++;
    let html;
    if (i < this.tq.length) {
      const q = this.tq.splice(i, 1)[0];
      html = this._toastHTML(q.kind, q.kind === 'rare' ? 'Rare encounter' : q.kind === 'zone' ? 'Entering' : 'Dive log', q.name, q.fact);
    } else if (this.tq.length > 2) {
      let names = '';
      for (let k = 0; k < Math.min(3, this.tq.length); k++) names += (k ? ' · ' : '') + this.tq[k].name;
      html = this._toastHTML('new', `${this.tq.length} new species`, names + (this.tq.length > 3 ? ' …' : ''), '', true);
      this.tq.length = 0;
    } else {
      const q = this.tq.shift();
      html = this._toastHTML('new', 'New species logged', q.name, q.fact);
    }
    this.toastEl.innerHTML = html;
    this.toastEl.classList.add('on');
    this.toastUntil = now + TOAST_MS;
  }
  _toastHTML(kind, title, name, fact, multi = false) {
    const n = this.app.sightings ? this.app.sightings.size : 0;
    const f = fact.length > 120 ? fact.slice(0, 117).replace(/\s+\S*$/, '') + '…' : fact;
    const ic = { rare: 'star', new: 'fish', note: 'log', zone: 'zones' }[kind] || 'fish';
    const head = kind === 'new' || kind === 'rare' ? `${title} · ${n} seen` : title;
    return `<span class="dk-tic ${kind}">${icon(ic)}</span><span class="dk-tb${multi ? ' multi' : ''}"><span class="dk-k">${esc(head)}</span>`
      + `<b>${esc(name)}</b>${f ? `<small>${esc(f)}</small>` : ''}</span>`;
  }
  _renderLog() {
    if (!this.logDirty) return;
    this.logDirty = false;
    const a = this.app, items = [];
    for (const e of a.recent || []) items.push(e);
    for (const e of this.events) items.push(e);
    items.sort((p, q) => q.t - p.t);
    txt(this.R.logn, String(a.sightings ? a.sightings.size : 0));
    if (!items.length) { this.R.loglist.innerHTML = '<li class="dk-empty">Nothing logged yet. Species are logged when they swim within about 45 m.</li>'; return; }
    let h = '';
    for (const e of items) {
      if (e.ev) { h += `<li class="dk-li ev"><span class="dk-lt">${hms(e.t)}</span><i>${esc(e.name)}</i></li>`; continue; }
      const s = a.sightings && a.sightings.get(e.name), c = s && s.count > 1 ? `<small class="dk-lc">×${s.count}</small>` : '';
      h += `<li class="dk-li${this.rare.has(e.name) ? ' rare' : ''}"><span class="dk-lt">${hms(e.t)}</span><b>${esc(e.name)}</b>${c}`
        + `${e.fact ? `<p>${esc(e.fact)}</p>` : ''}</li>`;
    }
    this.R.loglist.innerHTML = h;
  }

  // ---------- per frame ----------
  update(dt) {
    const now = performance.now();
    if (now >= this.nextSight) { this.nextSight = now + 1000; this._checkSightings(); if (this.sheet === 'log') this._renderLog(); }
    this._toastTick(now);
    if (!this.open) return;
    const idle = this.sheet ? IDLE_SHEET_MS : IDLE_MS;
    if (!this.pinned && now - this.lastPoke > idle && !this.deck.contains(document.activeElement)) { this.hide(); return; }
    if (this.sizeDirty) { this.sizeDirty = false; this._measure(); this.sonar.resize(); this.tape.resize(); }
    if (now >= this.nextUI) {
      this.nextUI = now + UI_MS;
      this._refresh(this.forceFull);
      this.forceFull = false;
    }
    this.sonar.draw(now);
    this.tape.draw(now);
    this.cost = this.cost * 0.97 + (performance.now() - now) * 0.03;
  }

  // The heading refreshes every 200 ms (the compass tape canvas eases between readings). Everything else is
  // split into five slices, one per refresh, so each reading updates once a second (like a dive computer)
  // and no frame pays for all of them: each DOM write costs style/layout time. A control action forces a
  // full refresh at once.
  _refresh(full) {
    const a = this.app, o = a.info(), R = this.R;
    this.last = o;
    const h = o.heading, d = o.depth;
    this.tape.set(h);                // the tape eases toward this on its own canvas
    txt(R.hdg, pad3(Math.round(h) % 360) + '°');
    txt(R.card, CARD[Math.round(h / 22.5) % 16]);
    const sl = full ? -1 : (this.slice = (this.slice + 1) % 5);

    if (o.zoneKey !== this.zoneKey) {   // narrow portrait hides the zone caption behind the deck: say it here
      if (this.zoneKey && this.narrow.matches && a.captionsOn) this.tq.push({ kind: 'zone', name: o.zone, fact: o.subtitle });
      this.zoneKey = o.zoneKey;
    }
    if (sl <= 0) { // navigation
      txt(R.zone, o.zone); txt(R.sub, o.subtitle);
      tf(R.prog, `scaleX(${o.zoneProgress.toFixed(3)})`);
      txt(R.next, o.nextZone);
      const m = o.metresToNext, eta = o.speed > 0.2 ? m / o.speed : 0;
      txt(R.tonext, (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m')
        + (eta ? ` · ${eta >= 90 ? Math.round(eta / 60) + ' min' : Math.round(eta) + ' s'}` : ''));
      txt(R.dive, hms(o.diveTime));
      txt(R.dist, o.distanceKm.toFixed(2) + ' km');
      txt(R.species, String(o.species));
    }
    if (sl < 0 || sl === 1) { // watching, time and weather
      flag(R.watchrow, 'on', !!o.watching);
      if (o.watching) txt(R.watch, o.watching);
      const ch = o.clockHours, hh = Math.floor(ch), mm = Math.floor((ch - hh) * 60);
      txt(R.clock, pad2(hh) + ':' + pad2(mm));
      tf(R.hh, `rotate(${Math.round((ch % 12) * 30)}deg)`);
      tf(R.mh, `rotate(${mm * 6}deg)`);
      const tg = o.night >= 0.5 ? 'moon' : (o.timeLabel === 'dawn' ? 'dawn' : o.timeLabel === 'dusk' ? 'dusk' : 'sun');
      if (tg !== this.glyph.tod) { this.glyph.tod = tg; R.todg.innerHTML = icon(tg); }
      txt(R.tod, o.timeLabel);
      const wk = o.weatherKey || 'clear';
      if (wk !== this.glyph.wx) { this.glyph.wx = wk; R.wxg.innerHTML = icon(wk); }
      txt(R.wx, WEATHER_INFO[wk] || o.weather);
    }
    if (sl < 0 || sl === 2) { // depth, seabed, altitude, vertical speed
      tf(R.dmk, `translateY(${(depthFrac(d) * 100).toFixed(1)}%)`);
      txt(R.depth, (d >= 100 ? Math.round(d) : d.toFixed(1)) + ' m');
      let zi = 0; while (d >= DEPTH_ZONES[zi].to) zi++;
      if (R.dzone.__v !== DEPTH_ZONES[zi].name) R.dzone.className = 'dk-dzone ' + DEPTH_ZONES[zi].cls;
      txt(R.dzone, DEPTH_ZONES[zi].name);
      if (o.seabed != null) { tf(R.smk, `translateY(${(depthFrac(o.seabed) * 100).toFixed(1)}%)`); flag(R.smk, 'on', true); } else flag(R.smk, 'on', false);
      txt(R.seabed, o.seabed != null ? (o.seabed >= 100 ? Math.round(o.seabed) : o.seabed.toFixed(1)) + ' m' : 'open water');
      txt(R.alt, o.altitude != null ? o.altitude.toFixed(1) + ' m' : '—');
      if (this.dPrev !== null && o.diveTime > this.tPrev + 0.05) {
        const vz = (d - this.dPrev) / (o.diveTime - this.tPrev);
        this.vs += (vz - this.vs) * 0.6;
      } else if (o.paused) this.vs = 0;
      if (o.diveTime !== this.tPrev) { this.dPrev = d; this.tPrev = o.diveTime; }
      const vs = this.vs, av = Math.abs(vs);
      txt(R.vs, av < 0.05 ? 'level' : (vs > 0 ? '▼ ' : '▲ ') + (av >= 10 ? Math.round(av) : av.toFixed(1)) + ' m/s');
    }
    if (sl < 0 || sl === 3) { // environment
      txt(R.temp, o.tempC.toFixed(1) + '°C');
      txt(R.vis, o.visibility >= 79.5 ? '80+ m' : Math.round(o.visibility) + ' m');
      tf(R.light, `scaleX(${Math.max(0.02, Math.min(1, o.light)).toFixed(2)})`);
      txt(R.lightv, Math.round(o.light * 100) + '%');
      const lm = a.lampMode;
      txt(R.lampv, lm === 'auto' ? (o.lamps ? 'AUTO · ON' : 'AUTO · OFF') : lm.toUpperCase());
      flag(R.lampled, 'on', !!o.lamps);
      tf(R.cura, `rotate(${Math.round(o.currentDir - h)}deg)`);
      txt(R.curv, o.currentKnots.toFixed(1) + ' kn');
      txt(R.curd, 'set ' + pad3(Math.round(o.currentDir) % 360) + '°');
    }
    if (sl < 0 || sl === 4) { // helm: speed, pause state, pitch; and the open sheet
      const v = o.speed;
      tf(R.needle, `rotate(${speedAngle(v)}deg)`);
      tf(R.setm, `rotate(${speedAngle(o.speedSetting)}deg)`);
      txt(R.spd, v.toFixed(1));
      txt(R.kn, o.speedKnots.toFixed(1) + ' kn · set ' + o.speedSetting.toFixed(1));
      flag(R.paused, 'on', o.paused);
      if (this.glyph.pause !== o.paused) {
        this.glyph.pause = o.paused;
        R.pause.innerHTML = icon(o.paused ? 'play' : 'pause');
        R.pause.setAttribute('aria-label', o.paused ? 'Play' : 'Pause');
      }
      const p = Math.round(o.pitch);
      txt(R.pitch, (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p) + '°');
      tf(R.hor, `translateY(${Math.max(-13, Math.min(13, o.pitch * 0.55)).toFixed(0)}px)`);
      txt(R.ncont, String(this.sonar.count));
      if (this.sheet) this._refreshSheet(o);
    }
  }
  _refreshSheet(o) {
    const a = this.app, R = this.R;
    switch (this.sheet) {
      case 'zones': for (const z of this.zoneBtns) flag(z, 'cur', z.dataset.zone === o.zoneKey); break;
      case 'time': {
        const cur = o.timeLabel === 'midday' ? 'day' : o.timeLabel;
        for (const b of this.timeBtns) pressed(b, b.dataset.time === cur);
        break;
      }
      case 'weather': for (const b of this.wxBtns) pressed(b, b.dataset.weather === o.weatherKey); break;
      case 'log': break;
      case 'systems': {
        for (const b of this.togs) {
          const k = b.dataset.tog;
          pressed(b, k === 'labels' ? a.labelsOn : k === 'captions' ? a.captionsOn : k === 'stats' ? a.statsOn : k === 'full' ? a.fullscreen : a.wakeLock);
        }
        const supported = 'wakeLock' in navigator;
        txt(R.tg_wake, !supported ? 'not supported by this browser' : !a.wakeLock ? 'off: the screen may dim'
          : a.wakeLockActive ? 'active: the screen stays on' : 'waiting: tap the view to activate');
        flag(R.tg_wake, 'ok', supported && a.wakeLock && a.wakeLockActive);
        for (const b of this.lampBtns) pressed(b, b.dataset.lamp === a.lampMode);
        for (const b of this.camBtns) pressed(b, (b.dataset.cam === '1') === (a.curiosity >= 0.5));
        for (const b of this.qBtns) pressed(b, b.dataset.q === a.quality);
        txt(R.qnote, `Running at ${o.tier} quality${a.quality === 'auto' ? ' (chosen for this device)' : ''}. Changing it reloads the dive.`);
        txt(R.fps, o.fps.toFixed(0));
        txt(R.res, Math.round(o.res * 100) + '%');
        txt(R.tier, o.tier);
        txt(R.cost, this.cost.toFixed(2) + ' ms');
        txt(R.gpu, o.gpu || 'unknown');
        txt(R.seed, String(o.seed));
        break;
      }
      default: break;
    }
  }
}
