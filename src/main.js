import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createHeightfield, SUN_DIR, HALF } from './heightfield.js';
import { createTerrain } from './terrain.js';
import { createSky, createRange, createForest, createBoulders, createVillage, createLift, Obstacles, SKY } from './scenery.js';
import { Skier } from './skier.js';
import { Rider } from './rider.js';
import { Score } from './tricks.js';
import { Challenge, DROPS, GRADES, altitude, freeRideStart } from './events.js';
import { Spray, Track } from './fx.js';
import { ChaseCam } from './camera.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { clamp, lerp, damp } from './util.js';

const $ = (id) => document.getElementById(id);
const CAPTURE = new URLSearchParams(location.search).has('capture');
const KIND = { race: 'Race', trick: 'Freeride', wing: 'Wingsuit', free: 'Free ride' };
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};
const gradeHTML = (g) => `<span class="grade ${g}" title="${GRADES[g].label}">${GRADES[g].double ? '<i></i><i></i>' : '<i></i>'}</span>`;
const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem('varenne.' + k));
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('varenne.' + k, JSON.stringify(v));
    } catch (e) {
      /* storage unavailable: bests last for this visit only */
    }
  },
};
const memBest = {};
const getBest = (id) => store.get('best.' + id) ?? memBest[id] ?? null;
const setBest = (id, v) => {
  memBest[id] = v;
  store.set('best.' + id, v);
};

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
}
const tick = () => new Promise((r) => setTimeout(r, 20));
function progress(p, msg) {
  $('load-bar').style.width = `${Math.round(p * 100)}%`;
  if (msg) $('load-msg').textContent = msg;
}

