/* Automação, de perto: Opentrons® Flex controlado pelo scroll.
 *
 * MODELO: não existe modelo 3D oficial público do Flex. A máquina é construída
 * em código a partir das fontes oficiais da Opentrons:
 *   - Manual do Flex, "System Specifications" e "Robot Components"
 *     (docs.opentrons.com/flex): 87 × 69 × 84 cm (L × P × A), estrutura de chapa
 *     metálica e perfis de alumínio, porta frontal e janelas laterais de
 *     policarbonato, tela de 7" na frente à direita, faixa de luz de status no
 *     topo frontal, câmera no canto superior junto à porta, faixas de LED brancas
 *     nas bordas internas superiores, deck de alumínio usinado, pórtico X/Y.
 *   - Definição de deck do código aberto (Opentrons/opentrons,
 *     shared-data/deck/definitions/5/ot3_standard.json): posições de 128 × 86 mm,
 *     A1 no fundo à esquerda.
 * Peças internas (forma exata do carro das pipetas, trilhos) são aproximações
 * visuais. Para trocar por um asset oficial (GLB), basta substituir buildMachine()
 * mantendo os nomes das partes (door, gantry, carriage, pipettes, slots, screen, status, led).
 *
 * INTERAÇÃO: cada [data-pose] do texto é uma âncora. O scroll mistura a pose
 * atual com a seguinte, com platôs de leitura, e a câmera persegue a pose com
 * amortecimento. Nada dispara por tempo: ir, parar e voltar funcionam.
 */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
const ADDONS = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/';

const root = document.getElementById('flex-3d');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = !!(navigator.connection && navigator.connection.saveData);
const lowEnd = (navigator.deviceMemory && navigator.deviceMemory < 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4);

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------------------------------------------------- poses
   cam/target em metros (base no chão, frente para +z).
   shift: deslocamento do enquadramento para a direita (o texto fica à esquerda). */
const POSES = {
  intro:     { cam: [1.95, 1.18, 2.75], tgt: [0.02, 0.4, 0], fov: 28, shift: 0.16, door: 0, gz: 0.02, cx: 0.02, pz: 0, slots: 0, screen: 0.3, status: 0.7, led: 0.35, dims: 0, hi: 0 },
  estrutura: { cam: [-2.2, 1.3, 2.7], tgt: [0.02, 0.42, 0], fov: 28, shift: 0.16, door: 1, gz: 0.02, cx: 0.02, pz: 0, slots: 0, screen: 0.3, status: 0.7, led: 0.55, dims: 1, hi: 0 },
  portico:   { cam: [-1.5, 1.12, 2.5], tgt: [0.0, 0.44, 0], fov: 28, shift: 0.16, door: 0, gz: 0.12, cx: 0.07, pz: 1, slots: 0.25, screen: 0.3, status: 0.7, led: 1, dims: 0, hi: 1 },
  deck:      { cam: [-0.62, 2.3, 2.3], tgt: [0.05, 0.3, -0.02], fov: 30, shift: 0.17, door: 0, gz: -0.22, cx: -0.12, pz: 0, slots: 1, screen: 0.3, status: 0.7, led: 1, dims: 0, hi: 0 },
  interface: { cam: [1.3, 0.98, 2.45], tgt: [0.1, 0.48, 0.15], fov: 28, shift: 0.17, door: 0, gz: -0.05, cx: 0.0, pz: 0, slots: 0, screen: 1, status: 1, led: 0.6, dims: 0, hi: 0 },
  final:     { cam: [2.05, 1.2, 2.95], tgt: [0.02, 0.4, 0], fov: 28, shift: 0.16, door: 0, gz: 0.02, cx: 0.02, pz: 0, slots: 0, screen: 0.6, status: 1, led: 0.5, dims: 0, hi: 0 },
};
const KEYS = ['door', 'gz', 'cx', 'pz', 'slots', 'screen', 'status', 'led', 'dims', 'hi', 'fov', 'shift'];

