// Headless capture for Boundless Blue (software GL: a frame costs 1-5 s, so keep sizes modest and shots few).
// Usage: node tools/shot.cjs <out.png> "<query>" [advanceSeconds=6] [width=960] [height=540] [mode=canvas|page|deck] [evalJs]
//   env: PORT (dev server port, default 8100), FRAMES (real frames rendered before the capture, default 8)
//   canvas: PNG of the WebGL canvas (scene only).  page: full page incl. HUD/captions.  deck: opens the control deck first.
//   evalJs: optional JS run in the page after advancing (e.g. "__ocean.app.toggleLabels()"), before the final frames.
// Needs the dev server (python3 tools/serve.py 8100), Playwright with Chromium, and `npm install` in tools/
// (three.js is served from tools/node_modules, so no CDN access is needed).
// The sim is stepped with __ocean.advance(); drawing is skipped while advancing, then FRAMES real frames are rendered
// (god rays accumulate over frames). Prints JSON: timings, draw calls, triangles, console errors/warnings.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 8100, FRAMES = +(process.env.FRAMES || 8);
const THREE_DIR = [path.join(__dirname, 'node_modules/three'), '/home/user/boundless-blue/tools/node_modules/three'].find((d) => fs.existsSync(d));
(async () => {
  const [out, query = '', adv = '6', w = '960', h = '540', mode = 'canvas', evalJs = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/KHR_parallel_shader_compile/.test(m.text())) logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__gate = false;
    window.requestAnimationFrame = (cb) => window.__gate ? 0 : raf(cb);
  });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.186.1/**', route => {
    const rel = new URL(route.request().url()).pathname.replace('/npm/three@0.186.1/', '');
    const f = path.join(THREE_DIR, rel);
    if (fs.existsSync(f)) route.fulfill({ body: fs.readFileSync(f), contentType: 'text/javascript' }); else route.abort();
  });
  const t0 = Date.now();
  await page.goto('http://localhost:' + PORT + '/?' + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ocean && window.__ocean.ready, null, { timeout: 600000 });
  await page.evaluate(async () => { await window.__ocean.ready; window.__gate = true; });
  const tReady = Date.now() - t0;
  const res = await page.evaluate(async ([adv, evalJs, FRAMES]) => {
    const o = window.__ocean, post = o.post, real = post.render;
    post.render = () => {};
    for (let i = 0; i < adv; i++) { o.advance(1); await new Promise(r => setTimeout(r, 10)); }
    if (evalJs) { try { await (0, eval)(evalJs); } catch (e) { console.error('evalJs: ' + e.message); } }
    post.render = real;
    const t1 = performance.now();
    o.advance(FRAMES / 30);
    const png = document.querySelector('canvas').toDataURL('image/png');
    const i = o.renderer.info.render;
    return { frameMsSW: Math.round((performance.now() - t1) / FRAMES), calls: i.calls, tris: i.triangles, tier: o.tier,
      depth: +(-o.camera.position.y).toFixed(1), png };
  }, [+adv, evalJs, FRAMES]);
  if (mode === 'canvas') fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
  else {
    if (mode === 'deck') {
      await page.mouse.click(+w / 2, +h / 2); await page.waitForTimeout(400);
      // let the instruments refresh (they update inside tick) without paying for more software-GL frames
      await page.evaluate(async () => { const o = window.__ocean, real = o.post.render; o.post.render = () => {};
        for (let i = 0; i < 6; i++) { o.advance(0.3); await new Promise((r) => setTimeout(r, 120)); } o.post.render = real; });
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: out, timeout: 120000 });
  }
  delete res.png;
  console.log(JSON.stringify({ out, tReady, ...res, logs: logs.slice(0, 12) }));
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
