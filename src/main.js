import './style.css';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Net } from './net.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => Math.round(v * 100) / 100;
const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.75, metalness: 0.05, ...o });
const PAL = [0xe4572e, 0x29b6a6, 0xf2b134, 0x8d99ae, 0x6a4c93];

/* ================= Звук (WebAudio, без файлов) ================= */
const audio = (() => {
  let ctx = null, master = null, nbuf = null, muted = false;
  try { muted = localStorage.getItem('muted') === '1'; } catch (e) { /* нет доступа к storage */ }
  const g = {};
  let wasGrounded = true, airT = 0, prevThr = 0, lastTick = 0;
  const GEARS = [0, 9, 19, 31, 45, 70];

  function noiseLoop(type, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = nbuf; src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filter); filter.connect(gain); gain.connect(master); src.start();
    return { filter, gain };
  }
  function osc(type, freq, dest) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.connect(dest); o.start();
    return o;
  }
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    nbuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nbuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    g.roll = noiseLoop('bandpass', 500, 0.8);   // шорох колёс по асфальту
    g.rumble = noiseLoop('lowpass', 120, 0.7);  // низкий гул (турбо)
    // скрип/визг (обычная коляска, занос, треск при перегрузке)
    const sqGain = ctx.createGain(); sqGain.gain.value = 0;
    const sqFilter = ctx.createBiquadFilter(); sqFilter.type = 'bandpass'; sqFilter.frequency.value = 1300; sqFilter.Q.value = 6;
    sqFilter.connect(sqGain); sqGain.connect(master);
    g.sq = { gain: sqGain, osc: osc('sawtooth', 900, sqFilter) };
    // двигатель турбо
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 3); }
    shaper.curve = curve;
    const engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 800; engFilter.Q.value = 2;
    const engGain = ctx.createGain(); engGain.gain.value = 0;
    shaper.connect(engFilter); engFilter.connect(engGain); engGain.connect(master);
    g.eng = { filter: engFilter, gain: engGain, o1: osc('sawtooth', 60, shaper), o2: osc('square', 30, shaper), o3: osc('sine', 60, shaper) };
    // свист турбины
    const whGain = ctx.createGain(); whGain.gain.value = 0; whGain.connect(master);
    g.wh = { gain: whGain, osc: osc('sine', 2000, whGain) };
  }

  function burst({ type = 'lowpass', f0 = 1000, f1 = f0, q = 0.8, dur = 0.2, vol = 0.5 }) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = nbuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(gn); gn.connect(master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  function tone({ type = 'sine', f0 = 200, f1 = f0, dur = 0.2, vol = 0.4 }) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gn); gn.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  const tick = (v) => burst({ type: 'bandpass', f0: 1800 + Math.random() * 600, q: 3, dur: 0.025, vol: 0.18 * v });
  const thud = (v) => { tone({ f0: 130, f1: 40, dur: 0.2, vol: 0.8 * v }); burst({ f0: 700, f1: 120, dur: 0.15, vol: 0.5 * v }); };
  const pop = () => { burst({ type: 'bandpass', f0: 900, f1: 300, q: 1.2, dur: 0.09, vol: 0.55 }); tone({ type: 'square', f0: 240, f1: 70, dur: 0.09, vol: 0.18 }); };
  function crash(vol = 1) {
    if (!ctx) return;
    burst({ f0: 3500, f1: 150, dur: 1.5, vol: 1.0 * vol });
    tone({ f0: 110, f1: 25, dur: 0.9, vol: 1.0 * vol });
    for (let i = 0; i < 7; i++) {
      setTimeout(() => tone({ type: 'triangle', f0: 500 + Math.random() * 2200, f1: 200, dur: 0.22, vol: 0.28 * vol }), Math.random() * 600);
    }
  }
  const oops = () => {
    tone({ type: 'triangle', f0: 600, f1: 380, dur: 0.28, vol: 0.22 });
    setTimeout(() => tone({ type: 'triangle', f0: 520, f1: 340, dur: 0.22, vol: 0.18 }), 120);
  };
  function setMuted(m) {
    muted = m;
    if (m && window.speechSynthesis) window.speechSynthesis.cancel();
    try { localStorage.setItem('muted', m ? '1' : '0'); } catch (e) { /* нет доступа к storage */ }
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.7, ctx.currentTime, 0.03);
  }
  function rpmOf(sp, thr) {
    let gi = 0;
    while (gi < GEARS.length - 2 && sp >= GEARS[gi + 1]) gi++;
    const f = Math.min(1, (sp - GEARS[gi]) / (GEARS[gi + 1] - GEARS[gi]));
    return 1400 + f * 5200 + thr * 600;
  }
  function update(st) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const set = (prm, v, tc = 0.06) => prm.setTargetAtTime(v, t, tc);
    const sp = st.speed, on = st.grounded && !st.broken;
    const turbo = st.turbo && !st.broken;
    // посадка после прыжка
    if (st.grounded) { if (!wasGrounded && airT > 0.3) thud(Math.min(1, airT)); airT = 0; } else airT += st.dt;
    wasGrounded = st.grounded;
    // качение
    set(g.roll.gain.gain, on ? Math.min(1, sp / 18) * (turbo ? 0.25 : 0.4) : 0);
    set(g.roll.filter.frequency, 300 + sp * 45);
    set(g.rumble.gain.gain, on ? Math.min(1, sp / 30) * (turbo ? 0.35 : 0.1) : 0);
    // скрип обычной коляски / визг на ручнике / треск при перегрузке на склоне
    const skid = st.hand && sp > 3 && on;
    let sq = !turbo && on ? Math.min(1, sp / 5) * (sp < 9 ? 0.05 : 0.025) : 0;
    let sqf = 780 + sp * 18;
    if (skid) { sq = 0.12; sqf = 1700 + Math.random() * 200; }
    if (st.stress > 0.15 && !st.broken) { sq = Math.max(sq, 0.04 + st.stress * 0.12); sqf = 2200 + Math.random() * 900; }
    set(g.sq.gain.gain, sq); set(g.sq.osc.frequency, sqf, 0.03);
    // щелчки колёс (обычная коляска)
    const idx = Math.floor(Math.abs(st.rearSpin) / (Math.PI / 2));
    if (idx !== lastTick) { lastTick = idx; if (on && sp > 0.8 && !turbo) tick(Math.min(1, sp / 8)); }
    // двигатель турбо
    if (turbo) {
      const thr = st.thr, rpm = rpmOf(sp, thr), f = (rpm / 60) * 3;
      set(g.eng.o1.frequency, f, 0.04); set(g.eng.o2.frequency, f / 2, 0.04); set(g.eng.o3.frequency, f, 0.04);
      set(g.eng.filter.frequency, 300 + thr * 2200 + rpm * 0.25);
      set(g.eng.gain.gain, 0.05 + thr * 0.17 + (rpm / 7000) * 0.05);
      set(g.wh.osc.frequency, 1600 + rpm * 0.6, 0.05);
      set(g.wh.gain.gain, thr * Math.min(1, sp / 25) * 0.035);
      if (prevThr > 0 && thr === 0 && sp > 12) { // выстрелы в глушителе
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) setTimeout(pop, 40 + i * (60 + Math.random() * 80));
      }
    } else { set(g.eng.gain.gain, 0, 0.03); set(g.wh.gain.gain, 0, 0.03); }
    prevThr = turbo ? st.thr : 0;
  }
  return { init, update, crash, thud, oops, setMuted, isMuted: () => muted };
})();
window.addEventListener('pointerdown', audio.init);
window.addEventListener('keydown', audio.init);
document.addEventListener('visibilitychange', () => { if (!document.hidden) audio.init(); });

