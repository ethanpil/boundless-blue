// Control-deck markup (built once). Styles live in index.html under "control deck".
import { icon } from './icons.js';

// Depth gauge: a log scale so a 10 m reef, a 4000 m plain and the 8000 m hadal trench all read clearly.
const DMAX = 11000, DK = 5;
export const depthFrac = (d) => Math.min(1, Math.log10(1 + Math.max(0, d) / DK) / Math.log10(1 + DMAX / DK));
export const DEPTH_ZONES = [
  { to: 200, name: 'SUNLIT ZONE', cls: 'z0' },
  { to: 1000, name: 'TWILIGHT ZONE', cls: 'z1' },
  { to: 4000, name: 'MIDNIGHT ZONE', cls: 'z2' },
  { to: 6000, name: 'ABYSSAL ZONE', cls: 'z3' },
  { to: Infinity, name: 'HADAL ZONE', cls: 'z4' },
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
  for (const [d, t, minor] of [[0, '0'], [10, '10'], [30, '30', 1], [100, '100', 1], [200, '200'], [500, '500', 1], [1000, '1k'], [2000, '2k', 1], [4000, '4k'], [8000, '8k', 1]]) {
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

// Zone picker groups, in picker order. A zone whose key is not listed (a zone added later) is placed by its
// water temperature (below 0 °C: polar; up to 6 °C: the deep), else under "More zones" at the end.
export const ZONE_GROUPS = [
  { id: 'shallows', label: 'Shallows & shores', keys: ['seagrass', 'mangrove', 'tidepool', 'sandflat', 'otterkelp', 'biobay', 'jellylake'] },
  { id: 'reefs', label: 'Reefs & forests', keys: ['reef', 'softcoral', 'anemone', 'champagne', 'wall', 'kelp', 'sunkenforest'] },
  { id: 'open', label: 'Open water', keys: ['pelagic', 'sargassum', 'whaleshark', 'seamount', 'whalefall'] },
  { id: 'caves', label: 'Caves, wrecks & ruins', keys: ['cave', 'bluehole', 'wreck', 'ruins'] },
  { id: 'ice', label: 'Polar seas', keys: ['polar', 'iceedge'] },
  { id: 'deep', label: 'The deep', keys: ['coldcoral', 'vents', 'lostcity', 'abyss', 'deepplain', 'hadal'] },
  { id: 'more', label: 'More zones', keys: [] },
];
export function zoneGroup(z) {
  for (const g of ZONE_GROUPS) if (g.keys.includes(z.key)) return g.id;
  return z.tempC < 0 ? 'ice' : z.tempC <= 6 ? 'deep' : 'more';
}

// Instrument-mode buttons. Helm buttons keep their labels at every size; menu and quick-bar labels hide on
// narrow landscape screens. title: the mouse tooltip (what it does, and its key), so icon-only buttons explain
// themselves too. Labels are written in sentence case and set in capitals by CSS (the essentials bar shares them).
const helmBtn = (id, ic, text, label, title, extra = '') => `<button type="button" class="dk-btn dk-hb" id="${id}" aria-label="${label}" title="${title}" ${extra}>${icon(ic)}<span>${text}</span></button>`;
const quickBtn = (id, ic, text, label, title, extra = '') => `<button type="button" class="dk-btn dk-mb" id="${id}" aria-label="${label}" title="${title}" ${extra}>${icon(ic)}<span>${text}</span></button>`;
const menuBtn = (sheet, ic, text, label, title = label) =>
  `<button type="button" class="dk-btn dk-mb" data-sheet="${sheet}" aria-label="${label}" title="${title}" aria-expanded="false" aria-controls="dk-sh-${sheet}">${icon(ic)}<span>${text}</span></button>`;
// Essentials-bar button: always labelled; data-key shows its keyboard shortcut on hover or keyboard focus.
const essBtn = (attrs, ic, text, key = '', kbd = '') => `<button type="button" class="dk-btn dk-eb" ${attrs}${key ? ` data-key="${key}"` : ''}${kbd ? ` aria-keyshortcuts="${kbd}"` : ''}>${icon(ic)}<span>${text}</span></button>`;
const essSheet = (sheet, ic, text, key = '', kbd = '') => essBtn(`data-sheet="${sheet}" aria-expanded="false" aria-controls="dk-sh-${sheet}"`, ic, text, key, kbd);
const sheetHead = (ic, title) =>
  `<header class="dk-sh-h"><span class="dk-sh-t">${icon(ic)}${title}</span><button type="button" class="dk-x" data-close aria-label="Close panel">${icon('close')}</button></header>`;
const tog = (key, ic, title, sub, kbd = '') =>
  `<button type="button" class="dk-tog" data-tog="${key}" aria-pressed="false"${kbd ? ` aria-keyshortcuts="${kbd}"` : ''}>${icon(ic)}<span><b>${title}${kbd ? ` <kbd>${kbd}</kbd>` : ''}</b><small id="dk-tg-${key}">${sub}</small></span><i class="dk-sw" aria-hidden="true"></i></button>`;
const grp = (title) => `<h3 class="dk-grp">${title}</h3>`;
// labelled readout: the label in plain words, with a tooltip saying what it measures
const k = (text, title) => `<span class="dk-k" title="${title}">${text}</span>`;

function zonePicker(app) {
  const tile = (z) => `<button type="button" class="dk-zt" data-zone="${esc(z.key)}" style="--zc:${z.color || '#3aa7c9'};--zd:${z.deep || '#0b3550'}">`
    + `<b>${esc(z.label)}</b><small>${esc(z.subtitle || '')}</small><span class="dk-zgo">tap again to dive ${icon('next')}</span></button>`;
  let h = '';
  for (const g of ZONE_GROUPS) {
    const zs = app.zones.filter((z) => zoneGroup(z) === g.id);
    if (!zs.length) continue;
    h += `<section class="dk-zsec" aria-label="${esc(g.label)}"><h3 class="dk-grp dk-zh">${esc(g.label)}</h3><div class="dk-zgrid">${zs.map(tile).join('')}</div></section>`;
  }
  return h;
}

// The essentials bar: the default deck. One line of status and the everyday actions, all labelled.
function essHTML() {
  return `
<section class="dk-p dk-ess" id="dk-ess" aria-label="Controls">
  <div class="dk-est" aria-live="off">
    <span class="dk-esz" id="dk-ezone">&nbsp;</span>
    <span class="dk-esn">Next: <b id="dk-enext"></b> <span id="dk-eto"></span></span>
    <span class="dk-prog" aria-hidden="true"><i id="dk-eprog"></i></span>
  </div>
  <div class="dk-eacts">
    ${essBtn('data-act="pause" id="dk-epause"', 'pause', 'Pause', 'Space', 'Space')}
    ${essBtn('data-act="next" id="dk-enextz"', 'nextzone', 'Next zone', 'N', 'N')}
    ${essSheet('zones', 'zones', 'Zones')}
    ${essSheet('time', 'clock', 'Time', 'T skips ahead')}
    ${essSheet('weather', 'cloud', 'Weather', 'W changes it')}
    ${essBtn('data-act="sound" id="dk-esnd"', 'sound', 'Sound', 'A', 'A')}
    ${essBtn('data-act="identify" id="dk-eid" aria-pressed="false"', 'identify', 'Identify', 'D', 'D')}
    ${essBtn('data-act="full" id="dk-efull" aria-pressed="false"', 'full', 'Fullscreen', 'F', 'F')}
    ${essSheet('systems', 'more', 'More')}
    ${essBtn('data-act="hide" id="dk-ehide" aria-label="Hide the controls"', 'hide', 'Hide', 'Esc', 'Escape')}
  </div>
</section>`;
}

export function deckHTML(app) {
  const times = app.times.map((t) => `<button type="button" class="dk-opt" data-time="${t}" aria-pressed="false">${icon(t)}<b>${TIME_INFO[t]?.label || t}</b><small>${TIME_INFO[t]?.clock || ''}</small></button>`).join('');
  const wx = app.weathers.map((w) => `<button type="button" class="dk-opt" data-weather="${w}" aria-pressed="false">${icon(w)}<b>${WEATHER_INFO[w] || w}</b></button>`).join('');
  const quals = ['auto', 'low', 'medium', 'high', 'ultra'].map((q) => `<button type="button" data-q="${q}" aria-pressed="false">${q === 'medium' ? 'MED' : q.toUpperCase()}</button>`).join('');
  return `${essHTML()}
<section class="dk-p dk-nav" aria-label="Navigation">
  <button type="button" class="dk-navbtn" data-sheet="zones" aria-label="Current zone. Open the zone picker">
    <span class="dk-k"><i class="dk-led" aria-hidden="true"></i>ZONE</span>
    <span class="dk-zone" id="dk-zone">&nbsp;</span>
    <span class="dk-sub" id="dk-sub">&nbsp;</span>
    <span class="dk-prog" aria-hidden="true"><i id="dk-prog"></i></span>
    <span class="dk-nextl"><span class="dk-k">NEXT</span> <b id="dk-next"></b> <span id="dk-tonext"></span></span>
  </button>
  <div class="dk-trip">
    <span class="dk-tv">${k('DIVE TIME', 'Time since the dive began')}<b id="dk-dive">00:00:00</b></span>
    <span class="dk-tv">${k('DISTANCE', 'Distance travelled on this dive')}<b id="dk-dist">0.00 km</b></span>
    <button type="button" class="dk-tv dk-chip" data-sheet="log" aria-label="Species seen. Open the sightings log"><span class="dk-k">SPECIES</span><b id="dk-species">0</b></button>
  </div>
</section>

<section class="dk-p dk-compass" aria-label="Compass">
  <div class="dk-tape" aria-hidden="true"><canvas id="dk-tape"></canvas><i class="dk-lubber"></i></div>
  <div class="dk-hdgrow">
    <span class="dk-att" aria-hidden="true" title="Attitude: the camera's tilt against the horizon"><i id="dk-hor"></i><b></b></span>
    ${k('HEADING', 'Compass heading: the direction of travel')}<b class="dk-big" id="dk-hdg">000°</b><span class="dk-card" id="dk-card">N</span>
    <span class="dk-k dk-pk" title="Camera tilt: + looking up, − looking down">TILT</span><b id="dk-pitch">+0°</b>
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
  <span class="dk-k dk-ct" title="Depth below the surface (log scale)">DEPTH</span>
  <div class="dk-dg" aria-hidden="true">${depthScale()}<div class="dk-mk dk-smk" id="dk-smk"><i></i></div><div class="dk-mk dk-dmk" id="dk-dmk"><i></i></div></div>
  <div class="dk-dread">
    <b class="dk-big" id="dk-depth">0 m</b>
    <span class="dk-dzone" id="dk-dzone"></span>
    <span class="dk-row">${k('SEABED', 'Depth of the seabed below the surface')}<b id="dk-seabed"></b></span>
    <span class="dk-row">${k('HEIGHT', 'Height above the seabed')}<b id="dk-alt"></b></span>
    <span class="dk-row">${k('UP/DOWN', 'Vertical speed: ▲ rising, ▼ sinking')}<b id="dk-vs"></b></span>
  </div>
</section>

<div class="dk-right">
  <section class="dk-p dk-sonar" aria-label="Sonar">
    <div class="dk-scope" title="Sonar: life and sites around you, the direction of travel up"><canvas id="dk-sonar" aria-hidden="true"></canvas></div>
    <div class="dk-sonrow">
      <button type="button" class="dk-mini" id="dk-range" aria-label="Sonar range, tap to change" title="Sonar range: tap to change">${icon('sonar')}<span id="dk-rangev">60 m</span></button>
      <span class="dk-ncont"><b id="dk-ncont">0</b> contacts</span>
    </div>
    <div class="dk-legend" aria-hidden="true"><span><i class="lg-a"></i>life</span><span><i class="lg-b"></i>large</span><span><i class="lg-p"></i>site</span><span><i class="lg-r"></i>rare</span></div>
  </section>
  <section class="dk-p dk-env" aria-label="Environment">
    <div class="dk-cell">${k('WATER', 'Water temperature')}<b id="dk-temp"></b></div>
    <div class="dk-cell">${k('VISIBILITY', 'How far you can see through the water')}<b id="dk-vis"></b></div>
    <div class="dk-cell dk-lightc">${k('DAYLIGHT', 'Sunlight reaching this depth')}<span class="dk-bar" aria-hidden="true"><i id="dk-light"></i></span><b id="dk-lightv"></b></div>
    <button type="button" class="dk-cell dk-lampbtn" id="dk-lamp" aria-label="Lamps. Tap to cycle auto, on and off" title="Camera lamps: tap to cycle auto, on and off (L)"><span class="dk-k">LAMPS <i class="dk-ledl" id="dk-lampled" aria-hidden="true"></i></span><b id="dk-lampv">AUTO</b></button>
    <div class="dk-cell dk-cur" title="Water current: its speed, and the compass direction it flows toward">${k('CURRENT', 'Water current: its speed, and the compass direction it flows toward')}<span class="dk-cura" id="dk-cura" aria-hidden="true">${icon('arrow')}</span><b id="dk-curv"></b><span class="dk-curd" id="dk-curd"></span></div>
  </section>
</div>

<div class="dk-bottom">
<section class="dk-p dk-helm" aria-label="Helm">
  ${helmBtn('dk-pause', 'pause', 'Pause', 'Pause', 'Pause or play (Space)', 'data-act="pause"')}
  ${helmBtn('dk-slower', 'minus', 'Slower', 'Slower', 'Slower (←)', 'data-act="slower"')}
  <div class="dk-speed" aria-live="off">
    <span class="dk-dial" aria-hidden="true">${speedDial()}<i class="dk-needle dk-set" id="dk-setm"></i><i class="dk-needle" id="dk-needle"></i></span>
    <span class="dk-spcol" title="Speed now in metres per second; below, in knots and the cruising speed set with Slower / Faster"><span class="dk-k">SPEED</span><b class="dk-big" id="dk-spd">0.0</b><small>m/s</small><span class="dk-paused" id="dk-paused">PAUSED</span><span class="dk-kn" id="dk-kn">0.0 kn</span></span>
  </div>
  ${helmBtn('dk-faster', 'plus', 'Faster', 'Faster', 'Faster (→)', 'data-act="faster"')}
  ${helmBtn('dk-nextz', 'nextzone', 'Next zone', 'Next zone', 'Skip ahead to the next zone (N)', 'data-act="next"')}
</section>
<div class="dk-tools">
<section class="dk-p dk-quick" aria-label="Quick settings">
  ${quickBtn('dk-id', 'identify', 'Identify', 'Identify mode', 'Identify: tap or click anything to name it (D)', 'data-act="identify" aria-pressed="false"')}
  ${quickBtn('dk-lampq', 'lampauto', 'Lamps auto', 'Lamps: auto. Tap to cycle auto, on and off', 'Lamps: auto, on or off (L)')}
  ${quickBtn('dk-snd', 'sound', 'Sound', 'Sound', 'Sound on or off (A)', 'data-act="sound"')}
  ${quickBtn('dk-full', 'full', 'Fullscreen', 'Fullscreen', 'Fullscreen (F)', 'data-act="full" aria-pressed="false"')}
  ${quickBtn('dk-simple', 'simple', 'Simple', 'Simple controls', 'Back to the simple control bar (G)', 'data-act="simple"')}
</section>
<section class="dk-p dk-menu" aria-label="Deck menu">
  ${menuBtn('zones', 'zones', 'Zones', 'Zones', 'Zones: dive anywhere')}
  ${menuBtn('time', 'clock', 'Time', 'Time of day')}
  ${menuBtn('weather', 'cloud', 'Weather', 'Weather')}
  ${menuBtn('log', 'log', 'Log', 'Sightings log')}
  ${menuBtn('systems', 'more', 'More', 'More settings')}
  <button type="button" class="dk-btn dk-mb" data-act="hide" aria-label="Close the deck" title="Close the deck (Esc)">${icon('close')}<span>Close</span></button>
</section>
</div>
</div>

<div class="dk-sheet" id="dk-sh-zones" role="dialog" aria-label="Zones">
  ${sheetHead('zones', 'Zones')}
  <div class="dk-sh-b">
    <p class="dk-znow">Now in <b id="dk-znow"></b></p>
    <button type="button" class="dk-wbtn" data-act="next">${icon('nextzone')}<span>Skip ahead to the next zone <small>same dive · <span id="dk-znext"></span></small></span></button>
    <p class="dk-note">Or pick a zone, then tap it again to dive there. The dive and its log carry on in a freshly generated stretch of ocean.</p>
    ${zonePicker(app)}
  </div>
</div>

<div class="dk-sheet" id="dk-sh-time" role="dialog" aria-label="Time of day">
  ${sheetHead('clock', 'Time of day')}
  <div class="dk-sh-b">
    <div class="dk-grid3">${times}</div>
    <button type="button" class="dk-wbtn" data-act="skiptime">${icon('skip')}<span>Skip ahead <small>a few hours (T)</small></span></button>
    <p class="dk-note">The sun moves on its own: a full day and night pass in about an hour.</p>
  </div>
</div>

<div class="dk-sheet" id="dk-sh-weather" role="dialog" aria-label="Weather">
  ${sheetHead('cloud', 'Weather')}
  <div class="dk-sh-b">
    <div class="dk-grid3">${wx}</div>
    <button type="button" class="dk-wbtn" data-act="nextwx">${icon('surge')}<span>Change the weather <small>surprise me (W)</small></span></button>
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

<div class="dk-sheet" id="dk-sh-systems" role="dialog" aria-label="More settings">
  ${sheetHead('more', 'More')}
  <div class="dk-sh-b">
    ${grp('View')}
    <div class="dk-togs">
      ${tog('inst', 'gauge', 'Instruments', 'the full cockpit: depth, compass, sonar and more', 'G')}
      <button type="button" class="dk-wbtn" data-sheet="log" aria-controls="dk-sh-log">${icon('log')}<span>Sightings log <small><b id="dk-mlogn">0</b> species seen on this dive</small></span></button>
    </div>
    ${grp('Dive')}
    <div class="dk-segrow"><span class="dk-k">${icon('next')}SPEED</span>
      <div class="dk-seg dk-spdseg" role="group" aria-label="Speed"><button type="button" data-act="slower" aria-keyshortcuts="ArrowLeft">${icon('minus')}SLOWER</button><b id="dk-mspd" aria-live="off">—</b><button type="button" data-act="faster" aria-keyshortcuts="ArrowRight">${icon('plus')}FASTER</button></div>
      <small class="dk-help">How fast the camera glides (← and → keys).</small></div>
    <div class="dk-segrow"><span class="dk-k">${icon('lamp')}LAMPS</span><div class="dk-seg" role="group" aria-label="Lamps">
      <button type="button" data-lamp="auto" aria-pressed="false">AUTO</button><button type="button" data-lamp="on" aria-pressed="false">ON</button><button type="button" data-lamp="off" aria-pressed="false">OFF</button></div>
      <small class="dk-help">Lights beside the camera. Auto turns them on when it gets dark (L).</small></div>
    <div class="dk-segrow"><span class="dk-k">${icon('camera')}CAMERA</span><div class="dk-seg" role="group" aria-label="Camera mode">
      <button type="button" data-cam="1" aria-pressed="false">DOCUMENTARY</button><button type="button" data-cam="0" aria-pressed="false">STEADY</button></div>
      <small class="dk-help">Documentary turns to follow animals; steady keeps a calm glide ahead.</small></div>
    ${grp('On screen')}
    <div class="dk-togs">
      ${tog('labels', 'eye', 'Names', 'label creatures and objects', 'I')}
      ${tog('captions', 'cc', 'Captions', 'zone titles and notes', 'H')}
      ${tog('alerts', 'fish', 'New species alerts', 'a card when a species is first logged, rare ones too')}
      ${tog('pin', 'pin', 'Keep controls open', 'do not hide them when idle')}
      ${tog('stats', 'stats', 'Stats overlay', 'frame rate and draw calls', 'S')}
    </div>
    ${grp('Sound')}
    <div class="dk-togs">
      ${tog('sound', 'sound', 'Sound', 'ambient sea sounds', 'A')}
      <label class="dk-vol" id="dk-volrow"><span class="dk-k">VOLUME</span><input type="range" id="dk-vol" min="0" max="100" step="1" value="60"><b id="dk-volv">60%</b></label>
    </div>
    ${grp('Device')}
    <div class="dk-togs">
      ${tog('wake', 'awake', 'Keep screen awake', 'checking…')}
    </div>
    <div class="dk-segrow"><span class="dk-k">${icon('quality')}GRAPHICS QUALITY</span><div class="dk-seg dk-seg5" role="group" aria-label="Graphics quality">${quals}</div>
      <p class="dk-note" id="dk-qnote"></p></div>
    ${grp('Share')}
    <button type="button" class="dk-wbtn" id="dk-share">${icon('link')}<span>Copy a link to this dive <small id="dk-sharest">same seed and starting zone</small></span></button>
    <input class="dk-url" id="dk-shareurl" type="text" readonly hidden aria-label="Link to this dive">
    <details class="dk-more">
      <summary>${icon('stats')}<span>Performance details</span></summary>
      <div class="dk-diag" aria-label="Diagnostics">
        <div>${k('FPS', 'Frames drawn per second')}<b id="dk-fps">—</b></div>
        <div>${k('RES', 'Render resolution, lowered automatically on slow devices')}<b id="dk-res">—</b></div>
        <div>${k('TIER', 'Graphics quality in use')}<b id="dk-tier">—</b></div>
        <div>${k('DECK', 'Time these controls take per frame')}<b id="dk-cost">—</b></div>
        <div class="dk-dw"><span class="dk-k">GPU</span><b id="dk-gpu">—</b></div>
        <div class="dk-dw"><span class="dk-k">SEED</span><b id="dk-seed">—</b></div>
      </div>
    </details>
    <p class="dk-keys"><b>Keys</b> M controls (again: instruments) · G instruments · Space pause · ←/→ speed · N next zone · D identify · L lamps · A sound · F fullscreen · T time · W weather · I names · H captions · S stats · Esc close</p>
  </div>
</div>`;
}
