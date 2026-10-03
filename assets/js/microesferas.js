/* Como funciona o NeoMAP®: microesferas em WebGL (Three.js), controladas pelo scroll.
 * Quatro formações, uma por etapa do texto: mancha de sangue seco no papel filtro,
 * o picote, o ensaio em suspensão com quatro conjuntos de microesferas e o mapa
 * de leitura (classificação por cor × sinal). É um esquema ilustrativo: os fatos
 * estão no texto, e sem WebGL ou com movimento reduzido entram quadros estáticos.
 * O tempo da animação só anda com o scroll; parada a página, parada a cena.
 */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
const ADDONS = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/';
const MARKERS = [0xde1e18, 0xf2a516, 0x12a08f, 0x5361d6]; // TSH, T4, 17-OH, IRT
const BG = 0xf3f4f6;
const LABELS = ['Coleta', 'Picote', 'Ensaio multiplex', 'Leitura'];

const root = document.getElementById('mx');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = !!(navigator.connection && navigator.connection.saveData);
const lowEnd = (navigator.deviceMemory && navigator.deviceMemory < 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4);

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
const gauss = (r) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

/* ---------------------------------------------------------- progresso pelo scroll (0 a 3) */
const state = { prog: 0, step: -1 };
function wireSteps() {
  const steps = [...root.querySelectorAll('.mx__step')];
  const stage = root.querySelector('.mx__stage');
  const imgs = [...stage.querySelectorAll('.mx__still img')];
  const countN = stage.querySelector('[data-mx-count]'), countL = stage.querySelector('[data-mx-label]');
  const setStep = (i) => {
    if (i === state.step) return;
    state.step = i;
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    stage.dataset.step = i;
    imgs.forEach((img) => img.classList.toggle('is-on', Number(img.dataset.still) === i));
    countN.textContent = i + 1;
    countL.textContent = LABELS[i];
  };
  const measure = () => {
    if (window.__mxForce != null) { state.prog = window.__mxForce; setStep(Math.round(state.prog)); return; }
    const vh = innerHeight;
    // no celular o palco fica preso no topo: a etapa vira ativa quando o texto aparece abaixo dele
    const narrow = innerWidth <= 900;
    const pts = steps.map((s) => { const r = s.getBoundingClientRect(); return narrow ? r.top : r.top + r.height / 2; });
    const below = narrow ? stage.getBoundingClientRect().bottom : 0;
    const mid = narrow ? below + (vh - below) * 0.55 : vh * 0.5;
    let p = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (mid >= b) p = i + 1;
      else if (mid > a) { p = i + (mid - a) / (b - a); break; }
      else break;
    }
    state.prog = Math.max(0, Math.min(3, p));
    setStep(Math.round(state.prog));
  };
  let tick = false;
  addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(() => { tick = false; measure(); }); } }, { passive: true });
  addEventListener('resize', measure);
  measure();
  return measure;
}

