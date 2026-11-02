// Control-deck markup (built once). Styles live in index.html under "control deck".
import { icon } from './icons.js';

// Depth gauge: a log scale so a 10 m reef and a 4000 m plain both read clearly.
const DMAX = 6000, DK = 5;
export const depthFrac = (d) => Math.log10(1 + Math.max(0, d) / DK) / Math.log10(1 + DMAX / DK);
export const DEPTH_ZONES = [
  { to: 200, name: 'SUNLIT ZONE', cls: 'z0' },
  { to: 1000, name: 'TWILIGHT ZONE', cls: 'z1' },
  { to: 4000, name: 'MIDNIGHT ZONE', cls: 'z2' },
  { to: Infinity, name: 'ABYSSAL ZONE', cls: 'z3' },
];

export const TIME_INFO = {
  dawn: { label: 'Dawn', clock: '05:00' }, morning: { label: 'Morning', clock: '08:00' },
  day: { label: 'Midday', clock: '11:00' }, afternoon: { label: 'Afternoon', clock: '15:30' },
  dusk: { label: 'Dusk', clock: '19:00' }, night: { label: 'Night', clock: '23:00' },
};
export const WEATHER_INFO = {
  clear: 'Clear', crystal: 'Crystal clear', overcast: 'Overcast', rain: 'Rain', plankton: 'Plankton bloom', surge: 'Surge',
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export { esc };

function depthScale() {
  const pct = (d) => (depthFrac(d) * 100).toFixed(2);
  let h = '';
  let from = 0;
  for (const z of DEPTH_ZONES) {
    const to = Math.min(z.to, DMAX);
    h += `<i class="dk-band ${z.cls}" style="top:${pct(from)}%;height:${(pct(to) - pct(from)).toFixed(2)}%"></i>`;
    from = to;
  }
  h += `<span class="dk-bl" style="top:${pct(27)}%">SUNLIT</span><span class="dk-bl" style="top:${pct(450)}%">TWILIGHT</span>`
    + `<span class="dk-bl" style="top:${pct(2000)}%">MIDNIGHT</span>`;
  for (const [d, t, minor] of [[0, '0'], [10, '10'], [30, '30', 1], [100, '100'], [200, '200'], [500, '500', 1], [1000, '1k'], [2000, '2k', 1], [4000, '4k']]) {
    h += `<span class="dk-tk${minor ? ' minor' : ''}" style="top:${pct(d)}%">${t}</span>`;
  }
  return h;
}

function clockFace() {
  let t = '';
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, r0 = i % 3 === 0 ? 15 : 17, x0 = 22 + Math.sin(a) * r0, y0 = 22 - Math.cos(a) * r0;
    const x1 = 22 + Math.sin(a) * 19.5, y1 = 22 - Math.cos(a) * 19.5;
    t += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 44 44" class="dk-face" aria-hidden="true"><circle cx="22" cy="22" r="21" class="dk-fbz"/><circle cx="22" cy="22" r="19.5" class="dk-fgl"/><g class="dk-fticks">${t}</g></svg>`;
}

function speedDial() {
  // half dial, square-root scale 0..16 m/s; ticks at 0 1 4 9 16
  let t = '';
  for (const v of [0, 1, 4, 9, 16]) {
    const a = (-90 + 180 * Math.sqrt(v / 16)) * Math.PI / 180;
    const x0 = 30 + Math.sin(a) * 21, y0 = 30 - Math.cos(a) * 21, x1 = 30 + Math.sin(a) * 26, y1 = 30 - Math.cos(a) * 26;
    t += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 60 33" class="dk-dialf" aria-hidden="true"><path class="dk-darc" d="M4 30A26 26 0 0 1 56 30"/><path class="dk-dred" d="M48.38 11.62A26 26 0 0 1 56 30"/><g class="dk-fticks">${t}</g></svg>`;
}

// helm buttons keep their labels at every size; menu and quick-bar labels hide on narrow landscape screens
const helmBtn = (id, ic, text, label) => `<button type="button" class="dk-btn dk-hb" id="${id}" aria-label="${label}">${icon(ic)}<span>${text}</span></button>`;
const quickBtn = (id, ic, text, label, extra = '') => `<button type="button" class="dk-btn dk-mb" id="${id}" aria-label="${label}" ${extra}>${icon(ic)}<span>${text}</span></button>`;
const menuBtn = (sheet, ic, text, label) =>
  `<button type="button" class="dk-btn dk-mb" data-sheet="${sheet}" aria-label="${label}" aria-expanded="false" aria-controls="dk-sh-${sheet}">${icon(ic)}<span>${text}</span></button>`;
const sheetHead = (ic, title) =>
  `<header class="dk-sh-h"><span class="dk-sh-t">${icon(ic)}${title}</span><button type="button" class="dk-x" data-close aria-label="Close panel">${icon('close')}</button></header>`;
const tog = (key, ic, title, sub) =>
  `<button type="button" class="dk-tog" data-tog="${key}" aria-pressed="false">${icon(ic)}<span><b>${title}</b><small id="dk-tg-${key}">${sub}</small></span><i class="dk-sw" aria-hidden="true"></i></button>`;

export function deckHTML(app) {
  const zones = app.zones.map((z) => `<button type="button" class="dk-zt" data-zone="${esc(z.key)}" style="--zc:${z.color || '#3aa7c9'};--zd:${z.deep || '#0b3550'}" aria-label="Dive to ${esc(z.label)}">`
    + `<b>${esc(z.label)}</b><small>${esc(z.subtitle || '')}</small><span class="dk-zgo">tap again to dive ${icon('next')}</span></button>`).join('');
  const times = app.times.map((t) => `<button type="button" class="dk-opt" data-time="${t}" aria-pressed="false">${icon(t)}<b>${TIME_INFO[t]?.label || t}</b><small>${TIME_INFO[t]?.clock || ''}</small></button>`).join('');
  const wx = app.weathers.map((w) => `<button type="button" class="dk-opt" data-weather="${w}" aria-pressed="false">${icon(w)}<b>${WEATHER_INFO[w] || w}</b></button>`).join('');
  const quals = ['auto', 'low', 'medium', 'high', 'ultra'].map((q) => `<button type="button" data-q="${q}" aria-pressed="false">${q === 'medium' ? 'MED' : q.toUpperCase()}</button>`).join('');
  return `
<section class="dk-p dk-nav" aria-label="Navigation">
  <button type="button" class="dk-navbtn" data-sheet="zones" aria-label="Current zone. Open the zone picker">
    <span class="dk-k"><i class="dk-led" aria-hidden="true"></i>ZONE</span>
    <span class="dk-zone" id="dk-zone">&nbsp;</span>
    <span class="dk-sub" id="dk-sub">&nbsp;</span>
    <span class="dk-prog" aria-hidden="true"><i id="dk-prog"></i></span>
    <span class="dk-nextl"><span class="dk-k">NEXT</span> <b id="dk-next"></b> <span id="dk-tonext"></span></span>
  </button>
  <div class="dk-trip">
    <span class="dk-tv"><span class="dk-k">DIVE</span><b id="dk-dive">00:00:00</b></span>
    <span class="dk-tv"><span class="dk-k">DIST</span><b id="dk-dist">0.00 km</b></span>
    <button type="button" class="dk-tv dk-chip" data-sheet="log" aria-label="Species seen. Open the sightings log"><span class="dk-k">SPECIES</span><b id="dk-species">0</b></button>
  </div>
</section>

<section class="dk-p dk-compass" aria-label="Compass">
  <div class="dk-tape" aria-hidden="true"><canvas id="dk-tape"></canvas><i class="dk-lubber"></i></div>
  <div class="dk-hdgrow">
    <span class="dk-att" aria-hidden="true"><i id="dk-hor"></i><b></b></span>
    <span class="dk-k">HDG</span><b class="dk-big" id="dk-hdg">000°</b><span class="dk-card" id="dk-card">N</span>
    <span class="dk-k dk-pk">PITCH</span><b id="dk-pitch">+0°</b>
  </div>
  <div class="dk-watch" id="dk-watchrow"><span class="dk-k">WATCHING</span><b id="dk-watch"></b></div>
</section>

<section class="dk-p dk-time" aria-label="Time and weather">
  <button type="button" class="dk-clockbtn" data-sheet="time" aria-label="Time of day. Open the time picker">
    <span class="dk-clock" aria-hidden="true">${clockFace()}<i class="dk-hand dk-hh" id="dk-hh"></i><i class="dk-hand dk-mh" id="dk-mh"></i><i class="dk-hub"></i></span>
    <span class="dk-tcol"><b class="dk-big" id="dk-clock">00:00</b><span class="dk-tod"><span class="dk-g" id="dk-todg"></span><span id="dk-tod"></span></span></span>
  </button>
  <button type="button" class="dk-wxbtn" data-sheet="weather" aria-label="Weather. Open the weather picker">
    <span class="dk-g" id="dk-wxg"></span><span class="dk-wxl" id="dk-wx"></span>
  </button>
</section>

<section class="dk-p dk-depth" aria-label="Depth">
  <span class="dk-k dk-ct">DEPTH</span>
  <div class="dk-dg" aria-hidden="true">${depthScale()}<div class="dk-mk dk-smk" id="dk-smk"><i></i></div><div class="dk-mk dk-dmk" id="dk-dmk"><i></i></div></div>
  <div class="dk-dread">
    <b class="dk-big" id="dk-depth">0 m</b>
    <span class="dk-dzone" id="dk-dzone"></span>
    <span class="dk-row"><span class="dk-k">BED</span><b id="dk-seabed"></b></span>
    <span class="dk-row"><span class="dk-k">ALT</span><b id="dk-alt"></b></span>
    <span class="dk-row"><span class="dk-k">V/S</span><b id="dk-vs"></b></span>
  </div>
</section>

<div class="dk-right">
  <section class="dk-p dk-sonar" aria-label="Sonar">
    <div class="dk-scope"><canvas id="dk-sonar" aria-hidden="true"></canvas></div>
    <div class="dk-sonrow">
      <button type="button" class="dk-mini" id="dk-range" aria-label="Sonar range, tap to change">${icon('sonar')}<span id="dk-rangev">60 m</span></button>
      <span class="dk-ncont"><b id="dk-ncont">0</b> contacts</span>
    </div>
    <div class="dk-legend" aria-hidden="true"><span><i class="lg-a"></i>life</span><span><i class="lg-b"></i>large</span><span><i class="lg-p"></i>site</span><span><i class="lg-r"></i>rare</span></div>
  </section>
  <section class="dk-p dk-env" aria-label="Environment">
    <div class="dk-cell"><span class="dk-k">TEMP</span><b id="dk-temp"></b></div>
    <div class="dk-cell"><span class="dk-k">VIS</span><b id="dk-vis"></b></div>
    <div class="dk-cell dk-lightc"><span class="dk-k">LIGHT</span><span class="dk-bar" aria-hidden="true"><i id="dk-light"></i></span><b id="dk-lightv"></b></div>
    <button type="button" class="dk-cell dk-lampbtn" id="dk-lamp" aria-label="Lamps. Tap to cycle auto, on and off"><span class="dk-k">LAMPS <i class="dk-ledl" id="dk-lampled" aria-hidden="true"></i></span><b id="dk-lampv">AUTO</b></button>
    <div class="dk-cell dk-cur"><span class="dk-k">CURRENT</span><span class="dk-cura" id="dk-cura" aria-hidden="true">${icon('arrow')}</span><b id="dk-curv"></b><span class="dk-curd" id="dk-curd"></span></div>
  </section>
</div>

<div class="dk-bottom">
<section class="dk-p dk-helm" aria-label="Helm">
  ${helmBtn('dk-pause', 'pause', 'PAUSE', 'Pause')}
  ${helmBtn('dk-slower', 'minus', 'SLOWER', 'Slower')}
  <div class="dk-speed" aria-live="off">
    <span class="dk-dial" aria-hidden="true">${speedDial()}<i class="dk-needle dk-set" id="dk-setm"></i><i class="dk-needle" id="dk-needle"></i></span>
    <span class="dk-spcol"><span class="dk-k">SPEED</span><b class="dk-big" id="dk-spd">0.0</b><small>m/s</small><span class="dk-paused" id="dk-paused">PAUSED</span><span class="dk-kn" id="dk-kn">0.0 kn</span></span>
  </div>
  ${helmBtn('dk-faster', 'plus', 'FASTER', 'Faster')}
  ${helmBtn('dk-nextz', 'nextzone', 'NEXT ZONE', 'Next zone')}
</section>
<div class="dk-tools">
<section class="dk-p dk-quick" aria-label="Quick settings">
  ${quickBtn('dk-id', 'identify', 'IDENTIFY', 'Identify mode', 'aria-pressed="false"')}
  ${quickBtn('dk-lampq', 'lampauto', 'LAMPS AUTO', 'Lamps: auto. Tap to cycle auto, on and off')}
  ${quickBtn('dk-snd', 'sound', 'SOUND', 'Sound')}
  ${quickBtn('dk-full', 'full', 'FULLSCREEN', 'Fullscreen', 'aria-pressed="false"')}
  ${quickBtn('dk-pin', 'pin', 'PIN', 'Keep the deck open', 'aria-pressed="false"')}
</section>
<section class="dk-p dk-menu" aria-label="Deck menu">
  ${menuBtn('zones', 'zones', 'ZONES', 'Zones')}
  ${menuBtn('time', 'clock', 'TIME', 'Time of day')}
  ${menuBtn('weather', 'cloud', 'WEATHER', 'Weather')}
  ${menuBtn('log', 'log', 'LOG', 'Sightings log')}
  ${menuBtn('systems', 'systems', 'SYSTEMS', 'Systems and settings')}
  <button type="button" class="dk-btn dk-mb" id="dk-close" aria-label="Close the deck">${icon('close')}<span>CLOSE</span></button>
</section>
</div>
</div>

<div class="dk-sheet" id="dk-sh-zones" role="dialog" aria-label="Zones">
  ${sheetHead('zones', 'Zones')}
  <div class="dk-sh-b">
    <button type="button" class="dk-wbtn" data-act="next">${icon('nextzone')}<span>Skip ahead to the next zone <small>same dive</small></span></button>
    <p class="dk-note">Or pick a zone, then tap it again to dive there. The dive and its log carry on in a freshly generated stretch of ocean.</p>
    <div class="dk-zgrid">${zones}</div>
  </div>
</div>

<div class="dk-sheet" id="dk-sh-time" role="dialog" aria-label="Time of day">
  ${sheetHead('clock', 'Time of day')}
  <div class="dk-sh-b">
    <div class="dk-grid3">${times}</div>
    <button type="button" class="dk-wbtn" data-act="skiptime">${icon('skip')}<span>Skip ahead <small>a few hours</small></span></button>
    <p class="dk-note">The sun moves on its own: a full day and night pass in about an hour.</p>
  </div>
</div>

<div class="dk-sheet" id="dk-sh-weather" role="dialog" aria-label="Weather">
  ${sheetHead('cloud', 'Weather')}
  <div class="dk-sh-b">
    <div class="dk-grid3">${wx}</div>
    <button type="button" class="dk-wbtn" data-act="nextwx">${icon('surge')}<span>Change the weather <small>surprise me</small></span></button>
    <p class="dk-note">Weather drifts on its own every few minutes and fades in over about a minute and a half.</p>
  </div>
</div>

<div class="dk-sheet" id="dk-sh-log" role="dialog" aria-label="Sightings log">
  ${sheetHead('log', 'Sightings log')}
  <div class="dk-sh-b">
    <div class="dk-logsum"><b id="dk-logn">0</b><span> species seen on this dive</span></div>
    <ol class="dk-loglist" id="dk-loglist"></ol>
  </div>
</div>

<div class="dk-sheet" id="dk-sh-systems" role="dialog" aria-label="Systems">
  ${sheetHead('systems', 'Systems')}
  <div class="dk-sh-b">
    <div class="dk-togs">
      ${tog('labels', 'eye', 'Names', 'label creatures and objects')}
      ${tog('captions', 'cc', 'Captions', 'zone titles and notes')}
      ${tog('alerts', 'fish', 'New species alerts', 'a card when a species is first logged, rare ones too')}
      ${tog('sound', 'sound', 'Sound', 'ambient sea sounds')}
      <label class="dk-vol" id="dk-volrow"><span class="dk-k">VOLUME</span><input type="range" id="dk-vol" min="0" max="100" step="1" value="60"><b id="dk-volv">60%</b></label>
      ${tog('wake', 'awake', 'Keep screen awake', 'checking…')}
      ${tog('full', 'full', 'Fullscreen', 'hide the browser')}
      ${tog('stats', 'stats', 'Stats overlay', 'frame rate and draw calls')}
    </div>
    <div class="dk-segrow"><span class="dk-k">${icon('lamp')}LAMPS</span><div class="dk-seg" role="group" aria-label="Lamps">
      <button type="button" data-lamp="auto" aria-pressed="false">AUTO</button><button type="button" data-lamp="on" aria-pressed="false">ON</button><button type="button" data-lamp="off" aria-pressed="false">OFF</button></div></div>
    <div class="dk-segrow"><span class="dk-k">${icon('camera')}CAMERA</span><div class="dk-seg" role="group" aria-label="Camera mode">
      <button type="button" data-cam="1" aria-pressed="false">DOCUMENTARY</button><button type="button" data-cam="0" aria-pressed="false">STEADY</button></div></div>
    <div class="dk-segrow"><span class="dk-k">${icon('quality')}QUALITY</span><div class="dk-seg dk-seg5" role="group" aria-label="Graphics quality">${quals}</div></div>
    <p class="dk-note" id="dk-qnote"></p>
    <button type="button" class="dk-wbtn" id="dk-share">${icon('link')}<span>Copy a link to this dive <small id="dk-sharest">same seed and starting zone</small></span></button>
    <input class="dk-url" id="dk-shareurl" type="text" readonly hidden aria-label="Link to this dive">
    <div class="dk-diag" aria-label="Diagnostics">
      <div><span class="dk-k">FPS</span><b id="dk-fps">—</b></div>
      <div><span class="dk-k">RES</span><b id="dk-res">—</b></div>
      <div><span class="dk-k">TIER</span><b id="dk-tier">—</b></div>
      <div><span class="dk-k">DECK</span><b id="dk-cost">—</b></div>
      <div class="dk-dw"><span class="dk-k">GPU</span><b id="dk-gpu">—</b></div>
      <div class="dk-dw"><span class="dk-k">SEED</span><b id="dk-seed">—</b></div>
    </div>
    <p class="dk-keys"><b>Keys</b> M deck · Space pause · ←/→ speed · N next zone · D identify · L lamps · A sound · F fullscreen · T time · W weather · I names · H captions · S stats · Esc close</p>
  </div>
</div>`;
}