/* ---------------------------------------------------------- trilho de poses */
const track = { els: [], weights: {}, active: 'intro' };
function measure() { track.els = [...root.querySelectorAll('[data-pose]')]; }
// posições lidas a cada quadro: imagens que carregam acima da seção não desalinham o trilho
const anchors = () => track.els.map((el) => { const r = el.getBoundingClientRect(); return { name: el.dataset.pose, center: r.top + r.height / 2 }; });
function resolve(mobile) {
  // modo de captura dos quadros estáticos (só usado pela ferramenta de captura)
  if (window.__forcePose && POSES[window.__forcePose]) {
    const P = POSES[window.__forcePose];
    Object.keys(POSES).forEach((n) => { track.weights[n] = n === window.__forcePose ? 1 : 0; });
    track.active = window.__forcePose;
    const out = { cam: P.cam.slice(), tgt: P.tgt.slice() };
    KEYS.forEach((k) => { out[k] = P[k]; });
    return out;
  }
  const list = anchors();
  if (!list.length) return null;
  const y = innerHeight * (mobile ? 0.7 : 0.5);
  let i = 0;
  while (i < list.length - 1 && list[i + 1].center <= y) i++;
  const a = list[i], b = list[Math.min(i + 1, list.length - 1)];
  const span = b.center - a.center;
  const raw = span > 0 ? clamp01((y - a.center) / span) : 0;
  const t = smoother(clamp01((raw - 0.2) / 0.6)); // platô: segura início e fim para leitura
  const A = POSES[a.name], B = POSES[b.name];
  const out = { cam: [0, 0, 0], tgt: [0, 0, 0] };
  for (let k = 0; k < 3; k++) { out.cam[k] = lerp(A.cam[k], B.cam[k], t); out.tgt[k] = lerp(A.tgt[k], B.tgt[k], t); }
  KEYS.forEach((k) => { out[k] = lerp(A[k], B[k], t); });
  Object.keys(POSES).forEach((n) => { track.weights[n] = 0; });
  track.weights[a.name] += 1 - t;
  track.weights[b.name] += t;
  track.active = raw < 0.5 ? a.name : b.name;
  return out;
}

/* ---------------------------------------------------------- texturas geradas */
function canvasTex(THREE, w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function brushedTex(THREE, size) {
  // alumínio escovado: riscos finos horizontais, usado como mapa de rugosidade
  const t = canvasTex(THREE, size, size, (g, w, h) => {
    g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < size * 6; i++) {
      const y = Math.random() * h, l = 60 + Math.random() * 360, x = Math.random() * w;
      const v = 100 + Math.random() * 70;
      g.strokeStyle = `rgba(${v},${v},${v},0.28)`; g.lineWidth = 0.4 + Math.random() * 0.9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (Math.random() - 0.5) * 0.4); g.stroke();
    }
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function plateTex(THREE) {
  // microplaca de 96 poços (8 × 12), ilustrativa
  return canvasTex(THREE, 768, 516, (g, w, h) => {
    g.fillStyle = '#e8ecef'; g.fillRect(0, 0, w, h);
    const px = w / 13.2, py = h / 9.2;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) {
      const x = px * (1.1 + c), y = py * (1.1 + r);
      const grd = g.createRadialGradient(x - px * 0.08, y - py * 0.08, 1, x, y, px * 0.42);
      grd.addColorStop(0, '#aeb6be'); grd.addColorStop(1, '#d9dee3');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, px * 0.39, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#a3acb5'; g.lineWidth = 1.2; g.stroke();
    }
  });
}

function screenTex(THREE) {
  // tela ligada: brilho neutro, sem simular a interface do fabricante
  return canvasTex(THREE, 512, 300, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#262a30'); grd.addColorStop(1, '#121417');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(230,234,238,0.07)'; g.fillRect(0, 0, w, 44);
    g.fillStyle = 'rgba(230,234,238,0.045)';
    for (let i = 0; i < 3; i++) g.fillRect(28 + i * 160, 84, 140, 172);
  });
}

function contactTex(THREE) {
  // sombra de contato pré-calculada com a planta da máquina: ela nunca flutua
  return canvasTex(THREE, 512, 512, (g, w, h) => {
    g.filter = 'blur(26px)';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(w * 0.2, h * 0.22, w * 0.6, h * 0.56);
    g.filter = 'blur(7px)';
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(w * 0.255, h * 0.27, w * 0.49, h * 0.46);
  }, false);
}