/* ================= Рендер, сцена, небо, свет ================= */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe3ff, 120, 420);
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
const resize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(500, 24, 12),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 p;void main(){float h=clamp(normalize(p).y,0.,1.);gl_FragColor=vec4(mix(vec3(.75,.89,1.),vec3(.12,.4,.85),pow(h,.6)),1.);}',
  })
);
scene.add(sky);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6b7a55, 1.0));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 220 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), M(0x5fa35b));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const plaza = new THREE.Mesh(
  new THREE.CircleGeometry(60, 48),
  M(0x9aa0a6, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
);
plaza.rotation.x = -Math.PI / 2;
plaza.position.y = 0.03;
plaza.receiveShadow = true;
scene.add(plaza);
const grid = new THREE.GridHelper(400, 100, 0x3f7a44, 0x3f7a44);
grid.position.y = 0.05;
grid.material.opacity = 0.35;
grid.material.transparent = true;
scene.add(grid);

/* ================= Физика ================= */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -15, 0) });
world.defaultContactMaterial.friction = 0; // трение реализовано вручную в управлении
world.defaultContactMaterial.restitution = 0;
const groundBody = new CANNON.Body({
  mass: 0,
  shape: new CANNON.Box(new CANNON.Vec3(600, 5, 600)),
  position: new CANNON.Vec3(0, -5, 0),
});
world.addBody(groundBody);

/* ================= Процедурный уровень (InstancedMesh) ================= */
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const boxes = [];

function box(x, y, z, sx, sy, sz, yaw, tilt, col) {
  const qy = new CANNON.Quaternion();
  const qt = new CANNON.Quaternion();
  qy.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
  qt.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), tilt);
  const b = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)),
    position: new CANNON.Vec3(x, y, z),
    quaternion: qy.mult(qt),
  });
  world.addBody(b);
  boxes.push({ b, s: [sx, sy, sz], col });
}

// Сегмент рампы: верхняя поверхность начинается в (x0, h0, z0), длина L, ширина W, наклон t (рад), направление yaw.
// Плита делается достаточно толстой, чтобы доставать до земли (выглядит как цельный блок).
function seg(x0, z0, yaw, L, W, t, h0, col) {
  const c = Math.cos(t), s = Math.sin(t);
  const hEnd = h0 + L * s;
  const T = Math.max(0.4, Math.max(h0, hEnd) * c + 0.3);
  const lx = (L * c) / 2 + (T / 2) * s;
  const ly = h0 + (L * s) / 2 - (T / 2) * c;
  box(x0 + lx * Math.cos(yaw), ly, z0 - lx * Math.sin(yaw), L, T, W, yaw, t, col);
  return { x: x0 + L * c * Math.cos(yaw), z: z0 - L * c * Math.sin(yaw), h: hEnd };
}

// Длинная гора со спуском
let e = seg(-110, -110, 0, 70, 16, 0.2, 0, PAL[0]);
e = seg(e.x, e.z, 0, 14, 16, 0, e.h, PAL[3]);
seg(e.x, e.z, 0, 70, 16, -0.2, e.h, PAL[0]);

// Пирамида с четырьмя заездами
(function pyramid(cx, cz, top) {
  box(cx, top / 2, cz, 10, top, 10, 0, 0, PAL[2]);
  const L = 12, t = Math.asin(top / L), run = L * Math.cos(t) + 5;
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    seg(cx - Math.cos(yaw) * run, cz + Math.sin(yaw) * run, yaw, L, 10, t, 0, PAL[(k + 1) % 5]);
  }
})(70, 60, 3);


// ОПАСНЫЙ СКЛОН: длинный крутой спуск. Если разогнаться выше лимита — коляска развалится.
const SLOPE_LIMIT = 18; // м/с (≈ 65 км/ч)
const SLOPE_Z = 135;
let sl = seg(-125, SLOPE_Z, 0, 60, 18, 0.3, 0, PAL[0]);       // подъём
sl = seg(sl.x, sl.z, 0, 14, 18, 0, sl.h, PAL[2]);              // площадка наверху
const slopeTop = { x: sl.x, h: sl.h };
sl = seg(sl.x, sl.z, 0, 70, 18, -0.3, sl.h, PAL[0]);           // крутой спуск
const slopeZone = { x0: slopeTop.x, x1: slopeTop.x + 58, zc: SLOPE_Z, hw: 9 };

// Лестница-бордюры (для олли)
for (let i = 0; i < 5; i++) box(30 + i * 1.2 + 0.6, ((i + 1) * 0.12) / 2, 0, 1.2, (i + 1) * 0.12, 8, 0, 0, PAL[3]);
for (let i = 0; i < 6; i++) box(-30, 0.09, -20 + i * 7, 14, 0.18, 0.6, 0, 0, PAL[2]);

// Крутой кикер
seg(-45, 35, 0, 7, 8, 0.6, 0, PAL[4]);

// Фанбоксы и трамплины
for (let i = 0; i < 42; i++) {
  const x = (rnd() - 0.5) * 300, z = (rnd() - 0.5) * 300, yaw = rnd() * 6.28, col = PAL[i % 5];
  if (Math.hypot(x, z) < 18) continue;
  if (z > 100 && x > -145 && x < 40) continue; // не мешаем склону
  if (i % 3 === 0) {
    let a = seg(x, z, yaw, 9, 8, 0.25, 0, col);
    a = seg(a.x, a.z, yaw, 8, 8, 0, a.h, PAL[3]);
    seg(a.x, a.z, yaw, 9, 8, -0.25, a.h, col);
  } else {
    const a = seg(x, z, yaw, 7, 6, 0.32, 0, col);
    seg(a.x + 9 * Math.cos(yaw), a.z - 9 * Math.sin(yaw), yaw, 7, 6, -0.3, 1.2, col);
  }
}
// Препятствия
for (let i = 0; i < 16; i++) {
  const x = (rnd() - 0.5) * 120, z = (rnd() - 0.5) * 120;
  if (Math.hypot(x, z) < 12) continue;
  const h = 0.4 + rnd() * 1.4;
  box(x, h / 2, z, 1 + rnd() * 3, h, 1 + rnd() * 3, rnd() * 6.28, 0, PAL[i % 5]);
}

{
  const lvl = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M(0xffffff), boxes.length);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  boxes.forEach((o, i) => {
    p.copy(o.b.position); q.copy(o.b.quaternion); s.set(o.s[0], o.s[1], o.s[2]);
    lvl.setMatrixAt(i, m.compose(p, q, s));
    lvl.setColorAt(i, c.setHex(o.col));
  });
  lvl.castShadow = true;
  lvl.receiveShadow = true;
  lvl.frustumCulled = false;
  scene.add(lvl);
}

// Предупреждающие полосы на спуске и табличка наверху
{
  const N = 9;
  const stripes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M(0xffffff), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.3)), p = new THREE.Vector3(), sc = new THREE.Vector3(1.6, 0.05, 17), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const u = 4 + i * 6.2;
    p.set(slopeTop.x + u * Math.cos(0.3), slopeTop.h - u * Math.sin(0.3) + 0.04, SLOPE_Z);
    stripes.setMatrixAt(i, m.compose(p, q, sc));
    stripes.setColorAt(i, c.setHex(i % 2 ? 0x111111 : 0xffd60a));
  }
  stripes.frustumCulled = false;
  stripes.receiveShadow = true;
  scene.add(stripes);
  const sign = makeLabel('⚠ СКЛОН ≤ ' + Math.round(SLOPE_LIMIT * 3.6) + ' км/ч', false);
  sign.scale.set(9, 2.25, 1);
  sign.position.set(slopeTop.x - 4, slopeTop.h + 4, SLOPE_Z);
  scene.add(sign);
}

