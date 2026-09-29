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

const az = Number(params.get('az') ?? 215) * Math.PI / 180; // 0 = camera in front (+Z)
const el = Number(params.get('el') ?? 12) * Math.PI / 180;
const dist = Number(params.get('d') ?? 3.9);
const fov = Number(params.get('fov') ?? 30);
const target = new THREE.Vector3(Number(params.get('tx') ?? 0), Number(params.get('ty') ?? 0.58), Number(params.get('tz') ?? -0.05));
const camera = new THREE.PerspectiveCamera(fov, W / H, 0.05, 50);
camera.position.set(target.x + dist * Math.cos(el) * Math.sin(az), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(az));
camera.lookAt(target);
renderer.render(scene, camera);
let tris = 0;
model.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  const g = m.geometry; const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  tris += n * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
});
(window as any).__stats = { tris, meshes: 0 };
(window as any).__ready = true;