function floorTex(THREE) {
  // pequena área iluminada sob o equipamento, que se dissolve no fundo da seção
  return canvasTex(THREE, 1024, 1024, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(48,52,61,0.95)'); grd.addColorStop(0.32, 'rgba(34,37,44,0.7)'); grd.addColorStop(1, 'rgba(20,22,27,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

/* Ambiente de estúdio: caixas de luz retangulares numa sala escura. Gera os
   reflexos longos e limpos no alumínio, no policarbonato e no preto acetinado. */
function studioEnv(THREE, renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(12, 32, 16), new THREE.MeshBasicMaterial({ color: 0x0b0c0f, side: THREE.BackSide })));
  const floorM = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0x15171b }));
  floorM.rotation.x = -Math.PI / 2; floorM.position.y = -0.6; s.add(floorM);
  const panel = (w, h, k, pos, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0.5, 0); s.add(m);
  };
  panel(7, 2.4, 4.2, [0, 7, 0.6]);               // caixa de luz superior
  panel(2.6, 6, 3.0, [-6.5, 2.4, 2.2], 0xfff3e6); // faixa quente à esquerda
  panel(2.6, 6, 2.6, [6.5, 2.2, 1.0], 0xe6eefc);   // faixa fria à direita
  panel(2.2, 4, 1.2, [3.5, 2.5, 6], 0xffffff);     // rebatedor frontal à direita
  panel(5, 1.3, 0.9, [0, 1.6, 7.5]);              // preenchimento frontal
  panel(4, 0.5, 1.4, [0, 0.6, -7]);               // contraluz baixo
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.035).texture;
  pm.dispose();
  return tex;
}

function roundedRect(THREE, x0, y0, x1, y1, r, path = false) {
  const s = path ? new THREE.Path() : new THREE.Shape();
  s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1); s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/* ---------------------------------------------------------- a máquina (87 × 69 × 84 cm) */
