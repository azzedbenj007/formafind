import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createModel } from './model';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') ?? 1280), H = Number(params.get('h') ?? 853);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d8d8, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(1.5, 3.2, 2.0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2 });
scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 1.2);
rim.position.set(-2, 1.6, -2.4);
scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: Number(params.get("shadow") ?? 0.06) }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const model = createModel();
model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
scene.add(model);


type View = { az: number; el: number; d: number; fov: number; tx: number; ty: number; tz: number };
const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
function place(v: View) {
  const az = v.az * Math.PI / 180, el = v.el * Math.PI / 180;
  camera.fov = v.fov; camera.aspect = W / H; camera.updateProjectionMatrix();
  const t = new THREE.Vector3(v.tx, v.ty, v.tz);
  camera.position.set(t.x + v.d * Math.cos(el) * Math.sin(az), t.y + v.d * Math.sin(el), t.z + v.d * Math.cos(el) * Math.cos(az));
  camera.lookAt(t);
  renderer.render(scene, camera);
}
const G = 224;
const gl = renderer.getContext();
const buf = new Uint8Array(W * H * 4);
function renderMask(v: View): Uint8Array {
  place(v);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const m = new Uint8Array(G * G);
  for (let y = 0; y < G; y++) {
    const sy = H - 1 - Math.min(H - 1, Math.floor(y * H / G));
    for (let x = 0; x < G; x++) {
      const sx = Math.min(W - 1, Math.floor(x * W / G));
      const i = (sy * W + sx) * 4;
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const dist = Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2);
      const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      m[y * G + x] = dist > 24 || (sat > 0.16 && luma < 0.94) ? 1 : 0;
    }
  }
  // keep largest 4-connected blob
  const seen = new Uint8Array(G * G); let best: number[] = [];
  for (let s0 = 0; s0 < G * G; s0++) {
    if (!m[s0] || seen[s0]) continue;
    const stack = [s0]; seen[s0] = 1; const blob: number[] = [];
    while (stack.length) {
      const idx = stack.pop()!; blob.push(idx);
      const y = Math.floor(idx / G), x = idx % G;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx >= 0 && nx < G && ny >= 0 && ny < G) { const n = ny * G + nx; if (m[n] && !seen[n]) { seen[n] = 1; stack.push(n); } }
      }
    }
    if (blob.length > best.length) best = blob;
  }
  const out = new Uint8Array(G * G); for (const i of best) out[i] = 1;
  return out;
}
function iou(a: Uint8Array, b: Uint8Array) { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] || b[k]) { u++; if (a[k] && b[k]) i++; } } return u ? i / u : 0; }
(window as any).fit = (photo: string, start: View, iters = 6) => {
  const ref = Uint8Array.from(photo, (c) => (c === '1' ? 1 : 0));
  let cur = { ...start }; let score = iou(ref, renderMask(cur));
  const steps: Record<keyof View, number> = { az: 4, el: 3, d: 0.3, fov: 4, tx: 0.08, ty: 0.08, tz: 0.08 };
  for (let it = 0; it < iters; it++) {
    for (const k of Object.keys(steps) as (keyof View)[]) {
      for (const dir of [1, -1]) {
        let improved = true;
        while (improved) {
          improved = false;
          const cand = { ...cur, [k]: cur[k] + dir * steps[k] };
          const s = iou(ref, renderMask(cand));
          if (s > score + 1e-4) { cur = cand; score = s; improved = true; }
        }
      }
    }
    for (const k of Object.keys(steps) as (keyof View)[]) steps[k] *= 0.5;
  }
  return { view: cur, iou: score };
};
(window as any).__ready = true;