// Декор: деревья, горы, облака (без физики, инстансинг)
{
  const N = 150;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), M(0x7a5230), N);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 4, 7), M(0xffffff), N);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const a = rnd() * 6.283, r = 170 + rnd() * 75, sc = 0.8 + rnd() * 0.9;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (x > -145 && x < 45 && Math.abs(z - SLOPE_Z) < 25) s.set(0, 0, 0); else s.set(sc, sc, sc);
    trunks.setMatrixAt(i, m.compose(p.set(x, sc, z), q, s));
    crowns.setMatrixAt(i, m.compose(p.set(x, 4 * sc, z), q, s));
    crowns.setColorAt(i, c.setHSL(0.3 + rnd() * 0.06, 0.55, 0.28 + rnd() * 0.1));
  }
  trunks.castShadow = crowns.castShadow = false;
  trunks.frustumCulled = crowns.frustumCulled = false;
  scene.add(trunks, crowns);

  const mts = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), M(0x7a8fa6), 26);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * 6.283 + rnd() * 0.2, r = 320 + rnd() * 40;
    const w = 70 + rnd() * 60, h = 50 + rnd() * 70;
    mts.setMatrixAt(i, m.compose(p.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r), q, s.set(w, h, w)));
  }
  mts.frustumCulled = false;
  scene.add(mts);

  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 30);
  for (let i = 0; i < 30; i++) {
    const a = rnd() * 6.283, r = 80 + rnd() * 250;
    clouds.setMatrixAt(i, m.compose(p.set(Math.cos(a) * r, 70 + rnd() * 50, Math.sin(a) * r), q, s.set(15 + rnd() * 20, 5 + rnd() * 3, 10 + rnd() * 10)));
  }
  clouds.frustumCulled = false;
  scene.add(clouds);
}

/* ================= Модель коляски ================= */
// Система координат шасси: вперёд +X, вверх +Y, вправо +Z. Начало — центр масс.
const WHEELS = [
  { x: 0.6, y: -0.35, z: -0.42, r: 0.2, front: true },
  { x: 0.6, y: -0.35, z: 0.42, r: 0.2, front: true },
  { x: -0.4, y: -0.13, z: -0.58, r: 0.42, front: false },
  { x: -0.4, y: -0.13, z: 0.58, r: 0.42, front: false },
];

// Скины: мощность (л.с.) и крутящий момент (Н·м) реально влияют на разгон.
const SKINS = [
  { name: 'Обычная', hp: 40, nm: 280, color: null, turbo: false },
  { name: 'Турбо', hp: 1000, nm: 1500, color: 0xff3b00, turbo: true },
];

function createChair(color) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.163;
  group.add(body);
  const accent = M(color);
  const dark = M(0x23262d);
  const metal = M(0xc5ccd6, { metalness: 0.5, roughness: 0.4 });
  const gold = M(0xffc300, { metalness: 0.8, roughness: 0.3, emissive: 0x331a00 });
  const skin = M(0xf1c27d), shirt = M(0x3a86ff), pants = M(0x1d3557);
  const box = (w, h, d, mat, x, y, z, rz = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    mesh.castShadow = true;
    body.add(mesh);
    return mesh;
  };
  box(0.5, 0.06, 0.5, accent, -0.15, -0.2, 0);          // сиденье
  box(0.06, 0.55, 0.5, accent, -0.4, 0.08, 0);          // спинка
  for (const sd of [-1, 1]) {
    box(0.95, 0.04, 0.04, metal, 0.05, -0.28, sd * 0.27); // рама
    box(0.04, 0.55, 0.04, metal, -0.42, 0.02, sd * 0.27); // стойка спинки
    box(0.42, 0.04, 0.05, metal, -0.18, 0.12, sd * 0.3);  // подлокотник
    box(0.04, 0.3, 0.04, metal, 0.05, -0.12, sd * 0.3);   // опора подлокотника
    box(0.2, 0.04, 0.04, dark, -0.55, 0.33, sd * 0.27);   // ручка для толкания
    box(0.04, 0.3, 0.04, metal, 0.62, -0.43, sd * 0.2);   // подножка
    box(0.45, 0.13, 0.14, pants, 0.1, -0.12, sd * 0.12);  // бедро
    box(0.12, 0.5, 0.14, pants, 0.5, -0.27, sd * 0.12, 0.927); // голень
    box(0.2, 0.07, 0.14, dark, 0.73, -0.45, sd * 0.12);   // ступня
    box(0.09, 0.42, 0.09, shirt, -0.28, 0.14, sd * 0.27); // рука
  }
  box(0.22, 0.5, 0.38, shirt, -0.3, 0.12, 0);            // торс
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), skin);
  head.position.set(-0.3, 0.5, 0);
  head.castShadow = true;
  body.add(head);

  // Элементы турбо-скина: спойлер, выхлопные трубы, огонь
  const extras = new THREE.Group();
  body.add(extras);
  const ex = (geo, mat, x, y, z, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.castShadow = true;
    extras.add(m);
    return m;
  };
  ex(new THREE.BoxGeometry(0.28, 0.04, 0.8), gold, -0.66, 0.78, 0);
  for (const sd of [-1, 1]) {
    ex(new THREE.BoxGeometry(0.04, 0.3, 0.04), gold, -0.6, 0.62, sd * 0.3);
    ex(new THREE.CylinderGeometry(0.06, 0.07, 0.35, 8), gold, -0.62, -0.05, sd * 0.17, Math.PI / 2);
  }
  extras.visible = false;
  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a00, fog: false });
  for (const sd of [-1, 1]) {
    const f = ex(new THREE.ConeGeometry(0.09, 0.6, 6), flameMat, -1.0, -0.05, sd * 0.17, Math.PI / 2);
    f.castShadow = false;
    f.visible = false;
    flames.push(f);
  }

  const wheels = WHEELS.map((c) => {
    const g = new THREE.Group();
    g.position.set(c.x, c.y, c.z);
    const w = c.front ? 0.1 : 0.08;
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(c.r, c.r, w, 14).rotateX(Math.PI / 2), dark);
    add(new THREE.CylinderGeometry(c.r * 0.35, c.r * 0.35, w + 0.02, 8).rotateX(Math.PI / 2), metal);
    add(new THREE.BoxGeometry(c.r * 1.8, c.r * 0.12, w * 0.6), metal);
    add(new THREE.BoxGeometry(c.r * 1.8, c.r * 0.12, w * 0.6), metal).rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(c.r * 0.3, c.r * 0.3, w + 0.03), M(0xffd60a), c.r * 0.7, 0, 0); // маркер вращения
    if (!c.front) {
      const rim = add(new THREE.TorusGeometry(c.r * 0.82, 0.015, 5, 16), metal, 0, 0, Math.sign(c.z) * (w / 2 + 0.06));
      rim.castShadow = false;
    }
    group.add(g);
    return { group: g, front: c.front, r: c.r };
  });
  return { group, body, wheels, accent, extras, flames, baseColor: color, skin: 0 };
}