function buildMachine(THREE, RoundedBoxGeometry, quality) {
  const W = 0.87, D = 0.69, H = 0.84, FZ = D / 2;
  const m = new THREE.Group();
  const parts = {};
  const brushed = brushedTex(THREE, quality.lite ? 512 : 1024);
  const seg = quality.lite ? 2 : 4;

  // preto acetinado da moldura: pega o reflexo das caixas de luz sem virar espelho
  const black = new THREE.MeshPhysicalMaterial({ color: 0x17191c, roughness: 0.42, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.32 });
  const blackMatte = new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.78, metalness: 0.05 });
  // alumínio escovado das laterais, com reflexo alongado (anisotropia)
  const alu = new THREE.MeshPhysicalMaterial({ color: 0xd2d6db, metalness: 0.85, roughness: 0.3, roughnessMap: brushed, anisotropy: quality.lite ? 0 : 0.55 });
  const aluLight = new THREE.MeshPhysicalMaterial({ color: 0xd9dde1, metalness: 0.9, roughness: 0.28, roughnessMap: brushed, clearcoat: 0.2 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8f959c, metalness: 0.92, roughness: 0.4, roughnessMap: brushed });
  const interior = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.88, metalness: 0.1 });
  // policarbonato: quase invisível, aparece só nos reflexos
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, ior: 1.58, specularIntensity: 1, transparent: true, opacity: 0.08, envMapIntensity: 1.8, side: THREE.DoubleSide, depthWrite: false });
  const tint = new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, roughness: 0.04, metalness: 0, ior: 1.58, transparent: true, opacity: 0.38, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false });

  const cast = (o) => { if (quality.shadows) { o.castShadow = true; o.receiveShadow = true; } return o; };
  const add = (geo, mat, x, y, z, parent = m) => { const o = cast(new THREE.Mesh(geo, mat)); o.position.set(x, y, z); parent.add(o); return o; };
  const ext = (shape, depth, bevel = 0.004) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: quality.lite ? 2 : 4, curveSegments: quality.lite ? 8 : 18 });

  // base, tampo, fundo e pés
  add(new RoundedBoxGeometry(W - 0.03, 0.13, D - 0.03, seg, 0.012), blackMatte, 0, 0.075, 0);
  add(new RoundedBoxGeometry(W - 0.02, 0.022, D - 0.02, seg, 0.009), black, 0, H - 0.011, 0);
  add(new THREE.BoxGeometry(W - 0.05, H - 0.05, 0.012), interior, 0, H / 2, -FZ + 0.012);
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => add(new THREE.CylinderGeometry(0.018, 0.02, 0.012, 24), blackMatte, sx * (W / 2 - 0.07), 0.006, sz * (D / 2 - 0.07))));

  // moldura frontal preta de cantos arredondados, com a abertura da porta
  const front = roundedRect(THREE, -W / 2, 0.01, W / 2, H, 0.045);
  front.holes.push(roundedRect(THREE, -0.405, 0.135, 0.405, 0.75, 0.018, true));
  add(ext(front, 0.026), black, 0, 0, FZ - 0.03);
  add(new RoundedBoxGeometry(0.4, 0.024, 0.01, 2, 0.004), blackMatte, -0.07, 0.07, FZ);

  // laterais em alumínio com janela de policarbonato
  [-1, 1].forEach((sx) => {
    const side = roundedRect(THREE, -D / 2, 0.01, D / 2, H, 0.045);
    side.holes.push(roundedRect(THREE, -0.29, 0.17, 0.27, 0.77, 0.016, true));
    const o = add(ext(side, 0.016, 0.003), alu, 0, 0, 0);
    o.rotation.y = -Math.PI / 2;
    o.position.x = sx > 0 ? W / 2 : -W / 2 + 0.016;
    const win = add(new THREE.PlaneGeometry(0.56, 0.6), tint, sx * (W / 2 - 0.006), 0.47, -0.01);
    win.rotation.y = Math.PI / 2;
    win.castShadow = false;
    [-0.2, 0.2].forEach((z) => { const cap = add(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 28), aluLight, sx * (W / 2 + 0.002), 0.09, z); cap.rotation.z = Math.PI / 2; });
    [-0.09, 0.07].forEach((z) => add(new RoundedBoxGeometry(0.004, 0.035, 0.11, 2, 0.002), blackMatte, sx * (W / 2 + 0.001), 0.075, z));
  });

  // deck de alumínio usinado (855 × 582 mm)
  const deckY = 0.145;
  add(new RoundedBoxGeometry(0.84, 0.012, 0.58, 2, 0.004), deckMat, 0, deckY - 0.006, 0);
  // posições de 128 × 86 mm; A1 no fundo à esquerda; coluna 4 = área de apoio
  const colX = [-0.19, -0.026, 0.138, 0.302];
  const rowZ = { A: -0.16, B: -0.053, C: 0.054, D: 0.161 };
  const slotGeo = new RoundedBoxGeometry(0.128, 0.004, 0.086, 2, 0.003);
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x858c94, metalness: 0.88, roughness: 0.42, roughnessMap: brushed });
  const clipMat = new THREE.MeshStandardMaterial({ color: 0x8a9199, metalness: 0.75, roughness: 0.42 });
  const clipGeo = new THREE.BoxGeometry(0.012, 0.006, 0.004);
  // destaque das posições: contorno vermelho da marca, aceso pelo scroll
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xff5a52, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  parts.slots = [];
  Object.entries(rowZ).forEach(([row, z], ri) => colX.forEach((x, ci) => {
    const lift = ci === 3 ? 0.006 : 0;
    const s = add(slotGeo, slotMat, x, deckY - 0.0005 + lift, z);
    s.castShadow = false;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => add(clipGeo, clipMat, x + a * 0.058, deckY + 0.006 + lift, z + b * 0.04));
    const ring = roundedRect(THREE, -0.066, -0.045, 0.066, 0.045, 0.006);
    ring.holes.push(roundedRect(THREE, -0.0635, -0.0425, 0.0635, 0.0425, 0.005, true));
    const mat = edgeMat.clone();
    const edge = new THREE.Mesh(new THREE.ShapeGeometry(ring, 6), mat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(x, deckY + 0.0035 + lift, z);
    edge.renderOrder = 2;
    m.add(edge);
    parts.slots.push({ mat, order: ci === 3 ? 12 + ri : ri * 3 + ci, staging: ci === 3 });
  }));
  add(new RoundedBoxGeometry(0.11, 0.004, 0.4, 2, 0.003), slotMat, -0.345, deckY + 0.002, -0.05);

  // material de laboratório ilustrativo: racks de ponteiras e microplacas
  const rackMat = new THREE.MeshPhysicalMaterial({ color: 0x8f98a3, roughness: 0.28, metalness: 0, transparent: true, opacity: 0.92, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const tipMat = new THREE.MeshPhysicalMaterial({ color: 0xeef1f4, roughness: 0.22, clearcoat: 0.4, transparent: true, opacity: 0.92 });
  const tipGeo = new THREE.CylinderGeometry(0.0034, 0.0016, 0.034, quality.lite ? 6 : 12, 1, true);
  const racks = [['A', 0], ['A', 1], ['B', 0]];
  const tips = new THREE.InstancedMesh(tipGeo, tipMat, racks.length * 96);
  let ti = 0;
  const mtx = new THREE.Matrix4();
  racks.forEach(([row, ci]) => {
    const x = colX[ci], z = rowZ[row];
    add(new RoundedBoxGeometry(0.124, 0.052, 0.082, 2, 0.004), rackMat, x, deckY + 0.032, z);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) {
      mtx.makeTranslation(x - 0.0495 + c * 0.009, deckY + 0.075, z - 0.0315 + r * 0.009);
      tips.setMatrixAt(ti++, mtx);
    }
  });
  if (quality.shadows) tips.castShadow = true;
  m.add(tips);
  const plateTop = new THREE.MeshStandardMaterial({ map: plateTex(THREE), roughness: 0.38 });
  const plateSide = new THREE.MeshStandardMaterial({ color: 0xe4e8ec, roughness: 0.45 });
  [['C', 1], ['D', 1], ['C', 0]].forEach(([row, ci]) => {
    add(new THREE.BoxGeometry(0.127, 0.015, 0.085), [plateSide, plateSide, plateTop, plateSide, plateSide, plateSide], colX[ci], deckY + 0.012, rowZ[row]);
  });

  // pórtico: coberturas dos trilhos Y, viga X móvel, carro e montagens das pipetas
  [-1, 1].forEach((sx) => add(new RoundedBoxGeometry(0.02, 0.1, 0.6, 2, 0.006), aluLight, sx * 0.395, 0.5, -0.02));
  const gantry = new THREE.Group(); m.add(gantry);
  const beamMat = aluLight.clone();
  add(new RoundedBoxGeometry(0.77, 0.085, 0.1, seg, 0.012), beamMat, 0, 0.5, 0, gantry);
  const carriage = new THREE.Group(); gantry.add(carriage);
  add(new RoundedBoxGeometry(0.15, 0.36, 0.09, seg, 0.012), black, 0, 0.5, 0.085, carriage);
  add(new RoundedBoxGeometry(0.06, 0.3, 0.012, 2, 0.004), alu, -0.035, 0.5, 0.133, carriage);
  const pip = new THREE.Group(); carriage.add(pip);
  [-0.04, 0.045].forEach((x, i) => {
    add(new RoundedBoxGeometry(0.048, 0.22, 0.052, seg, 0.009), i ? black : aluLight, x, 0.43, 0.16, pip);
    add(new THREE.CylinderGeometry(0.006, 0.0025, 0.05, 20), blackMatte, x, 0.296, 0.16, pip);
    [0.5, 0.38].forEach((y) => add(new THREE.BoxGeometry(0.05, 0.003, 0.054), blackMatte, x, y, 0.16, pip));
    add(new RoundedBoxGeometry(0.03, 0.04, 0.008, 2, 0.003), alu, x, 0.47, 0.19, pip);
  });
  parts.gantry = gantry; parts.carriage = carriage; parts.pipettes = pip; parts.beamMat = beamMat;

  // porta frontal de policarbonato, articulada no topo
  const doorPivot = new THREE.Group(); doorPivot.position.set(0, 0.75, FZ + 0.004); m.add(doorPivot);
  const doorFrame = roundedRect(THREE, -0.405, -0.615, 0.25, 0, 0.012);
  doorFrame.holes.push(roundedRect(THREE, -0.39, -0.6, 0.235, -0.015, 0.008, true));
  add(ext(doorFrame, 0.008, 0.002), blackMatte, 0, 0, 0, doorPivot);
  add(new THREE.PlaneGeometry(0.625, 0.585), glass, -0.0775, -0.3075, 0.005, doorPivot).castShadow = false;
  [-0.36, 0.2].forEach((x) => add(new RoundedBoxGeometry(0.03, 0.02, 0.02, 2, 0.004), blackMatte, x, 0.005, -0.004, doorPivot));
  parts.door = doorPivot;
  // painel fixo à direita da porta, com a tela de 7"
  add(new THREE.PlaneGeometry(0.15, 0.585), glass, 0.33, 0.4425, FZ + 0.004).castShadow = false;
  const screen = new THREE.Group(); screen.position.set(0.33, 0.52, FZ + 0.03); screen.rotation.x = -0.08; m.add(screen);
  add(new RoundedBoxGeometry(0.205, 0.135, 0.016, seg, 0.006), alu, 0, 0, -0.003, screen);
  add(new RoundedBoxGeometry(0.195, 0.125, 0.016, seg, 0.005), black, 0, 0, 0, screen);
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex(THREE), toneMapped: false });
  add(new THREE.PlaneGeometry(0.155, 0.093), screenMat, 0, 0, 0.0085, screen);
  // vidro da tela: reflexo por cima da imagem
  add(new THREE.PlaneGeometry(0.16, 0.098), new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.02, transparent: true, opacity: 0.12, envMapIntensity: 2, depthWrite: false }), 0, 0, 0.0092, screen).castShadow = false;
  add(new THREE.BoxGeometry(0.03, 0.05, 0.03), blackMatte, 0, -0.08, -0.02, screen);
  parts.screen = screenMat;

  // luz de status no topo frontal e câmera no canto superior
  const statusMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  add(new RoundedBoxGeometry(0.38, 0.008, 0.006, 2, 0.003), statusMat, 0.03, 0.795, FZ - 0.001).castShadow = false;
  parts.status = statusMat;
  const lens = add(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 24), new THREE.MeshPhysicalMaterial({ color: 0x050607, roughness: 0.08, clearcoat: 1 }), -0.385, 0.795, FZ);
  lens.rotation.x = Math.PI / 2;

  // faixas de LED brancas nas bordas internas superiores
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.4 });
  add(new THREE.BoxGeometry(0.78, 0.006, 0.006), ledMat, 0, 0.738, FZ - 0.05).castShadow = false;
  [-1, 1].forEach((sx) => { add(new THREE.BoxGeometry(0.006, 0.006, 0.56), ledMat, sx * 0.4, 0.738, 0).castShadow = false; });
  parts.led = ledMat;

  return { group: m, parts, W, D, H };
}