async function boot() {
  if (!hasWebGL()) {
    $('load-msg').outerHTML = '<div class="err">This game needs WebGL, which this browser has turned off. Try a current Chrome, Safari, Edge or Firefox.</div>';
    return;
  }
  progress(0.05, 'Raising the mountain…');
  await tick();
  try {
    await Promise.race([document.fonts.load('900 40px "Big Shoulders Display"'), new Promise((r) => setTimeout(r, 1500))]);
  } catch (e) {
    /* system fallback fonts */
  }
  const field = createHeightfield();
  progress(0.45, 'Laying snow…');
  await tick();

  const canvas = $('c');
  const mobile = Math.min(innerWidth, innerHeight) < 600;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(SKY.horizon.clone(), 0.00021);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.15, 24000);
  scene.add(new THREE.HemisphereLight('#c2d6f0', '#8a93a3', 1.15));
  const sun = new THREE.DirectionalLight('#fff1de', 2.7);
  const sunDir = new THREE.Vector3(...SUN_DIR).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -55;
  sc.right = 55;
  sc.top = 55;
  sc.bottom = -55;
  sc.near = 10;
  sc.far = 3600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);

  const terrain = createTerrain(field);
  scene.add(terrain.group);
  scene.add(createRange(terrain.material));
  scene.add(createSky());
  progress(0.6, 'Planting the forest…');
  await tick();
  const obstacles = new Obstacles();
  scene.add(createForest(field, obstacles));
  scene.add(createBoulders(field, obstacles));
  scene.add(createVillage(field, obstacles));
  const lift = createLift(field);
  scene.add(lift.group);
  progress(0.75, 'Setting gates…');
  await tick();
  const challenges = DROPS.map((d) => new Challenge(d, field, obstacles));
  for (const c of challenges) scene.add(c.group);

  const skier = new Skier();
  scene.add(skier.root);
  const rider = new Rider(field, obstacles);
  const score = new Score();
  const spray = new Spray();
  scene.add(spray.points);
  const tracks = [new Track(), new Track()];
  for (const t of tracks) scene.add(t.mesh);
  const chase = new ChaseCam(camera, field);
  const input = new Input(window);
  const sound = new Sound();
  const startSound = () => sound.start();
  input.onAny = startSound;
  window.addEventListener('pointerdown', startSound);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.38;
  controls.minDistance = 250;
  controls.maxDistance = 5200;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.enabled = false;

  // ---------------------------------------------------------------- state
  const G = {
    state: 'loading',
    sel: store.get('sel') || DROPS[0].id,
    ch: null,
    free: null,
    endT: -1,
    wipeT: 0,
    runT: 0,
    stats: null,
    camTween: null,
    manual: false,
    bot: null,
    paused: false,
    helpFrom: null,
  };
  if (!DROPS.some((d) => d.id === G.sel)) G.sel = DROPS[0].id;
  const chOf = (id) => challenges.find((c) => c.def.id === id);
  const touch = matchMedia('(pointer: coarse)').matches;

  // ---------------------------------------------------------------- map UI
  const markers = [];
  const addMarker = (id, label, grade, pos, cls = '') => {
    const el = document.createElement('button');
    el.className = `mk ${cls}`;
    el.innerHTML = `<span class="tag">${grade ? gradeHTML(grade) : ''}${label}</span><span class="stem"></span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      select(id);
    });
    $('markers').appendChild(el);
    const m = { id, el, pos };
    markers.push(m);
    return m;
  };
  for (const c of challenges) addMarker(c.def.id, c.def.name, c.def.grade, c.start.clone().setY(c.start.y + 25));
  const freeMarker = addMarker('free', 'Free ride', null, new THREE.Vector3(), 'free');
  freeMarker.el.hidden = true;

  function renderDrops() {
    const nav = $('drops');
    nav.querySelectorAll('.drop, .free').forEach((n) => n.remove());
    for (const c of challenges) {
      const best = getBest(c.def.id);
      const medal = best != null ? c.medalFor(best) || 'none' : null;
      const b = document.createElement('button');
      b.className = 'drop';
      b.setAttribute('aria-pressed', String(G.sel === c.def.id));
      b.innerHTML = `${gradeHTML(c.def.grade)}<span><b>${c.def.name}</b><span class="disc">${KIND[c.def.kind]} · ${GRADES[c.def.grade].label}</span></span>${
        medal ? `<span class="medal ${medal}" title="${medal === 'none' ? 'Finished' : medal}"></span>` : '<span></span>'
      }`;
      b.addEventListener('click', () => select(c.def.id));
      nav.appendChild(b);
    }
    const f = document.createElement('div');
    f.className = 'free';
    f.textContent = 'Free ride: click any slope on the mountain to drop in there.';
    nav.appendChild(f);
  }

  function renderCard() {
    const card = $('card');
    if (G.sel === 'free' && G.free) {
      const f = G.free;
      card.innerHTML = `<div class="row"><span class="kicker">Free ride · No clock</span></div>
        <h2>Your own line</h2>
        <p>Ride from here wherever you like. Tricks still score. Open the mountain view with M when you're done.</p>
        <dl><div><dt>Start</dt><dd>${fmtInt(altitude(field, f.y))}<small>m</small></dd></div>
        <div><dt>Slope</dt><dd>${Math.round(field.slopeDeg(f.x, f.z))}<small>°</small></dd></div>
        <div><dt>Above village</dt><dd>${fmtInt(altitude(field, f.y) - 1850)}<small>m</small></dd></div><div></div></dl>
        <button class="go" id="go">Drop in <span class="key">Enter</span></button>`;
    } else {
      const c = chOf(G.sel);
      const d = c.def;
      const best = getBest(d.id);
      const fmt = (v) => (d.kind === 'race' ? fmtTime(v) : fmtInt(v));
      const count = d.kind === 'race' ? ['Gates', c.gates.length] : d.kind === 'wing' ? ['Rings', c.rings.length] : ['Length', `${(c.length / 1000).toFixed(1)}<small>km</small>`];
      card.innerHTML = `<div class="row">${gradeHTML(d.grade)}<span class="kicker">${KIND[d.kind]} · ${GRADES[d.grade].label}</span></div>
        <h2>${d.name}</h2>
        <p>${d.blurb}</p>
        <dl>
          <div><dt>Start</dt><dd>${fmtInt(c.startAlt)}<small>m</small></dd></div>
          <div><dt>Vertical</dt><dd>${fmtInt(c.drop)}<small>m</small></dd></div>
          <div><dt>${c.maxSlope ? 'Steepest' : 'Line'}</dt><dd>${c.maxSlope ? `${c.maxSlope}<small>°</small>` : `${(c.length / 1000).toFixed(1)}<small>km</small>`}</dd></div>
          <div><dt>${count[0]}</dt><dd>${count[1]}</dd></div>
        </dl>
        <div class="targets">
          <span><i class="medal gold"></i>${fmt(c.medals[0])}</span>
          <span><i class="medal silver"></i>${fmt(c.medals[1])}</span>
          <span><i class="medal bronze"></i>${fmt(c.medals[2])}</span>
          ${best != null ? `<span class="best">Best ${fmt(best)}</span>` : ''}
        </div>
        <button class="go" id="go">Drop in <span class="key">Enter</span></button>`;
    }
    $('go').addEventListener('click', () => dropIn());
  }

  function select(id, fly = true) {
    G.sel = id;
    if (id !== 'free') store.set('sel', id);
    for (const m of markers) m.el.classList.toggle('on', m.id === id);
    renderDrops();
    renderCard();
    if (fly) {
      const p = id === 'free' ? G.free.clone() : chOf(id).start.clone();
      flyTo(p);
    }
  }

  function flyTo(p) {
    const target = p.clone();
    target.y = lerp(p.y, 450, 0.35);
    const off = new THREE.Vector3().subVectors(camera.position, controls.target);
    const dist = clamp(off.length(), 1300, 2600);
    off.y = Math.max(off.y, dist * 0.45);
    off.setLength(dist);
    G.camTween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: target.clone().add(off), t1: target };
  }

  function showMap() {
    G.state = 'map';
    G.endT = -1;
    if (G.ch) G.ch.end();
    G.ch = null;
    skier.root.visible = false;
    for (const t of tracks) t.clear();
    $('mapui').hidden = false;
    $('hud').hidden = true;
    $('results').hidden = true;
    $('pause').hidden = true;
    $('help').hidden = true;
    $('scrim').hidden = true;
    $('markers').hidden = false;
    controls.enabled = true;
    camera.fov = 45;
    camera.updateProjectionMatrix();
    if (!G.mapInit) {
      G.mapInit = true;
      camera.position.set(900, 1900, 2500);
      controls.target.set(-60, 520, -380);
    }
    select(G.sel === 'free' && !G.free ? DROPS[0].id : G.sel, false);
    const p = G.sel === 'free' ? G.free : chOf(G.sel).start;
    flyTo(p.clone());
  }

  function fadeThen(fn) {
    if (G.manual) {
      fn();
      return;
    }
    $('fade').classList.add('on');
    setTimeout(() => {
      fn();
      requestAnimationFrame(() => $('fade').classList.remove('on'));
    }, 360);
  }

  function dropIn() {
    sound.start();
    fadeThen(startRun);
  }

  function startRun() {
    const id = G.sel;
    G.ch?.end();
    G.ch = id === 'free' ? null : chOf(id);
    let kind = 'free';
    if (G.ch) {
      kind = G.ch.def.kind;
      G.ch.begin();
      rider.reset(G.ch.start, G.ch.yaw, kind === 'wing' ? 'wing' : 'ski', kind === 'wing' ? 30 : 0);
    } else {
      const s = freeRideStart(field, G.free.x, G.free.z);
      rider.reset(new THREE.Vector3(s.x, 0, s.z), s.yaw, 'ski', 0);
    }
    G.kind = kind;
    score.reset();
    for (const t of tracks) t.clear();
    G.state = 'ride';
    G.endT = -1;
    G.runT = 0;
    G.wipeT = 0;
    G.stats = { top: 0, dist: 0, startY: rider.pos.y, minY: rider.pos.y, crashes: 0 };
    skier.root.visible = true;
    skier.p.wing = kind === 'wing' ? 1 : 0;
    skier.p.chute = 0;
    skier.p.limp = 0;
    $('mapui').hidden = true;
    $('markers').hidden = true;
    $('hud').hidden = false;
    $('results').hidden = true;
    $('pause').hidden = true;
    $('help').hidden = true;
    $('scrim').hidden = true;
    $('wipe').hidden = true;
    $('touch').hidden = !touch;
    controls.enabled = false;
    camera.fov = 60;
    chase.dir.set(Math.sin(rider.yaw), 0, Math.cos(rider.yaw));
    chase.snap(rider);
    updateHudStatic();
  }

  function updateHudStatic() {
    const ch = G.ch;
    $('ev-name').innerHTML = ch ? `${gradeHTML(ch.def.grade)}${ch.def.name}` : 'Free ride';
  }

  function pause(on) {
    if (on && G.state !== 'ride') return;
    G.paused = on;
    $('pause').hidden = !on;
    $('scrim').hidden = !on;
    $('help').hidden = true;
    $('pause-title').textContent = G.ch ? G.ch.def.name : 'Free ride';
  }

  function showHelp(on) {
    $('help').hidden = !on;
    if (on) {
      G.helpFrom = !$('pause').hidden ? 'pause' : 'map';
      $('pause').hidden = true;
      $('scrim').hidden = false;
    } else {
      if (G.helpFrom === 'pause' && G.paused) $('pause').hidden = false;
      else $('scrim').hidden = true;
    }
  }

  function finishRun() {
    const ch = G.ch;
    score.flush();
    G.state = 'results';
    const d = ch.def;
    const value = d.kind === 'race' ? ch.time + ch.penalty : score.total;
    const prev = getBest(d.id);
    const better = prev == null || (d.kind === 'race' ? value < prev : value > prev);
    if (better) setBest(d.id, value);
    const medal = ch.medalFor(value);
    const fmt = (v) => (d.kind === 'race' ? fmtTime(v) : fmtInt(v));
    const s = G.stats;
    const cells =
      d.kind === 'race'
        ? [
            ['Gates', `${ch.hits}/${ch.gates.length}`],
            ['Penalty', `${ch.penalty} s`],
            ['Top speed', `${Math.round(s.top * 3.6)} km/h`],
          ]
        : d.kind === 'wing'
          ? [
              ['Rings', `${ch.hits}/${ch.rings.length}`],
              ['Top speed', `${Math.round(s.top * 3.6)} km/h`],
              ['Time', fmtTime(ch.time)],
            ]
          : [
              ['Tricks', String(score.tricks)],
              ['Best trick', score.best ? fmtInt(score.best.pts) : '–'],
              ['Biggest air', `${score.maxAir.toFixed(1)} s`],
            ];
    cells.push(['Vertical', `${fmtInt(s.startY - s.minY)} m`], ['Distance', `${(s.dist / 1000).toFixed(2)} km`], ['Wipeouts', String(s.crashes)]);
    const el = $('results');
    el.innerHTML = `<div class="kicker">${d.name} · ${KIND[d.kind]}</div>
      <h2>${medal ? medal[0].toUpperCase() + medal.slice(1) : 'Finished'}</h2>
      <div class="medalbig ${medal || 'none'}">${medal ? '★' : 'No medal'}</div>
      <div class="res-main">${d.kind === 'race' ? fmtTime(value) : `${fmtInt(value)} <small style="font-size:24px">pts</small>`}</div>
      <div class="res-best">${better && prev != null ? 'New personal best' : prev != null ? `Personal best ${fmt(prev)}` : 'First finish recorded'}</div>
      <div class="res-targets"><span><i class="medal gold"></i>${fmt(ch.medals[0])}</span><span><i class="medal silver"></i>${fmt(ch.medals[1])}</span><span><i class="medal bronze"></i>${fmt(ch.medals[2])}</span></div>
      <dl class="res-grid">${cells.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <div class="acts">
        <button class="btn primary" data-a="restart">Ride again <span class="key">Enter</span></button>
        <button class="btn" data-a="map">Mountain view <span class="key">M</span></button>
        <button class="btn" data-a="continue">Keep riding <span class="key">Esc</span></button>
      </div>`;
    el.hidden = false;
    $('scrim').hidden = true;
    sound.chime(!!medal);
  }

  function keepRiding() {
    $('results').hidden = true;
    G.state = 'ride';
  }

  // Buttons
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'resume') pause(false);
    if (a === 'restart') {
      pause(false);
      fadeThen(startRun);
    }
    if (a === 'map') {
      pause(false);
      fadeThen(showMap);
    }
    if (a === 'help') showHelp(true);
    if (a === 'close-help') showHelp(false);
    if (a === 'continue') keepRiding();
  });
  $('b-help').addEventListener('click', () => showHelp(true));
  const setMute = (m) => {
    sound.setMuted(m);
    store.set('muted', m);
    $('b-sound').setAttribute('aria-pressed', String(!m));
    $('snd-wave').style.opacity = m ? 0.15 : 1;
  };
  setMute(!!store.get('muted'));
  $('b-sound').addEventListener('click', () => setMute(!sound.muted));

  // Click a slope to free ride from there.
  const ray = new THREE.Raycaster();
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  canvas.addEventListener('pointerup', (e) => {
    if (G.state !== 'map' || !downAt) return;
    if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(terrain.group.children, false)[0];
    if (!hit) return;
    const p = hit.point;
    if (Math.abs(p.x) > HALF - 160 || Math.abs(p.z) > HALF - 160) return;
    G.free = new THREE.Vector3(p.x, field.height(p.x, p.z), p.z);
    freeMarker.pos.copy(G.free).setY(G.free.y + 25);
    freeMarker.el.hidden = false;
    select('free', false);
  });

  // Touch controls
  if (touch) {
    const stick = $('stick');
    const knob = stick.querySelector('i');
    let sid = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
      input.touch.steer = Math.abs(x) > 0.12 ? x : 0;
      input.touch.fwd = y < -0.3 ? -y : 0;
      input.touch.back = y > 0.3 ? y : 0;
    };
    stick.addEventListener('pointerdown', (e) => {
      sid = e.pointerId;
      stick.setPointerCapture(sid);
      move(e);
    });
    stick.addEventListener('pointermove', (e) => e.pointerId === sid && move(e));
    const end = () => {
      sid = null;
      knob.style.transform = '';
      input.touch.steer = input.touch.fwd = input.touch.back = 0;
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    for (const b of document.querySelectorAll('[data-t]')) {
      const t = b.dataset.t;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('on');
        if (t === 'jump') input.touch.jump = true;
        if (t === 'grab') input.touch.grab = true;
        input.tap(t);
      });
      const up = () => {
        b.classList.remove('on');
        if (t === 'jump' && input.touch.jump) {
          input.touch.jump = false;
          input.untap('jump');
        }
        if (t === 'grab') input.touch.grab = false;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    }
  }

  // ---------------------------------------------------------------- per-frame
  const _side = new THREE.Vector3();
  const _f = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const proj = new THREE.Vector3();
  let feedKey = '';
  let lastHud = 0;
  let simT = 0;

  function handleRiderEvents(evs) {
    for (const e of evs) {
      score.onEvent(e);
      if (e.type === 'land') {
        skier.absorb(e.impact / 14);
        if (e.impact > 3) spray.burst(rider.pos, rider.vel, Math.min(80, e.impact * 6), clamp(e.impact / 10, 0.5, 1.6));
        if (e.air > 0.3) sound.thump(clamp(e.impact / 15));
      }
      if (e.type === 'crash') {
        G.wipeT = 0;
        G.stats.crashes++;
        spray.burst(rider.pos, rider.vel, 90, 1.4);
        sound.thump(1);
        $('wipe-why').textContent = e.reason;
        $('wipe-hint').innerHTML = touch ? 'Tap <b>Back</b> to rewind' : '<span class="key">R</span> rewind to before the fall';
        $('wipe').hidden = false;
      }
      if (e.type === 'chute') sound.whoosh();
      if (e.type === 'wing') {
        sound.whoosh();
        score.push('Wingsuit', 0, 'good');
      }
      if (e.type === 'chuteland') spray.burst(rider.pos, rider.vel, 30, 0.6);
    }
  }

  function doRewind() {
    if (!rider.rewind(3)) return;
    sound.whoosh();
    $('wipe').hidden = true;
    for (const t of tracks) t.add(rider.pos, _side, 0, false);
    skier.p.limp = 0;
    score.push('Rewind', 0, 'bad');
  }

  function simulate(dt, inp) {
    // Global keys
    if (inp.pause) {
      if (!$('help').hidden) showHelp(false);
      else if (G.state === 'results') keepRiding();
      else if (G.state === 'ride') pause(!G.paused);
      else if (G.state === 'map' && !$('help').hidden) showHelp(false);
    }
    if (inp.mute) setMute(!sound.muted);
    if (inp.help) showHelp($('help').hidden);
    if (G.state === 'map') {
      if (inp.restart) dropIn();
      return;
    }
    if (G.state !== 'ride' && G.state !== 'results') return;
    if (inp.map) {
      pause(false);
      fadeThen(showMap);
      return;
    }
    if (inp.restart) {
      pause(false);
      fadeThen(startRun);
      return;
    }
    if (G.paused) return;
    if (inp.cam) chase.far = !chase.far;
    if (inp.rewind && G.state === 'ride') doRewind();

    const drive = G.state === 'results' ? { ...inp, steer: 0, fwd: 0, back: rider.speed > 2 ? 1 : 0, jump: false, jumpPressed: false, jumpReleased: false, wingPressed: false, grab: false } : inp;
    const prev = rider.pos.clone();
    const evs = rider.step(dt, drive);
    handleRiderEvents(evs);
    G.runT += dt;
    if (G.ch) {
      for (const e of G.ch.update(dt, rider)) {
        if (e.type === 'gate') {
          score.onEvent(e);
          if (G.ch.def.kind !== 'trick' || !e.ok) sound.chime(e.ok);
          if (e.pts) score.total += e.pts;
        }
        if (e.type === 'finish') {
          G.endT = 1.6;
          score.push('Finish', 0, 'good');
          sound.chime(true);
        }
      }
    }
    if (G.endT > 0 && G.state === 'ride') {
      G.endT -= dt;
      if (G.endT <= 0) finishRun();
    }
    score.update(dt, rider, rider.mode === 'ski' && rider.grounded);
    const s = G.stats;
    if (rider.mode !== 'crash') {
      s.top = Math.max(s.top, rider.speed);
      s.dist += Math.hypot(rider.pos.x - prev.x, rider.pos.z - prev.z);
      s.minY = Math.min(s.minY, rider.pos.y);
    }
    if (rider.mode === 'crash') {
      G.wipeT += dt;
      if (rider.settled && G.wipeT > 2.6) doRewind();
    }

    // Model pose
    const grounded = rider.mode === 'ski' && rider.grounded;
    skier.skisOn = true;
    skier.update(dt, {
      crouch: grounded ? (inp.jump && G.state === 'ride' ? 0.35 + rider.charge * 0.55 : 0.18 + rider.spray * 0.25 + rider.tuck * 0.35) : rider.mode === 'ski' ? 0.4 : 0,
      tuck: rider.tuck,
      lean: grounded ? rider.lean : 0,
      wing: rider.mode === 'wing' ? 1 : 0,
      chute: rider.mode === 'chute' ? 1 : 0,
      grab: rider.grab,
      grabKind: rider.grabKind,
      limp: rider.mode === 'crash' ? 1 : 0,
      plow: 0,
    });
    skier.root.position.copy(rider.pos);
    skier.root.quaternion.copy(rider.quat);
    if (grounded && rider.brake > 0.05) {
      // Hockey stop: swing the skis across the fall line.
      _q.setFromAxisAngle(_up, rider.brake * 1.1 * (rider.lean >= 0 ? 1 : -1));
      skier.root.quaternion.multiply(_q);
    }
    if (rider.mode === 'crash') {
      _p.set(0, 0.8, 0).applyQuaternion(rider.quat);
      skier.root.position.sub(_p);
    }

    // Snow
    if (grounded) {
      _f.set(Math.sin(rider.yaw), 0, Math.cos(rider.yaw));
      _side.crossVectors(rider.normal, _f).normalize();
      if (rider.speed > 3) spray.spray(dt, rider.pos, rider.vel, _side, rider.spray);
      const hw = 0.05 + rider.spray * 0.3 + rider.brake * 0.4;
      tracks[0].add(_p.copy(rider.pos).addScaledVector(_side, 0.13), _side, hw, rider.speed > 0.5);
      tracks[1].add(_p.copy(rider.pos).addScaledVector(_side, -0.13), _side, hw, rider.speed > 0.5);
    } else {
      tracks[0].add(rider.pos, _side, 0, false);
      tracks[1].add(rider.pos, _side, 0, false);
      if (rider.mode === 'crash' && rider.spray > 0.05) spray.spray(dt, rider.pos, rider.vel, _side.set(1, 0, 0), rider.spray);
    }
    sound.update(rider);
  }

  function updateHud(inp) {
    const ch = G.ch;
    const kind = G.kind;
    if (kind === 'race') {
      $('ev-big').textContent = fmtTime(ch.time + ch.penalty);
      $('ev-sub').innerHTML = `<span>Gate <b>${Math.min(ch.next + 1, ch.gates.length)}/${ch.gates.length}</b></span>${ch.penalty ? `<span class="pen">+${ch.penalty} s penalty</span>` : ''}`;
    } else if (kind === 'wing') {
      $('ev-big').textContent = fmtInt(score.total);
      $('ev-sub').innerHTML = `<span>Ring <b>${Math.min(ch.next + 1, ch.rings.length)}/${ch.rings.length}</b></span><span>Hit <b>${ch.hits}</b></span>`;
    } else {
      $('ev-big').textContent = fmtInt(score.total);
      $('ev-sub').innerHTML = `${ch ? `<span>Gold <b>${fmtInt(ch.medals[0])}</b></span>` : ''}<span>Tricks <b>${score.tricks}</b></span>`;
    }
    $('spd').textContent = Math.round(rider.speed * 3.6);
    const alt = altitude(field, rider.pos.y);
    $('spd-sub').innerHTML =
      rider.mode === 'wing' || rider.mode === 'chute'
        ? `<span class="${rider.clearance < 30 ? 'prox' : ''}">Ground <b>${Math.max(0, Math.round(rider.clearance))} m</b></span><span><b>${fmtInt(alt)}</b> m</span>`
        : `<span><b>${fmtInt(alt)}</b> m</span>`;
    const pend = score.pending;
    const combo = $('combo');
    if (pend > 0) {
      combo.hidden = false;
      combo.innerHTML = `+${fmtInt(pend)}${score.multiplier > 1 ? `<small>×${score.multiplier}</small>` : ''}`;
    } else combo.hidden = true;
    const items = score.feed.slice(-4);
    const key = items.map((f) => f.text + f.pts + Math.floor(f.t > 2.2)).join('|');
    if (key !== feedKey) {
      feedKey = key;
      $('feed').innerHTML = items
        .map((f) => `<div class="it ${f.kind === 'trick' ? '' : f.kind} ${f.t > 2.2 ? 'out' : ''}">${f.text}${f.pts > 0 ? `<em>+${fmtInt(f.pts)}</em>` : ''}</div>`)
        .join('');
    }
    const charging = rider.mode === 'ski' && rider.grounded && rider.charge > 0.05;
    $('charge').hidden = !charging;
    if (charging) $('charge').firstElementChild.style.width = `${rider.charge * 100}%`;

    // Prompt
    let hint = '';
    const k = (x) => `<span class="key">${x}</span>`;
    if (rider.mode === 'crash') hint = '';
    else if (rider.mode === 'wing') hint = `<span>${k('A')}${k('D')} bank</span><span>${k('W')} dive</span><span>${k('S')} flare</span><span>${k('Space')} open canopy</span>`;
    else if (rider.mode === 'chute') hint = `<span>${k('A')}${k('D')} steer</span><span>${k('S')} brake</span>`;
    else if (!rider.grounded && rider.clearance > 18) hint = `<span>${k('Q')} open wingsuit</span><span>${k('A')}${k('D')} spin</span><span>${k('W')}${k('S')} flip</span>`;
    else if (G.runT < 10 || rider.speed < 1) hint = `<span>${k('W')} push off</span><span>${k('A')}${k('D')} carve</span><span>${k('S')} brake</span><span>${k('Space')} jump</span><span>${k('R')} rewind</span><span>${k('Esc')} menu</span>`;
    const pr = $('prompt');
    if (pr.dataset.h !== hint) {
      pr.dataset.h = hint;
      pr.innerHTML = hint;
      pr.hidden = !hint || G.state === 'results';
    }

    // Next target marker
    const tg = ch ? ch.target() : null;
    const tel = $('tgt');
    if (tg && G.state === 'ride') {
      proj.copy(tg).project(camera);
      const behind = proj.z > 1;
      let x = proj.x;
      let y = proj.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const edge = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.9;
      if (edge) {
        const m = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.85, 1e-3);
        x /= m;
        y /= m;
      }
      tel.hidden = false;
      tel.classList.toggle('edge', edge);
      tel.style.transform = `translate(${((x + 1) / 2) * innerWidth}px, ${((1 - y) / 2) * innerHeight}px)`;
      const dist = Math.round(tg.distanceTo(rider.pos));
      const label = kind === 'race' ? (ch.next < ch.gates.length ? `Gate ${ch.next + 1}` : 'Finish') : kind === 'wing' ? `Ring ${ch.next + 1}` : 'Finish';
      $('tgt-lbl').textContent = `${label} · ${dist} m`;
    } else tel.hidden = true;
    void inp;
  }

  function updateMarkers() {
    const w = innerWidth;
    const h = innerHeight;
    for (const m of markers) {
      if (m.el.hidden) continue;
      proj.copy(m.pos).project(camera);
      const vis = proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1;
      m.el.style.visibility = vis ? 'visible' : 'hidden';
      if (vis) m.el.style.transform = `translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  // Test autopilot: steer at the next gate, ring or line point.
  function autopilot(inp) {
    let tg = null;
    if (G.ch && G.ch.line) {
      let bi = 0;
      let bd = Infinity;
      G.ch.line.forEach((p, i) => {
        const d = Math.hypot(p.x - rider.pos.x, p.z - rider.pos.z);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      const p = G.ch.line[Math.min(G.ch.line.length - 1, bi + 3)];
      tg = new THREE.Vector3(p.x, p.h, p.z);
      if (G.ch.gates && G.ch.next < G.ch.gates.length) {
        const g = G.ch.gates[G.ch.next];
        if (Math.hypot(g.x - rider.pos.x, g.z - rider.pos.z) < 60) tg = new THREE.Vector3(g.x, 0, g.z);
      }
    } else if (G.ch) tg = G.ch.target();
    if (!tg) return;
    const want = Math.atan2(tg.x - rider.pos.x, tg.z - rider.pos.z);
    let d = want - rider.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    inp.steer = clamp(-d * 2.5, -1, 1);
    if (rider.mode === 'wing') {
      const dy = tg.y + 4 - rider.pos.y;
      const dist = Math.hypot(tg.x - rider.pos.x, tg.z - rider.pos.z);
      const need = Math.atan2(dy, dist);
      inp.fwd = clamp((-0.42 - need) / 0.73);
      inp.back = clamp((need + 0.42) / 0.62);
    }
  }

  function frame(dt, draw = true) {
    const inp = input.frame(dt);
    if (G.bot) Object.assign(inp, G.bot);
    if (G.auto && G.state === 'ride') autopilot(inp);
    simT += dt;
    lift.update(simT);
    if (G.state === 'map') {
      if (inp.restart) dropIn();
      if (inp.pause && !$('help').hidden) showHelp(false);
      if (inp.mute) setMute(!sound.muted);
      if (inp.help) showHelp($('help').hidden);
      if (G.camTween) {
        const tw = G.camTween;
        tw.t = Math.min(1, tw.t + dt / 1.4);
        const e = tw.t < 0.5 ? 2 * tw.t * tw.t : 1 - (-2 * tw.t + 2) ** 2 / 2;
        camera.position.lerpVectors(tw.p0, tw.p1, e);
        controls.target.lerpVectors(tw.t0, tw.t1, e);
        if (tw.t >= 1) G.camTween = null;
      }
      controls.update();
      updateMarkers();
    } else {
      simulate(dt, inp);
      if (!G.paused) {
        spray.update(dt);
        chase.update(dt, rider);
      }
      if (G.state === 'ride' || G.state === 'results') {
        lastHud += dt;
        updateHud(inp);
      }
    }
    // Shadow box follows the action.
    const focus = G.state === 'map' ? controls.target : rider.pos;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir, 1800);
    terrain.update(camera.position);
    if (draw) renderer.render(scene, camera);
  }

  function resize() {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  progress(0.9, 'Waxing skis…');
  await tick();
  showMap();
  camera.position.copy(G.camTween.p1);
  controls.target.copy(G.camTween.t1);
  G.camTween = null;
  controls.update();
  renderer.compile(scene, camera);
  progress(1);
  $('loading').classList.add('done');
  if (CAPTURE) $('loading').hidden = true;

  let last = performance.now();
  function loop(now) {
    if (G.manual) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Test hooks for headless screenshots.
  window.VF = {
    manual(on) {
      G.manual = on;
      if (!on) {
        last = performance.now();
        requestAnimationFrame(loop);
      }
    },
    advance(sec, step = 1 / 30) {
      const n = Math.max(1, Math.round(sec / step));
      for (let i = 0; i < n; i++) frame(step, i === n - 1);
    },
    select: (id) => select(id),
    drop(id) {
      if (id) G.sel = id;
      startRun();
    },
    bot(b) {
      G.bot = b;
    },
    auto(on) {
      G.auto = on;
    },
    rider,
    score,
    G,
    challenges,
    camera,
    controls,
    field,
  };
}

boot().catch((e) => {
  console.error(e);
  const m = $('load-msg');
  if (m) m.textContent = 'Something went wrong while building the mountain. Reload the page to try again.';
});