function applySkin(ch, idx) {
  const sk = SKINS[idx] || SKINS[0];
  ch.skin = SKINS[idx] ? idx : 0;
  ch.extras.visible = sk.turbo;
  ch.accent.color.setHex(sk.color ?? ch.baseColor);
  ch.accent.emissive.setHex(sk.turbo ? 0x400800 : 0x000000);
  if (!sk.turbo) ch.flames.forEach((f) => { f.visible = false; });
}
function flicker(ch, on) {
  const show = on && SKINS[ch.skin].turbo;
  ch.flames.forEach((f) => { f.visible = show; if (show) f.scale.set(1, 0.6 + Math.random() * 0.9, 1); });
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const wheelLocalQuat = (w, steer, spin, out) =>
  out.copy(_qa.setFromAxisAngle(AY, w.front ? steer : 0)).multiply(_qb.setFromAxisAngle(AZ, spin));

/* ================= Локальная коляска (твёрдое тело + аркадное вождение) ================= */
const myColor = PAL[Math.floor(Math.random() * PAL.length)];
const chair = createChair(myColor);
scene.add(chair.group);

const MASS = 150;
const STEP = 1 / 120;
const chassis = new CANNON.Body({
  mass: MASS,
  position: new CANNON.Vec3(0, 1, 0),
  linearDamping: 0.01,
  angularDamping: 0.4,
});
chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.18, 0.38)), new CANNON.Vec3(0, 0.1, 0));
WHEELS.forEach((w) => chassis.addShape(new CANNON.Sphere(w.r), new CANNON.Vec3(w.x, w.y, w.z)));
world.addBody(chassis);

const _f = new CANNON.Vec3(), _u = new CANNON.Vec3(), _p = new CANNON.Vec3(), _r = new CANNON.Vec3(), _w = new CANNON.Vec3(), _t = new CANNON.Vec3();
const X1 = new CANNON.Vec3(1, 0, 0), Y1 = new CANNON.Vec3(0, 1, 0);

function resetChair(x, y, z, yaw) {
  chassis.position.set(x, y, z);
  chassis.quaternion.setFromAxisAngle(Y1, yaw);
  chassis.velocity.setZero();
  chassis.angularVelocity.setZero();
  chassis.force.setZero();
  chassis.torque.setZero();
  groundT = 0;
}

// --- определение опоры: смотрим контакты шасси с землёй/рампами после каждого шага ---
const nG = new CANNON.Vec3(0, 1, 0);
let groundT = 0;
world.addEventListener('postStep', () => {
  let cnt = 0;
  _t.set(0, 0, 0);
  for (const c of world.contacts) {
    let nx, ny, nz;
    if (c.bj === chassis) { nx = c.ni.x; ny = c.ni.y; nz = c.ni.z; }
    else if (c.bi === chassis) { nx = -c.ni.x; ny = -c.ni.y; nz = -c.ni.z; }
    else continue;
    if (ny > 0.45) { _t.x += nx; _t.y += ny; _t.z += nz; cnt++; }
  }
  if (cnt) { _t.normalize(); nG.copy(_t); groundT = 0.15; }
});

/* ================= Управление ================= */
const keys = {};
const keyMap = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'hand', ShiftRight: 'hand',
};
const typing = () => document.activeElement && document.activeElement.id === 'otherid';
const input = { thr: 0, steer: 0, hand: false };
let skinIdx = 0;
let lastJump = 0;
const isGrounded = () => groundT > 0;

function updateSkinUI() {
  const sk = SKINS[skinIdx];
  $('skin').textContent = `Скин: ${sk.name} · ${sk.hp} л.с. · ${sk.nm} Н·м`;
}
function setSkin(i) { skinIdx = i; applySkin(chair, i); updateSkinUI(); }
$('skin').addEventListener('click', () => { setSkin((skinIdx + 1) % SKINS.length); $('skin').blur(); });
setSkin(0);

let broken = false, brokenT = 0, stress = 0;
function unbreak() {
  if (!broken) return;
  broken = false; brokenT = 0; stress = 0;
  chair.group.visible = true;
  chassis.mass = MASS;
  chassis.updateMassProperties();
  chassis.collisionFilterMask = -1;
}
function respawn(origin) {
  if (broken) { unbreak(); origin = true; }
  chassis.vectorToWorldFrame(X1, _f);
  const yaw = origin ? 0 : Math.atan2(-_f.z, _f.x);
  const p = origin ? { x: 0, y: 1, z: 0 } : { x: chassis.position.x, y: chassis.position.y + 1.5, z: chassis.position.z };
  resetChair(p.x, p.y, p.z, yaw);
}
function ollie() {
  const now = performance.now();
  if (!isGrounded() || now - lastJump < 400) return;
  lastJump = now;
  chassis.velocity.x += nG.x * 5.2; chassis.velocity.y += nG.y * 5.2; chassis.velocity.z += nG.z * 5.2;
}
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'F11') { ev.preventDefault(); autoFull = false; toggleFull(); return; }
  if (typing()) return;
  if (ev.code === 'Space') { ev.preventDefault(); if (!ev.repeat) ollie(); return; }
  if (ev.code === 'KeyR') { respawn(false); return; }
  if (ev.code === 'KeyM' && !ev.repeat) { toggleMute(); return; }
  if (ev.code === 'KeyT' && !ev.repeat) { setSkin((skinIdx + 1) % SKINS.length); return; }
  const k = keyMap[ev.code];
  if (k) { keys[k] = true; ev.preventDefault(); }
});
window.addEventListener('keyup', (ev) => { const k = keyMap[ev.code]; if (k) keys[k] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

/* ----- Полноэкранный режим (F11 / кнопка / автоматически при первом касании или клавише) ----- */
const rootEl = document.documentElement;
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function enterFull() {
  const f = rootEl.requestFullscreen || rootEl.webkitRequestFullscreen;
  if (!f) return;
  try {
    const pr = f.call(rootEl);
    if (pr && pr.then) pr.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* не поддерживается */ } }).catch(() => {});
  } catch (e) { /* браузер запретил */ }
}
function exitFull() { (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document); }
function toggleFull() { if (isFull()) exitFull(); else enterFull(); }
// Браузеры разрешают полноэкранный режим только после действия пользователя —
// поэтому «автоматически» = при самом первом касании/клике/нажатии клавиши.
let autoFull = true;
const autoEnter = () => { if (!autoFull) return; autoFull = false; if (!isFull()) enterFull(); };
window.addEventListener('pointerup', autoEnter);
window.addEventListener('keydown', (ev) => { if (ev.code !== 'F11') autoEnter(); });

/* ----- Сенсорное управление ----- */
const isTouch = new URLSearchParams(location.search).has('touch') || window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
if (isTouch) {
  document.body.classList.add('touch', 'menu-closed');
  $('menu').addEventListener('click', () => document.body.classList.toggle('menu-closed'));
}
$('fs').addEventListener('click', toggleFull);
function toggleMute() { audio.setMuted(!audio.isMuted()); $('snd').textContent = audio.isMuted() ? '🔇' : '🔊'; }
$('snd').textContent = audio.isMuted() ? '🔇' : '🔊';
$('snd').addEventListener('click', toggleMute);
document.querySelectorAll('#touch [data-k]').forEach((b) => {
  const k = b.dataset.k;
  const down = (ev) => { ev.preventDefault(); b.setPointerCapture(ev.pointerId); keys[k] = true; b.classList.add('on'); };
  const up = () => { keys[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
});
document.querySelectorAll('#touch [data-act]').forEach((b) => {
  b.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    if (b.dataset.act === 'jump') ollie();
    else if (b.dataset.act === 'respawn') respawn(false);
    else if (b.dataset.act === 'skin') setSkin((skinIdx + 1) % SKINS.length);
  });
});
window.addEventListener('contextmenu', (ev) => { if (isTouch) ev.preventDefault(); });