/* ---------------------------------------------------------- cotas (linhas técnicas) */
function buildDims(THREE, M) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xe6eaee, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const g = new THREE.Group();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const seg = (pts) => {
    for (let k = 0; k < pts.length; k += 2) {
      a.set(...pts[k]); b.set(...pts[k + 1]);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, a.distanceTo(b), 6), mat);
      bar.position.copy(a).add(b).multiplyScalar(0.5);
      bar.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      g.add(bar);
    }
  };
  const t = 0.022, W = M.W / 2, D = M.D / 2, H = M.H;
  seg([[-W, -0.05, D + 0.06], [W, -0.05, D + 0.06], [-W, -0.05 - t, D + 0.06], [-W, -0.05 + t, D + 0.06], [W, -0.05 - t, D + 0.06], [W, -0.05 + t, D + 0.06]]);
  seg([[-W - 0.07, 0, D], [-W - 0.07, H, D], [-W - 0.07 - t, 0, D], [-W - 0.07 + t, 0, D], [-W - 0.07 - t, H, D], [-W - 0.07 + t, H, D]]);
  seg([[W + 0.07, -0.05, -D], [W + 0.07, -0.05, D], [W + 0.07 - t, -0.05, -D], [W + 0.07 + t, -0.05, -D], [W + 0.07 - t, -0.05, D], [W + 0.07 + t, -0.05, D]]);
  return { group: g, mat };
}