/* ---------------------------------------------------------- cena */
async function boot(measure) {
  let THREE, RE;
  try { [THREE, RE] = await Promise.all([import(THREE_URL), import(ADDONS + 'environments/RoomEnvironment.js')]); } catch (_) { return; }
  const stage = root.querySelector('.mx__stage');
  const canvas = stage.querySelector('canvas');
  const N = lowEnd ? 200 : 340;
  const r = rng(29);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' }); } catch (_) { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowEnd ? 1.25 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 11, 24); // a profundidade se dissolve no fundo claro do palco
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RE.RoomEnvironment(), 0.04).texture;
  pm.dispose();
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9dde3, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(-4, 6, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe7ff, 0.9); rim.position.set(5, -2, -6); scene.add(rim);

  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.22, sheen: 0.15, sheenColor: new THREE.Color(0xffffff) });
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, lowEnd ? 14 : 24, lowEnd ? 10 : 16), mat, N);
  scene.add(mesh);

  // cada formação: posição, cor e escala por microesfera
  const blood = (k) => new THREE.Color().setHSL(0.998, 0.82, 0.13 + k * 0.07);
  const F = [[], [], [], []];
  const clusters = () => (stage.clientWidth < 560 ? [[-1.8, -1.0], [-0.35, 0.95], [1.15, 0.0], [1.95, 1.5]] : [[-2.3, -1.4], [-0.3, 0.8], [1.5, -0.25], [2.5, 1.55]]);
  let C = clusters();
  for (let i = 0; i < N; i++) {
    const g = i % 4;
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()), k = r();
    // 0: mancha de sangue seco no papel filtro
    const sx = Math.cos(a) * rad * 3.4, sy = Math.sin(a) * rad * 2.6;
    F[0].push({ p: [sx, sy, (r() - 0.5) * 0.25], c: blood(k), s: 0.085 + r() * 0.06 });
    // 1: o picote. Só o que está dentro do disco permanece
    const inside = rad < 0.36;
    const pa = r() * Math.PI * 2, pr = Math.sqrt(r()) * 1.25;
    F[1].push({ p: inside ? [Math.cos(pa) * pr, Math.sin(pa) * pr, (r() - 0.5) * 0.3] : [sx * 1.6, sy * 1.6, -2 - r() * 3], c: inside ? blood(k + 0.25) : blood(k * 0.4), s: inside ? 0.12 + r() * 0.05 : 0 });
    // 2: ensaio em suspensão, quatro conjuntos identificados por cor
    const u = r() * 2 - 1, b2 = r() * Math.PI * 2, rr = Math.cbrt(r()) * 4;
    F[2].push({ p: [Math.cos(b2) * Math.sqrt(1 - u * u) * rr * 1.3, u * rr * 0.9, Math.sin(b2) * Math.sqrt(1 - u * u) * rr], c: new THREE.Color(MARKERS[g]), s: 0.055 + Math.pow(r(), 2) * 0.07 });
    // 3: leitura, mapa de classificação por cor (x) e sinal (y)
    F[3].push({ j: [gauss(r) * 0.3, gauss(r) * 0.3, (r() - 0.5) * 0.2], g, c: new THREE.Color(MARKERS[g]), s: 0.07 + r() * 0.03 });
  }
  const pos3 = (i) => { const f = F[3][i]; return [C[f.g][0] + f.j[0], C[f.g][1] + f.j[1], f.j[2]]; };
  const delay = Array.from({ length: N }, () => r());
  const ph = Array.from({ length: N }, () => r() * 100);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), v = new THREE.Vector3();
  const tags = [...stage.querySelectorAll('[data-tag]')];
  const CAMZ = [13, 10.8, 13.2, 12.6]; // aproxima no picote, recua na suspensão

  let t = 0, cur = state.prog, dirty = true;
  const draw = (dt) => {
    const prev = cur;
    cur = window.__mxForce != null ? state.prog : cur + (state.prog - cur) * (1 - Math.exp(-dt * 6));
    const d = Math.abs(cur - prev);
    if (d < 1e-5 && !dirty) return;
    dirty = false;
    t += d * 9; // o tempo só anda com o scroll
    const k = Math.min(2, Math.floor(cur));
    const f = cur - k;
    // movimento browniano só na suspensão; na leitura as microesferas param
    const wob = Math.max(0, 1 - Math.abs(cur - 2)) * 0.12 + 0.015;
    for (let i = 0; i < N; i++) {
      const e = smooth(clamp01((f - delay[i] * 0.35) / 0.65));
      const A = F[k][i], B = F[k + 1][i];
      const ap = k === 3 ? pos3(i) : A.p, bp = k + 1 === 3 ? pos3(i) : B.p;
      p.set(
        ap[0] + (bp[0] - ap[0]) * e + Math.sin(t * 0.7 + ph[i]) * wob,
        ap[1] + (bp[1] - ap[1]) * e + Math.cos(t * 0.6 + ph[i] * 1.3) * wob,
        ap[2] + (bp[2] - ap[2]) * e + Math.sin(t * 0.5 + ph[i] * 0.7) * wob
      );
      s.setScalar(A.s + (B.s - A.s) * e);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
      c.copy(A.c).lerp(B.c, e);
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    const spin = Math.max(0, 1 - Math.abs(cur - 2));
    mesh.rotation.y = Math.sin(t * 0.15) * 0.5 * spin;
    mesh.rotation.x = (cur < 1 ? 0.35 * (1 - cur) : 0) + Math.cos(t * 0.12) * 0.15 * spin;
    const zi = Math.min(2, Math.floor(cur)), zf = smooth(cur - zi);
    camera.position.z = (CAMZ[zi] + (CAMZ[zi + 1] - CAMZ[zi]) * zf) * Math.max(1, 1.2 / camera.aspect);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    stage.dataset.formed = cur > 2.6 ? 'true' : 'false';
    if (cur > 2.4) {
      mesh.updateMatrixWorld();
      tags.forEach((tag, g) => {
        v.set(C[g][0], C[g][1] + 0.72, 0).applyMatrix4(mesh.matrixWorld).project(camera);
        tag.style.left = ((v.x + 1) / 2 * 100).toFixed(2) + '%';
        tag.style.top = ((1 - v.y) / 2 * 100).toFixed(2) + '%';
      });
    }
  };
  const fit = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    C = clusters();
    dirty = true;
  };
  try { await renderer.compileAsync(scene, camera); } catch (_) { /* compila no primeiro quadro */ }
  new ResizeObserver(() => { fit(); measure(); draw(0); }).observe(stage);
  fit(); measure(); draw(0);
  stage.classList.add('has-gl');

  // laço só com o palco visível; fora da tela não consome nada
  let visible = false, raf = 0, last = performance.now();
  const loop = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; draw(dt); raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0; };
  const start = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; start(); }, { rootMargin: '100px 0px' }).observe(root);
  document.addEventListener('visibilitychange', start);
  window.__mxReady = true;
}

if (root) {
  const measure = wireSteps();
  const ok = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (_) { return false; } })();
  if (window.__forceGL || (!reduce && !saveData && ok)) {
    const io = new IntersectionObserver((e) => {
      if (!e.some((x) => x.isIntersecting)) return;
      io.disconnect();
      (window.requestIdleCallback || setTimeout)(() => boot(measure).catch((err) => console.warn('Microesferas 3D indisponíveis:', err)), { timeout: 800 });
    }, { rootMargin: '500px 0px' });
    io.observe(root);
  }
}