// --- физика вождения: вызывается перед КАЖДЫМ внутренним шагом симуляции ---
const BRAKE = 12;      // м/с² торможение
const K_DRAG = 0.011;  // сопротивление воздуха: a = K * v²
const R_WHEEL = 0.42;
world.addEventListener('preStep', () => {
  if (broken) return;
  const dt = STEP;
  groundT -= dt;
  const v = chassis.velocity, av = chassis.angularVelocity;
  chassis.vectorToWorldFrame(X1, _f);
  chassis.vectorToWorldFrame(Y1, _u);
  if (groundT > 0) {
    // направление «вперёд» вдоль поверхности
    const d = _f.dot(nG);
    _p.set(_f.x - nG.x * d, _f.y - nG.y * d, _f.z - nG.z * d);
    if (_p.normalize() < 1e-6) _p.copy(_f);
    _p.cross(nG, _r); // вправо
    const vf = v.dot(_p), vr = v.dot(_r);
    const sk = SKINS[skinIdx];
    const P = sk.hp * 745.7, aT = sk.nm / (R_WHEEL * MASS);
    let a = 0;
    if (input.hand) {
      a = -Math.sign(vf) * 6;
    } else if (input.thr > 0) {
      a = Math.min(aT, P / (MASS * Math.max(vf, 1)));
      if (vf < -1) a += BRAKE;
    } else if (input.thr < 0) {
      if (vf > 1) a = -BRAKE;
      else a = -0.45 * Math.min(aT, P / (MASS * Math.max(-vf, 1)));
    } else if (Math.abs(vf) > 0.01) {
      a = -Math.sign(vf) * Math.min(Math.abs(vf) / dt, 1.2);
    }
    a -= K_DRAG * vf * Math.abs(vf);
    let nvf = vf + a * dt;
    if (!input.hand && input.thr === 0 && Math.abs(nvf) < 1.5) nvf *= 0.85; // стоит на склоне
    if (input.hand && vf * nvf < 0) nvf = 0;
    const grip = input.hand ? 0.012 : 0.14;
    const nvr = vr * (1 - grip);
    v.x += _p.x * (nvf - vf) + _r.x * (nvr - vr);
    v.y += _p.y * (nvf - vf) + _r.y * (nvr - vr);
    v.z += _p.z * (nvf - vf) + _r.z * (nvr - vr);

    // руль: целевая угловая скорость вокруг нормали поверхности
    const sp = Math.abs(vf);
    let wd = input.steer * Math.min(2.2, 12 / Math.max(sp, 5)) * Math.min(1, sp / 2.5) * Math.sign(vf || 1);
    if (input.hand) wd = input.steer * 2.0;
    const wn = av.dot(nG);
    const k = Math.min(1, dt * 12);
    av.x += nG.x * (wd - wn) * k; av.y += nG.y * (wd - wn) * k; av.z += nG.z * (wd - wn) * k;

    // «самовыравнивание»: коляска держится колёсами на поверхности
    if (_u.dot(nG) > 0.2) {
      _u.cross(nG, _w);
      av.x += _w.x * 40 * dt; av.y += _w.y * 40 * dt; av.z += _w.z * 40 * dt;
      const wn2 = av.dot(nG);
      const dmp = Math.min(1, dt * 9);
      av.x -= (av.x - nG.x * wn2) * dmp; av.y -= (av.y - nG.y * wn2) * dmp; av.z -= (av.z - nG.z * wn2) * dmp;
    }
  } else {
    av.y += input.steer * dt * 5; // немного управления в воздухе
  }
  const sp2 = v.length();
  if (sp2 > 70) v.scale(70 / sp2, v);
});

let flipT = 0;
const spin = [0, 0, 0, 0];
function control() {
  if (broken) { input.thr = 0; input.steer = 0; input.hand = false; return 0; }
  const k = typing() ? {} : keys;
  input.thr = (k.up ? 1 : 0) - (k.down ? 1 : 0);
  input.steer = (k.left ? 1 : 0) - (k.right ? 1 : 0);
  input.hand = !!k.hand;
  chassis.vectorToWorldFrame(X1, _f);
  chassis.vectorToWorldFrame(Y1, _u);
  _p.set(_f.x, 0, _f.z); _p.normalize();
  return chassis.velocity.dot(_p);
}
let steerCur = 0;

/* ================= Камера ================= */
let camYaw = 0, userYaw = 0, pitch = 0.32, dist = 7.5, dragging = false;
const cv = renderer.domElement;
let lastX = 0, lastY = 0;
cv.addEventListener('pointerdown', (ev) => {
  dragging = true;
  lastX = ev.clientX; lastY = ev.clientY;
  cv.setPointerCapture(ev.pointerId);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
});
cv.addEventListener('pointerup', () => { dragging = false; });
cv.addEventListener('pointercancel', () => { dragging = false; });
cv.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  userYaw -= (ev.clientX - lastX) * 0.006;
  pitch = clamp(pitch + (ev.clientY - lastY) * 0.004, 0.08, 1.3);
  lastX = ev.clientX; lastY = ev.clientY;
});
cv.addEventListener('wheel', (ev) => { dist = clamp(dist + ev.deltaY * 0.005, 3, 14); }, { passive: true });