/* ---------------------------------------------------------- cena */
async function boot() {
  let THREE, RB, RA;
  try {
    [THREE, RB, RA] = await Promise.all([import(THREE_URL), import(ADDONS + 'geometries/RoundedBoxGeometry.js'), import(ADDONS + 'lights/RectAreaLightUniformsLib.js')]);
  } catch (_) { return; } // sem rede: ficam os quadros estáticos
  const stage = root.querySelector('.flex3d__stage');
  const canvas = stage.querySelector('canvas');
  const mobileQ = matchMedia('(max-width: 900px)');
  const quality = { shadows: !lowEnd && !mobileQ.matches, lite: lowEnd || mobileQ.matches };
  const maxDpr = Math.min(devicePixelRatio || 1, quality.lite ? 1.5 : 2);
  let dpr = maxDpr;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (_) { return; }
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.setClearColor(0x000000, 0); // o fundo é o da seção (CSS), sem emenda
  if (quality.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap; }

  const scene = new THREE.Scene();
  // a inicialização cede a vez ao navegador entre etapas para não travar o scroll
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  scene.environment = studioEnv(THREE, renderer);
  await breathe();
  scene.environmentIntensity = 1.05;

  // chão: área iluminada + sombra de contato + sombra em tempo real
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: floorTex(THREE), transparent: true, depthWrite: false, toneMapped: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; scene.add(floor);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1.45), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: contactTex(THREE), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.0005; scene.add(contact);
  if (quality.shadows) {
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.32 }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.001; catcher.receiveShadow = true; scene.add(catcher);
  }

  // luz principal quente e alta, contraluz fria, preenchimento suave do ambiente
  scene.add(new THREE.HemisphereLight(0xe8ecf0, 0x0c0d10, 0.25));
  const key = new THREE.DirectionalLight(0xfff1e2, 2.3); key.position.set(-1.5, 4.4, 1.9); scene.add(key);
  if (quality.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -0.9, right: 0.9, top: 1.0, bottom: -0.7, near: 1, far: 9 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.01; key.shadow.radius = 10; key.shadow.blurSamples = 16;
  }
  const rim = new THREE.DirectionalLight(0xdbe6f5, 1.6); rim.position.set(2.8, 1.8, -2.6); scene.add(rim);
  // as faixas de LED internas iluminam o deck de cima (luz de área)
  RA.RectAreaLightUniformsLib.init();
  const inner = new THREE.RectAreaLight(0xffffff, 0, 0.76, 0.52);
  inner.position.set(0, 0.73, 0); inner.lookAt(0, 0, 0); scene.add(inner);

  const M = buildMachine(THREE, RB.RoundedBoxGeometry, quality);
  scene.add(M.group);
  const dims = buildDims(THREE, M); scene.add(dims.group);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 30);
  await breathe();
  // shaders compilados fora da thread principal quando o navegador permite
  try { await renderer.compileAsync(scene, camera); } catch (_) { /* compila no primeiro quadro */ }
  const pins = [...root.querySelectorAll('[data-pin]')].map((p) => ({ el: p, at: p.dataset.pin.split(',').map(Number), for: p.dataset.for.split(' '), carriage: p.dataset.part === 'carriage', tag: p.classList.contains('pin--tag') }));
  const pinVec = new THREE.Vector3();

  const fit = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = 2;
  };
  let dirty = 2;
  fit();
  new ResizeObserver(() => { fit(); measure(); }).observe(stage);
  measure();
  addEventListener('load', measure);
  if (document.fonts) document.fonts.ready.then(measure);
  addEventListener('resize', measure);

  // leve paralaxe com o ponteiro, só em mouse
  let pointerX = 0, pointerY = 0, px = 0, py = 0;
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    root.addEventListener('pointermove', (e) => { const b = stage.getBoundingClientRect(); pointerX = (e.clientX - b.left) / b.width - 0.5; pointerY = (e.clientY - b.top) / b.height - 0.5; });
    root.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; });
  }

  const rail = [...root.querySelectorAll('.flex3d__rail button')];
  const steps = [...root.querySelectorAll('[data-pose]')];
  let lastActive = '';
  const tmpCam = new THREE.Vector3(), tmpTgt = new THREE.Vector3();
  const beamBase = M.parts.beamMat.emissive.clone();
  const beamHi = new THREE.Color(0x24080a);
  let cur = null;

  function frame(dt) {
    const mobile = mobileQ.matches;
    const target = resolve(mobile);
    if (!target) return false;
    if (!cur) cur = JSON.parse(JSON.stringify(target));
    // amortecimento exponencial: suave na ida e na volta, sem atraso perceptível
    const k = window.__forcePose ? 1 : 1 - Math.exp(-dt * 6.5);
    let moved = 0;
    for (let i = 0; i < 3; i++) {
      const c0 = cur.cam[i], t0 = cur.tgt[i];
      cur.cam[i] = lerp(cur.cam[i], target.cam[i], k); cur.tgt[i] = lerp(cur.tgt[i], target.tgt[i], k);
      moved += Math.abs(cur.cam[i] - c0) + Math.abs(cur.tgt[i] - t0);
    }
    KEYS.forEach((n) => { const v0 = cur[n]; cur[n] = lerp(cur[n], target[n], k); moved += Math.abs(cur[n] - v0); });
    const ppx = px, ppy = py;
    px = lerp(px, pointerX, 1 - Math.exp(-dt * 3)); py = lerp(py, pointerY, 1 - Math.exp(-dt * 3));
    moved += Math.abs(px - ppx) + Math.abs(py - ppy);

    if (track.active !== lastActive) {
      lastActive = track.active;
      rail.forEach((b) => b.setAttribute('aria-current', b.dataset.go === lastActive ? 'step' : 'false'));
      steps.forEach((s) => s.classList.toggle('is-active', s.dataset.pose === lastActive));
    }
    // cena parada: não redesenha (economiza bateria e GPU)
    if (moved < 1e-5 && !dirty) return false;
    dirty = Math.max(0, dirty - 1);

    // câmera: afasta conforme a proporção da tela para a máquina caber inteira
    tmpTgt.set(cur.tgt[0], cur.tgt[1], cur.tgt[2]);
    tmpCam.set(cur.cam[0], cur.cam[1], cur.cam[2]);
    const fitK = mobile ? Math.max(1, 1.08 / camera.aspect) : Math.max(1, 1.62 / camera.aspect);
    tmpCam.sub(tmpTgt).multiplyScalar(fitK).add(tmpTgt);
    camera.position.set(tmpCam.x + px * 0.14, tmpCam.y - py * 0.07, tmpCam.z);
    camera.fov = cur.fov;
    camera.lookAt(tmpTgt);
    camera.filmOffset = mobile ? 0 : -cur.shift * camera.filmGauge;
    camera.updateProjectionMatrix();

    // peças
    M.parts.door.rotation.x = -cur.door * 1.25; // articulada no topo: a porta sobe
    M.parts.gantry.position.z = cur.gz;
    M.parts.carriage.position.x = cur.cx;
    M.parts.pipettes.position.y = -cur.pz * 0.075;
    M.parts.screen.color.setScalar(0.4 + cur.screen * 0.7);
    M.parts.status.color.setScalar(0.45 + cur.status * 0.55);
    M.parts.led.opacity = 0.25 + cur.led * 0.75;
    inner.intensity = cur.led * 2.4;
    M.parts.beamMat.emissive.copy(beamBase).lerp(beamHi, cur.hi);
    M.parts.slots.forEach((s) => { s.mat.opacity = clamp01(cur.slots * 17 - s.order) * (s.staging ? 0.45 : 0.95); });
    dims.mat.opacity = cur.dims * 0.8;

    renderer.render(scene, camera);

    // marcadores DOM projetados a partir do 3D
    const w = stage.clientWidth, h = stage.clientHeight;
    pins.forEach((p) => {
      const weight = p.for.reduce((s, n) => s + (track.weights[n] || 0), 0);
      const vis = clamp01((weight - 0.55) / 0.3);
      if (vis <= 0.001) { if (p.el.style.visibility !== 'hidden') { p.el.style.opacity = 0; p.el.style.visibility = 'hidden'; } return; }
      pinVec.set(p.at[0], p.at[1], p.at[2]);
      if (p.carriage) { pinVec.x += cur.cx; pinVec.z += cur.gz; }
      pinVec.project(camera);
      const sx = (pinVec.x + 1) / 2 * w, sy = (1 - pinVec.y) / 2 * h;
      p.el.style.visibility = 'visible';
      p.el.style.opacity = vis;
      if (!p.tag) p.el.classList.toggle('pin--left', sx > w * (mobile ? 0.55 : 0.74));
      p.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    });
    return true;
  }

  // resolução adaptativa: se o quadro passar de ~24 ms, reduz a densidade de pixels
  let acc = 0, n = 0;
  function adapt(dt, drew) {
    if (!drew) return;
    acc += dt; n++;
    if (n < 45) return;
    const avg = acc / n; acc = 0; n = 0;
    if (avg > 0.024 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); fit(); }
  }

  // laço apenas com a seção visível
  let visible = false, raf = 0, last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    adapt(dt, frame(dt));
    raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
  };
  const start = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; start(); }, { rootMargin: '200px 0px' }).observe(root);
  document.addEventListener('visibilitychange', start);

  frame(1);
  root.classList.add('has-gl');
  window.__flexReady = true;
}

/* ---------------------------------------------------------- trilho de etapas e estado sem WebGL */
function wire() {
  const rail = [...root.querySelectorAll('.flex3d__rail button')];
  rail.forEach((b) => b.addEventListener('click', () => {
    const el = root.querySelector(`[data-pose="${b.dataset.go}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    const focusable = el.querySelector('h2, h3');
    if (focusable) { focusable.setAttribute('tabindex', '-1'); focusable.focus({ preventScroll: true }); }
  }));
  // sem WebGL ou com movimento reduzido: troca o quadro estático conforme a etapa
  const imgs = [...root.querySelectorAll('.flex3d__still img')];
  const steps = [...root.querySelectorAll('[data-pose]')];
  const io = new IntersectionObserver((entries) => {
    if (root.classList.contains('has-gl')) return;
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const name = e.target.dataset.pose;
      steps.forEach((s) => s.classList.toggle('is-active', s === e.target));
      imgs.forEach((i) => i.classList.toggle('is-on', i.dataset.still === name));
      rail.forEach((b) => b.setAttribute('aria-current', b.dataset.go === name ? 'step' : 'false'));
    });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));
}

if (root) {
  wire();
  const ok = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (_) { return false; } })();
  if (window.__forceGL || (!reduce && !saveData && ok)) {
    // carrega só quando a seção se aproxima; o restante da página não espera pelo 3D
    const io = new IntersectionObserver((e) => {
      if (!e.some((x) => x.isIntersecting)) return;
      io.disconnect();
      (window.requestIdleCallback || setTimeout)(() => boot().catch((err) => console.warn('Opentrons Flex 3D indisponível:', err)), { timeout: 800 });
    }, { rootMargin: '900px 0px' });
    io.observe(root);
  }
}