const camTarget = new THREE.Vector3(), camWanted = new THREE.Vector3();
let camInit = false;
function updateCamera(dt) {
  chassis.vectorToWorldFrame(X1, _f);
  const heading = Math.atan2(-_f.z, _f.x);
  let d = heading - camYaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  camYaw += d * (camInit ? 1 - Math.exp(-dt * 3.5) : 1);
  if (!dragging) userYaw *= Math.exp(-dt * 1.2);
  const a = camYaw + userYaw;
  camTarget.set(chassis.position.x, chassis.position.y + 0.8, chassis.position.z);
  camWanted.set(
    camTarget.x - Math.cos(a) * Math.cos(pitch) * dist,
    camTarget.y + Math.sin(pitch) * dist,
    camTarget.z + Math.sin(a) * Math.cos(pitch) * dist
  );
  camWanted.y = Math.max(camWanted.y, 0.5);
  if (camInit) camera.position.lerp(camWanted, 1 - Math.exp(-dt * 12)); else camera.position.copy(camWanted);
  camInit = true;
  camera.lookAt(camTarget);
  sky.position.copy(camera.position);
  const fov = 65 + Math.min(chassis.velocity.length() / 45, 1) * 18;
  if (Math.abs(fov - camera.fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

/* ================= Подвеска (пружины-демпферы кузова относительно колёс) ================= */
// Кузов «сидит» на колёсах на трёх пружинах: ход вверх-вниз, тангаж (приседание при разгоне,
// клевок при торможении) и крен в поворотах. Приземление после прыжка заметно проседает.
const susp = { y: 0, vy: 0, p: 0, vp: 0, r: 0, vr: 0 };
const prevV = new CANNON.Vec3();
let accF = 0, accU = 0, accR = 0;
function updateSuspension(dt) {
  const v = chassis.velocity;
  _t.set((v.x - prevV.x) / dt, (v.y - prevV.y) / dt, (v.z - prevV.z) / dt);
  prevV.copy(v);
  chassis.vectorToLocalFrame(_t, _w); // ускорение в осях коляски: x — вперёд, y — вверх, z — вправо
  const k = 1 - Math.exp(-dt * 18);
  accF += (clamp(_w.x, -40, 40) - accF) * k;
  accU += (clamp(_w.y, -60, 90) - accU) * k;
  accR += (clamp(_w.z, -40, 40) - accR) * k;
  const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
  for (let i = 0; i < n; i++) {
    susp.vy += (-170 * susp.y - 14 * susp.vy - accU) * h;
    susp.y = clamp(susp.y + susp.vy * h, -0.16, 0.08);
    susp.vp += (-140 * susp.p - 12 * susp.vp + 1.1 * accF) * h;
    susp.p = clamp(susp.p + susp.vp * h, -0.2, 0.2);
    susp.vr += (-140 * susp.r - 12 * susp.vr - 0.9 * accR) * h;
    susp.r = clamp(susp.r + susp.vr * h, -0.16, 0.16);
  }
  chair.body.position.y = 0.163 + susp.y;
  chair.body.rotation.set(susp.r, 0, susp.p);
}

/* ================= Синхронизация графики с физикой ================= */
const _ql = new THREE.Quaternion();
function syncVisuals(dt, fs) {
  chair.group.position.copy(chassis.position);
  chair.group.quaternion.copy(chassis.quaternion);
  steerCur += (input.steer * 0.45 - steerCur) * Math.min(1, dt * 9);
  for (let i = 0; i < 4; i++) {
    const w = chair.wheels[i];
    spin[i] -= (fs * dt) / w.r;
    wheelLocalQuat(w, steerCur, spin[i], w.group.quaternion);
  }
  updateSuspension(dt);
  if (stress > 0.15) { // кузов трясётся перед разрушением
    const a = stress * 0.04;
    chair.body.position.x += (Math.random() - 0.5) * a;
    chair.body.position.z += (Math.random() - 0.5) * a;
    chair.body.rotation.z += (Math.random() - 0.5) * a * 2;
  }
  flicker(chair, input.thr > 0);
  chassis.vectorToWorldFrame(Y1, _u);
  flipT = _u.y < 0.35 ? flipT + dt : 0;
  $('hint').style.display = flipT > 1 ? 'block' : 'none';
  sun.position.set(chassis.position.x + 45, 75, chassis.position.z + 28);
  sun.target.position.copy(chassis.position);
  $('speed').textContent = Math.round(chassis.velocity.length() * 3.6);
}


/* ================= Частицы, обломки, разрушение на склоне ================= */
const MAXP = 320;
const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pVel = new Float32Array(MAXP * 3);
const pBase = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pMax = new Float32Array(MAXP);
for (let i = 0; i < MAXP; i++) pPos[i * 3 + 1] = -999;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.7, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
pts.frustumCulled = false;
scene.add(pts);
let pHead = 0;
function emit(x, y, z, vx, vy, vz, life, r, g, b) {
  const i = pHead; pHead = (pHead + 1) % MAXP;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pBase[i * 3] = r; pBase[i * 3 + 1] = g; pBase[i * 3 + 2] = b;
  pLife[i] = pMax[i] = life;
}
function updateParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    const j = i * 3;
    if (pLife[i] <= 0) { pPos[j + 1] = -999; pCol[j] = pCol[j + 1] = pCol[j + 2] = 0; continue; }
    pVel[j + 1] -= 6 * dt;
    pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
    const damp = 1 - dt * 1.2;
    pVel[j] *= damp; pVel[j + 1] *= damp; pVel[j + 2] *= damp;
    const f = pLife[i] / pMax[i];
    pCol[j] = pBase[j] * f; pCol[j + 1] = pBase[j + 1] * f; pCol[j + 2] = pBase[j + 2] * f;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}
const rr = (a, b) => a + Math.random() * (b - a);
function burstFx(pos, vel) {
  for (let i = 0; i < 120; i++) { // искры и огонь
    const a = Math.random() * 6.283, e = rr(-0.2, 1);
    const sp = rr(4, 14);
    emit(pos.x, pos.y + 0.4, pos.z, Math.cos(a) * sp * (1 - Math.abs(e) * 0.3) + vel.x * 0.5, e * sp + 3, Math.sin(a) * sp + vel.z * 0.5, rr(0.5, 1.4), 1, rr(0.3, 0.7), 0.05);
  }
  for (let i = 0; i < 60; i++) { // дым
    emit(pos.x, pos.y + 0.4, pos.z, rr(-3, 3), rr(1, 6), rr(-3, 3), rr(1.5, 3), 0.35, 0.35, 0.35);
  }
}

const debris = [];
function wheelMesh(r, w, mat, hub) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 12).rotateX(Math.PI / 2), mat);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.35, w + 0.02, 8).rotateX(Math.PI / 2), hub);
  t.castShadow = true; g.add(t, h);
  return g;
}
function explode(pos, vel, quat, color) {
  const q = new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w);
  const accent = M(color), dark = M(0x23262d), metal = M(0xc5ccd6, { metalness: 0.5, roughness: 0.4 });
  const skin = M(0xf1c27d), shirt = M(0x3a86ff), pants = M(0x1d3557);
  const B = (w, h, d) => ({ mesh: new THREE.BoxGeometry(w, h, d), shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)) });
  const defs = [];
  const box = (w, h, d, mat, o) => { const b = B(w, h, d); defs.push({ obj: new THREE.Mesh(b.mesh, mat), shape: b.shape, o, m: 6 }); };
  box(0.5, 0.06, 0.5, accent, [-0.15, -0.04, 0]);            // сиденье
  box(0.06, 0.55, 0.5, accent, [-0.4, 0.24, 0]);             // спинка
  box(0.22, 0.5, 0.38, shirt, [-0.3, 0.28, 0]);              // торс
  for (const sd of [-1, 1]) {
    box(0.95, 0.04, 0.04, metal, [0.05, -0.12, sd * 0.27]);  // рама
    box(0.42, 0.04, 0.05, metal, [-0.18, 0.28, sd * 0.3]);   // подлокотник
    box(0.12, 0.5, 0.14, pants, [0.5, -0.11, sd * 0.12]);    // нога
    box(0.09, 0.42, 0.09, shirt, [-0.28, 0.3, sd * 0.27]);   // рука
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), skin);
  defs.push({ obj: head, shape: new CANNON.Sphere(0.14), o: [-0.3, 0.66, 0], m: 3 });
  for (const sd of [-1, 1]) {
    defs.push({ obj: wheelMesh(0.42, 0.08, dark, metal), shape: new CANNON.Sphere(0.4), o: [-0.4, -0.13, sd * 0.58], m: 8 });
    defs.push({ obj: wheelMesh(0.2, 0.1, dark, metal), shape: new CANNON.Sphere(0.19), o: [0.6, -0.35, sd * 0.42], m: 4 });
  }
  const now = performance.now();
  for (const d of defs) {
    const off = new THREE.Vector3(d.o[0], d.o[1], d.o[2]).applyQuaternion(q);
    const body = new CANNON.Body({
      mass: d.m, shape: d.shape, linearDamping: 0.35, angularDamping: 0.5,
      position: new CANNON.Vec3(pos.x + off.x, pos.y + off.y, pos.z + off.z),
      collisionFilterGroup: 2, collisionFilterMask: 1,
    });
    body.quaternion.set(q.x, q.y, q.z, q.w);
    const out = off.clone().normalize();
    const sp = rr(3, 8);
    body.velocity.set(vel.x * 0.7 + out.x * sp + rr(-2, 2), vel.y * 0.7 + out.y * sp + rr(3, 8), vel.z * 0.7 + out.z * sp + rr(-2, 2));
    body.angularVelocity.set(rr(-9, 9), rr(-9, 9), rr(-9, 9));
    world.addBody(body);
    d.obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(d.obj);
    debris.push({ body, obj: d.obj, born: now });
  }
  burstFx(pos, vel);
}
function updateDebris() {
  const now = performance.now();
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    if (now - d.born > 9000 || d.body.position.y < -30) {
      world.removeBody(d.body); scene.remove(d.obj);
      d.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      debris.splice(i, 1);
      continue;
    }
    d.obj.position.copy(d.body.position);
    d.obj.quaternion.copy(d.body.quaternion);
  }
}

function breakChair() {
  if (broken) return;
  broken = true; brokenT = 0; stress = 0;
  explode(chassis.position, chassis.velocity, chassis.quaternion, SKINS[skinIdx].color ?? myColor);
  chair.group.visible = false;
  flicker(chair, false);
  chassis.velocity.setZero(); chassis.angularVelocity.setZero();
  chassis.mass = 0; chassis.updateMassProperties();
  chassis.collisionFilterMask = 0;
  audio.crash(1);
}

function updateDamage(dt) {
  const warn = $('warn');
  if (broken) {
    brokenT += dt;
    warn.style.display = 'block';
    warn.textContent = '💥 Коляска развалилась! Нажми R (или подожди)';
    if (brokenT > 6) respawn(true);
    return;
  }
  const p = chassis.position, sp = chassis.velocity.length();
  const inSlope = p.x > slopeZone.x0 && p.x < slopeZone.x1 && Math.abs(p.z - slopeZone.zc) < slopeZone.hw && p.y > 0.9;
  const over = sp - SLOPE_LIMIT;
  if (inSlope && over > 0) stress += (0.25 + over * 0.12) * dt;
  else stress = Math.max(0, stress - 0.4 * dt);
  if (inSlope && sp > 32) stress = 1;
  if (stress >= 1) { breakChair(); return; }
  if (inSlope && sp > SLOPE_LIMIT * 0.8) {
    warn.style.display = 'block';
    warn.textContent = stress > 0 ? `⚠ ПЕРЕГРУЗКА ${Math.round(stress * 100)}% — СБРОСЬ СКОРОСТЬ!` : `⚠ Опасный склон: держи ниже ${Math.round(SLOPE_LIMIT * 3.6)} км/ч`;
    warn.style.background = stress > 0 ? '#c1121fdd' : '#e09f00dd';
  } else warn.style.display = 'none';
  if (stress > 0.25) { // дым и искры из перегруженной коляски
    chassis.vectorToWorldFrame(_t.set(-0.6, 0.3, rr(-0.3, 0.3)), _w);
    emit(p.x + _w.x, p.y + _w.y, p.z + _w.z, rr(-1, 1), rr(1, 3), rr(-1, 1), rr(0.6, 1.2), 0.3, 0.3, 0.3);
    if (stress > 0.55) emit(p.x + _w.x, p.y + _w.y - 0.2, p.z + _w.z, rr(-3, 3), rr(1, 4), rr(-3, 3), rr(0.3, 0.7), 1, 0.6, 0.1);
  }
}


/* ================= Бабки в парке ================= */
const GRANNY_PHRASE = 'Человек в тележке катиться он здоровый человек?';
let grannyCount = 0;

function insideAnyBox(x, z) {
  for (const o of boxes) {
    const h = o.b.shapes[0].halfExtents;
    for (const y of [0.3, 1.0]) {
      o.b.pointToLocalFrame(_t.set(x, y, z), _w);
      if (Math.abs(_w.x) < h.x + 1.2 && Math.abs(_w.z) < h.z + 1.2 && Math.abs(_w.y) < h.y + 0.2) return true;
    }
  }
  return false;
}

function createGranny(dressColor) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const dress = M(dressColor), skin = M(0xf1c27d), hair = M(0xeeeeee), scarf = M(0xd62828), dark = M(0x4a3b2a), bag = M(0x8d5524);
  const part = (geo, mat, x, y, z, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; g.add(m);
    return m;
  };
  part(new THREE.CylinderGeometry(0.2, 0.36, 0.85, 8), dress, 0, 0.45, 0);        // платье
  part(new THREE.SphereGeometry(0.23, 8, 6), dress, 0, 0.92, 0);                   // плечи
  part(new THREE.SphereGeometry(0.16, 8, 6), skin, 0, 1.18, 0);                    // голова
  part(new THREE.SphereGeometry(0.18, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), scarf, 0, 1.22, -0.02); // платок
  part(new THREE.SphereGeometry(0.07, 6, 5), hair, 0, 1.4, -0.08);                 // пучок
  part(new THREE.BoxGeometry(0.07, 0.45, 0.07), dress, 0.27, 0.82, 0.05, -0.15);   // руки
  part(new THREE.BoxGeometry(0.07, 0.45, 0.07), dress, -0.27, 0.82, 0.05, 0.15);
  part(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 5), dark, 0.34, 0.43, 0.12);   // клюка
  part(new THREE.BoxGeometry(0.22, 0.24, 0.1), bag, -0.34, 0.62, 0.1);             // сумка
  return g;
}

let bubbleTex = null;
function makeBubble() {
  if (!bubbleTex) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.strokeStyle = '#222'; g.lineWidth = 6;
    g.beginPath(); g.roundRect ? g.roundRect(6, 6, 500, 150, 26) : g.rect(6, 6, 500, 150); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(230, 154); g.lineTo(256, 196); g.lineTo(282, 154); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.font = 'bold 34px system-ui,sans-serif'; g.textAlign = 'center';
    const words = GRANNY_PHRASE.split(' '); const lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > 470) { lines.push(cur); cur = w; } else cur = t; }
    lines.push(cur);
    lines.forEach((l, i) => g.fillText(l, 256, 52 + i * 42));
    bubbleTex = new THREE.CanvasTexture(c);
    bubbleTex.colorSpace = THREE.SRGBColorSpace;
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthTest: false, fog: false }));
  sp.scale.set(5, 1.95, 1);
  sp.renderOrder = 11;
  sp.visible = false;
  scene.add(sp);
  return sp;
}

function grannySay(pitch) {
  if (audio.isMuted()) return;
  const ss = window.speechSynthesis;
  if (!ss || typeof SpeechSynthesisUtterance === 'undefined') { audio.oops(); return; }
  audio.oops();
  if (ss.speaking) return;
  const u = new SpeechSynthesisUtterance(GRANNY_PHRASE);
  u.lang = 'ru-RU'; u.pitch = pitch; u.rate = 0.92; u.volume = 1;
  const v = ss.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('ru'));
  if (v) u.voice = v;
  ss.speak(u);
}

const grannies = [];
{
  const homes = [];
  for (let tries = 0; homes.length < 18 && tries < 800; tries++) {
    const onPlaza = homes.length < 10;
    const a = Math.random() * 6.283, r = onPlaza ? 9 + Math.random() * 46 : 60 + Math.random() * 90;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > 105 && x > -150 && x < 50) continue;        // не на склоне
    if (insideAnyBox(x, z)) continue;                    // не на рампах и препятствиях
    if (homes.some((h) => Math.hypot(h.x - x, h.z - z) < 5)) continue;
    homes.push({ x, z });
  }
  const dresses = [0x7b2cbf, 0x2a9d8f, 0xe76f51, 0x457b9d, 0xb5838d, 0x6a994e, 0xf4a261];
  homes.forEach((h, i) => {
    const g = createGranny(dresses[i % dresses.length]);
    g.position.set(h.x, 0, h.z);
    g.rotation.y = Math.random() * 6.283;
    scene.add(g);
    grannies.push({ g, home: h, state: 'idle', vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, ph: Math.random() * 6, pitch: 1.3 + Math.random() * 0.6, bubble: makeBubble(), bubbleT: 0 });
  });
}

function hitGranny(gr) {
  gr.state = 'fly'; gr.t = 0;
  const v = chassis.velocity;
  gr.vel.set(v.x * 0.7 + rr(-1, 1), rr(5, 9), v.z * 0.7 + rr(-1, 1));
  gr.spin.set(rr(-6, 6), rr(-4, 4), rr(-6, 6));
  chassis.velocity.x *= 0.88; chassis.velocity.z *= 0.88;
  grannyCount++;
  $('gcount').textContent = grannyCount;
  gr.bubbleT = 4;
  grannySay(gr.pitch);
  audio.thud(0.6);
}

function updateGrannies(dt) {
  const cp = chassis.position, now = performance.now() * 0.001;
  for (const gr of grannies) {
    const g = gr.g;
    if (gr.state === 'idle') {
      g.position.set(gr.home.x, Math.abs(Math.sin(now * 2 + gr.ph)) * 0.02, gr.home.z);
      const dx = cp.x - gr.home.x, dz = cp.z - gr.home.z, d = Math.hypot(dx, dz);
      if (d < 14 && !broken) g.rotation.y = Math.atan2(dx, dz); // смотрит на коляску
      if (!broken && d < 1.15 && cp.y < 1.4 && chassis.velocity.length() > 1.2) hitGranny(gr);
    } else if (gr.state === 'fly') {
      gr.vel.y -= 15 * dt;
      g.position.addScaledVector(gr.vel, dt);
      g.rotation.x += gr.spin.x * dt; g.rotation.y += gr.spin.y * dt; g.rotation.z += gr.spin.z * dt;
      if (g.position.y <= 0.18 && gr.vel.y < 0) {
        g.position.y = 0.18; gr.state = 'down'; gr.t = 0;
        g.rotation.set(-Math.PI / 2, rr(0, 6.28), 0);
      }
    } else { // лежит, потом встаёт на место
      gr.t += dt;
      g.position.x += gr.vel.x * dt; g.position.z += gr.vel.z * dt;
      gr.vel.x *= Math.max(0, 1 - 3 * dt); gr.vel.z *= Math.max(0, 1 - 3 * dt);
      if (gr.t > 7) { gr.state = 'idle'; g.rotation.set(0, rr(0, 6.28), 0); g.position.set(gr.home.x, 0, gr.home.z); }
    }
    if (gr.bubbleT > 0) {
      gr.bubbleT -= dt;
      gr.bubble.visible = gr.bubbleT > 0;
      gr.bubble.position.set(g.position.x, g.position.y + 2.6, g.position.z);
    }
  }
}

/* ================= Мультиплеер ================= */
const remotes = new Map();

function makeLabel(text, onTop = true) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#fff'; g.font = 'bold 56px system-ui,sans-serif'; g.textAlign = 'center';
  g.fillText(text, 256, 86);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: !onTop, transparent: true, fog: false }));
  sp.scale.set(2.4, 0.6, 1);
  sp.renderOrder = 10;
  return sp;
}

function getRemote(id) {
  let r = remotes.get(id);
  if (r) return r;
  const ch = createChair(0xffb703);
  scene.add(ch.group);
  const label = makeLabel(id);
  scene.add(label);
  r = { ch, label, tp: new THREE.Vector3(), tq: new THREE.Quaternion(), st: 0, tst: 0, sf: 0, tsf: 0, sr: 0, tsr: 0, th: 0, br: false, init: false };
  remotes.set(id, r);
  return r;
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.ch.group, r.label);
  r.ch.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  r.label.material.map.dispose();
  r.label.material.dispose();
  remotes.delete(id);
}

const finite = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => Number.isFinite(v));
const net = new Net({
  color: myColor,
  onId: (id) => { $('myid').value = id; },
  onStatus: (t) => { $('status').textContent = t; },
  onHello: (id, c) => { const ch = getRemote(id).ch; ch.baseColor = c & 0xffffff; applySkin(ch, ch.skin); },
  onLeave: removeRemote,
  onState: (id, d) => {
    if (!finite(d.p, 3) || !finite(d.q, 4)) return;
    const r = getRemote(id);
    r.tp.set(d.p[0], d.p[1], d.p[2]);
    r.tq.set(d.q[0], d.q[1], d.q[2], d.q[3]).normalize();
    if (Number.isInteger(d.k) && d.k !== r.ch.skin) applySkin(r.ch, d.k);
    r.th = d.th ? 1 : 0;
    const br = !!d.br;
    if (br !== r.br) {
      r.br = br;
      if (br) {
        explode(r.tp, { x: 0, y: 0, z: 0 }, r.tq, r.ch.baseColor);
        r.ch.group.visible = false; r.label.visible = false;
        audio.crash(0.35);
      } else { r.ch.group.visible = true; r.label.visible = true; r.ch.group.position.copy(r.tp); }
    }
    r.tst = Number.isFinite(d.st) ? d.st : 0;
    r.tsf = Number.isFinite(d.sf) ? d.sf : 0;
    r.tsr = Number.isFinite(d.sr) ? d.sr : 0;
    if (!r.init) {
      r.init = true;
      r.ch.group.position.copy(r.tp);
      r.ch.group.quaternion.copy(r.tq);
      r.sf = r.tsf; r.sr = r.tsr;
    }
  },
});

function sendState() {
  const p = chassis.position, q = chassis.quaternion;
  net.send({
    t: 's',
    p: [r2(p.x), r2(p.y), r2(p.z)],
    q: [q.x, q.y, q.z, q.w].map((v) => Math.round(v * 1000) / 1000),
    st: r2(steerCur), sf: r2(spin[0]), sr: r2(spin[2]), k: skinIdx, th: input.thr > 0 ? 1 : 0, br: broken ? 1 : 0,
  });
}

function updateRemotes(dt) {
  const k = 1 - Math.exp(-dt * 14);
  for (const r of remotes.values()) {
    const g = r.ch.group;
    if (!r.init) continue;
    if (g.position.distanceTo(r.tp) > 30) g.position.copy(r.tp); else g.position.lerp(r.tp, k);
    g.quaternion.slerp(r.tq, k);
    r.st += (r.tst - r.st) * k;
    r.sf += (r.tsf - r.sf) * k;
    r.sr += (r.tsr - r.sr) * k;
    r.ch.wheels.forEach((w) => wheelLocalQuat(w, r.st, w.front ? r.sf : r.sr, w.group.quaternion));
    flicker(r.ch, !!r.th && !r.br);
    r.label.position.set(g.position.x, g.position.y + 1.9, g.position.z);
  }
}

const DEBUG = new URLSearchParams(location.search).has('debug');
if (DEBUG) $('dbg').style.display = 'block';

/* ================= UI ================= */
$('copy').addEventListener('click', async () => {
  const el = $('myid');
  try { await navigator.clipboard.writeText(el.value); }
  catch { el.select(); document.execCommand('copy'); }
  $('copy').textContent = 'Скопировано!';
  setTimeout(() => { $('copy').textContent = 'Скопировать'; }, 1200);
});
const join = () => { net.connect($('otherid').value); $('otherid').blur(); $('status').textContent = 'Подключение...'; };
$('join').addEventListener('click', join);
$('otherid').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') join(); });

/* ================= Главный цикл ================= */
let last = performance.now(), netT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (dt <= 0) return;
  const fs = control();
  world.step(STEP, dt, 12);
  if (!Number.isFinite(chassis.position.y + chassis.position.x + chassis.position.z) || chassis.position.y < -20 || Math.abs(chassis.position.x) > 260 || Math.abs(chassis.position.z) > 260) respawn(true);
  syncVisuals(dt, fs);
  if (DEBUG) $('dbg').textContent = `y=${chassis.position.y.toFixed(2)} опора=${isGrounded()} v=${chassis.velocity.length().toFixed(1)} м/с газ=${input.thr}`;
  updateDamage(dt);
  updateGrannies(dt);
  updateDebris();
  updateParticles(dt);
  audio.update({
    dt, speed: chassis.velocity.length(), grounded: isGrounded(), turbo: SKINS[skinIdx].turbo,
    thr: input.thr > 0 ? 1 : 0, hand: input.hand, broken, stress, rearSpin: spin[2],
  });
  updateCamera(dt);
  updateRemotes(dt);
  netT += dt;
  if (netT >= 0.05) { netT = 0; sendState(); }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
