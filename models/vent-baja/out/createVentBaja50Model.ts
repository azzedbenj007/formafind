import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function buildTubeGeometry(
  path: { points: [number, number, number][]; radius?: number; radialSegments?: number; closed?: boolean },
): THREE.TubeGeometry {
  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(vectors, path.closed ?? false);
  const tubularSegments = Math.max(8, path.points.length * 6);
  return new THREE.TubeGeometry(curve, tubularSegments, path.radius ?? 0.05, path.radialSegments ?? 8, path.closed ?? false);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Vent Baja 50 Dirt Bike
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createVentBaja50DirtBikeModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Vent Baja 50 Dirt Bike";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 30.0, "aspect": 1.5006, "orientation": {"yaw": 215.0, "pitch": -12.0, "roll": 0.0}, "positionHint": [-2.2, 1.35, -2.6], "note": "Rear-right three-quarter studio shot; camera behind and to the RIGHT of the bike (-X), target (0, 0.55, -0.05)."}, "approximationNotes": []};
  root.userData.materialPipeline = {"schemaVersion": 1, "status": "proceed", "registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "analysisArtifact": "/home/user/formafind/models/vent-baja/material-analysis.json", "targetThreshold": 0.7, "unresolvedNotObservedMaterials": [], "regions": [{"componentId": "side-panel-l", "regionId": "red-gloss", "specMaterialId": "red-plastic", "profileId": "plastic.glossy", "status": "proceed"}, {"componentId": "silencer", "regionId": "white-gloss", "specMaterialId": "white-plastic", "profileId": "plastic.glossy", "status": "proceed"}, {"componentId": "side-panel-l", "regionId": "grey-stripe", "specMaterialId": "grey-plastic", "profileId": "plastic.matte", "status": "proceed"}, {"componentId": "seat", "regionId": "seat-vinyl", "specMaterialId": "seat-vinyl", "profileId": "leather.matte", "status": "proceed"}, {"componentId": "fork-upper-l", "regionId": "gold-tube", "specMaterialId": "gold-anodized", "profileId": "metal.gold", "status": "proceed"}, {"componentId": "tyre-rear", "regionId": "rubber", "specMaterialId": "tyre-rubber", "profileId": "rubber.matte", "status": "proceed"}, {"componentId": "swingarm-l", "regionId": "black-paint", "specMaterialId": "black-frame", "profileId": "coating.painted-metal", "status": "proceed"}, {"componentId": "shock-spring", "regionId": "yellow-spring", "specMaterialId": "yellow-spring", "profileId": "coating.painted-metal", "status": "proceed"}, {"componentId": "disc-rear", "regionId": "steel-disc", "specMaterialId": "brushed-steel", "profileId": "metal.steel-brushed", "status": "proceed"}, {"componentId": "chain", "regionId": "chain-links", "specMaterialId": "chain-steel", "profileId": "metal.brass", "status": "proceed"}, {"componentId": "silencer-cap", "regionId": "carbon-cap", "specMaterialId": "carbon-cap", "profileId": "plastic.glossy", "status": "proceed"}, {"componentId": "plate-reflector", "regionId": "red-reflector", "specMaterialId": "reflector-red", "profileId": "plastic.glossy", "status": "proceed"}], "controlledViewsRequired": ["albedo-unlit", "environment-reflection", "grazing", "neutral-studio", "reference-beauty"]};
  root.userData.materialReferenceRegistry = "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["red-plastic"] = createSculptMaterial(
    "red-plastic",
    {"id": "red-plastic", "name": "Gloss red bodywork plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#C8101E", "color": "#C8101E", "albedo": {"dominant": "#C8101E", "secondary": ["#A8031A", "#B11728"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#C8101E", "#A8031A", "#B11728"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.28, "variation": 0.058, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [{"id": "red-panel-edge-gloss", "kind": "gloss", "region": "moulded panel edges", "roughness": 0.18, "notes": "Crisp specular line along shroud and fender edges in the photo."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Vivid red (hue ~356), high saturation; photo mid-value #A8031A de-lit upward.", "physical": {"clearcoat": 0.6, "clearcoatRoughness": 0.2}, "clearcoat": 0.6, "clearcoatRoughness": 0.2, "materialEvidence": {"componentId": "side-panel-l", "regionId": "red-gloss", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/00-red-gloss.png", "bbox": {"x": 335, "y": 250, "width": 50, "height": 22}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.001}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "side-panel-l", "regionId": "red-gloss", "materialId": "plastic.glossy", "family": "plastic", "subtype": "gloss-plastic", "finish": "gloss", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "materialFamily": "plastic", "materialFinish": "glossy", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "plastic.glossy", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-physical", "three.mesh-standard", "adobe.pbr-guide-1", "google.filament-pbr", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap"], "validationViews": ["neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "materialSubtype": "generic-polymer", "referenceMaterialId": "plastic.glossy", "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#FBF8F7", "#EED2D5", "#BC4E59", "#A40A1F", "#A60C20"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 135.9, "meanSaturation": 0.57, "gradientStrength": 0.752, "mottle": 0.02, "streakRatio": 1.24, "hueSpread": 0.001, "specularFraction": 0.359}}, "ior": {"base": 1.5, "variation": 0.0}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/00-red-gloss.png (confidence 0.86) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.86, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/00-red-gloss.png", "verdict": "pass"}},
    options
  );
  materialMap["white-plastic"] = createSculptMaterial(
    "white-plastic",
    {"id": "white-plastic", "name": "Gloss white livery / silencer", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#EEF0F2", "color": "#EEF0F2", "albedo": {"dominant": "#EEF0F2", "secondary": ["#DCDFE3", "#BCBDBE"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#EEF0F2", "#DCDFE3", "#BCBDBE"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.28, "variation": 0.05, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [{"id": "silencer-decal", "kind": "decal", "region": "silencer can outer face", "notes": "Red/yellow sticker and 'VENT' logo on the can (approximated by colour patch geometry)."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Neutral white with cool shadow side #BCBDBE.", "physical": {"clearcoat": 0.5, "clearcoatRoughness": 0.2}, "clearcoat": 0.5, "clearcoatRoughness": 0.2, "materialEvidence": {"componentId": "silencer", "regionId": "white-gloss", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/01-white-gloss.png", "bbox": {"x": 525, "y": 356, "width": 24, "height": 12}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0003}, "observations": ["near-neutral colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "silencer", "regionId": "white-gloss", "materialId": "plastic.glossy", "family": "plastic", "subtype": "gloss-plastic", "finish": "gloss", "aliases": [], "confidence": 0.799, "source": "vision"}, "alternatives": []}, "materialFamily": "plastic", "materialFinish": "glossy", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "plastic.glossy", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-physical", "three.mesh-standard", "adobe.pbr-guide-1", "google.filament-pbr", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap"], "validationViews": ["neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "materialSubtype": "generic-polymer", "referenceMaterialId": "plastic.glossy", "textureAnalysis": {"finishClass": "plastic", "recipe": {"metalness": 0.05, "roughness": 0.6, "clearcoat": 0.2, "clearcoatRoughness": 0.3, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.7, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#B9BBC3", "#B9BBC3", "#97999D", "#6F7171", "#6F7171"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 151.8, "meanSaturation": 0.044, "gradientStrength": 0.294, "mottle": 0.005, "streakRatio": 1.19, "hueSpread": 0.0, "specularFraction": 0.0}}, "ior": {"base": 1.5, "variation": 0.0}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/01-white-gloss.png (confidence 0.799) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.799, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/01-white-gloss.png", "verdict": "pass"}},
    options
  );
  materialMap["grey-plastic"] = createSculptMaterial(
    "grey-plastic",
    {"id": "grey-plastic", "name": "Satin slate-grey livery stripe", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#56626F", "color": "#56626F", "albedo": {"dominant": "#56626F", "secondary": ["#5A6776", "#506877"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#56626F", "#5A6776", "#506877"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.68, "variation": 0.05, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Blue-grey satin stripe separating red and white fields.", "physical": {}, "materialEvidence": {"componentId": "side-panel-l", "regionId": "grey-stripe", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/02-grey-stripe.png", "bbox": {"x": 545, "y": 258, "width": 40, "height": 12}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0004}, "observations": ["chromatic base-colour response", "directional surface frequency", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "side-panel-l", "regionId": "grey-stripe", "materialId": "plastic.matte", "family": "plastic", "subtype": "satin-plastic", "finish": "satin", "aliases": [], "confidence": 0.751, "source": "vision"}, "alternatives": []}, "materialFamily": "plastic", "materialFinish": "matte", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "plastic.matte", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-standard", "adobe.pbr-guide-1", "google.filament-pbr", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "aoMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing"]}, "materialSubtype": "generic-polymer", "referenceMaterialId": "plastic.matte", "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#5A6776", "#596776", "#596776", "#596776", "#576676"], "paletteHueRisk": [{"stop": "#5A6776", "hueRisk": "blue-collapse", "suggestedRgb": [118, 103, 90]}, {"stop": "#596776", "hueRisk": "blue-collapse", "suggestedRgb": [118, 103, 89]}, {"stop": "#596776", "hueRisk": "blue-collapse", "suggestedRgb": [118, 103, 89]}, {"stop": "#596776", "hueRisk": "blue-collapse", "suggestedRgb": [118, 103, 89]}, {"stop": "#576676", "hueRisk": "blue-collapse", "suggestedRgb": [118, 102, 87]}], "gradientAxis": "horizontal", "stats": {"meanLum": 100.7, "meanSaturation": 0.245, "gradientStrength": 0.007, "mottle": 0.002, "streakRatio": 2.25, "hueSpread": 0.002, "specularFraction": 0.0}}, "ior": {"base": 1.5, "variation": 0.0}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/02-grey-stripe.png (confidence 0.751) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.751, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/02-grey-stripe.png", "verdict": "pass"}},
    options
  );
  materialMap["seat-vinyl"] = createSculptMaterial(
    "seat-vinyl",
    {"id": "seat-vinyl", "name": "Black textured seat vinyl", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#1B1C1D", "color": "#1B1C1D", "albedo": {"dominant": "#1B1C1D", "secondary": ["#383939", "#4A4C4B"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#1B1C1D", "#383939", "#4A4C4B"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.62, "variation": 0.05, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Matte black grained vinyl; top surface catches soft highlight.", "physical": {}, "materialEvidence": {"componentId": "seat", "regionId": "seat-vinyl", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/03-seat-vinyl.png", "bbox": {"x": 480, "y": 213, "width": 80, "height": 16}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0012}, "observations": ["near-neutral colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "seat", "regionId": "seat-vinyl", "materialId": "leather.matte", "family": "fabric", "subtype": "vinyl", "finish": "matte", "aliases": [], "confidence": 0.793, "source": "vision"}, "alternatives": []}, "materialFamily": "leather", "materialFinish": "matte-worn", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "leather.matte", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-physical", "three.mesh-standard", "adobe.pbr-guide-2", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap", "clearcoatMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "reference-beauty"]}, "materialSubtype": "natural-or-synthetic", "referenceMaterialId": "leather.matte", "textureAnalysis": {"finishClass": "brushed-steel", "recipe": {"metalness": 1.0, "roughness": 0.35, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 1.0, "procedural": "brushed"}, "palette": ["#FFFFFF", "#FEFEFE", "#484945", "#3B3C3E", "#464749"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 135.1, "meanSaturation": 0.027, "gradientStrength": 0.778, "mottle": 0.007, "streakRatio": 0.39, "hueSpread": 0.0, "specularFraction": 0.34}}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/03-seat-vinyl.png (confidence 0.793) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.793, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/03-seat-vinyl.png", "verdict": "pass"}},
    options
  );
  materialMap["gold-anodized"] = createSculptMaterial(
    "gold-anodized",
    {"id": "gold-anodized", "name": "Gold anodized fork stanchion", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#C99A3A", "color": "#C99A3A", "albedo": {"dominant": "#C99A3A", "secondary": ["#DBB238", "#9F7521"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#C99A3A", "#DBB238", "#9F7521"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.22, "variation": 0.061, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 1.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Gold TiN/anodized coating, strong specular, warm hue.", "physical": {}, "materialEvidence": {"componentId": "fork-upper-l", "regionId": "gold-tube", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/04-gold-tube.png", "bbox": {"x": 868, "y": 215, "width": 14, "height": 70}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0009}, "observations": ["chromatic base-colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "fork-upper-l", "regionId": "gold-tube", "materialId": "metal.gold", "family": "metal", "subtype": "anodized", "finish": "metallic", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "materialFamily": "metal", "materialFinish": "polished", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "metal.gold", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-standard", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "metalnessMap"], "validationViews": ["albedo-unlit", "environment-reflection", "grazing", "reference-beauty"]}, "materialSubtype": "gold", "referenceMaterialId": "metal.gold", "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#DAAEB0", "#FAF7FD", "#ECE3EA", "#AF8A2B", "#C49D31"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 184.9, "meanSaturation": 0.42, "gradientStrength": 0.664, "mottle": 0.014, "streakRatio": 0.23, "hueSpread": 0.038, "specularFraction": 0.417}}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/04-gold-tube.png (confidence 0.86) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.86, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/04-gold-tube.png", "verdict": "pass"}},
    options
  );
  materialMap["tyre-rubber"] = createSculptMaterial(
    "tyre-rubber",
    {"id": "tyre-rubber", "name": "Knobby tyre rubber", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#232322", "color": "#232322", "albedo": {"dominant": "#232322", "secondary": ["#3A3A37", "#5A5A56"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#232322", "#3A3A37", "#5A5A56"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.88, "variation": 0.05, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.05, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [{"id": "tyre-knob-wear", "kind": "stain", "region": "knob tops", "dirtAmount": 0.15, "cavityBias": 0.7, "notes": "Knob crowns slightly lighter/dustier than the carcass."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Near-black rubber; knob tops slightly lighter from wear.", "physical": {}, "materialEvidence": {"componentId": "tyre-rear", "regionId": "rubber", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/05-rubber.png", "bbox": {"x": 250, "y": 560, "width": 28, "height": 60}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0015}, "observations": ["near-neutral colour response", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "tyre-rear", "regionId": "rubber", "materialId": "rubber.matte", "family": "rubber", "subtype": "rubber", "finish": "matte", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "materialFamily": "rubber", "materialFinish": "matte", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "rubber.matte", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-standard", "adobe.pbr-guide-1", "google.filament-pbr", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "reference-beauty"]}, "materialSubtype": "generic-elastomer", "referenceMaterialId": "rubber.matte", "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#31322F", "#3B3B38", "#363735", "#494948", "#383A3A"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 63.4, "meanSaturation": 0.055, "gradientStrength": 0.152, "mottle": 0.022, "streakRatio": 0.7, "hueSpread": 0.191, "specularFraction": 0.0}}, "ior": {"base": 1.48, "variation": 0.0}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/05-rubber.png (confidence 0.86) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.86, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/05-rubber.png", "verdict": "pass"}},
    options
  );
  materialMap["black-frame"] = createSculptMaterial(
    "black-frame",
    {"id": "black-frame", "name": "Satin black painted steel", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#141517", "color": "#141517", "albedo": {"dominant": "#141517", "secondary": ["#201F1A", "#0F1012"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#141517", "#201F1A", "#0F1012"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.45, "variation": 0.05, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.3, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.05, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [{"id": "frame-edge-wear", "kind": "scratch", "region": "swingarm lower edge, footpeg mounts", "roughness": 0.6, "notes": "Faint satin scuffing only; the bike is new."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Frame, swingarm, rims, engine cases, expansion chamber.", "physical": {}, "materialEvidence": {"componentId": "swingarm-l", "regionId": "black-paint", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/06-black-paint.png", "bbox": {"x": 470, "y": 510, "width": 60, "height": 16}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0009}, "observations": ["near-neutral colour response", "directional surface frequency", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "swingarm-l", "regionId": "black-paint", "materialId": "coating.painted-metal", "family": "coating", "subtype": "paint-over-metal", "finish": "satin", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "materialFamily": "coating", "materialFinish": "gloss-or-satin", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "coating.painted-metal", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-physical", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-1", "adobe.pbr-guide-2"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap", "clearcoatRoughnessMap", "metalnessMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "materialSubtype": "paint-over-metal", "referenceMaterialId": "coating.painted-metal", "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#5A5850", "#343431", "#262729", "#444646", "#3C3E40"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 54.0, "meanSaturation": 0.089, "gradientStrength": 0.232, "mottle": 0.054, "streakRatio": 2.67, "hueSpread": 0.891, "specularFraction": 0.001}}, "ior": {"base": 1.5, "variation": 0.0}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/06-black-paint.png (confidence 0.86) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.86, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/06-black-paint.png", "verdict": "pass"}},
    options
  );
  materialMap["yellow-spring"] = createSculptMaterial(
    "yellow-spring",
    {"id": "yellow-spring", "name": "Yellow painted shock spring", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#E0B11E", "color": "#E0B11E", "albedo": {"dominant": "#E0B11E", "secondary": ["#B48316", "#88610E"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#E0B11E", "#B48316", "#88610E"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.45, "variation": 0.05, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.1, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Saturated yellow-gold spring coils.", "physical": {}, "materialEvidence": {"componentId": "shock-spring", "regionId": "yellow-spring", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/07-yellow-spring.png", "bbox": {"x": 588, "y": 418, "width": 18, "height": 18}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0003}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "shock-spring", "regionId": "yellow-spring", "materialId": "coating.painted-metal", "family": "coating", "subtype": "paint-over-metal", "finish": "gloss", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "materialFamily": "coating", "materialFinish": "gloss-or-satin", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "coating.painted-metal", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-physical", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-1", "adobe.pbr-guide-2"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap", "clearcoatRoughnessMap", "metalnessMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "materialSubtype": "paint-over-metal", "referenceMaterialId": "coating.painted-metal", "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#6C5118", "#664C13", "#30230F", "#181815", "#1F1E1F"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 51.0, "meanSaturation": 0.419, "gradientStrength": 0.232, "mottle": 0.008, "streakRatio": 0.69, "hueSpread": 0.123, "specularFraction": 0.0}}, "ior": {"base": 1.5, "variation": 0.0}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/07-yellow-spring.png (confidence 0.86) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.86, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/07-yellow-spring.png", "verdict": "pass"}},
    options
  );
  materialMap["brushed-steel"] = createSculptMaterial(
    "brushed-steel",
    {"id": "brushed-steel", "name": "Brushed steel / aluminium", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#A9B1B2", "color": "#A9B1B2", "albedo": {"dominant": "#A9B1B2", "secondary": ["#888E8C", "#D0D9DB"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#A9B1B2", "#888E8C", "#D0D9DB"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.35, "variation": 0.05, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 1.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [{"id": "disc-wave-edge", "kind": "gloss", "region": "brake disc friction ring", "roughness": 0.2, "notes": "Bright machined ring on the wave discs."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Discs, spokes, triple clamps, fork lowers, footpegs, radiator.", "physical": {}, "materialEvidence": {"componentId": "disc-rear", "regionId": "steel-disc", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/08-steel-disc.png", "bbox": {"x": 395, "y": 585, "width": 30, "height": 22}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0006}, "observations": ["near-neutral colour response", "directional surface frequency", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "disc-rear", "regionId": "steel-disc", "materialId": "metal.steel-brushed", "family": "metal", "subtype": "steel", "finish": "metallic", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "materialFamily": "metal", "materialFinish": "brushed", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "metal.steel-brushed", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap", "normalMap", "anisotropyMap"], "optionalMaps": ["metalnessMap"], "validationViews": ["neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "materialSubtype": "steel", "referenceMaterialId": "metal.steel-brushed", "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#1E1F21", "#1A1B1C", "#2C2E2E", "#535857", "#7E8383"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 58.4, "meanSaturation": 0.083, "gradientStrength": 0.472, "mottle": 0.035, "streakRatio": 2.11, "hueSpread": 0.065, "specularFraction": 0.006}}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/08-steel-disc.png (confidence 0.86) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.86, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/08-steel-disc.png", "verdict": "pass"}},
    options
  );
  materialMap["chain-steel"] = createSculptMaterial(
    "chain-steel",
    {"id": "chain-steel", "name": "Drive chain steel", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#5A5850", "color": "#5A5850", "albedo": {"dominant": "#5A5850", "secondary": ["#4A4B4C", "#3B3D3E"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#5A5850", "#4A4B4C", "#3B3D3E"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.688, "variation": 0.061, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.9, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Dark steel chain; evidence crop reads neutral grey, not gold.", "physical": {}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/09-chain-links.png (confidence 0.794) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.794, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/09-chain-links.png", "verdict": "pass"}},
    options
  );
  materialMap["carbon-cap"] = createSculptMaterial(
    "carbon-cap",
    {"id": "carbon-cap", "name": "Carbon silencer end cap", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#26231F", "color": "#26231F", "albedo": {"dominant": "#26231F", "secondary": ["#2A2621", "#322F2C"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#26231F", "#2A2621", "#322F2C"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.28, "variation": 0.05, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Dark carbon weave under clear lacquer.", "physical": {"clearcoat": 0.8, "clearcoatRoughness": 0.15}, "clearcoat": 0.8, "clearcoatRoughness": 0.15, "materialEvidence": {"componentId": "silencer-cap", "regionId": "carbon-cap", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/10-carbon-cap.png", "bbox": {"x": 398, "y": 272, "width": 26, "height": 26}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0006}, "observations": ["near-neutral colour response", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "silencer-cap", "regionId": "carbon-cap", "materialId": "plastic.glossy", "family": "plastic", "subtype": "carbon-composite", "finish": "satin", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "materialFamily": "plastic", "materialFinish": "glossy", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "plastic.glossy", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-physical", "three.mesh-standard", "adobe.pbr-guide-1", "google.filament-pbr", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap"], "validationViews": ["neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "materialSubtype": "generic-polymer", "referenceMaterialId": "plastic.glossy", "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#2A2822", "#2C2823", "#35322E", "#373633", "#3D3D3C"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 52.7, "meanSaturation": 0.147, "gradientStrength": 0.122, "mottle": 0.011, "streakRatio": 0.67, "hueSpread": 0.043, "specularFraction": 0.0}}, "ior": {"base": 1.5, "variation": 0.0}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/10-carbon-cap.png (confidence 0.86) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.86, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/10-carbon-cap.png", "verdict": "pass"}},
    options
  );
  materialMap["reflector-red"] = createSculptMaterial(
    "reflector-red",
    {"id": "reflector-red", "name": "Red reflector / tail lens", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#8A0F1A", "color": "#8A0F1A", "albedo": {"dominant": "#8A0F1A", "secondary": ["#570712", "#93464F"], "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}, "colorVariation": {"palette": ["#8A0F1A", "#570712", "#93464F"], "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}, "roughness": {"base": 0.28, "variation": 0.05, "map": "independent-procedural-field (flat; reference-derived base value)", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases where panels overlap the frame and around the engine."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.6, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Translucent red lens; faint emissive lift.", "physical": {"emissive": "#300004"}, "emissive": "#300004", "materialEvidence": {"componentId": "plate-reflector", "regionId": "red-reflector", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/11-red-reflector.png", "bbox": {"x": 200, "y": 322, "width": 30, "height": 14}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0004}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "plate-reflector", "regionId": "red-reflector", "materialId": "plastic.glossy", "family": "plastic", "subtype": "translucent-plastic", "finish": "gloss", "aliases": [], "confidence": 0.86, "source": "vision"}, "alternatives": []}, "materialFamily": "plastic", "materialFinish": "glossy", "materialReference": {"registry": "/home/user/formafind/.claude/skills/img2threejs/docs/materials/material-reference.json", "profileId": "plastic.glossy", "method": "explicit-material-id", "confidence": 1.0, "sourceRefs": ["three.mesh-physical", "three.mesh-standard", "adobe.pbr-guide-1", "google.filament-pbr", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap"], "validationViews": ["neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "materialSubtype": "generic-polymer", "referenceMaterialId": "plastic.glossy", "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#BFADAF", "#75393F", "#6A2D32", "#5B2A33", "#583C3F"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 74.6, "meanSaturation": 0.571, "gradientStrength": 0.515, "mottle": 0.032, "streakRatio": 1.45, "hueSpread": 0.013, "specularFraction": 0.072}}, "ior": {"base": 1.5, "variation": 0.0}, "textureless": {"declared": true, "evidence": ["reference crop /home/user/formafind/models/vent-baja/material-evidence/11-red-reflector.png (confidence 0.86) palette []: one flat hue family, no print/grain/weave at review scale", "material-analysis.json region assignment: flat finish class"]}, "referencePbrMeasurement": {"confidence": 0.86, "palette": null, "sourceImage": "/home/user/formafind/models/vent-baja/material-evidence/11-red-reflector.png", "verdict": "pass"}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Vent Baja 50__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_root_0.position.set(0.0, 0.1, 0.0);
    node_root_0.rotation.set(-0.0, 0.0, -0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Vent Baja 50", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible assembly root: a zero-size anchor node; every visible part is its own solid child.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 0.9}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.1, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(0.001, 0.001, 0.001);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Vent Baja 50";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Vent Baja 50", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Invisible assembly root: a zero-size anchor node; every visible part is its own solid child.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 0.9}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.1, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_root_0);

  const attachment_frame_head_tube_1 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.8016, 0.3994], "localEnd": [0.0, 0.962, 0.3177], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.028, "endRadius": 0.028};
  const endpoint_frame_head_tube_1 = makeAttachmentEndpoint(attachment_frame_head_tube_1);
  const node_frame_head_tube_1 = new THREE.Group();
  node_frame_head_tube_1.name = "Frame head tube__pivot";
  node_frame_head_tube_1.scale.set(1, 1, 1);
  if (endpoint_frame_head_tube_1) {
    node_frame_head_tube_1.position.copy(endpoint_frame_head_tube_1.start);
    node_frame_head_tube_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_frame_head_tube_1.position.set(0.0, 0.0, 0.0);
    node_frame_head_tube_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_frame_head_tube_1.userData.sculptComponent = {"id": "frame-head-tube", "name": "Frame head tube", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Short straight steel tube; a cylinder between measured endpoints on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.8016, 0.3994], "localEnd": [0.0, 0.962, 0.3177], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.028, "endRadius": 0.028}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_head_tube_1.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_frame_head_tube_1);
  nodes["frame-head-tube"] = node_frame_head_tube_1;
  const mesh_frame_head_tube_1Geometry = endpoint_frame_head_tube_1
    ? new THREE.CylinderGeometry(endpoint_frame_head_tube_1.endRadius, endpoint_frame_head_tube_1.baseRadius, endpoint_frame_head_tube_1.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_frame_head_tube_1) {
    mesh_frame_head_tube_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_head_tube_1 = new THREE.Mesh(
    mesh_frame_head_tube_1Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_head_tube_1.name = "Frame head tube";
  if (endpoint_frame_head_tube_1) {
    mesh_frame_head_tube_1.position.copy(endpoint_frame_head_tube_1.midpoint);
    mesh_frame_head_tube_1.quaternion.copy(endpoint_frame_head_tube_1.quaternion);
  }
  mesh_frame_head_tube_1.castShadow = options.castShadow ?? true;
  mesh_frame_head_tube_1.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_head_tube_1.userData.sculptComponent = {"id": "frame-head-tube", "name": "Frame head tube", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Short straight steel tube; a cylinder between measured endpoints on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.8016, 0.3994], "localEnd": [0.0, 0.962, 0.3177], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.028, "endRadius": 0.028}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_head_tube_1.add(mesh_frame_head_tube_1);
  meshes["frame-head-tube"] = mesh_frame_head_tube_1;
  colliders["frame-head-tube"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_frame_head_tube_1);

  const attachment_frame_spar_l_2 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_frame_spar_l_2 = makeAttachmentEndpoint(attachment_frame_spar_l_2);
  const node_frame_spar_l_2 = new THREE.Group();
  node_frame_spar_l_2.name = "Frame main spar L__pivot";
  node_frame_spar_l_2.scale.set(1, 1, 1);
  if (endpoint_frame_spar_l_2) {
    node_frame_spar_l_2.position.copy(endpoint_frame_spar_l_2.start);
    node_frame_spar_l_2.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_frame_spar_l_2.position.set(0.0, 0.0, 0.0);
    node_frame_spar_l_2.rotation.set(-0.0, 0.0, -0.0);
  }
  node_frame_spar_l_2.userData.sculptComponent = {"id": "frame-spar-l", "name": "Frame main spar L", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Bent round-section steel spar following a measured polyline; swept tube, not a box.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.0, 0.9117872032176058, 0.32858366060217514], [0.065, 0.84, 0.18], [0.065, 0.76, 0.0], [0.065, 0.66, -0.12], [0.065, 0.52, -0.16], [0.065, 0.4, -0.15]], "radius": 0.022, "radialSegments": 10}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_spar_l_2.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_frame_spar_l_2);
  nodes["frame-spar-l"] = node_frame_spar_l_2;
  const mesh_frame_spar_l_2Geometry = endpoint_frame_spar_l_2
    ? new THREE.CylinderGeometry(endpoint_frame_spar_l_2.endRadius, endpoint_frame_spar_l_2.baseRadius, endpoint_frame_spar_l_2.length, 16, 6)
    : buildTubeGeometry({"points": [[0.0, 0.9117872032176058, 0.32858366060217514], [0.065, 0.84, 0.18], [0.065, 0.76, 0.0], [0.065, 0.66, -0.12], [0.065, 0.52, -0.16], [0.065, 0.4, -0.15]], "radius": 0.022, "radialSegments": 10});
  if (!endpoint_frame_spar_l_2) {
    mesh_frame_spar_l_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_spar_l_2 = new THREE.Mesh(
    mesh_frame_spar_l_2Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_spar_l_2.name = "Frame main spar L";
  if (endpoint_frame_spar_l_2) {
    mesh_frame_spar_l_2.position.copy(endpoint_frame_spar_l_2.midpoint);
    mesh_frame_spar_l_2.quaternion.copy(endpoint_frame_spar_l_2.quaternion);
  }
  mesh_frame_spar_l_2.castShadow = options.castShadow ?? true;
  mesh_frame_spar_l_2.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_spar_l_2.userData.sculptComponent = {"id": "frame-spar-l", "name": "Frame main spar L", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Bent round-section steel spar following a measured polyline; swept tube, not a box.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.0, 0.9117872032176058, 0.32858366060217514], [0.065, 0.84, 0.18], [0.065, 0.76, 0.0], [0.065, 0.66, -0.12], [0.065, 0.52, -0.16], [0.065, 0.4, -0.15]], "radius": 0.022, "radialSegments": 10}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_spar_l_2.add(mesh_frame_spar_l_2);
  meshes["frame-spar-l"] = mesh_frame_spar_l_2;
  colliders["frame-spar-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_frame_spar_l_2);

  const attachment_frame_subframe_l_3 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_frame_subframe_l_3 = makeAttachmentEndpoint(attachment_frame_subframe_l_3);
  const node_frame_subframe_l_3 = new THREE.Group();
  node_frame_subframe_l_3.name = "Rear subframe rail L__pivot";
  node_frame_subframe_l_3.scale.set(1, 1, 1);
  if (endpoint_frame_subframe_l_3) {
    node_frame_subframe_l_3.position.copy(endpoint_frame_subframe_l_3.start);
    node_frame_subframe_l_3.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_frame_subframe_l_3.position.set(0.0, 0.0, 0.0);
    node_frame_subframe_l_3.rotation.set(-0.0, 0.0, -0.0);
  }
  node_frame_subframe_l_3.userData.sculptComponent = {"id": "frame-subframe-l", "name": "Rear subframe rail L", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Thin bent subframe tube under the seat; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.065, 0.68, -0.12], [0.07475, 0.76, -0.4], [0.08125, 0.82, -0.66]], "radius": 0.012, "radialSegments": 8}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_subframe_l_3.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_frame_subframe_l_3);
  nodes["frame-subframe-l"] = node_frame_subframe_l_3;
  const mesh_frame_subframe_l_3Geometry = endpoint_frame_subframe_l_3
    ? new THREE.CylinderGeometry(endpoint_frame_subframe_l_3.endRadius, endpoint_frame_subframe_l_3.baseRadius, endpoint_frame_subframe_l_3.length, 16, 6)
    : buildTubeGeometry({"points": [[0.065, 0.68, -0.12], [0.07475, 0.76, -0.4], [0.08125, 0.82, -0.66]], "radius": 0.012, "radialSegments": 8});
  if (!endpoint_frame_subframe_l_3) {
    mesh_frame_subframe_l_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_subframe_l_3 = new THREE.Mesh(
    mesh_frame_subframe_l_3Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_subframe_l_3.name = "Rear subframe rail L";
  if (endpoint_frame_subframe_l_3) {
    mesh_frame_subframe_l_3.position.copy(endpoint_frame_subframe_l_3.midpoint);
    mesh_frame_subframe_l_3.quaternion.copy(endpoint_frame_subframe_l_3.quaternion);
  }
  mesh_frame_subframe_l_3.castShadow = options.castShadow ?? true;
  mesh_frame_subframe_l_3.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_subframe_l_3.userData.sculptComponent = {"id": "frame-subframe-l", "name": "Rear subframe rail L", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Thin bent subframe tube under the seat; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.065, 0.68, -0.12], [0.07475, 0.76, -0.4], [0.08125, 0.82, -0.66]], "radius": 0.012, "radialSegments": 8}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_subframe_l_3.add(mesh_frame_subframe_l_3);
  meshes["frame-subframe-l"] = mesh_frame_subframe_l_3;
  colliders["frame-subframe-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_frame_subframe_l_3);

  const attachment_frame_strut_l_4 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_frame_strut_l_4 = makeAttachmentEndpoint(attachment_frame_strut_l_4);
  const node_frame_strut_l_4 = new THREE.Group();
  node_frame_strut_l_4.name = "Subframe strut L__pivot";
  node_frame_strut_l_4.scale.set(1, 1, 1);
  if (endpoint_frame_strut_l_4) {
    node_frame_strut_l_4.position.copy(endpoint_frame_strut_l_4.start);
    node_frame_strut_l_4.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_frame_strut_l_4.position.set(0.0, 0.0, 0.0);
    node_frame_strut_l_4.rotation.set(-0.0, 0.0, -0.0);
  }
  node_frame_strut_l_4.userData.sculptComponent = {"id": "frame-strut-l", "name": "Subframe strut L", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Diagonal support tube; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.065, 0.46, -0.16], [0.07475, 0.62, -0.4], [0.08125, 0.8, -0.62]], "radius": 0.01, "radialSegments": 8}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_strut_l_4.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_frame_strut_l_4);
  nodes["frame-strut-l"] = node_frame_strut_l_4;
  const mesh_frame_strut_l_4Geometry = endpoint_frame_strut_l_4
    ? new THREE.CylinderGeometry(endpoint_frame_strut_l_4.endRadius, endpoint_frame_strut_l_4.baseRadius, endpoint_frame_strut_l_4.length, 16, 6)
    : buildTubeGeometry({"points": [[0.065, 0.46, -0.16], [0.07475, 0.62, -0.4], [0.08125, 0.8, -0.62]], "radius": 0.01, "radialSegments": 8});
  if (!endpoint_frame_strut_l_4) {
    mesh_frame_strut_l_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_strut_l_4 = new THREE.Mesh(
    mesh_frame_strut_l_4Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_strut_l_4.name = "Subframe strut L";
  if (endpoint_frame_strut_l_4) {
    mesh_frame_strut_l_4.position.copy(endpoint_frame_strut_l_4.midpoint);
    mesh_frame_strut_l_4.quaternion.copy(endpoint_frame_strut_l_4.quaternion);
  }
  mesh_frame_strut_l_4.castShadow = options.castShadow ?? true;
  mesh_frame_strut_l_4.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_strut_l_4.userData.sculptComponent = {"id": "frame-strut-l", "name": "Subframe strut L", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Diagonal support tube; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.065, 0.46, -0.16], [0.07475, 0.62, -0.4], [0.08125, 0.8, -0.62]], "radius": 0.01, "radialSegments": 8}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_strut_l_4.add(mesh_frame_strut_l_4);
  meshes["frame-strut-l"] = mesh_frame_strut_l_4;
  colliders["frame-strut-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_frame_strut_l_4);

  const attachment_frame_spar_r_5 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_frame_spar_r_5 = makeAttachmentEndpoint(attachment_frame_spar_r_5);
  const node_frame_spar_r_5 = new THREE.Group();
  node_frame_spar_r_5.name = "Frame main spar R__pivot";
  node_frame_spar_r_5.scale.set(1, 1, 1);
  if (endpoint_frame_spar_r_5) {
    node_frame_spar_r_5.position.copy(endpoint_frame_spar_r_5.start);
    node_frame_spar_r_5.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_frame_spar_r_5.position.set(0.0, 0.0, 0.0);
    node_frame_spar_r_5.rotation.set(-0.0, 0.0, -0.0);
  }
  node_frame_spar_r_5.userData.sculptComponent = {"id": "frame-spar-r", "name": "Frame main spar R", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Bent round-section steel spar following a measured polyline; swept tube, not a box.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.0, 0.9117872032176058, 0.32858366060217514], [-0.065, 0.84, 0.18], [-0.065, 0.76, 0.0], [-0.065, 0.66, -0.12], [-0.065, 0.52, -0.16], [-0.065, 0.4, -0.15]], "radius": 0.022, "radialSegments": 10}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_spar_r_5.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_frame_spar_r_5);
  nodes["frame-spar-r"] = node_frame_spar_r_5;
  const mesh_frame_spar_r_5Geometry = endpoint_frame_spar_r_5
    ? new THREE.CylinderGeometry(endpoint_frame_spar_r_5.endRadius, endpoint_frame_spar_r_5.baseRadius, endpoint_frame_spar_r_5.length, 16, 6)
    : buildTubeGeometry({"points": [[0.0, 0.9117872032176058, 0.32858366060217514], [-0.065, 0.84, 0.18], [-0.065, 0.76, 0.0], [-0.065, 0.66, -0.12], [-0.065, 0.52, -0.16], [-0.065, 0.4, -0.15]], "radius": 0.022, "radialSegments": 10});
  if (!endpoint_frame_spar_r_5) {
    mesh_frame_spar_r_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_spar_r_5 = new THREE.Mesh(
    mesh_frame_spar_r_5Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_spar_r_5.name = "Frame main spar R";
  if (endpoint_frame_spar_r_5) {
    mesh_frame_spar_r_5.position.copy(endpoint_frame_spar_r_5.midpoint);
    mesh_frame_spar_r_5.quaternion.copy(endpoint_frame_spar_r_5.quaternion);
  }
  mesh_frame_spar_r_5.castShadow = options.castShadow ?? true;
  mesh_frame_spar_r_5.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_spar_r_5.userData.sculptComponent = {"id": "frame-spar-r", "name": "Frame main spar R", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Bent round-section steel spar following a measured polyline; swept tube, not a box.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.0, 0.9117872032176058, 0.32858366060217514], [-0.065, 0.84, 0.18], [-0.065, 0.76, 0.0], [-0.065, 0.66, -0.12], [-0.065, 0.52, -0.16], [-0.065, 0.4, -0.15]], "radius": 0.022, "radialSegments": 10}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_spar_r_5.add(mesh_frame_spar_r_5);
  meshes["frame-spar-r"] = mesh_frame_spar_r_5;
  colliders["frame-spar-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_frame_spar_r_5);

  const attachment_frame_subframe_r_6 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_frame_subframe_r_6 = makeAttachmentEndpoint(attachment_frame_subframe_r_6);
  const node_frame_subframe_r_6 = new THREE.Group();
  node_frame_subframe_r_6.name = "Rear subframe rail R__pivot";
  node_frame_subframe_r_6.scale.set(1, 1, 1);
  if (endpoint_frame_subframe_r_6) {
    node_frame_subframe_r_6.position.copy(endpoint_frame_subframe_r_6.start);
    node_frame_subframe_r_6.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_frame_subframe_r_6.position.set(0.0, 0.0, 0.0);
    node_frame_subframe_r_6.rotation.set(-0.0, 0.0, -0.0);
  }
  node_frame_subframe_r_6.userData.sculptComponent = {"id": "frame-subframe-r", "name": "Rear subframe rail R", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Thin bent subframe tube under the seat; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[-0.065, 0.68, -0.12], [-0.07475, 0.76, -0.4], [-0.08125, 0.82, -0.66]], "radius": 0.012, "radialSegments": 8}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_subframe_r_6.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_frame_subframe_r_6);
  nodes["frame-subframe-r"] = node_frame_subframe_r_6;
  const mesh_frame_subframe_r_6Geometry = endpoint_frame_subframe_r_6
    ? new THREE.CylinderGeometry(endpoint_frame_subframe_r_6.endRadius, endpoint_frame_subframe_r_6.baseRadius, endpoint_frame_subframe_r_6.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.065, 0.68, -0.12], [-0.07475, 0.76, -0.4], [-0.08125, 0.82, -0.66]], "radius": 0.012, "radialSegments": 8});
  if (!endpoint_frame_subframe_r_6) {
    mesh_frame_subframe_r_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_subframe_r_6 = new THREE.Mesh(
    mesh_frame_subframe_r_6Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_subframe_r_6.name = "Rear subframe rail R";
  if (endpoint_frame_subframe_r_6) {
    mesh_frame_subframe_r_6.position.copy(endpoint_frame_subframe_r_6.midpoint);
    mesh_frame_subframe_r_6.quaternion.copy(endpoint_frame_subframe_r_6.quaternion);
  }
  mesh_frame_subframe_r_6.castShadow = options.castShadow ?? true;
  mesh_frame_subframe_r_6.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_subframe_r_6.userData.sculptComponent = {"id": "frame-subframe-r", "name": "Rear subframe rail R", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Thin bent subframe tube under the seat; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[-0.065, 0.68, -0.12], [-0.07475, 0.76, -0.4], [-0.08125, 0.82, -0.66]], "radius": 0.012, "radialSegments": 8}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_subframe_r_6.add(mesh_frame_subframe_r_6);
  meshes["frame-subframe-r"] = mesh_frame_subframe_r_6;
  colliders["frame-subframe-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_frame_subframe_r_6);

  const attachment_frame_strut_r_7 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_frame_strut_r_7 = makeAttachmentEndpoint(attachment_frame_strut_r_7);
  const node_frame_strut_r_7 = new THREE.Group();
  node_frame_strut_r_7.name = "Subframe strut R__pivot";
  node_frame_strut_r_7.scale.set(1, 1, 1);
  if (endpoint_frame_strut_r_7) {
    node_frame_strut_r_7.position.copy(endpoint_frame_strut_r_7.start);
    node_frame_strut_r_7.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_frame_strut_r_7.position.set(0.0, 0.0, 0.0);
    node_frame_strut_r_7.rotation.set(-0.0, 0.0, -0.0);
  }
  node_frame_strut_r_7.userData.sculptComponent = {"id": "frame-strut-r", "name": "Subframe strut R", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Diagonal support tube; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[-0.065, 0.46, -0.16], [-0.07475, 0.62, -0.4], [-0.08125, 0.8, -0.62]], "radius": 0.01, "radialSegments": 8}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_strut_r_7.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_frame_strut_r_7);
  nodes["frame-strut-r"] = node_frame_strut_r_7;
  const mesh_frame_strut_r_7Geometry = endpoint_frame_strut_r_7
    ? new THREE.CylinderGeometry(endpoint_frame_strut_r_7.endRadius, endpoint_frame_strut_r_7.baseRadius, endpoint_frame_strut_r_7.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.065, 0.46, -0.16], [-0.07475, 0.62, -0.4], [-0.08125, 0.8, -0.62]], "radius": 0.01, "radialSegments": 8});
  if (!endpoint_frame_strut_r_7) {
    mesh_frame_strut_r_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_strut_r_7 = new THREE.Mesh(
    mesh_frame_strut_r_7Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_strut_r_7.name = "Subframe strut R";
  if (endpoint_frame_strut_r_7) {
    mesh_frame_strut_r_7.position.copy(endpoint_frame_strut_r_7.midpoint);
    mesh_frame_strut_r_7.quaternion.copy(endpoint_frame_strut_r_7.quaternion);
  }
  mesh_frame_strut_r_7.castShadow = options.castShadow ?? true;
  mesh_frame_strut_r_7.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_strut_r_7.userData.sculptComponent = {"id": "frame-strut-r", "name": "Subframe strut R", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Diagonal support tube; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[-0.065, 0.46, -0.16], [-0.07475, 0.62, -0.4], [-0.08125, 0.8, -0.62]], "radius": 0.01, "radialSegments": 8}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_strut_r_7.add(mesh_frame_strut_r_7);
  meshes["frame-strut-r"] = mesh_frame_strut_r_7;
  colliders["frame-strut-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_frame_strut_r_7);

  const attachment_frame_downtube_8 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_frame_downtube_8 = makeAttachmentEndpoint(attachment_frame_downtube_8);
  const node_frame_downtube_8 = new THREE.Group();
  node_frame_downtube_8.name = "Frame downtube and cradle__pivot";
  node_frame_downtube_8.scale.set(1, 1, 1);
  if (endpoint_frame_downtube_8) {
    node_frame_downtube_8.position.copy(endpoint_frame_downtube_8.start);
    node_frame_downtube_8.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_frame_downtube_8.position.set(0.0, 0.0, 0.0);
    node_frame_downtube_8.rotation.set(-0.0, 0.0, -0.0);
  }
  node_frame_downtube_8.userData.sculptComponent = {"id": "frame-downtube", "name": "Frame downtube and cradle", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Single cradle tube from head to under the engine and up to the pivot; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.0, 0.8417872032176057, 0.3685836606021752], [0.0, 0.64, 0.33], [0.0, 0.42, 0.3], [0.0, 0.26, 0.21], [0.0, 0.25, 0.0], [0.0, 0.28, -0.12], [0.0, 0.4, -0.15]], "radius": 0.022, "radialSegments": 10}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_downtube_8.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_frame_downtube_8);
  nodes["frame-downtube"] = node_frame_downtube_8;
  const mesh_frame_downtube_8Geometry = endpoint_frame_downtube_8
    ? new THREE.CylinderGeometry(endpoint_frame_downtube_8.endRadius, endpoint_frame_downtube_8.baseRadius, endpoint_frame_downtube_8.length, 16, 6)
    : buildTubeGeometry({"points": [[0.0, 0.8417872032176057, 0.3685836606021752], [0.0, 0.64, 0.33], [0.0, 0.42, 0.3], [0.0, 0.26, 0.21], [0.0, 0.25, 0.0], [0.0, 0.28, -0.12], [0.0, 0.4, -0.15]], "radius": 0.022, "radialSegments": 10});
  if (!endpoint_frame_downtube_8) {
    mesh_frame_downtube_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_frame_downtube_8 = new THREE.Mesh(
    mesh_frame_downtube_8Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_downtube_8.name = "Frame downtube and cradle";
  if (endpoint_frame_downtube_8) {
    mesh_frame_downtube_8.position.copy(endpoint_frame_downtube_8.midpoint);
    mesh_frame_downtube_8.quaternion.copy(endpoint_frame_downtube_8.quaternion);
  }
  mesh_frame_downtube_8.castShadow = options.castShadow ?? true;
  mesh_frame_downtube_8.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_downtube_8.userData.sculptComponent = {"id": "frame-downtube", "name": "Frame downtube and cradle", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Single cradle tube from head to under the engine and up to the pivot; swept tube.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.0, 0.8417872032176057, 0.3685836606021752], [0.0, 0.64, 0.33], [0.0, 0.42, 0.3], [0.0, 0.26, 0.21], [0.0, 0.25, 0.0], [0.0, 0.28, -0.12], [0.0, 0.4, -0.15]], "radius": 0.022, "radialSegments": 10}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_frame_downtube_8.add(mesh_frame_downtube_8);
  meshes["frame-downtube"] = mesh_frame_downtube_8;
  colliders["frame-downtube"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_frame_downtube_8);

  const endpoint_engine_cases_9 = makeAttachmentEndpoint(null);
  const node_engine_cases_9 = new THREE.Group();
  node_engine_cases_9.name = "Engine crankcase__pivot";
  node_engine_cases_9.scale.set(1, 1, 1);
  if (endpoint_engine_cases_9) {
    node_engine_cases_9.position.copy(endpoint_engine_cases_9.start);
    node_engine_cases_9.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_engine_cases_9.position.set(0.0, 0.4, 0.06);
    node_engine_cases_9.rotation.set(-0.0, 0.0, -0.0);
  }
  node_engine_cases_9.userData.sculptComponent = {"id": "engine-cases", "name": "Engine crankcase", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cast crankcase block; mostly occluded so a bevel-ready box stands in.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.02, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.22, "height": 0.24, "depth": 0.3, "units": "m", "confidence": 0.6}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.4, 0.06], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.4, 0.06], "localEnd": [0.0, 0.4, 0.06], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_engine_cases_9.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_engine_cases_9);
  nodes["engine-cases"] = node_engine_cases_9;
  const mesh_engine_cases_9Geometry = endpoint_engine_cases_9
    ? new THREE.CylinderGeometry(endpoint_engine_cases_9.endRadius, endpoint_engine_cases_9.baseRadius, endpoint_engine_cases_9.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_engine_cases_9) {
    mesh_engine_cases_9Geometry.scale(0.22, 0.24, 0.3);
  }
  const mesh_engine_cases_9 = new THREE.Mesh(
    mesh_engine_cases_9Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_engine_cases_9.name = "Engine crankcase";
  if (endpoint_engine_cases_9) {
    mesh_engine_cases_9.position.copy(endpoint_engine_cases_9.midpoint);
    mesh_engine_cases_9.quaternion.copy(endpoint_engine_cases_9.quaternion);
  }
  mesh_engine_cases_9.castShadow = options.castShadow ?? true;
  mesh_engine_cases_9.receiveShadow = options.receiveShadow ?? true;
  mesh_engine_cases_9.userData.sculptComponent = {"id": "engine-cases", "name": "Engine crankcase", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.55, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cast crankcase block; mostly occluded so a bevel-ready box stands in.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.02, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.22, "height": 0.24, "depth": 0.3, "units": "m", "confidence": 0.6}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.4, 0.06], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.4, 0.06], "localEnd": [0.0, 0.4, 0.06], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_engine_cases_9.add(mesh_engine_cases_9);
  meshes["engine-cases"] = mesh_engine_cases_9;
  colliders["engine-cases"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_engine_cases_9);

  const attachment_engine_cylinder_10 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.5, 0.14], "localEnd": [0.0, 0.66, 0.22], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.07, "endRadius": 0.065};
  const endpoint_engine_cylinder_10 = makeAttachmentEndpoint(attachment_engine_cylinder_10);
  const node_engine_cylinder_10 = new THREE.Group();
  node_engine_cylinder_10.name = "Engine cylinder barrel__pivot";
  node_engine_cylinder_10.scale.set(1, 1, 1);
  if (endpoint_engine_cylinder_10) {
    node_engine_cylinder_10.position.copy(endpoint_engine_cylinder_10.start);
    node_engine_cylinder_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_engine_cylinder_10.position.set(0.0, 0.0, 0.0);
    node_engine_cylinder_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_engine_cylinder_10.userData.sculptComponent = {"id": "engine-cylinder", "name": "Engine cylinder barrel", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Forward-inclined round barrel; tapered cylinder between endpoints.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cylinder-fins", "kind": "ridge", "description": "Horizontal cooling-fin ridges on the barrel (approximated by head ring)."}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.5, 0.14], "localEnd": [0.0, 0.66, 0.22], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.07, "endRadius": 0.065}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_engine_cylinder_10.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_engine_cylinder_10);
  nodes["engine-cylinder"] = node_engine_cylinder_10;
  const mesh_engine_cylinder_10Geometry = endpoint_engine_cylinder_10
    ? new THREE.CylinderGeometry(endpoint_engine_cylinder_10.endRadius, endpoint_engine_cylinder_10.baseRadius, endpoint_engine_cylinder_10.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_engine_cylinder_10) {
    mesh_engine_cylinder_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_engine_cylinder_10 = new THREE.Mesh(
    mesh_engine_cylinder_10Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_engine_cylinder_10.name = "Engine cylinder barrel";
  if (endpoint_engine_cylinder_10) {
    mesh_engine_cylinder_10.position.copy(endpoint_engine_cylinder_10.midpoint);
    mesh_engine_cylinder_10.quaternion.copy(endpoint_engine_cylinder_10.quaternion);
  }
  mesh_engine_cylinder_10.castShadow = options.castShadow ?? true;
  mesh_engine_cylinder_10.receiveShadow = options.receiveShadow ?? true;
  mesh_engine_cylinder_10.userData.sculptComponent = {"id": "engine-cylinder", "name": "Engine cylinder barrel", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Forward-inclined round barrel; tapered cylinder between endpoints.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cylinder-fins", "kind": "ridge", "description": "Horizontal cooling-fin ridges on the barrel (approximated by head ring)."}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.5, 0.14], "localEnd": [0.0, 0.66, 0.22], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.07, "endRadius": 0.065}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_engine_cylinder_10.add(mesh_engine_cylinder_10);
  meshes["engine-cylinder"] = mesh_engine_cylinder_10;
  colliders["engine-cylinder"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_engine_cylinder_10);

  const attachment_engine_head_11 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.66, 0.22], "localEnd": [0.0, 0.7, 0.24], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.08, "endRadius": 0.075};
  const endpoint_engine_head_11 = makeAttachmentEndpoint(attachment_engine_head_11);
  const node_engine_head_11 = new THREE.Group();
  node_engine_head_11.name = "Cylinder head__pivot";
  node_engine_head_11.scale.set(1, 1, 1);
  if (endpoint_engine_head_11) {
    node_engine_head_11.position.copy(endpoint_engine_head_11.start);
    node_engine_head_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_engine_head_11.position.set(0.0, 0.0, 0.0);
    node_engine_head_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_engine_head_11.userData.sculptComponent = {"id": "engine-head", "name": "Cylinder head", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat cylinder-head disc capping the barrel.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.66, 0.22], "localEnd": [0.0, 0.7, 0.24], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.08, "endRadius": 0.075}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_engine_head_11.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_engine_head_11);
  nodes["engine-head"] = node_engine_head_11;
  const mesh_engine_head_11Geometry = endpoint_engine_head_11
    ? new THREE.CylinderGeometry(endpoint_engine_head_11.endRadius, endpoint_engine_head_11.baseRadius, endpoint_engine_head_11.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_engine_head_11) {
    mesh_engine_head_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_engine_head_11 = new THREE.Mesh(
    mesh_engine_head_11Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_engine_head_11.name = "Cylinder head";
  if (endpoint_engine_head_11) {
    mesh_engine_head_11.position.copy(endpoint_engine_head_11.midpoint);
    mesh_engine_head_11.quaternion.copy(endpoint_engine_head_11.quaternion);
  }
  mesh_engine_head_11.castShadow = options.castShadow ?? true;
  mesh_engine_head_11.receiveShadow = options.receiveShadow ?? true;
  mesh_engine_head_11.userData.sculptComponent = {"id": "engine-head", "name": "Cylinder head", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat cylinder-head disc capping the barrel.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.66, 0.22], "localEnd": [0.0, 0.7, 0.24], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.08, "endRadius": 0.075}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_engine_head_11.add(mesh_engine_head_11);
  meshes["engine-head"] = mesh_engine_head_11;
  colliders["engine-head"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_engine_head_11);

  const attachment_engine_clutch_cover_12 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.11, 0.4, 0.07], "localEnd": [-0.135, 0.4, 0.07], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.1, "endRadius": 0.092};
  const endpoint_engine_clutch_cover_12 = makeAttachmentEndpoint(attachment_engine_clutch_cover_12);
  const node_engine_clutch_cover_12 = new THREE.Group();
  node_engine_clutch_cover_12.name = "Left engine side cover__pivot";
  node_engine_clutch_cover_12.scale.set(1, 1, 1);
  if (endpoint_engine_clutch_cover_12) {
    node_engine_clutch_cover_12.position.copy(endpoint_engine_clutch_cover_12.start);
    node_engine_clutch_cover_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_engine_clutch_cover_12.position.set(0.0, 0.0, 0.0);
    node_engine_clutch_cover_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_engine_clutch_cover_12.userData.sculptComponent = {"id": "engine-clutch-cover", "name": "Left engine side cover", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round cast side cover on the visible left side.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.11, 0.4, 0.07], "localEnd": [-0.135, 0.4, 0.07], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.1, "endRadius": 0.092}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_engine_clutch_cover_12.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_engine_clutch_cover_12);
  nodes["engine-clutch-cover"] = node_engine_clutch_cover_12;
  const mesh_engine_clutch_cover_12Geometry = endpoint_engine_clutch_cover_12
    ? new THREE.CylinderGeometry(endpoint_engine_clutch_cover_12.endRadius, endpoint_engine_clutch_cover_12.baseRadius, endpoint_engine_clutch_cover_12.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_engine_clutch_cover_12) {
    mesh_engine_clutch_cover_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_engine_clutch_cover_12 = new THREE.Mesh(
    mesh_engine_clutch_cover_12Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_engine_clutch_cover_12.name = "Left engine side cover";
  if (endpoint_engine_clutch_cover_12) {
    mesh_engine_clutch_cover_12.position.copy(endpoint_engine_clutch_cover_12.midpoint);
    mesh_engine_clutch_cover_12.quaternion.copy(endpoint_engine_clutch_cover_12.quaternion);
  }
  mesh_engine_clutch_cover_12.castShadow = options.castShadow ?? true;
  mesh_engine_clutch_cover_12.receiveShadow = options.receiveShadow ?? true;
  mesh_engine_clutch_cover_12.userData.sculptComponent = {"id": "engine-clutch-cover", "name": "Left engine side cover", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round cast side cover on the visible left side.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.11, 0.4, 0.07], "localEnd": [-0.135, 0.4, 0.07], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.1, "endRadius": 0.092}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_engine_clutch_cover_12.add(mesh_engine_clutch_cover_12);
  meshes["engine-clutch-cover"] = mesh_engine_clutch_cover_12;
  colliders["engine-clutch-cover"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_engine_clutch_cover_12);

  const attachment_engine_badge_13 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.135, 0.38, 0.07], "localEnd": [-0.14, 0.38, 0.07], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.035, "endRadius": 0.035};
  const endpoint_engine_badge_13 = makeAttachmentEndpoint(attachment_engine_badge_13);
  const node_engine_badge_13 = new THREE.Group();
  node_engine_badge_13.name = "VENT oval badge on side cover__pivot";
  node_engine_badge_13.scale.set(1, 1, 1);
  if (endpoint_engine_badge_13) {
    node_engine_badge_13.position.copy(endpoint_engine_badge_13.start);
    node_engine_badge_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_engine_badge_13.position.set(0.0, 0.0, 0.0);
    node_engine_badge_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_engine_badge_13.userData.sculptComponent = {"id": "engine-badge", "name": "VENT oval badge on side cover", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Thin raised badge disc.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "engine-vent-badge", "kind": "decal", "description": "Silver/white oval 'VENT' badge on the side cover."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.135, 0.38, 0.07], "localEnd": [-0.14, 0.38, 0.07], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.035, "endRadius": 0.035}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_engine_badge_13.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_engine_badge_13);
  nodes["engine-badge"] = node_engine_badge_13;
  const mesh_engine_badge_13Geometry = endpoint_engine_badge_13
    ? new THREE.CylinderGeometry(endpoint_engine_badge_13.endRadius, endpoint_engine_badge_13.baseRadius, endpoint_engine_badge_13.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_engine_badge_13) {
    mesh_engine_badge_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_engine_badge_13 = new THREE.Mesh(
    mesh_engine_badge_13Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_engine_badge_13.name = "VENT oval badge on side cover";
  if (endpoint_engine_badge_13) {
    mesh_engine_badge_13.position.copy(endpoint_engine_badge_13.midpoint);
    mesh_engine_badge_13.quaternion.copy(endpoint_engine_badge_13.quaternion);
  }
  mesh_engine_badge_13.castShadow = options.castShadow ?? true;
  mesh_engine_badge_13.receiveShadow = options.receiveShadow ?? true;
  mesh_engine_badge_13.userData.sculptComponent = {"id": "engine-badge", "name": "VENT oval badge on side cover", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Thin raised badge disc.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "engine-vent-badge", "kind": "decal", "description": "Silver/white oval 'VENT' badge on the side cover."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.135, 0.38, 0.07], "localEnd": [-0.14, 0.38, 0.07], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.035, "endRadius": 0.035}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_engine_badge_13.add(mesh_engine_badge_13);
  meshes["engine-badge"] = mesh_engine_badge_13;
  colliders["engine-badge"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_engine_badge_13);

  const endpoint_radiator_14 = makeAttachmentEndpoint(null);
  const node_radiator_14 = new THREE.Group();
  node_radiator_14.name = "Radiator core__pivot";
  node_radiator_14.scale.set(1, 1, 1);
  if (endpoint_radiator_14) {
    node_radiator_14.position.copy(endpoint_radiator_14.start);
    node_radiator_14.rotation.set(-0.1885, 0.0, -0.0);
  } else {
    node_radiator_14.position.set(-0.09, 0.7, 0.28);
    node_radiator_14.rotation.set(-0.1885, 0.0, -0.0);
  }
  node_radiator_14.userData.sculptComponent = {"id": "radiator", "name": "Radiator core", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rectangular finned core; box with fin grooves as surface feature.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.05, "height": 0.26, "depth": 0.12, "units": "m", "confidence": 0.55}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "radiator-fins", "kind": "groove", "description": "Fine vertical fin grooves on the silver radiator core."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.09, 0.7, 0.28], "rotation": [-0.1885, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.09, 0.7, 0.28], "localEnd": [-0.09, 0.7, 0.28], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_radiator_14.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_radiator_14);
  nodes["radiator"] = node_radiator_14;
  const mesh_radiator_14Geometry = endpoint_radiator_14
    ? new THREE.CylinderGeometry(endpoint_radiator_14.endRadius, endpoint_radiator_14.baseRadius, endpoint_radiator_14.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_radiator_14) {
    mesh_radiator_14Geometry.scale(0.05, 0.26, 0.12);
  }
  const mesh_radiator_14 = new THREE.Mesh(
    mesh_radiator_14Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_radiator_14.name = "Radiator core";
  if (endpoint_radiator_14) {
    mesh_radiator_14.position.copy(endpoint_radiator_14.midpoint);
    mesh_radiator_14.quaternion.copy(endpoint_radiator_14.quaternion);
  }
  mesh_radiator_14.castShadow = options.castShadow ?? true;
  mesh_radiator_14.receiveShadow = options.receiveShadow ?? true;
  mesh_radiator_14.userData.sculptComponent = {"id": "radiator", "name": "Radiator core", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rectangular finned core; box with fin grooves as surface feature.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.05, "height": 0.26, "depth": 0.12, "units": "m", "confidence": 0.55}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "radiator-fins", "kind": "groove", "description": "Fine vertical fin grooves on the silver radiator core."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.09, 0.7, 0.28], "rotation": [-0.1885, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.09, 0.7, 0.28], "localEnd": [-0.09, 0.7, 0.28], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_radiator_14.add(mesh_radiator_14);
  meshes["radiator"] = mesh_radiator_14;
  colliders["radiator"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_radiator_14);

  const attachment_exhaust_chamber_15 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_exhaust_chamber_15 = makeAttachmentEndpoint(attachment_exhaust_chamber_15);
  const node_exhaust_chamber_15 = new THREE.Group();
  node_exhaust_chamber_15.name = "Two-stroke expansion chamber__pivot";
  node_exhaust_chamber_15.scale.set(1, 1, 1);
  if (endpoint_exhaust_chamber_15) {
    node_exhaust_chamber_15.position.copy(endpoint_exhaust_chamber_15.start);
    node_exhaust_chamber_15.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_exhaust_chamber_15.position.set(0.0, 0.0, 0.0);
    node_exhaust_chamber_15.rotation.set(-0.0, 0.0, -0.0);
  }
  node_exhaust_chamber_15.userData.sculptComponent = {"id": "exhaust-chamber", "name": "Two-stroke expansion chamber", "level": "macro", "role": "pipe", "importance": 0.8, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Continuous curved steel pipe of near-constant section; swept tube along measured spine.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[-0.03, 0.6, 0.27], [-0.1, 0.55, 0.37], [-0.16, 0.4, 0.37], [-0.17, 0.3, 0.25], [-0.17, 0.28, 0.06], [-0.16, 0.34, -0.1], [-0.15, 0.48, -0.22], [-0.14, 0.6, -0.31]], "radius": 0.045, "radialSegments": 14}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pipe-curl", "kind": "contour", "description": "Pipe curls out in front of the engine and runs back low along it."}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_exhaust_chamber_15.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_exhaust_chamber_15);
  nodes["exhaust-chamber"] = node_exhaust_chamber_15;
  const mesh_exhaust_chamber_15Geometry = endpoint_exhaust_chamber_15
    ? new THREE.CylinderGeometry(endpoint_exhaust_chamber_15.endRadius, endpoint_exhaust_chamber_15.baseRadius, endpoint_exhaust_chamber_15.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.03, 0.6, 0.27], [-0.1, 0.55, 0.37], [-0.16, 0.4, 0.37], [-0.17, 0.3, 0.25], [-0.17, 0.28, 0.06], [-0.16, 0.34, -0.1], [-0.15, 0.48, -0.22], [-0.14, 0.6, -0.31]], "radius": 0.045, "radialSegments": 14});
  if (!endpoint_exhaust_chamber_15) {
    mesh_exhaust_chamber_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_exhaust_chamber_15 = new THREE.Mesh(
    mesh_exhaust_chamber_15Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_exhaust_chamber_15.name = "Two-stroke expansion chamber";
  if (endpoint_exhaust_chamber_15) {
    mesh_exhaust_chamber_15.position.copy(endpoint_exhaust_chamber_15.midpoint);
    mesh_exhaust_chamber_15.quaternion.copy(endpoint_exhaust_chamber_15.quaternion);
  }
  mesh_exhaust_chamber_15.castShadow = options.castShadow ?? true;
  mesh_exhaust_chamber_15.receiveShadow = options.receiveShadow ?? true;
  mesh_exhaust_chamber_15.userData.sculptComponent = {"id": "exhaust-chamber", "name": "Two-stroke expansion chamber", "level": "macro", "role": "pipe", "importance": 0.8, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Continuous curved steel pipe of near-constant section; swept tube along measured spine.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[-0.03, 0.6, 0.27], [-0.1, 0.55, 0.37], [-0.16, 0.4, 0.37], [-0.17, 0.3, 0.25], [-0.17, 0.28, 0.06], [-0.16, 0.34, -0.1], [-0.15, 0.48, -0.22], [-0.14, 0.6, -0.31]], "radius": 0.045, "radialSegments": 14}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pipe-curl", "kind": "contour", "description": "Pipe curls out in front of the engine and runs back low along it."}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_exhaust_chamber_15.add(mesh_exhaust_chamber_15);
  meshes["exhaust-chamber"] = mesh_exhaust_chamber_15;
  colliders["exhaust-chamber"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_exhaust_chamber_15);

  const attachment_silencer_16 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.14, 0.61, -0.3], "localEnd": [-0.15, 0.76, -0.7], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.058, "endRadius": 0.058};
  const endpoint_silencer_16 = makeAttachmentEndpoint(attachment_silencer_16);
  const node_silencer_16 = new THREE.Group();
  node_silencer_16.name = "Silencer can__pivot";
  node_silencer_16.scale.set(1, 1, 1);
  if (endpoint_silencer_16) {
    node_silencer_16.position.copy(endpoint_silencer_16.start);
    node_silencer_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_silencer_16.position.set(0.0, 0.0, 0.0);
    node_silencer_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_silencer_16.userData.sculptComponent = {"id": "silencer", "name": "Silencer can", "level": "meso", "role": "pipe", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round muffler can; straight cylinder between measured endpoints.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "silencer-sticker", "kind": "decal", "description": "Red/yellow sticker with VENT logo on the white can."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.14, 0.61, -0.3], "localEnd": [-0.15, 0.76, -0.7], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.058, "endRadius": 0.058}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}, "materialRegions": [{"regionId": "white-gloss", "materialId": "white-plastic", "profileId": "plastic.glossy", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/01-white-gloss.png", "bbox": {"x": 525, "y": 356, "width": 24, "height": 12}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0003}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "white-plastic"}};
  node_silencer_16.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_silencer_16);
  nodes["silencer"] = node_silencer_16;
  const mesh_silencer_16Geometry = endpoint_silencer_16
    ? new THREE.CylinderGeometry(endpoint_silencer_16.endRadius, endpoint_silencer_16.baseRadius, endpoint_silencer_16.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_silencer_16) {
    mesh_silencer_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_silencer_16 = new THREE.Mesh(
    mesh_silencer_16Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_silencer_16.name = "Silencer can";
  if (endpoint_silencer_16) {
    mesh_silencer_16.position.copy(endpoint_silencer_16.midpoint);
    mesh_silencer_16.quaternion.copy(endpoint_silencer_16.quaternion);
  }
  mesh_silencer_16.castShadow = options.castShadow ?? true;
  mesh_silencer_16.receiveShadow = options.receiveShadow ?? true;
  mesh_silencer_16.userData.sculptComponent = {"id": "silencer", "name": "Silencer can", "level": "meso", "role": "pipe", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round muffler can; straight cylinder between measured endpoints.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "silencer-sticker", "kind": "decal", "description": "Red/yellow sticker with VENT logo on the white can."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.14, 0.61, -0.3], "localEnd": [-0.15, 0.76, -0.7], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.058, "endRadius": 0.058}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}, "materialRegions": [{"regionId": "white-gloss", "materialId": "white-plastic", "profileId": "plastic.glossy", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/01-white-gloss.png", "bbox": {"x": 525, "y": 356, "width": 24, "height": 12}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0003}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "white-plastic"}};
  node_silencer_16.add(mesh_silencer_16);
  meshes["silencer"] = mesh_silencer_16;
  colliders["silencer"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_silencer_16);

  const attachment_silencer_cap_17 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.15, 0.76, -0.7], "localEnd": [-0.153, 0.78, -0.76], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.058, "endRadius": 0.045};
  const endpoint_silencer_cap_17 = makeAttachmentEndpoint(attachment_silencer_cap_17);
  const node_silencer_cap_17 = new THREE.Group();
  node_silencer_cap_17.name = "Carbon silencer end cap__pivot";
  node_silencer_cap_17.scale.set(1, 1, 1);
  if (endpoint_silencer_cap_17) {
    node_silencer_cap_17.position.copy(endpoint_silencer_cap_17.start);
    node_silencer_cap_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_silencer_cap_17.position.set(0.0, 0.0, 0.0);
    node_silencer_cap_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_silencer_cap_17.userData.sculptComponent = {"id": "silencer-cap", "name": "Carbon silencer end cap", "level": "micro", "role": "pipe", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tapered carbon end cap.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "carbon-cap", "materialLayers": ["carbon-cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 35, 31, 1.0)", "secondaryAlbedo": "rgba(42, 38, 33, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for carbon-cap)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.15, 0.76, -0.7], "localEnd": [-0.153, 0.78, -0.76], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.058, "endRadius": 0.045}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "carbon-cap"}}, "materialRegions": [{"regionId": "carbon-cap", "materialId": "carbon-cap", "profileId": "plastic.glossy", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/10-carbon-cap.png", "bbox": {"x": 398, "y": 272, "width": 26, "height": 26}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0006}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "carbon-cap"}};
  node_silencer_cap_17.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "carbon-cap"}};
  (nodes["root"] ?? root).add(node_silencer_cap_17);
  nodes["silencer-cap"] = node_silencer_cap_17;
  const mesh_silencer_cap_17Geometry = endpoint_silencer_cap_17
    ? new THREE.CylinderGeometry(endpoint_silencer_cap_17.endRadius, endpoint_silencer_cap_17.baseRadius, endpoint_silencer_cap_17.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_silencer_cap_17) {
    mesh_silencer_cap_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_silencer_cap_17 = new THREE.Mesh(
    mesh_silencer_cap_17Geometry,
    materialMap["carbon-cap"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_silencer_cap_17.name = "Carbon silencer end cap";
  if (endpoint_silencer_cap_17) {
    mesh_silencer_cap_17.position.copy(endpoint_silencer_cap_17.midpoint);
    mesh_silencer_cap_17.quaternion.copy(endpoint_silencer_cap_17.quaternion);
  }
  mesh_silencer_cap_17.castShadow = options.castShadow ?? true;
  mesh_silencer_cap_17.receiveShadow = options.receiveShadow ?? true;
  mesh_silencer_cap_17.userData.sculptComponent = {"id": "silencer-cap", "name": "Carbon silencer end cap", "level": "micro", "role": "pipe", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Tapered carbon end cap.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "carbon-cap", "materialLayers": ["carbon-cap"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.4, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(38, 35, 31, 1.0)", "secondaryAlbedo": "rgba(42, 38, 33, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for carbon-cap)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.15, 0.76, -0.7], "localEnd": [-0.153, 0.78, -0.76], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.058, "endRadius": 0.045}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "carbon-cap"}}, "materialRegions": [{"regionId": "carbon-cap", "materialId": "carbon-cap", "profileId": "plastic.glossy", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/10-carbon-cap.png", "bbox": {"x": 398, "y": 272, "width": 26, "height": 26}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0006}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "carbon-cap"}};
  node_silencer_cap_17.add(mesh_silencer_cap_17);
  meshes["silencer-cap"] = mesh_silencer_cap_17;
  colliders["silencer-cap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_silencer_cap_17);

  const endpoint_silencer_sticker_patch_18 = makeAttachmentEndpoint(null);
  const node_silencer_sticker_patch_18 = new THREE.Group();
  node_silencer_sticker_patch_18.name = "Silencer sticker patch__pivot";
  node_silencer_sticker_patch_18.scale.set(1, 1, 1);
  if (endpoint_silencer_sticker_patch_18) {
    node_silencer_sticker_patch_18.position.copy(endpoint_silencer_sticker_patch_18.start);
    node_silencer_sticker_patch_18.rotation.set(-0.36, 0.0, -0.0);
  } else {
    node_silencer_sticker_patch_18.position.set(-0.2, 0.69, -0.52);
    node_silencer_sticker_patch_18.rotation.set(-0.36, 0.0, -0.0);
  }
  node_silencer_sticker_patch_18.userData.sculptComponent = {"id": "silencer-sticker-patch", "name": "Silencer sticker patch", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat applied sticker; thin plate proud of the can.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.004, "height": 0.06, "depth": 0.1, "units": "m", "confidence": 0.5}, "material": "reflector-red", "materialLayers": ["reflector-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.2, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 15, 26, 1.0)", "secondaryAlbedo": "rgba(87, 7, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for reflector-red)"}, "transform": {"position": [-0.2, 0.69, -0.52], "rotation": [-0.36, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.2, 0.69, -0.52], "localEnd": [-0.2, 0.69, -0.52], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}}};
  node_silencer_sticker_patch_18.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}};
  (nodes["root"] ?? root).add(node_silencer_sticker_patch_18);
  nodes["silencer-sticker-patch"] = node_silencer_sticker_patch_18;
  const mesh_silencer_sticker_patch_18Geometry = endpoint_silencer_sticker_patch_18
    ? new THREE.CylinderGeometry(endpoint_silencer_sticker_patch_18.endRadius, endpoint_silencer_sticker_patch_18.baseRadius, endpoint_silencer_sticker_patch_18.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_silencer_sticker_patch_18) {
    mesh_silencer_sticker_patch_18Geometry.scale(0.004, 0.06, 0.1);
  }
  const mesh_silencer_sticker_patch_18 = new THREE.Mesh(
    mesh_silencer_sticker_patch_18Geometry,
    materialMap["reflector-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_silencer_sticker_patch_18.name = "Silencer sticker patch";
  if (endpoint_silencer_sticker_patch_18) {
    mesh_silencer_sticker_patch_18.position.copy(endpoint_silencer_sticker_patch_18.midpoint);
    mesh_silencer_sticker_patch_18.quaternion.copy(endpoint_silencer_sticker_patch_18.quaternion);
  }
  mesh_silencer_sticker_patch_18.castShadow = options.castShadow ?? true;
  mesh_silencer_sticker_patch_18.receiveShadow = options.receiveShadow ?? true;
  mesh_silencer_sticker_patch_18.userData.sculptComponent = {"id": "silencer-sticker-patch", "name": "Silencer sticker patch", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat applied sticker; thin plate proud of the can.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.004, "height": 0.06, "depth": 0.1, "units": "m", "confidence": 0.5}, "material": "reflector-red", "materialLayers": ["reflector-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.2, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 15, 26, 1.0)", "secondaryAlbedo": "rgba(87, 7, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for reflector-red)"}, "transform": {"position": [-0.2, 0.69, -0.52], "rotation": [-0.36, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.2, 0.69, -0.52], "localEnd": [-0.2, 0.69, -0.52], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}}};
  node_silencer_sticker_patch_18.add(mesh_silencer_sticker_patch_18);
  meshes["silencer-sticker-patch"] = mesh_silencer_sticker_patch_18;
  colliders["silencer-sticker-patch"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_silencer_sticker_patch_18);

  const endpoint_swingarm_l_19 = makeAttachmentEndpoint(null);
  const node_swingarm_l_19 = new THREE.Group();
  node_swingarm_l_19.name = "Swingarm arm L__pivot";
  node_swingarm_l_19.scale.set(1, 1, 1);
  if (endpoint_swingarm_l_19) {
    node_swingarm_l_19.position.copy(endpoint_swingarm_l_19.start);
    node_swingarm_l_19.rotation.set(2.8256, 0.0, -0.0);
  } else {
    node_swingarm_l_19.position.set(0.075, 0.315, -0.4);
    node_swingarm_l_19.rotation.set(2.8256, 0.0, -0.0);
  }
  node_swingarm_l_19.userData.sculptComponent = {"id": "swingarm-l", "name": "Swingarm arm L", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rectangular-section steel arm; box oriented along pivot->axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.5470831746635972, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.075, 0.315, -0.4], "rotation": [2.8256, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.075, 0.315, -0.4], "localEnd": [0.075, 0.315, -0.4], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "suspension", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}, "materialRegions": [{"regionId": "black-paint", "materialId": "black-frame", "profileId": "coating.painted-metal", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/06-black-paint.png", "bbox": {"x": 470, "y": 510, "width": 60, "height": 16}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0009}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "black-frame"}};
  node_swingarm_l_19.userData.actionProfile = {"animationRole": "suspension", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_swingarm_l_19);
  nodes["swingarm-l"] = node_swingarm_l_19;
  const mesh_swingarm_l_19Geometry = endpoint_swingarm_l_19
    ? new THREE.CylinderGeometry(endpoint_swingarm_l_19.endRadius, endpoint_swingarm_l_19.baseRadius, endpoint_swingarm_l_19.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_swingarm_l_19) {
    mesh_swingarm_l_19Geometry.scale(0.035, 0.065, 0.5470831746635972);
  }
  const mesh_swingarm_l_19 = new THREE.Mesh(
    mesh_swingarm_l_19Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_swingarm_l_19.name = "Swingarm arm L";
  if (endpoint_swingarm_l_19) {
    mesh_swingarm_l_19.position.copy(endpoint_swingarm_l_19.midpoint);
    mesh_swingarm_l_19.quaternion.copy(endpoint_swingarm_l_19.quaternion);
  }
  mesh_swingarm_l_19.castShadow = options.castShadow ?? true;
  mesh_swingarm_l_19.receiveShadow = options.receiveShadow ?? true;
  mesh_swingarm_l_19.userData.sculptComponent = {"id": "swingarm-l", "name": "Swingarm arm L", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rectangular-section steel arm; box oriented along pivot->axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.5470831746635972, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.075, 0.315, -0.4], "rotation": [2.8256, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.075, 0.315, -0.4], "localEnd": [0.075, 0.315, -0.4], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "suspension", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}, "materialRegions": [{"regionId": "black-paint", "materialId": "black-frame", "profileId": "coating.painted-metal", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/06-black-paint.png", "bbox": {"x": 470, "y": 510, "width": 60, "height": 16}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0009}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "black-frame"}};
  node_swingarm_l_19.add(mesh_swingarm_l_19);
  meshes["swingarm-l"] = mesh_swingarm_l_19;
  colliders["swingarm-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_swingarm_l_19);

  const endpoint_swingarm_r_20 = makeAttachmentEndpoint(null);
  const node_swingarm_r_20 = new THREE.Group();
  node_swingarm_r_20.name = "Swingarm arm R__pivot";
  node_swingarm_r_20.scale.set(1, 1, 1);
  if (endpoint_swingarm_r_20) {
    node_swingarm_r_20.position.copy(endpoint_swingarm_r_20.start);
    node_swingarm_r_20.rotation.set(2.8256, 0.0, -0.0);
  } else {
    node_swingarm_r_20.position.set(-0.075, 0.315, -0.4);
    node_swingarm_r_20.rotation.set(2.8256, 0.0, -0.0);
  }
  node_swingarm_r_20.userData.sculptComponent = {"id": "swingarm-r", "name": "Swingarm arm R", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rectangular-section steel arm; box oriented along pivot->axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.5470831746635972, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [-0.075, 0.315, -0.4], "rotation": [2.8256, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.075, 0.315, -0.4], "localEnd": [-0.075, 0.315, -0.4], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "suspension", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_swingarm_r_20.userData.actionProfile = {"animationRole": "suspension", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_swingarm_r_20);
  nodes["swingarm-r"] = node_swingarm_r_20;
  const mesh_swingarm_r_20Geometry = endpoint_swingarm_r_20
    ? new THREE.CylinderGeometry(endpoint_swingarm_r_20.endRadius, endpoint_swingarm_r_20.baseRadius, endpoint_swingarm_r_20.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_swingarm_r_20) {
    mesh_swingarm_r_20Geometry.scale(0.035, 0.065, 0.5470831746635972);
  }
  const mesh_swingarm_r_20 = new THREE.Mesh(
    mesh_swingarm_r_20Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_swingarm_r_20.name = "Swingarm arm R";
  if (endpoint_swingarm_r_20) {
    mesh_swingarm_r_20.position.copy(endpoint_swingarm_r_20.midpoint);
    mesh_swingarm_r_20.quaternion.copy(endpoint_swingarm_r_20.quaternion);
  }
  mesh_swingarm_r_20.castShadow = options.castShadow ?? true;
  mesh_swingarm_r_20.receiveShadow = options.receiveShadow ?? true;
  mesh_swingarm_r_20.userData.sculptComponent = {"id": "swingarm-r", "name": "Swingarm arm R", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Rectangular-section steel arm; box oriented along pivot->axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.065, "depth": 0.5470831746635972, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [-0.075, 0.315, -0.4], "rotation": [2.8256, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.075, 0.315, -0.4], "localEnd": [-0.075, 0.315, -0.4], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "suspension", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_swingarm_r_20.add(mesh_swingarm_r_20);
  meshes["swingarm-r"] = mesh_swingarm_r_20;
  colliders["swingarm-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_swingarm_r_20);

  const endpoint_swingarm_brace_21 = makeAttachmentEndpoint(null);
  const node_swingarm_brace_21 = new THREE.Group();
  node_swingarm_brace_21.name = "Swingarm cross brace__pivot";
  node_swingarm_brace_21.scale.set(1, 1, 1);
  if (endpoint_swingarm_brace_21) {
    node_swingarm_brace_21.position.copy(endpoint_swingarm_brace_21.start);
    node_swingarm_brace_21.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_swingarm_brace_21.position.set(0.0, 0.39, -0.24);
    node_swingarm_brace_21.rotation.set(-0.0, 0.0, -0.0);
  }
  node_swingarm_brace_21.userData.sculptComponent = {"id": "swingarm-brace", "name": "Swingarm cross brace", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Box brace joining the arms ahead of the tyre.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.15, "height": 0.04, "depth": 0.05, "units": "m", "confidence": 0.5}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.39, -0.24], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.39, -0.24], "localEnd": [0.0, 0.39, -0.24], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_swingarm_brace_21.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_swingarm_brace_21);
  nodes["swingarm-brace"] = node_swingarm_brace_21;
  const mesh_swingarm_brace_21Geometry = endpoint_swingarm_brace_21
    ? new THREE.CylinderGeometry(endpoint_swingarm_brace_21.endRadius, endpoint_swingarm_brace_21.baseRadius, endpoint_swingarm_brace_21.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_swingarm_brace_21) {
    mesh_swingarm_brace_21Geometry.scale(0.15, 0.04, 0.05);
  }
  const mesh_swingarm_brace_21 = new THREE.Mesh(
    mesh_swingarm_brace_21Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_swingarm_brace_21.name = "Swingarm cross brace";
  if (endpoint_swingarm_brace_21) {
    mesh_swingarm_brace_21.position.copy(endpoint_swingarm_brace_21.midpoint);
    mesh_swingarm_brace_21.quaternion.copy(endpoint_swingarm_brace_21.quaternion);
  }
  mesh_swingarm_brace_21.castShadow = options.castShadow ?? true;
  mesh_swingarm_brace_21.receiveShadow = options.receiveShadow ?? true;
  mesh_swingarm_brace_21.userData.sculptComponent = {"id": "swingarm-brace", "name": "Swingarm cross brace", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Box brace joining the arms ahead of the tyre.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.15, "height": 0.04, "depth": 0.05, "units": "m", "confidence": 0.5}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.39, -0.24], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.39, -0.24], "localEnd": [0.0, 0.39, -0.24], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_swingarm_brace_21.add(mesh_swingarm_brace_21);
  meshes["swingarm-brace"] = mesh_swingarm_brace_21;
  colliders["swingarm-brace"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_swingarm_brace_21);

  const attachment_shock_body_22 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.37, -0.25], "localEnd": [0.0, 0.74, -0.1], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.02, "endRadius": 0.024};
  const endpoint_shock_body_22 = makeAttachmentEndpoint(attachment_shock_body_22);
  const node_shock_body_22 = new THREE.Group();
  node_shock_body_22.name = "Rear shock body__pivot";
  node_shock_body_22.scale.set(1, 1, 1);
  if (endpoint_shock_body_22) {
    node_shock_body_22.position.copy(endpoint_shock_body_22.start);
    node_shock_body_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shock_body_22.position.set(0.0, 0.0, 0.0);
    node_shock_body_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_shock_body_22.userData.sculptComponent = {"id": "shock-body", "name": "Rear shock body", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight damper body between swingarm and frame mounts.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.37, -0.25], "localEnd": [0.0, 0.74, -0.1], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.02, "endRadius": 0.024}, "actionProfile": {"animationRole": "suspension", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_shock_body_22.userData.actionProfile = {"animationRole": "suspension", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_shock_body_22);
  nodes["shock-body"] = node_shock_body_22;
  const mesh_shock_body_22Geometry = endpoint_shock_body_22
    ? new THREE.CylinderGeometry(endpoint_shock_body_22.endRadius, endpoint_shock_body_22.baseRadius, endpoint_shock_body_22.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_shock_body_22) {
    mesh_shock_body_22Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shock_body_22 = new THREE.Mesh(
    mesh_shock_body_22Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shock_body_22.name = "Rear shock body";
  if (endpoint_shock_body_22) {
    mesh_shock_body_22.position.copy(endpoint_shock_body_22.midpoint);
    mesh_shock_body_22.quaternion.copy(endpoint_shock_body_22.quaternion);
  }
  mesh_shock_body_22.castShadow = options.castShadow ?? true;
  mesh_shock_body_22.receiveShadow = options.receiveShadow ?? true;
  mesh_shock_body_22.userData.sculptComponent = {"id": "shock-body", "name": "Rear shock body", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight damper body between swingarm and frame mounts.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.37, -0.25], "localEnd": [0.0, 0.74, -0.1], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.02, "endRadius": 0.024}, "actionProfile": {"animationRole": "suspension", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_shock_body_22.add(mesh_shock_body_22);
  meshes["shock-body"] = mesh_shock_body_22;
  colliders["shock-body"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_shock_body_22);

  const attachment_shock_spring_23 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_shock_spring_23 = makeAttachmentEndpoint(attachment_shock_spring_23);
  const node_shock_spring_23 = new THREE.Group();
  node_shock_spring_23.name = "Yellow shock spring__pivot";
  node_shock_spring_23.scale.set(1, 1, 1);
  if (endpoint_shock_spring_23) {
    node_shock_spring_23.position.copy(endpoint_shock_spring_23.start);
    node_shock_spring_23.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_shock_spring_23.position.set(0.0, 0.0, 0.0);
    node_shock_spring_23.rotation.set(-0.0, 0.0, -0.0);
  }
  node_shock_spring_23.userData.sculptComponent = {"id": "shock-spring", "name": "Yellow shock spring", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "fiber-strand", "topologyRationale": "A helical wire: a thin swept strand, not a solid volume.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.036, 0.4256, -0.2275], [0.0291, 0.4367, -0.2458], [0.0111, 0.4448, -0.2566], [-0.0111, 0.4479, -0.2554], [-0.0291, 0.4461, -0.242], [-0.036, 0.4413, -0.2211], [-0.0291, 0.4365, -0.2002], [-0.0111, 0.4348, -0.1868], [0.0111, 0.4379, -0.1855], [0.0291, 0.446, -0.1964], [0.036, 0.4571, -0.2147], [0.0291, 0.4681, -0.233], [0.0111, 0.4762, -0.2439], [-0.0111, 0.4794, -0.2426], [-0.0291, 0.4776, -0.2292], [-0.036, 0.4728, -0.2083], [-0.0291, 0.468, -0.1874], [-0.0111, 0.4662, -0.1741], [0.0111, 0.4694, -0.1728], [0.0291, 0.4774, -0.1836], [0.036, 0.4885, -0.202], [0.0291, 0.4996, -0.2203], [0.0111, 0.5077, -0.2311], [-0.0111, 0.5108, -0.2299], [-0.0291, 0.509, -0.2165], [-0.036, 0.5042, -0.1956], [-0.0291, 0.4994, -0.1747], [-0.0111, 0.4977, -0.1613], [0.0111, 0.5008, -0.16], [0.0291, 0.5089, -0.1709], [0.036, 0.52, -0.1892], [0.0291, 0.531, -0.2075], [0.0111, 0.5391, -0.2184], [-0.0111, 0.5423, -0.2171], [-0.0291, 0.5405, -0.2037], [-0.036, 0.5357, -0.1828], [-0.0291, 0.5309, -0.1619], [-0.0111, 0.5291, -0.1486], [0.0111, 0.5323, -0.1473], [0.0291, 0.5403, -0.1581], [0.036, 0.5514, -0.1765], [0.0291, 0.5625, -0.1948], [0.0111, 0.5706, -0.2056], [-0.0111, 0.5737, -0.2044], [-0.0291, 0.5719, -0.191], [-0.036, 0.5671, -0.1701], [-0.0291, 0.5623, -0.1492], [-0.0111, 0.5606, -0.1358], [0.0111, 0.5637, -0.1345], [0.0291, 0.5718, -0.1454], [0.036, 0.5829, -0.1637], [0.0291, 0.5939, -0.182], [0.0111, 0.602, -0.1929], [-0.0111, 0.6052, -0.1916], [-0.0291, 0.6034, -0.1782], [-0.036, 0.5986, -0.1573], [-0.0291, 0.5938, -0.1364], [-0.0111, 0.592, -0.1231], [0.0111, 0.5952, -0.1218], [0.0291, 0.6032, -0.1326], [0.036, 0.6143, -0.151], [0.0291, 0.6254, -0.1693], [0.0111, 0.6335, -0.1801], [-0.0111, 0.6366, -0.1789], [-0.0291, 0.6348, -0.1655], [-0.036, 0.63, -0.1446], [-0.0291, 0.6252, -0.1237], [-0.0111, 0.6235, -0.1103], [0.0111, 0.6266, -0.109], [0.0291, 0.6347, -0.1199], [0.036, 0.6458, -0.1382], [0.0291, 0.6568, -0.1565], [0.0111, 0.6649, -0.1674], [-0.0111, 0.6681, -0.1661], [-0.0291, 0.6663, -0.1527], [-0.036, 0.6615, -0.1318], [-0.0291, 0.6567, -0.1109], [-0.0111, 0.6549, -0.0976], [0.0111, 0.6581, -0.0963], [0.0291, 0.6661, -0.1071], [0.036, 0.6772, -0.1255]], "radius": 0.006, "radialSegments": 6}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "yellow-spring", "materialLayers": ["yellow-spring"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "yellow-spring-coils", "kind": "ridge", "description": "Eight saturated yellow coils around the black damper."}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(224, 177, 30, 1.0)", "secondaryAlbedo": "rgba(180, 131, 22, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for yellow-spring)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow-spring"}}, "materialRegions": [{"regionId": "yellow-spring", "materialId": "yellow-spring", "profileId": "coating.painted-metal", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/07-yellow-spring.png", "bbox": {"x": 588, "y": 418, "width": 18, "height": 18}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0003}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "yellow-spring"}};
  node_shock_spring_23.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow-spring"}};
  (nodes["root"] ?? root).add(node_shock_spring_23);
  nodes["shock-spring"] = node_shock_spring_23;
  const mesh_shock_spring_23Geometry = endpoint_shock_spring_23
    ? new THREE.CylinderGeometry(endpoint_shock_spring_23.endRadius, endpoint_shock_spring_23.baseRadius, endpoint_shock_spring_23.length, 16, 6)
    : buildTubeGeometry({"points": [[0.036, 0.4256, -0.2275], [0.0291, 0.4367, -0.2458], [0.0111, 0.4448, -0.2566], [-0.0111, 0.4479, -0.2554], [-0.0291, 0.4461, -0.242], [-0.036, 0.4413, -0.2211], [-0.0291, 0.4365, -0.2002], [-0.0111, 0.4348, -0.1868], [0.0111, 0.4379, -0.1855], [0.0291, 0.446, -0.1964], [0.036, 0.4571, -0.2147], [0.0291, 0.4681, -0.233], [0.0111, 0.4762, -0.2439], [-0.0111, 0.4794, -0.2426], [-0.0291, 0.4776, -0.2292], [-0.036, 0.4728, -0.2083], [-0.0291, 0.468, -0.1874], [-0.0111, 0.4662, -0.1741], [0.0111, 0.4694, -0.1728], [0.0291, 0.4774, -0.1836], [0.036, 0.4885, -0.202], [0.0291, 0.4996, -0.2203], [0.0111, 0.5077, -0.2311], [-0.0111, 0.5108, -0.2299], [-0.0291, 0.509, -0.2165], [-0.036, 0.5042, -0.1956], [-0.0291, 0.4994, -0.1747], [-0.0111, 0.4977, -0.1613], [0.0111, 0.5008, -0.16], [0.0291, 0.5089, -0.1709], [0.036, 0.52, -0.1892], [0.0291, 0.531, -0.2075], [0.0111, 0.5391, -0.2184], [-0.0111, 0.5423, -0.2171], [-0.0291, 0.5405, -0.2037], [-0.036, 0.5357, -0.1828], [-0.0291, 0.5309, -0.1619], [-0.0111, 0.5291, -0.1486], [0.0111, 0.5323, -0.1473], [0.0291, 0.5403, -0.1581], [0.036, 0.5514, -0.1765], [0.0291, 0.5625, -0.1948], [0.0111, 0.5706, -0.2056], [-0.0111, 0.5737, -0.2044], [-0.0291, 0.5719, -0.191], [-0.036, 0.5671, -0.1701], [-0.0291, 0.5623, -0.1492], [-0.0111, 0.5606, -0.1358], [0.0111, 0.5637, -0.1345], [0.0291, 0.5718, -0.1454], [0.036, 0.5829, -0.1637], [0.0291, 0.5939, -0.182], [0.0111, 0.602, -0.1929], [-0.0111, 0.6052, -0.1916], [-0.0291, 0.6034, -0.1782], [-0.036, 0.5986, -0.1573], [-0.0291, 0.5938, -0.1364], [-0.0111, 0.592, -0.1231], [0.0111, 0.5952, -0.1218], [0.0291, 0.6032, -0.1326], [0.036, 0.6143, -0.151], [0.0291, 0.6254, -0.1693], [0.0111, 0.6335, -0.1801], [-0.0111, 0.6366, -0.1789], [-0.0291, 0.6348, -0.1655], [-0.036, 0.63, -0.1446], [-0.0291, 0.6252, -0.1237], [-0.0111, 0.6235, -0.1103], [0.0111, 0.6266, -0.109], [0.0291, 0.6347, -0.1199], [0.036, 0.6458, -0.1382], [0.0291, 0.6568, -0.1565], [0.0111, 0.6649, -0.1674], [-0.0111, 0.6681, -0.1661], [-0.0291, 0.6663, -0.1527], [-0.036, 0.6615, -0.1318], [-0.0291, 0.6567, -0.1109], [-0.0111, 0.6549, -0.0976], [0.0111, 0.6581, -0.0963], [0.0291, 0.6661, -0.1071], [0.036, 0.6772, -0.1255]], "radius": 0.006, "radialSegments": 6});
  if (!endpoint_shock_spring_23) {
    mesh_shock_spring_23Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shock_spring_23 = new THREE.Mesh(
    mesh_shock_spring_23Geometry,
    materialMap["yellow-spring"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shock_spring_23.name = "Yellow shock spring";
  if (endpoint_shock_spring_23) {
    mesh_shock_spring_23.position.copy(endpoint_shock_spring_23.midpoint);
    mesh_shock_spring_23.quaternion.copy(endpoint_shock_spring_23.quaternion);
  }
  mesh_shock_spring_23.castShadow = options.castShadow ?? true;
  mesh_shock_spring_23.receiveShadow = options.receiveShadow ?? true;
  mesh_shock_spring_23.userData.sculptComponent = {"id": "shock-spring", "name": "Yellow shock spring", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "fiber-strand", "topologyRationale": "A helical wire: a thin swept strand, not a solid volume.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.036, 0.4256, -0.2275], [0.0291, 0.4367, -0.2458], [0.0111, 0.4448, -0.2566], [-0.0111, 0.4479, -0.2554], [-0.0291, 0.4461, -0.242], [-0.036, 0.4413, -0.2211], [-0.0291, 0.4365, -0.2002], [-0.0111, 0.4348, -0.1868], [0.0111, 0.4379, -0.1855], [0.0291, 0.446, -0.1964], [0.036, 0.4571, -0.2147], [0.0291, 0.4681, -0.233], [0.0111, 0.4762, -0.2439], [-0.0111, 0.4794, -0.2426], [-0.0291, 0.4776, -0.2292], [-0.036, 0.4728, -0.2083], [-0.0291, 0.468, -0.1874], [-0.0111, 0.4662, -0.1741], [0.0111, 0.4694, -0.1728], [0.0291, 0.4774, -0.1836], [0.036, 0.4885, -0.202], [0.0291, 0.4996, -0.2203], [0.0111, 0.5077, -0.2311], [-0.0111, 0.5108, -0.2299], [-0.0291, 0.509, -0.2165], [-0.036, 0.5042, -0.1956], [-0.0291, 0.4994, -0.1747], [-0.0111, 0.4977, -0.1613], [0.0111, 0.5008, -0.16], [0.0291, 0.5089, -0.1709], [0.036, 0.52, -0.1892], [0.0291, 0.531, -0.2075], [0.0111, 0.5391, -0.2184], [-0.0111, 0.5423, -0.2171], [-0.0291, 0.5405, -0.2037], [-0.036, 0.5357, -0.1828], [-0.0291, 0.5309, -0.1619], [-0.0111, 0.5291, -0.1486], [0.0111, 0.5323, -0.1473], [0.0291, 0.5403, -0.1581], [0.036, 0.5514, -0.1765], [0.0291, 0.5625, -0.1948], [0.0111, 0.5706, -0.2056], [-0.0111, 0.5737, -0.2044], [-0.0291, 0.5719, -0.191], [-0.036, 0.5671, -0.1701], [-0.0291, 0.5623, -0.1492], [-0.0111, 0.5606, -0.1358], [0.0111, 0.5637, -0.1345], [0.0291, 0.5718, -0.1454], [0.036, 0.5829, -0.1637], [0.0291, 0.5939, -0.182], [0.0111, 0.602, -0.1929], [-0.0111, 0.6052, -0.1916], [-0.0291, 0.6034, -0.1782], [-0.036, 0.5986, -0.1573], [-0.0291, 0.5938, -0.1364], [-0.0111, 0.592, -0.1231], [0.0111, 0.5952, -0.1218], [0.0291, 0.6032, -0.1326], [0.036, 0.6143, -0.151], [0.0291, 0.6254, -0.1693], [0.0111, 0.6335, -0.1801], [-0.0111, 0.6366, -0.1789], [-0.0291, 0.6348, -0.1655], [-0.036, 0.63, -0.1446], [-0.0291, 0.6252, -0.1237], [-0.0111, 0.6235, -0.1103], [0.0111, 0.6266, -0.109], [0.0291, 0.6347, -0.1199], [0.036, 0.6458, -0.1382], [0.0291, 0.6568, -0.1565], [0.0111, 0.6649, -0.1674], [-0.0111, 0.6681, -0.1661], [-0.0291, 0.6663, -0.1527], [-0.036, 0.6615, -0.1318], [-0.0291, 0.6567, -0.1109], [-0.0111, 0.6549, -0.0976], [0.0111, 0.6581, -0.0963], [0.0291, 0.6661, -0.1071], [0.036, 0.6772, -0.1255]], "radius": 0.006, "radialSegments": 6}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "yellow-spring", "materialLayers": ["yellow-spring"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "yellow-spring-coils", "kind": "ridge", "description": "Eight saturated yellow coils around the black damper."}], "surfaceDetail": {"macroRoughness": 0.38, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(224, 177, 30, 1.0)", "secondaryAlbedo": "rgba(180, 131, 22, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for yellow-spring)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "yellow-spring"}}, "materialRegions": [{"regionId": "yellow-spring", "materialId": "yellow-spring", "profileId": "coating.painted-metal", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/07-yellow-spring.png", "bbox": {"x": 588, "y": 418, "width": 18, "height": 18}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0003}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "yellow-spring"}};
  node_shock_spring_23.add(mesh_shock_spring_23);
  meshes["shock-spring"] = mesh_shock_spring_23;
  colliders["shock-spring"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_shock_spring_23);

  const endpoint_rear_hub_24 = makeAttachmentEndpoint(null);
  const node_rear_hub_24 = new THREE.Group();
  node_rear_hub_24.name = "Rear wheel hub__pivot";
  node_rear_hub_24.scale.set(1, 1, 1);
  if (endpoint_rear_hub_24) {
    node_rear_hub_24.position.copy(endpoint_rear_hub_24.start);
    node_rear_hub_24.rotation.set(-0.0, 0.0, 1.5708);
  } else {
    node_rear_hub_24.position.set(0.0, 0.23, -0.68);
    node_rear_hub_24.rotation.set(-0.0, 0.0, 1.5708);
  }
  node_rear_hub_24.userData.sculptComponent = {"id": "rear-hub", "name": "Rear wheel hub", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Turned hub barrel with flanges; lathe profile around the axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.02, -0.07], [0.035, -0.065], [0.03, -0.02], [0.028, 0.0], [0.03, 0.02], [0.035, 0.065], [0.02, 0.07]], "segments": 20}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.23, -0.68], "rotation": [-0.0, 0.0, 1.5708]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.23, -0.68], "localEnd": [0.0, 0.23, -0.68], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_rear_hub_24.userData.actionProfile = {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_rear_hub_24);
  nodes["rear-hub"] = node_rear_hub_24;
  const mesh_rear_hub_24Geometry = endpoint_rear_hub_24
    ? new THREE.CylinderGeometry(endpoint_rear_hub_24.endRadius, endpoint_rear_hub_24.baseRadius, endpoint_rear_hub_24.length, 16, 6)
    : buildLatheGeometry({"points": [[0.02, -0.07], [0.035, -0.065], [0.03, -0.02], [0.028, 0.0], [0.03, 0.02], [0.035, 0.065], [0.02, 0.07]], "segments": 20});
  if (!endpoint_rear_hub_24) {
    mesh_rear_hub_24Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_hub_24 = new THREE.Mesh(
    mesh_rear_hub_24Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_hub_24.name = "Rear wheel hub";
  if (endpoint_rear_hub_24) {
    mesh_rear_hub_24.position.copy(endpoint_rear_hub_24.midpoint);
    mesh_rear_hub_24.quaternion.copy(endpoint_rear_hub_24.quaternion);
  }
  mesh_rear_hub_24.castShadow = options.castShadow ?? true;
  mesh_rear_hub_24.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_hub_24.userData.sculptComponent = {"id": "rear-hub", "name": "Rear wheel hub", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Turned hub barrel with flanges; lathe profile around the axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.02, -0.07], [0.035, -0.065], [0.03, -0.02], [0.028, 0.0], [0.03, 0.02], [0.035, 0.065], [0.02, 0.07]], "segments": 20}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.23, -0.68], "rotation": [-0.0, 0.0, 1.5708]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.23, -0.68], "localEnd": [0.0, 0.23, -0.68], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_rear_hub_24.add(mesh_rear_hub_24);
  meshes["rear-hub"] = mesh_rear_hub_24;
  colliders["rear-hub"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_rear_hub_24);

  const endpoint_rear_tyre_25 = makeAttachmentEndpoint(null);
  const node_rear_tyre_25 = new THREE.Group();
  node_rear_tyre_25.name = "Rear knobby tyre__pivot";
  node_rear_tyre_25.scale.set(1, 1, 1);
  if (endpoint_rear_tyre_25) {
    node_rear_tyre_25.position.copy(endpoint_rear_tyre_25.start);
    node_rear_tyre_25.rotation.set(1.5708, 0.0, -1.5708);
  } else {
    node_rear_tyre_25.position.set(0.0, 0.0, 0.0);
    node_rear_tyre_25.rotation.set(1.5708, 0.0, -1.5708);
  }
  node_rear_tyre_25.userData.sculptComponent = {"id": "rear-tyre", "name": "Rear knobby tyre", "level": "meso", "role": "wheel", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Toroidal tyre carcass; torus with measured section ratio.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.1579}, "parent": "rear-hub", "dimensions": {"width": 0.6333333333333333, "height": 0.6333333333333333, "depth": 0.6333333333333333, "units": "scale", "confidence": 0.8}, "material": "tyre-rubber", "materialLayers": ["tyre-rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-tyre-knobs", "kind": "ridge", "description": "Rows of square rubber knobs around the tread."}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(35, 35, 34, 1.0)", "secondaryAlbedo": "rgba(58, 58, 55, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for tyre-rubber)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [1.5708, 0.0, -1.5708]}, "attachment": {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "tyre-rubber"}}};
  node_rear_tyre_25.userData.actionProfile = {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "tyre-rubber"}};
  (nodes["rear-hub"] ?? root).add(node_rear_tyre_25);
  nodes["rear-tyre"] = node_rear_tyre_25;
  const mesh_rear_tyre_25Geometry = endpoint_rear_tyre_25
    ? new THREE.CylinderGeometry(endpoint_rear_tyre_25.endRadius, endpoint_rear_tyre_25.baseRadius, endpoint_rear_tyre_25.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0711, 12, 48);
  if (!endpoint_rear_tyre_25) {
    mesh_rear_tyre_25Geometry.scale(0.6333333333333333, 0.6333333333333333, 0.6333333333333333);
  }
  const mesh_rear_tyre_25 = new THREE.Mesh(
    mesh_rear_tyre_25Geometry,
    materialMap["tyre-rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_tyre_25.name = "Rear knobby tyre";
  if (endpoint_rear_tyre_25) {
    mesh_rear_tyre_25.position.copy(endpoint_rear_tyre_25.midpoint);
    mesh_rear_tyre_25.quaternion.copy(endpoint_rear_tyre_25.quaternion);
  }
  mesh_rear_tyre_25.castShadow = options.castShadow ?? true;
  mesh_rear_tyre_25.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_tyre_25.userData.sculptComponent = {"id": "rear-tyre", "name": "Rear knobby tyre", "level": "meso", "role": "wheel", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Toroidal tyre carcass; torus with measured section ratio.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.1579}, "parent": "rear-hub", "dimensions": {"width": 0.6333333333333333, "height": 0.6333333333333333, "depth": 0.6333333333333333, "units": "scale", "confidence": 0.8}, "material": "tyre-rubber", "materialLayers": ["tyre-rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-tyre-knobs", "kind": "ridge", "description": "Rows of square rubber knobs around the tread."}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(35, 35, 34, 1.0)", "secondaryAlbedo": "rgba(58, 58, 55, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for tyre-rubber)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [1.5708, 0.0, -1.5708]}, "attachment": {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "tyre-rubber"}}};
  node_rear_tyre_25.add(mesh_rear_tyre_25);
  meshes["rear-tyre"] = mesh_rear_tyre_25;
  colliders["rear-tyre"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_rear_tyre_25);

  const endpoint_rear_rim_26 = makeAttachmentEndpoint(null);
  const node_rear_rim_26 = new THREE.Group();
  node_rear_rim_26.name = "Rear black rim__pivot";
  node_rear_rim_26.scale.set(1, 1, 1);
  if (endpoint_rear_rim_26) {
    node_rear_rim_26.position.copy(endpoint_rear_rim_26.start);
    node_rear_rim_26.rotation.set(1.5708, 0.0, -1.5708);
  } else {
    node_rear_rim_26.position.set(0.0, 0.0, 0.0);
    node_rear_rim_26.rotation.set(1.5708, 0.0, -1.5708);
  }
  node_rear_rim_26.userData.sculptComponent = {"id": "rear-rim", "name": "Rear black rim", "level": "meso", "role": "wheel", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Channel-section rim; slim torus widened on the axle axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.0504}, "parent": "rear-hub", "dimensions": {"width": 0.5288888888888889, "height": 0.5288888888888889, "depth": 0.8462222222222222, "units": "scale", "confidence": 0.8}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [1.5708, 0.0, -1.5708]}, "attachment": {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_rear_rim_26.userData.actionProfile = {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["rear-hub"] ?? root).add(node_rear_rim_26);
  nodes["rear-rim"] = node_rear_rim_26;
  const mesh_rear_rim_26Geometry = endpoint_rear_rim_26
    ? new THREE.CylinderGeometry(endpoint_rear_rim_26.endRadius, endpoint_rear_rim_26.baseRadius, endpoint_rear_rim_26.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0227, 12, 48);
  if (!endpoint_rear_rim_26) {
    mesh_rear_rim_26Geometry.scale(0.5288888888888889, 0.5288888888888889, 0.8462222222222222);
  }
  const mesh_rear_rim_26 = new THREE.Mesh(
    mesh_rear_rim_26Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_rim_26.name = "Rear black rim";
  if (endpoint_rear_rim_26) {
    mesh_rear_rim_26.position.copy(endpoint_rear_rim_26.midpoint);
    mesh_rear_rim_26.quaternion.copy(endpoint_rear_rim_26.quaternion);
  }
  mesh_rear_rim_26.castShadow = options.castShadow ?? true;
  mesh_rear_rim_26.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_rim_26.userData.sculptComponent = {"id": "rear-rim", "name": "Rear black rim", "level": "meso", "role": "wheel", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Channel-section rim; slim torus widened on the axle axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.0504}, "parent": "rear-hub", "dimensions": {"width": 0.5288888888888889, "height": 0.5288888888888889, "depth": 0.8462222222222222, "units": "scale", "confidence": 0.8}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [1.5708, 0.0, -1.5708]}, "attachment": {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_rear_rim_26.add(mesh_rear_rim_26);
  meshes["rear-rim"] = mesh_rear_rim_26;
  colliders["rear-rim"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_rear_rim_26);

  const attachment_rear_disc_27 = {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [-0.0, 0.076, 0.0], "localEnd": [-0.0, 0.072, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.105, "endRadius": 0.105};
  const endpoint_rear_disc_27 = makeAttachmentEndpoint(attachment_rear_disc_27);
  const node_rear_disc_27 = new THREE.Group();
  node_rear_disc_27.name = "Rear wave brake disc__pivot";
  node_rear_disc_27.scale.set(1, 1, 1);
  if (endpoint_rear_disc_27) {
    node_rear_disc_27.position.copy(endpoint_rear_disc_27.start);
    node_rear_disc_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_disc_27.position.set(-0.23, -0.0, 0.68);
    node_rear_disc_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_disc_27.userData.sculptComponent = {"id": "rear-disc", "name": "Rear wave brake disc", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Thin flat rotor; very short cylinder along the axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rear-hub", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-disc-ring", "kind": "gloss", "description": "Bright machined friction ring on the wave disc."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.23, -0.0, 0.68], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [-0.0, 0.076, 0.0], "localEnd": [-0.0, 0.072, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.105, "endRadius": 0.105}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_rear_disc_27.userData.actionProfile = {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["rear-hub"] ?? root).add(node_rear_disc_27);
  nodes["rear-disc"] = node_rear_disc_27;
  const mesh_rear_disc_27Geometry = endpoint_rear_disc_27
    ? new THREE.CylinderGeometry(endpoint_rear_disc_27.endRadius, endpoint_rear_disc_27.baseRadius, endpoint_rear_disc_27.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_rear_disc_27) {
    mesh_rear_disc_27Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_disc_27 = new THREE.Mesh(
    mesh_rear_disc_27Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_disc_27.name = "Rear wave brake disc";
  if (endpoint_rear_disc_27) {
    mesh_rear_disc_27.position.copy(endpoint_rear_disc_27.midpoint);
    mesh_rear_disc_27.quaternion.copy(endpoint_rear_disc_27.quaternion);
  }
  mesh_rear_disc_27.castShadow = options.castShadow ?? true;
  mesh_rear_disc_27.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_disc_27.userData.sculptComponent = {"id": "rear-disc", "name": "Rear wave brake disc", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Thin flat rotor; very short cylinder along the axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rear-hub", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-disc-ring", "kind": "gloss", "description": "Bright machined friction ring on the wave disc."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.23, -0.0, 0.68], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [-0.0, 0.076, 0.0], "localEnd": [-0.0, 0.072, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.105, "endRadius": 0.105}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_rear_disc_27.add(mesh_rear_disc_27);
  meshes["rear-disc"] = mesh_rear_disc_27;
  colliders["rear-disc"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_rear_disc_27);

  const attachment_rear_sprocket_28 = {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [0.0, -0.066, 0.0], "localEnd": [0.0, -0.07, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.105, "endRadius": 0.105};
  const endpoint_rear_sprocket_28 = makeAttachmentEndpoint(attachment_rear_sprocket_28);
  const node_rear_sprocket_28 = new THREE.Group();
  node_rear_sprocket_28.name = "Rear sprocket__pivot";
  node_rear_sprocket_28.scale.set(1, 1, 1);
  if (endpoint_rear_sprocket_28) {
    node_rear_sprocket_28.position.copy(endpoint_rear_sprocket_28.start);
    node_rear_sprocket_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_sprocket_28.position.set(-0.23, -0.0, 0.68);
    node_rear_sprocket_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_sprocket_28.userData.sculptComponent = {"id": "rear-sprocket", "name": "Rear sprocket", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat toothed plate on the hub; thin cylinder (teeth as repetition system).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rear-hub", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.23, -0.0, 0.68], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [0.0, -0.066, 0.0], "localEnd": [0.0, -0.07, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.105, "endRadius": 0.105}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_rear_sprocket_28.userData.actionProfile = {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["rear-hub"] ?? root).add(node_rear_sprocket_28);
  nodes["rear-sprocket"] = node_rear_sprocket_28;
  const mesh_rear_sprocket_28Geometry = endpoint_rear_sprocket_28
    ? new THREE.CylinderGeometry(endpoint_rear_sprocket_28.endRadius, endpoint_rear_sprocket_28.baseRadius, endpoint_rear_sprocket_28.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_rear_sprocket_28) {
    mesh_rear_sprocket_28Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_sprocket_28 = new THREE.Mesh(
    mesh_rear_sprocket_28Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_sprocket_28.name = "Rear sprocket";
  if (endpoint_rear_sprocket_28) {
    mesh_rear_sprocket_28.position.copy(endpoint_rear_sprocket_28.midpoint);
    mesh_rear_sprocket_28.quaternion.copy(endpoint_rear_sprocket_28.quaternion);
  }
  mesh_rear_sprocket_28.castShadow = options.castShadow ?? true;
  mesh_rear_sprocket_28.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_sprocket_28.userData.sculptComponent = {"id": "rear-sprocket", "name": "Rear sprocket", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat toothed plate on the hub; thin cylinder (teeth as repetition system).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rear-hub", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.23, -0.0, 0.68], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "rear-hub", "parentSocket": "rear-hub-mount", "localStart": [0.0, -0.066, 0.0], "localEnd": [0.0, -0.07, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.105, "endRadius": 0.105}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_rear_sprocket_28.add(mesh_rear_sprocket_28);
  meshes["rear-sprocket"] = mesh_rear_sprocket_28;
  colliders["rear-sprocket"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_rear_sprocket_28);

  const attachment_chain_29 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_chain_29 = makeAttachmentEndpoint(attachment_chain_29);
  const node_chain_29 = new THREE.Group();
  node_chain_29.name = "Drive chain loop__pivot";
  node_chain_29.scale.set(1, 1, 1);
  if (endpoint_chain_29) {
    node_chain_29.position.copy(endpoint_chain_29.start);
    node_chain_29.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_chain_29.position.set(0.0, 0.0, 0.0);
    node_chain_29.rotation.set(-0.0, 0.0, -0.0);
  }
  node_chain_29.userData.sculptComponent = {"id": "chain", "name": "Drive chain loop", "level": "meso", "role": "cable", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "fiber-strand", "topologyRationale": "Closed loop of links around both sprockets; a swept closed strand.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.075, 0.442, -0.03], [0.075, 0.4388, -0.0139], [0.075, 0.4297, -0.0003], [0.075, 0.4161, 0.0088], [0.075, 0.4, 0.012], [0.075, 0.3839, 0.0088], [0.075, 0.3703, -0.0003], [0.075, 0.3612, -0.0139], [0.075, 0.358, -0.03], [0.075, 0.122, -0.68], [0.075, 0.1257, -0.708], [0.075, 0.1365, -0.734], [0.075, 0.1536, -0.7564], [0.075, 0.176, -0.7735], [0.075, 0.202, -0.7843], [0.075, 0.23, -0.788], [0.075, 0.258, -0.7843], [0.075, 0.284, -0.7735], [0.075, 0.3064, -0.7564], [0.075, 0.3235, -0.734], [0.075, 0.3343, -0.708], [0.075, 0.338, -0.68]], "radius": 0.007, "radialSegments": 6, "closed": true}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "chain-steel", "materialLayers": ["chain-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(90, 88, 80, 1.0)", "secondaryAlbedo": "rgba(74, 75, 76, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for chain-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chain-steel"}}, "materialRegions": [{"regionId": "chain-links", "materialId": "chain-steel", "profileId": "metal.brass", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/09-chain-links.png", "bbox": {"x": 318, "y": 490, "width": 40, "height": 14}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0005}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "chain-steel"}};
  node_chain_29.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chain-steel"}};
  (nodes["root"] ?? root).add(node_chain_29);
  nodes["chain"] = node_chain_29;
  const mesh_chain_29Geometry = endpoint_chain_29
    ? new THREE.CylinderGeometry(endpoint_chain_29.endRadius, endpoint_chain_29.baseRadius, endpoint_chain_29.length, 16, 6)
    : buildTubeGeometry({"points": [[0.075, 0.442, -0.03], [0.075, 0.4388, -0.0139], [0.075, 0.4297, -0.0003], [0.075, 0.4161, 0.0088], [0.075, 0.4, 0.012], [0.075, 0.3839, 0.0088], [0.075, 0.3703, -0.0003], [0.075, 0.3612, -0.0139], [0.075, 0.358, -0.03], [0.075, 0.122, -0.68], [0.075, 0.1257, -0.708], [0.075, 0.1365, -0.734], [0.075, 0.1536, -0.7564], [0.075, 0.176, -0.7735], [0.075, 0.202, -0.7843], [0.075, 0.23, -0.788], [0.075, 0.258, -0.7843], [0.075, 0.284, -0.7735], [0.075, 0.3064, -0.7564], [0.075, 0.3235, -0.734], [0.075, 0.3343, -0.708], [0.075, 0.338, -0.68]], "radius": 0.007, "radialSegments": 6, "closed": true});
  if (!endpoint_chain_29) {
    mesh_chain_29Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_chain_29 = new THREE.Mesh(
    mesh_chain_29Geometry,
    materialMap["chain-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chain_29.name = "Drive chain loop";
  if (endpoint_chain_29) {
    mesh_chain_29.position.copy(endpoint_chain_29.midpoint);
    mesh_chain_29.quaternion.copy(endpoint_chain_29.quaternion);
  }
  mesh_chain_29.castShadow = options.castShadow ?? true;
  mesh_chain_29.receiveShadow = options.receiveShadow ?? true;
  mesh_chain_29.userData.sculptComponent = {"id": "chain", "name": "Drive chain loop", "level": "meso", "role": "cable", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "fiber-strand", "topologyRationale": "Closed loop of links around both sprockets; a swept closed strand.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.075, 0.442, -0.03], [0.075, 0.4388, -0.0139], [0.075, 0.4297, -0.0003], [0.075, 0.4161, 0.0088], [0.075, 0.4, 0.012], [0.075, 0.3839, 0.0088], [0.075, 0.3703, -0.0003], [0.075, 0.3612, -0.0139], [0.075, 0.358, -0.03], [0.075, 0.122, -0.68], [0.075, 0.1257, -0.708], [0.075, 0.1365, -0.734], [0.075, 0.1536, -0.7564], [0.075, 0.176, -0.7735], [0.075, 0.202, -0.7843], [0.075, 0.23, -0.788], [0.075, 0.258, -0.7843], [0.075, 0.284, -0.7735], [0.075, 0.3064, -0.7564], [0.075, 0.3235, -0.734], [0.075, 0.3343, -0.708], [0.075, 0.338, -0.68]], "radius": 0.007, "radialSegments": 6, "closed": true}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "chain-steel", "materialLayers": ["chain-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.45, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(90, 88, 80, 1.0)", "secondaryAlbedo": "rgba(74, 75, 76, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for chain-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chain-steel"}}, "materialRegions": [{"regionId": "chain-links", "materialId": "chain-steel", "profileId": "metal.brass", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/09-chain-links.png", "bbox": {"x": 318, "y": 490, "width": 40, "height": 14}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0005}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "chain-steel"}};
  node_chain_29.add(mesh_chain_29);
  meshes["chain"] = mesh_chain_29;
  colliders["chain"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_chain_29);

  const attachment_front_sprocket_30 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.072, 0.4, -0.03], "localEnd": [0.08, 0.4, -0.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.04, "endRadius": 0.04};
  const endpoint_front_sprocket_30 = makeAttachmentEndpoint(attachment_front_sprocket_30);
  const node_front_sprocket_30 = new THREE.Group();
  node_front_sprocket_30.name = "Front sprocket__pivot";
  node_front_sprocket_30.scale.set(1, 1, 1);
  if (endpoint_front_sprocket_30) {
    node_front_sprocket_30.position.copy(endpoint_front_sprocket_30.start);
    node_front_sprocket_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_sprocket_30.position.set(0.0, 0.0, 0.0);
    node_front_sprocket_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_sprocket_30.userData.sculptComponent = {"id": "front-sprocket", "name": "Front sprocket", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small gearbox output sprocket.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.072, 0.4, -0.03], "localEnd": [0.08, 0.4, -0.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.04, "endRadius": 0.04}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_front_sprocket_30.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_front_sprocket_30);
  nodes["front-sprocket"] = node_front_sprocket_30;
  const mesh_front_sprocket_30Geometry = endpoint_front_sprocket_30
    ? new THREE.CylinderGeometry(endpoint_front_sprocket_30.endRadius, endpoint_front_sprocket_30.baseRadius, endpoint_front_sprocket_30.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_front_sprocket_30) {
    mesh_front_sprocket_30Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_front_sprocket_30 = new THREE.Mesh(
    mesh_front_sprocket_30Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_sprocket_30.name = "Front sprocket";
  if (endpoint_front_sprocket_30) {
    mesh_front_sprocket_30.position.copy(endpoint_front_sprocket_30.midpoint);
    mesh_front_sprocket_30.quaternion.copy(endpoint_front_sprocket_30.quaternion);
  }
  mesh_front_sprocket_30.castShadow = options.castShadow ?? true;
  mesh_front_sprocket_30.receiveShadow = options.receiveShadow ?? true;
  mesh_front_sprocket_30.userData.sculptComponent = {"id": "front-sprocket", "name": "Front sprocket", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Small gearbox output sprocket.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.072, 0.4, -0.03], "localEnd": [0.08, 0.4, -0.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.04, "endRadius": 0.04}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_front_sprocket_30.add(mesh_front_sprocket_30);
  meshes["front-sprocket"] = mesh_front_sprocket_30;
  colliders["front-sprocket"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_front_sprocket_30);

  const endpoint_front_hub_31 = makeAttachmentEndpoint(null);
  const node_front_hub_31 = new THREE.Group();
  node_front_hub_31.name = "Front wheel hub__pivot";
  node_front_hub_31.scale.set(1, 1, 1);
  if (endpoint_front_hub_31) {
    node_front_hub_31.position.copy(endpoint_front_hub_31.start);
    node_front_hub_31.rotation.set(-0.0, 0.0, 1.5708);
  } else {
    node_front_hub_31.position.set(0.0, 0.25, 0.731);
    node_front_hub_31.rotation.set(-0.0, 0.0, 1.5708);
  }
  node_front_hub_31.userData.sculptComponent = {"id": "front-hub", "name": "Front wheel hub", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Turned hub barrel with flanges; lathe profile around the axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.02, -0.07], [0.035, -0.065], [0.03, -0.02], [0.028, 0.0], [0.03, 0.02], [0.035, 0.065], [0.02, 0.07]], "segments": 20}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.25, 0.731], "rotation": [-0.0, 0.0, 1.5708]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.25, 0.731], "localEnd": [0.0, 0.25, 0.731], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_front_hub_31.userData.actionProfile = {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_front_hub_31);
  nodes["front-hub"] = node_front_hub_31;
  const mesh_front_hub_31Geometry = endpoint_front_hub_31
    ? new THREE.CylinderGeometry(endpoint_front_hub_31.endRadius, endpoint_front_hub_31.baseRadius, endpoint_front_hub_31.length, 16, 6)
    : buildLatheGeometry({"points": [[0.02, -0.07], [0.035, -0.065], [0.03, -0.02], [0.028, 0.0], [0.03, 0.02], [0.035, 0.065], [0.02, 0.07]], "segments": 20});
  if (!endpoint_front_hub_31) {
    mesh_front_hub_31Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_front_hub_31 = new THREE.Mesh(
    mesh_front_hub_31Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_hub_31.name = "Front wheel hub";
  if (endpoint_front_hub_31) {
    mesh_front_hub_31.position.copy(endpoint_front_hub_31.midpoint);
    mesh_front_hub_31.quaternion.copy(endpoint_front_hub_31.quaternion);
  }
  mesh_front_hub_31.castShadow = options.castShadow ?? true;
  mesh_front_hub_31.receiveShadow = options.receiveShadow ?? true;
  mesh_front_hub_31.userData.sculptComponent = {"id": "front-hub", "name": "Front wheel hub", "level": "macro", "role": "support", "importance": 0.8, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Turned hub barrel with flanges; lathe profile around the axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.02, -0.07], [0.035, -0.065], [0.03, -0.02], [0.028, 0.0], [0.03, 0.02], [0.035, 0.065], [0.02, 0.07]], "segments": 20}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.25, 0.731], "rotation": [-0.0, 0.0, 1.5708]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.25, 0.731], "localEnd": [0.0, 0.25, 0.731], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_front_hub_31.add(mesh_front_hub_31);
  meshes["front-hub"] = mesh_front_hub_31;
  colliders["front-hub"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_front_hub_31);

  const endpoint_front_tyre_32 = makeAttachmentEndpoint(null);
  const node_front_tyre_32 = new THREE.Group();
  node_front_tyre_32.name = "Front knobby tyre__pivot";
  node_front_tyre_32.scale.set(1, 1, 1);
  if (endpoint_front_tyre_32) {
    node_front_tyre_32.position.copy(endpoint_front_tyre_32.start);
    node_front_tyre_32.rotation.set(1.5708, 0.0, -1.5708);
  } else {
    node_front_tyre_32.position.set(0.0, 0.0, 0.0);
    node_front_tyre_32.rotation.set(1.5708, 0.0, -1.5708);
  }
  node_front_tyre_32.userData.sculptComponent = {"id": "front-tyre", "name": "Front knobby tyre", "level": "meso", "role": "wheel", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Toroidal tyre carcass; torus with measured section ratio.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.129}, "parent": "front-hub", "dimensions": {"width": 0.6888888888888889, "height": 0.6888888888888889, "depth": 0.6888888888888889, "units": "scale", "confidence": 0.8}, "material": "tyre-rubber", "materialLayers": ["tyre-rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-tyre-knobs", "kind": "ridge", "description": "Rows of square rubber knobs around the tread."}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(35, 35, 34, 1.0)", "secondaryAlbedo": "rgba(58, 58, 55, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for tyre-rubber)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [1.5708, 0.0, -1.5708]}, "attachment": {"parentId": "front-hub", "parentSocket": "front-hub-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "tyre-rubber"}}};
  node_front_tyre_32.userData.actionProfile = {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "tyre-rubber"}};
  (nodes["front-hub"] ?? root).add(node_front_tyre_32);
  nodes["front-tyre"] = node_front_tyre_32;
  const mesh_front_tyre_32Geometry = endpoint_front_tyre_32
    ? new THREE.CylinderGeometry(endpoint_front_tyre_32.endRadius, endpoint_front_tyre_32.baseRadius, endpoint_front_tyre_32.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0581, 12, 48);
  if (!endpoint_front_tyre_32) {
    mesh_front_tyre_32Geometry.scale(0.6888888888888889, 0.6888888888888889, 0.6888888888888889);
  }
  const mesh_front_tyre_32 = new THREE.Mesh(
    mesh_front_tyre_32Geometry,
    materialMap["tyre-rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_tyre_32.name = "Front knobby tyre";
  if (endpoint_front_tyre_32) {
    mesh_front_tyre_32.position.copy(endpoint_front_tyre_32.midpoint);
    mesh_front_tyre_32.quaternion.copy(endpoint_front_tyre_32.quaternion);
  }
  mesh_front_tyre_32.castShadow = options.castShadow ?? true;
  mesh_front_tyre_32.receiveShadow = options.receiveShadow ?? true;
  mesh_front_tyre_32.userData.sculptComponent = {"id": "front-tyre", "name": "Front knobby tyre", "level": "meso", "role": "wheel", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Toroidal tyre carcass; torus with measured section ratio.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.129}, "parent": "front-hub", "dimensions": {"width": 0.6888888888888889, "height": 0.6888888888888889, "depth": 0.6888888888888889, "units": "scale", "confidence": 0.8}, "material": "tyre-rubber", "materialLayers": ["tyre-rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-tyre-knobs", "kind": "ridge", "description": "Rows of square rubber knobs around the tread."}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(35, 35, 34, 1.0)", "secondaryAlbedo": "rgba(58, 58, 55, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for tyre-rubber)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [1.5708, 0.0, -1.5708]}, "attachment": {"parentId": "front-hub", "parentSocket": "front-hub-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "tyre-rubber"}}};
  node_front_tyre_32.add(mesh_front_tyre_32);
  meshes["front-tyre"] = mesh_front_tyre_32;
  colliders["front-tyre"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_front_tyre_32);

  const endpoint_front_rim_33 = makeAttachmentEndpoint(null);
  const node_front_rim_33 = new THREE.Group();
  node_front_rim_33.name = "Front black rim__pivot";
  node_front_rim_33.scale.set(1, 1, 1);
  if (endpoint_front_rim_33) {
    node_front_rim_33.position.copy(endpoint_front_rim_33.start);
    node_front_rim_33.rotation.set(1.5708, 0.0, -1.5708);
  } else {
    node_front_rim_33.position.set(0.0, 0.0, 0.0);
    node_front_rim_33.rotation.set(1.5708, 0.0, -1.5708);
  }
  node_front_rim_33.userData.sculptComponent = {"id": "front-rim", "name": "Front black rim", "level": "meso", "role": "wheel", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Channel-section rim; slim torus widened on the axle axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.0448}, "parent": "front-hub", "dimensions": {"width": 0.5955555555555556, "height": 0.5955555555555556, "depth": 0.952888888888889, "units": "scale", "confidence": 0.8}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [1.5708, 0.0, -1.5708]}, "attachment": {"parentId": "front-hub", "parentSocket": "front-hub-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_front_rim_33.userData.actionProfile = {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["front-hub"] ?? root).add(node_front_rim_33);
  nodes["front-rim"] = node_front_rim_33;
  const mesh_front_rim_33Geometry = endpoint_front_rim_33
    ? new THREE.CylinderGeometry(endpoint_front_rim_33.endRadius, endpoint_front_rim_33.baseRadius, endpoint_front_rim_33.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0202, 12, 48);
  if (!endpoint_front_rim_33) {
    mesh_front_rim_33Geometry.scale(0.5955555555555556, 0.5955555555555556, 0.952888888888889);
  }
  const mesh_front_rim_33 = new THREE.Mesh(
    mesh_front_rim_33Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_rim_33.name = "Front black rim";
  if (endpoint_front_rim_33) {
    mesh_front_rim_33.position.copy(endpoint_front_rim_33.midpoint);
    mesh_front_rim_33.quaternion.copy(endpoint_front_rim_33.quaternion);
  }
  mesh_front_rim_33.castShadow = options.castShadow ?? true;
  mesh_front_rim_33.receiveShadow = options.receiveShadow ?? true;
  mesh_front_rim_33.userData.sculptComponent = {"id": "front-rim", "name": "Front black rim", "level": "meso", "role": "wheel", "importance": 0.6, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Channel-section rim; slim torus widened on the axle axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.0448}, "parent": "front-hub", "dimensions": {"width": 0.5955555555555556, "height": 0.5955555555555556, "depth": 0.952888888888889, "units": "scale", "confidence": 0.8}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [1.5708, 0.0, -1.5708]}, "attachment": {"parentId": "front-hub", "parentSocket": "front-hub-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_front_rim_33.add(mesh_front_rim_33);
  meshes["front-rim"] = mesh_front_rim_33;
  colliders["front-rim"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_front_rim_33);

  const attachment_front_disc_34 = {"parentId": "front-hub", "parentSocket": "front-hub-mount", "localStart": [-0.0, 0.085, 0.0], "localEnd": [-0.0, 0.081, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.13, "endRadius": 0.13};
  const endpoint_front_disc_34 = makeAttachmentEndpoint(attachment_front_disc_34);
  const node_front_disc_34 = new THREE.Group();
  node_front_disc_34.name = "Front wave brake disc__pivot";
  node_front_disc_34.scale.set(1, 1, 1);
  if (endpoint_front_disc_34) {
    node_front_disc_34.position.copy(endpoint_front_disc_34.start);
    node_front_disc_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_disc_34.position.set(-0.25, -0.0, -0.731);
    node_front_disc_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_disc_34.userData.sculptComponent = {"id": "front-disc", "name": "Front wave brake disc", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Thin flat rotor; very short cylinder along the axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-hub", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-disc-ring", "kind": "gloss", "description": "Bright machined friction ring on the wave disc."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.25, -0.0, -0.731], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "front-hub", "parentSocket": "front-hub-mount", "localStart": [-0.0, 0.085, 0.0], "localEnd": [-0.0, 0.081, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.13, "endRadius": 0.13}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_front_disc_34.userData.actionProfile = {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["front-hub"] ?? root).add(node_front_disc_34);
  nodes["front-disc"] = node_front_disc_34;
  const mesh_front_disc_34Geometry = endpoint_front_disc_34
    ? new THREE.CylinderGeometry(endpoint_front_disc_34.endRadius, endpoint_front_disc_34.baseRadius, endpoint_front_disc_34.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_front_disc_34) {
    mesh_front_disc_34Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_front_disc_34 = new THREE.Mesh(
    mesh_front_disc_34Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_disc_34.name = "Front wave brake disc";
  if (endpoint_front_disc_34) {
    mesh_front_disc_34.position.copy(endpoint_front_disc_34.midpoint);
    mesh_front_disc_34.quaternion.copy(endpoint_front_disc_34.quaternion);
  }
  mesh_front_disc_34.castShadow = options.castShadow ?? true;
  mesh_front_disc_34.receiveShadow = options.receiveShadow ?? true;
  mesh_front_disc_34.userData.sculptComponent = {"id": "front-disc", "name": "Front wave brake disc", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Thin flat rotor; very short cylinder along the axle.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-hub", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-disc-ring", "kind": "gloss", "description": "Bright machined friction ring on the wave disc."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.25, -0.0, -0.731], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "front-hub", "parentSocket": "front-hub-mount", "localStart": [-0.0, 0.085, 0.0], "localEnd": [-0.0, 0.081, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.13, "endRadius": 0.13}, "actionProfile": {"animationRole": "wheel-spin", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_front_disc_34.add(mesh_front_disc_34);
  meshes["front-disc"] = mesh_front_disc_34;
  colliders["front-disc"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_front_disc_34);

  const attachment_fork_lower_l_35 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.095, 0.2233, 0.7446], "localEnd": [0.095, 0.5529, 0.5766], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.03, "endRadius": 0.029};
  const endpoint_fork_lower_l_35 = makeAttachmentEndpoint(attachment_fork_lower_l_35);
  const node_fork_lower_l_35 = new THREE.Group();
  node_fork_lower_l_35.name = "Fork lower leg L__pivot";
  node_fork_lower_l_35.scale.set(1, 1, 1);
  if (endpoint_fork_lower_l_35) {
    node_fork_lower_l_35.position.copy(endpoint_fork_lower_l_35.start);
    node_fork_lower_l_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fork_lower_l_35.position.set(0.0, 0.0, 0.0);
    node_fork_lower_l_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_fork_lower_l_35.userData.sculptComponent = {"id": "fork-lower-l", "name": "Fork lower leg L", "level": "meso", "role": "fork", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight aluminium slider; cylinder on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.095, 0.2233, 0.7446], "localEnd": [0.095, 0.5529, 0.5766], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.03, "endRadius": 0.029}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_fork_lower_l_35.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_fork_lower_l_35);
  nodes["fork-lower-l"] = node_fork_lower_l_35;
  const mesh_fork_lower_l_35Geometry = endpoint_fork_lower_l_35
    ? new THREE.CylinderGeometry(endpoint_fork_lower_l_35.endRadius, endpoint_fork_lower_l_35.baseRadius, endpoint_fork_lower_l_35.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_fork_lower_l_35) {
    mesh_fork_lower_l_35Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fork_lower_l_35 = new THREE.Mesh(
    mesh_fork_lower_l_35Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_lower_l_35.name = "Fork lower leg L";
  if (endpoint_fork_lower_l_35) {
    mesh_fork_lower_l_35.position.copy(endpoint_fork_lower_l_35.midpoint);
    mesh_fork_lower_l_35.quaternion.copy(endpoint_fork_lower_l_35.quaternion);
  }
  mesh_fork_lower_l_35.castShadow = options.castShadow ?? true;
  mesh_fork_lower_l_35.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_lower_l_35.userData.sculptComponent = {"id": "fork-lower-l", "name": "Fork lower leg L", "level": "meso", "role": "fork", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight aluminium slider; cylinder on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.095, 0.2233, 0.7446], "localEnd": [0.095, 0.5529, 0.5766], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.03, "endRadius": 0.029}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_fork_lower_l_35.add(mesh_fork_lower_l_35);
  meshes["fork-lower-l"] = mesh_fork_lower_l_35;
  colliders["fork-lower-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_fork_lower_l_35);

  const attachment_fork_upper_l_36 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.095, 0.5351, 0.5857], "localEnd": [0.095, 1.0786, 0.3088], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.022};
  const endpoint_fork_upper_l_36 = makeAttachmentEndpoint(attachment_fork_upper_l_36);
  const node_fork_upper_l_36 = new THREE.Group();
  node_fork_upper_l_36.name = "Fork stanchion (gold) L__pivot";
  node_fork_upper_l_36.scale.set(1, 1, 1);
  if (endpoint_fork_upper_l_36) {
    node_fork_upper_l_36.position.copy(endpoint_fork_upper_l_36.start);
    node_fork_upper_l_36.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fork_upper_l_36.position.set(0.0, 0.0, 0.0);
    node_fork_upper_l_36.rotation.set(0.0, 0.0, 0.0);
  }
  node_fork_upper_l_36.userData.sculptComponent = {"id": "fork-upper-l", "name": "Fork stanchion (gold) L", "level": "meso", "role": "fork", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight fork tube; cylinder on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "gold-anodized", "materialLayers": ["gold-anodized"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-stanchion-l", "kind": "gloss", "description": "Gold anodized stanchion with a bright vertical highlight."}], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 154, 58, 1.0)", "secondaryAlbedo": "rgba(219, 178, 56, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for gold-anodized)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.095, 0.5351, 0.5857], "localEnd": [0.095, 1.0786, 0.3088], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.022}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gold-anodized"}}, "materialRegions": [{"regionId": "gold-tube", "materialId": "gold-anodized", "profileId": "metal.gold", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/04-gold-tube.png", "bbox": {"x": 868, "y": 215, "width": 14, "height": 70}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0009}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "gold-anodized"}};
  node_fork_upper_l_36.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gold-anodized"}};
  (nodes["root"] ?? root).add(node_fork_upper_l_36);
  nodes["fork-upper-l"] = node_fork_upper_l_36;
  const mesh_fork_upper_l_36Geometry = endpoint_fork_upper_l_36
    ? new THREE.CylinderGeometry(endpoint_fork_upper_l_36.endRadius, endpoint_fork_upper_l_36.baseRadius, endpoint_fork_upper_l_36.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_fork_upper_l_36) {
    mesh_fork_upper_l_36Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fork_upper_l_36 = new THREE.Mesh(
    mesh_fork_upper_l_36Geometry,
    materialMap["gold-anodized"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_upper_l_36.name = "Fork stanchion (gold) L";
  if (endpoint_fork_upper_l_36) {
    mesh_fork_upper_l_36.position.copy(endpoint_fork_upper_l_36.midpoint);
    mesh_fork_upper_l_36.quaternion.copy(endpoint_fork_upper_l_36.quaternion);
  }
  mesh_fork_upper_l_36.castShadow = options.castShadow ?? true;
  mesh_fork_upper_l_36.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_upper_l_36.userData.sculptComponent = {"id": "fork-upper-l", "name": "Fork stanchion (gold) L", "level": "meso", "role": "fork", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight fork tube; cylinder on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "gold-anodized", "materialLayers": ["gold-anodized"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-stanchion-l", "kind": "gloss", "description": "Gold anodized stanchion with a bright vertical highlight."}], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 154, 58, 1.0)", "secondaryAlbedo": "rgba(219, 178, 56, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for gold-anodized)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.095, 0.5351, 0.5857], "localEnd": [0.095, 1.0786, 0.3088], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.022}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gold-anodized"}}, "materialRegions": [{"regionId": "gold-tube", "materialId": "gold-anodized", "profileId": "metal.gold", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/04-gold-tube.png", "bbox": {"x": 868, "y": 215, "width": 14, "height": 70}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0009}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "gold-anodized"}};
  node_fork_upper_l_36.add(mesh_fork_upper_l_36);
  meshes["fork-upper-l"] = mesh_fork_upper_l_36;
  colliders["fork-upper-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_fork_upper_l_36);

  const endpoint_fork_guard_l_37 = makeAttachmentEndpoint(null);
  const node_fork_guard_l_37 = new THREE.Group();
  node_fork_guard_l_37.name = "Fork guard L__pivot";
  node_fork_guard_l_37.scale.set(1, 1, 1);
  if (endpoint_fork_guard_l_37) {
    node_fork_guard_l_37.position.copy(endpoint_fork_guard_l_37.start);
    node_fork_guard_l_37.rotation.set(-0.4712, 0.0, -0.0);
  } else {
    node_fork_guard_l_37.position.set(0.0998, 0.4151, 0.6806);
    node_fork_guard_l_37.rotation.set(-0.4712, 0.0, -0.0);
  }
  node_fork_guard_l_37.userData.sculptComponent = {"id": "fork-guard-l", "name": "Fork guard L", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plastic guard plate clipped to the slider front.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.26, "depth": 0.03, "units": "m", "confidence": 0.6}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fork-guard-logo-l", "kind": "decal", "description": "White guard with red 'VENT' lettering."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [0.0998, 0.4151, 0.6806], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0998, 0.4151, 0.6806], "localEnd": [0.0998, 0.4151, 0.6806], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_fork_guard_l_37.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_fork_guard_l_37);
  nodes["fork-guard-l"] = node_fork_guard_l_37;
  const mesh_fork_guard_l_37Geometry = endpoint_fork_guard_l_37
    ? new THREE.CylinderGeometry(endpoint_fork_guard_l_37.endRadius, endpoint_fork_guard_l_37.baseRadius, endpoint_fork_guard_l_37.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_fork_guard_l_37) {
    mesh_fork_guard_l_37Geometry.scale(0.035, 0.26, 0.03);
  }
  const mesh_fork_guard_l_37 = new THREE.Mesh(
    mesh_fork_guard_l_37Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_guard_l_37.name = "Fork guard L";
  if (endpoint_fork_guard_l_37) {
    mesh_fork_guard_l_37.position.copy(endpoint_fork_guard_l_37.midpoint);
    mesh_fork_guard_l_37.quaternion.copy(endpoint_fork_guard_l_37.quaternion);
  }
  mesh_fork_guard_l_37.castShadow = options.castShadow ?? true;
  mesh_fork_guard_l_37.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_guard_l_37.userData.sculptComponent = {"id": "fork-guard-l", "name": "Fork guard L", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plastic guard plate clipped to the slider front.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.26, "depth": 0.03, "units": "m", "confidence": 0.6}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fork-guard-logo-l", "kind": "decal", "description": "White guard with red 'VENT' lettering."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [0.0998, 0.4151, 0.6806], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0998, 0.4151, 0.6806], "localEnd": [0.0998, 0.4151, 0.6806], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_fork_guard_l_37.add(mesh_fork_guard_l_37);
  meshes["fork-guard-l"] = mesh_fork_guard_l_37;
  colliders["fork-guard-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_fork_guard_l_37);

  const endpoint_fork_guard_stripe_l_38 = makeAttachmentEndpoint(null);
  const node_fork_guard_stripe_l_38 = new THREE.Group();
  node_fork_guard_stripe_l_38.name = "Fork guard red stripe L__pivot";
  node_fork_guard_stripe_l_38.scale.set(1, 1, 1);
  if (endpoint_fork_guard_stripe_l_38) {
    node_fork_guard_stripe_l_38.position.copy(endpoint_fork_guard_stripe_l_38.start);
    node_fork_guard_stripe_l_38.rotation.set(-0.4712, 0.0, -0.0);
  } else {
    node_fork_guard_stripe_l_38.position.set(0.0998, 0.4228, 0.6957);
    node_fork_guard_stripe_l_38.rotation.set(-0.4712, 0.0, -0.0);
  }
  node_fork_guard_stripe_l_38.userData.sculptComponent = {"id": "fork-guard-stripe-l", "name": "Fork guard red stripe L", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Red logo band on the fork guard; thin plate.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.02, "height": 0.18, "depth": 0.004, "units": "m", "confidence": 0.5}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.0998, 0.4228, 0.6957], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0998, 0.4228, 0.6957], "localEnd": [0.0998, 0.4228, 0.6957], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_fork_guard_stripe_l_38.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}};
  (nodes["root"] ?? root).add(node_fork_guard_stripe_l_38);
  nodes["fork-guard-stripe-l"] = node_fork_guard_stripe_l_38;
  const mesh_fork_guard_stripe_l_38Geometry = endpoint_fork_guard_stripe_l_38
    ? new THREE.CylinderGeometry(endpoint_fork_guard_stripe_l_38.endRadius, endpoint_fork_guard_stripe_l_38.baseRadius, endpoint_fork_guard_stripe_l_38.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_fork_guard_stripe_l_38) {
    mesh_fork_guard_stripe_l_38Geometry.scale(0.02, 0.18, 0.004);
  }
  const mesh_fork_guard_stripe_l_38 = new THREE.Mesh(
    mesh_fork_guard_stripe_l_38Geometry,
    materialMap["red-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_guard_stripe_l_38.name = "Fork guard red stripe L";
  if (endpoint_fork_guard_stripe_l_38) {
    mesh_fork_guard_stripe_l_38.position.copy(endpoint_fork_guard_stripe_l_38.midpoint);
    mesh_fork_guard_stripe_l_38.quaternion.copy(endpoint_fork_guard_stripe_l_38.quaternion);
  }
  mesh_fork_guard_stripe_l_38.castShadow = options.castShadow ?? true;
  mesh_fork_guard_stripe_l_38.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_guard_stripe_l_38.userData.sculptComponent = {"id": "fork-guard-stripe-l", "name": "Fork guard red stripe L", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Red logo band on the fork guard; thin plate.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.02, "height": 0.18, "depth": 0.004, "units": "m", "confidence": 0.5}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.0998, 0.4228, 0.6957], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0998, 0.4228, 0.6957], "localEnd": [0.0998, 0.4228, 0.6957], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_fork_guard_stripe_l_38.add(mesh_fork_guard_stripe_l_38);
  meshes["fork-guard-stripe-l"] = mesh_fork_guard_stripe_l_38;
  colliders["fork-guard-stripe-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_fork_guard_stripe_l_38);

  const attachment_fork_lower_r_39 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.095, 0.2233, 0.7446], "localEnd": [-0.095, 0.5529, 0.5766], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.03, "endRadius": 0.029};
  const endpoint_fork_lower_r_39 = makeAttachmentEndpoint(attachment_fork_lower_r_39);
  const node_fork_lower_r_39 = new THREE.Group();
  node_fork_lower_r_39.name = "Fork lower leg R__pivot";
  node_fork_lower_r_39.scale.set(1, 1, 1);
  if (endpoint_fork_lower_r_39) {
    node_fork_lower_r_39.position.copy(endpoint_fork_lower_r_39.start);
    node_fork_lower_r_39.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fork_lower_r_39.position.set(0.0, 0.0, 0.0);
    node_fork_lower_r_39.rotation.set(0.0, 0.0, 0.0);
  }
  node_fork_lower_r_39.userData.sculptComponent = {"id": "fork-lower-r", "name": "Fork lower leg R", "level": "meso", "role": "fork", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight aluminium slider; cylinder on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.095, 0.2233, 0.7446], "localEnd": [-0.095, 0.5529, 0.5766], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.03, "endRadius": 0.029}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_fork_lower_r_39.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_fork_lower_r_39);
  nodes["fork-lower-r"] = node_fork_lower_r_39;
  const mesh_fork_lower_r_39Geometry = endpoint_fork_lower_r_39
    ? new THREE.CylinderGeometry(endpoint_fork_lower_r_39.endRadius, endpoint_fork_lower_r_39.baseRadius, endpoint_fork_lower_r_39.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_fork_lower_r_39) {
    mesh_fork_lower_r_39Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fork_lower_r_39 = new THREE.Mesh(
    mesh_fork_lower_r_39Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_lower_r_39.name = "Fork lower leg R";
  if (endpoint_fork_lower_r_39) {
    mesh_fork_lower_r_39.position.copy(endpoint_fork_lower_r_39.midpoint);
    mesh_fork_lower_r_39.quaternion.copy(endpoint_fork_lower_r_39.quaternion);
  }
  mesh_fork_lower_r_39.castShadow = options.castShadow ?? true;
  mesh_fork_lower_r_39.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_lower_r_39.userData.sculptComponent = {"id": "fork-lower-r", "name": "Fork lower leg R", "level": "meso", "role": "fork", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight aluminium slider; cylinder on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.095, 0.2233, 0.7446], "localEnd": [-0.095, 0.5529, 0.5766], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.03, "endRadius": 0.029}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_fork_lower_r_39.add(mesh_fork_lower_r_39);
  meshes["fork-lower-r"] = mesh_fork_lower_r_39;
  colliders["fork-lower-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_fork_lower_r_39);

  const attachment_fork_upper_r_40 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.095, 0.5351, 0.5857], "localEnd": [-0.095, 1.0786, 0.3088], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.022};
  const endpoint_fork_upper_r_40 = makeAttachmentEndpoint(attachment_fork_upper_r_40);
  const node_fork_upper_r_40 = new THREE.Group();
  node_fork_upper_r_40.name = "Fork stanchion (gold) R__pivot";
  node_fork_upper_r_40.scale.set(1, 1, 1);
  if (endpoint_fork_upper_r_40) {
    node_fork_upper_r_40.position.copy(endpoint_fork_upper_r_40.start);
    node_fork_upper_r_40.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fork_upper_r_40.position.set(0.0, 0.0, 0.0);
    node_fork_upper_r_40.rotation.set(0.0, 0.0, 0.0);
  }
  node_fork_upper_r_40.userData.sculptComponent = {"id": "fork-upper-r", "name": "Fork stanchion (gold) R", "level": "meso", "role": "fork", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight fork tube; cylinder on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "gold-anodized", "materialLayers": ["gold-anodized"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-stanchion-r", "kind": "gloss", "description": "Gold anodized stanchion with a bright vertical highlight."}], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 154, 58, 1.0)", "secondaryAlbedo": "rgba(219, 178, 56, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for gold-anodized)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.095, 0.5351, 0.5857], "localEnd": [-0.095, 1.0786, 0.3088], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.022}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gold-anodized"}}};
  node_fork_upper_r_40.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gold-anodized"}};
  (nodes["root"] ?? root).add(node_fork_upper_r_40);
  nodes["fork-upper-r"] = node_fork_upper_r_40;
  const mesh_fork_upper_r_40Geometry = endpoint_fork_upper_r_40
    ? new THREE.CylinderGeometry(endpoint_fork_upper_r_40.endRadius, endpoint_fork_upper_r_40.baseRadius, endpoint_fork_upper_r_40.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_fork_upper_r_40) {
    mesh_fork_upper_r_40Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fork_upper_r_40 = new THREE.Mesh(
    mesh_fork_upper_r_40Geometry,
    materialMap["gold-anodized"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_upper_r_40.name = "Fork stanchion (gold) R";
  if (endpoint_fork_upper_r_40) {
    mesh_fork_upper_r_40.position.copy(endpoint_fork_upper_r_40.midpoint);
    mesh_fork_upper_r_40.quaternion.copy(endpoint_fork_upper_r_40.quaternion);
  }
  mesh_fork_upper_r_40.castShadow = options.castShadow ?? true;
  mesh_fork_upper_r_40.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_upper_r_40.userData.sculptComponent = {"id": "fork-upper-r", "name": "Fork stanchion (gold) R", "level": "meso", "role": "fork", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Straight fork tube; cylinder on the rake axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "gold-anodized", "materialLayers": ["gold-anodized"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-stanchion-r", "kind": "gloss", "description": "Gold anodized stanchion with a bright vertical highlight."}], "surfaceDetail": {"macroRoughness": 0.25, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 154, 58, 1.0)", "secondaryAlbedo": "rgba(219, 178, 56, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for gold-anodized)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.095, 0.5351, 0.5857], "localEnd": [-0.095, 1.0786, 0.3088], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.022, "endRadius": 0.022}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "gold-anodized"}}};
  node_fork_upper_r_40.add(mesh_fork_upper_r_40);
  meshes["fork-upper-r"] = mesh_fork_upper_r_40;
  colliders["fork-upper-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_fork_upper_r_40);

  const endpoint_fork_guard_r_41 = makeAttachmentEndpoint(null);
  const node_fork_guard_r_41 = new THREE.Group();
  node_fork_guard_r_41.name = "Fork guard R__pivot";
  node_fork_guard_r_41.scale.set(1, 1, 1);
  if (endpoint_fork_guard_r_41) {
    node_fork_guard_r_41.position.copy(endpoint_fork_guard_r_41.start);
    node_fork_guard_r_41.rotation.set(-0.4712, 0.0, -0.0);
  } else {
    node_fork_guard_r_41.position.set(-0.0998, 0.4151, 0.6806);
    node_fork_guard_r_41.rotation.set(-0.4712, 0.0, -0.0);
  }
  node_fork_guard_r_41.userData.sculptComponent = {"id": "fork-guard-r", "name": "Fork guard R", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plastic guard plate clipped to the slider front.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.26, "depth": 0.03, "units": "m", "confidence": 0.6}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fork-guard-logo-r", "kind": "decal", "description": "White guard with red 'VENT' lettering."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.0998, 0.4151, 0.6806], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.0998, 0.4151, 0.6806], "localEnd": [-0.0998, 0.4151, 0.6806], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_fork_guard_r_41.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_fork_guard_r_41);
  nodes["fork-guard-r"] = node_fork_guard_r_41;
  const mesh_fork_guard_r_41Geometry = endpoint_fork_guard_r_41
    ? new THREE.CylinderGeometry(endpoint_fork_guard_r_41.endRadius, endpoint_fork_guard_r_41.baseRadius, endpoint_fork_guard_r_41.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_fork_guard_r_41) {
    mesh_fork_guard_r_41Geometry.scale(0.035, 0.26, 0.03);
  }
  const mesh_fork_guard_r_41 = new THREE.Mesh(
    mesh_fork_guard_r_41Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_guard_r_41.name = "Fork guard R";
  if (endpoint_fork_guard_r_41) {
    mesh_fork_guard_r_41.position.copy(endpoint_fork_guard_r_41.midpoint);
    mesh_fork_guard_r_41.quaternion.copy(endpoint_fork_guard_r_41.quaternion);
  }
  mesh_fork_guard_r_41.castShadow = options.castShadow ?? true;
  mesh_fork_guard_r_41.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_guard_r_41.userData.sculptComponent = {"id": "fork-guard-r", "name": "Fork guard R", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Plastic guard plate clipped to the slider front.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.26, "depth": 0.03, "units": "m", "confidence": 0.6}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fork-guard-logo-r", "kind": "decal", "description": "White guard with red 'VENT' lettering."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.0998, 0.4151, 0.6806], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.0998, 0.4151, 0.6806], "localEnd": [-0.0998, 0.4151, 0.6806], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_fork_guard_r_41.add(mesh_fork_guard_r_41);
  meshes["fork-guard-r"] = mesh_fork_guard_r_41;
  colliders["fork-guard-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_fork_guard_r_41);

  const endpoint_fork_guard_stripe_r_42 = makeAttachmentEndpoint(null);
  const node_fork_guard_stripe_r_42 = new THREE.Group();
  node_fork_guard_stripe_r_42.name = "Fork guard red stripe R__pivot";
  node_fork_guard_stripe_r_42.scale.set(1, 1, 1);
  if (endpoint_fork_guard_stripe_r_42) {
    node_fork_guard_stripe_r_42.position.copy(endpoint_fork_guard_stripe_r_42.start);
    node_fork_guard_stripe_r_42.rotation.set(-0.4712, 0.0, -0.0);
  } else {
    node_fork_guard_stripe_r_42.position.set(-0.0998, 0.4228, 0.6957);
    node_fork_guard_stripe_r_42.rotation.set(-0.4712, 0.0, -0.0);
  }
  node_fork_guard_stripe_r_42.userData.sculptComponent = {"id": "fork-guard-stripe-r", "name": "Fork guard red stripe R", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Red logo band on the fork guard; thin plate.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.02, "height": 0.18, "depth": 0.004, "units": "m", "confidence": 0.5}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [-0.0998, 0.4228, 0.6957], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.0998, 0.4228, 0.6957], "localEnd": [-0.0998, 0.4228, 0.6957], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_fork_guard_stripe_r_42.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}};
  (nodes["root"] ?? root).add(node_fork_guard_stripe_r_42);
  nodes["fork-guard-stripe-r"] = node_fork_guard_stripe_r_42;
  const mesh_fork_guard_stripe_r_42Geometry = endpoint_fork_guard_stripe_r_42
    ? new THREE.CylinderGeometry(endpoint_fork_guard_stripe_r_42.endRadius, endpoint_fork_guard_stripe_r_42.baseRadius, endpoint_fork_guard_stripe_r_42.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_fork_guard_stripe_r_42) {
    mesh_fork_guard_stripe_r_42Geometry.scale(0.02, 0.18, 0.004);
  }
  const mesh_fork_guard_stripe_r_42 = new THREE.Mesh(
    mesh_fork_guard_stripe_r_42Geometry,
    materialMap["red-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fork_guard_stripe_r_42.name = "Fork guard red stripe R";
  if (endpoint_fork_guard_stripe_r_42) {
    mesh_fork_guard_stripe_r_42.position.copy(endpoint_fork_guard_stripe_r_42.midpoint);
    mesh_fork_guard_stripe_r_42.quaternion.copy(endpoint_fork_guard_stripe_r_42.quaternion);
  }
  mesh_fork_guard_stripe_r_42.castShadow = options.castShadow ?? true;
  mesh_fork_guard_stripe_r_42.receiveShadow = options.receiveShadow ?? true;
  mesh_fork_guard_stripe_r_42.userData.sculptComponent = {"id": "fork-guard-stripe-r", "name": "Fork guard red stripe R", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Red logo band on the fork guard; thin plate.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.02, "height": 0.18, "depth": 0.004, "units": "m", "confidence": 0.5}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [-0.0998, 0.4228, 0.6957], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.0998, 0.4228, 0.6957], "localEnd": [-0.0998, 0.4228, 0.6957], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_fork_guard_stripe_r_42.add(mesh_fork_guard_stripe_r_42);
  meshes["fork-guard-stripe-r"] = mesh_fork_guard_stripe_r_42;
  colliders["fork-guard-stripe-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_fork_guard_stripe_r_42);

  const endpoint_clamp_lower_43 = makeAttachmentEndpoint(null);
  const node_clamp_lower_43 = new THREE.Group();
  node_clamp_lower_43.name = "Lower triple clamp__pivot";
  node_clamp_lower_43.scale.set(1, 1, 1);
  if (endpoint_clamp_lower_43) {
    node_clamp_lower_43.position.copy(endpoint_clamp_lower_43.start);
    node_clamp_lower_43.rotation.set(-0.4712, 0.0, -0.0);
  } else {
    node_clamp_lower_43.position.set(0.0, 0.8557, 0.3999);
    node_clamp_lower_43.rotation.set(-0.4712, 0.0, -0.0);
  }
  node_clamp_lower_43.userData.sculptComponent = {"id": "clamp-lower", "name": "Lower triple clamp", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Machined aluminium clamp; box perpendicular to the steering axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.25, "height": 0.035, "depth": 0.09, "units": "m", "confidence": 0.7}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.8557, 0.3999], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.8557, 0.3999], "localEnd": [0.0, 0.8557, 0.3999], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_clamp_lower_43.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_clamp_lower_43);
  nodes["clamp-lower"] = node_clamp_lower_43;
  const mesh_clamp_lower_43Geometry = endpoint_clamp_lower_43
    ? new THREE.CylinderGeometry(endpoint_clamp_lower_43.endRadius, endpoint_clamp_lower_43.baseRadius, endpoint_clamp_lower_43.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_clamp_lower_43) {
    mesh_clamp_lower_43Geometry.scale(0.25, 0.035, 0.09);
  }
  const mesh_clamp_lower_43 = new THREE.Mesh(
    mesh_clamp_lower_43Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_clamp_lower_43.name = "Lower triple clamp";
  if (endpoint_clamp_lower_43) {
    mesh_clamp_lower_43.position.copy(endpoint_clamp_lower_43.midpoint);
    mesh_clamp_lower_43.quaternion.copy(endpoint_clamp_lower_43.quaternion);
  }
  mesh_clamp_lower_43.castShadow = options.castShadow ?? true;
  mesh_clamp_lower_43.receiveShadow = options.receiveShadow ?? true;
  mesh_clamp_lower_43.userData.sculptComponent = {"id": "clamp-lower", "name": "Lower triple clamp", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Machined aluminium clamp; box perpendicular to the steering axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.25, "height": 0.035, "depth": 0.09, "units": "m", "confidence": 0.7}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.8557, 0.3999], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.8557, 0.3999], "localEnd": [0.0, 0.8557, 0.3999], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_clamp_lower_43.add(mesh_clamp_lower_43);
  meshes["clamp-lower"] = mesh_clamp_lower_43;
  colliders["clamp-lower"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_clamp_lower_43);

  const endpoint_clamp_upper_44 = makeAttachmentEndpoint(null);
  const node_clamp_upper_44 = new THREE.Group();
  node_clamp_upper_44.name = "Upper triple clamp__pivot";
  node_clamp_upper_44.scale.set(1, 1, 1);
  if (endpoint_clamp_upper_44) {
    node_clamp_upper_44.position.copy(endpoint_clamp_upper_44.start);
    node_clamp_upper_44.rotation.set(-0.4712, 0.0, -0.0);
  } else {
    node_clamp_upper_44.position.set(0.0, 1.0161, 0.3182);
    node_clamp_upper_44.rotation.set(-0.4712, 0.0, -0.0);
  }
  node_clamp_upper_44.userData.sculptComponent = {"id": "clamp-upper", "name": "Upper triple clamp", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Machined aluminium clamp; box perpendicular to the steering axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.25, "height": 0.035, "depth": 0.09, "units": "m", "confidence": 0.7}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 1.0161, 0.3182], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 1.0161, 0.3182], "localEnd": [0.0, 1.0161, 0.3182], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_clamp_upper_44.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_clamp_upper_44);
  nodes["clamp-upper"] = node_clamp_upper_44;
  const mesh_clamp_upper_44Geometry = endpoint_clamp_upper_44
    ? new THREE.CylinderGeometry(endpoint_clamp_upper_44.endRadius, endpoint_clamp_upper_44.baseRadius, endpoint_clamp_upper_44.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_clamp_upper_44) {
    mesh_clamp_upper_44Geometry.scale(0.25, 0.035, 0.09);
  }
  const mesh_clamp_upper_44 = new THREE.Mesh(
    mesh_clamp_upper_44Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_clamp_upper_44.name = "Upper triple clamp";
  if (endpoint_clamp_upper_44) {
    mesh_clamp_upper_44.position.copy(endpoint_clamp_upper_44.midpoint);
    mesh_clamp_upper_44.quaternion.copy(endpoint_clamp_upper_44.quaternion);
  }
  mesh_clamp_upper_44.castShadow = options.castShadow ?? true;
  mesh_clamp_upper_44.receiveShadow = options.receiveShadow ?? true;
  mesh_clamp_upper_44.userData.sculptComponent = {"id": "clamp-upper", "name": "Upper triple clamp", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Machined aluminium clamp; box perpendicular to the steering axis.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.25, "height": 0.035, "depth": 0.09, "units": "m", "confidence": 0.7}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 1.0161, 0.3182], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 1.0161, 0.3182], "localEnd": [0.0, 1.0161, 0.3182], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_clamp_upper_44.add(mesh_clamp_upper_44);
  meshes["clamp-upper"] = mesh_clamp_upper_44;
  colliders["clamp-upper"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_clamp_upper_44);

  const attachment_bar_riser_l_45 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.035, 1.0261, 0.3182], "localEnd": [0.035, 1.2393, 0.2706], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.014, "endRadius": 0.014};
  const endpoint_bar_riser_l_45 = makeAttachmentEndpoint(attachment_bar_riser_l_45);
  const node_bar_riser_l_45 = new THREE.Group();
  node_bar_riser_l_45.name = "Handlebar riser L__pivot";
  node_bar_riser_l_45.scale.set(1, 1, 1);
  if (endpoint_bar_riser_l_45) {
    node_bar_riser_l_45.position.copy(endpoint_bar_riser_l_45.start);
    node_bar_riser_l_45.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bar_riser_l_45.position.set(0.0, 0.0, 0.0);
    node_bar_riser_l_45.rotation.set(0.0, 0.0, 0.0);
  }
  node_bar_riser_l_45.userData.sculptComponent = {"id": "bar-riser-l", "name": "Handlebar riser L", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Machined bar-clamp riser between the upper clamp and the bar.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.035, 1.0261, 0.3182], "localEnd": [0.035, 1.2393, 0.2706], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.014, "endRadius": 0.014}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_bar_riser_l_45.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_bar_riser_l_45);
  nodes["bar-riser-l"] = node_bar_riser_l_45;
  const mesh_bar_riser_l_45Geometry = endpoint_bar_riser_l_45
    ? new THREE.CylinderGeometry(endpoint_bar_riser_l_45.endRadius, endpoint_bar_riser_l_45.baseRadius, endpoint_bar_riser_l_45.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_bar_riser_l_45) {
    mesh_bar_riser_l_45Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bar_riser_l_45 = new THREE.Mesh(
    mesh_bar_riser_l_45Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bar_riser_l_45.name = "Handlebar riser L";
  if (endpoint_bar_riser_l_45) {
    mesh_bar_riser_l_45.position.copy(endpoint_bar_riser_l_45.midpoint);
    mesh_bar_riser_l_45.quaternion.copy(endpoint_bar_riser_l_45.quaternion);
  }
  mesh_bar_riser_l_45.castShadow = options.castShadow ?? true;
  mesh_bar_riser_l_45.receiveShadow = options.receiveShadow ?? true;
  mesh_bar_riser_l_45.userData.sculptComponent = {"id": "bar-riser-l", "name": "Handlebar riser L", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Machined bar-clamp riser between the upper clamp and the bar.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.035, 1.0261, 0.3182], "localEnd": [0.035, 1.2393, 0.2706], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.014, "endRadius": 0.014}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_bar_riser_l_45.add(mesh_bar_riser_l_45);
  meshes["bar-riser-l"] = mesh_bar_riser_l_45;
  colliders["bar-riser-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_bar_riser_l_45);

  const attachment_bar_riser_r_46 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.035, 1.0261, 0.3182], "localEnd": [-0.035, 1.2393, 0.2706], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.014, "endRadius": 0.014};
  const endpoint_bar_riser_r_46 = makeAttachmentEndpoint(attachment_bar_riser_r_46);
  const node_bar_riser_r_46 = new THREE.Group();
  node_bar_riser_r_46.name = "Handlebar riser R__pivot";
  node_bar_riser_r_46.scale.set(1, 1, 1);
  if (endpoint_bar_riser_r_46) {
    node_bar_riser_r_46.position.copy(endpoint_bar_riser_r_46.start);
    node_bar_riser_r_46.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bar_riser_r_46.position.set(0.0, 0.0, 0.0);
    node_bar_riser_r_46.rotation.set(0.0, 0.0, 0.0);
  }
  node_bar_riser_r_46.userData.sculptComponent = {"id": "bar-riser-r", "name": "Handlebar riser R", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Machined bar-clamp riser between the upper clamp and the bar.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.035, 1.0261, 0.3182], "localEnd": [-0.035, 1.2393, 0.2706], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.014, "endRadius": 0.014}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_bar_riser_r_46.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_bar_riser_r_46);
  nodes["bar-riser-r"] = node_bar_riser_r_46;
  const mesh_bar_riser_r_46Geometry = endpoint_bar_riser_r_46
    ? new THREE.CylinderGeometry(endpoint_bar_riser_r_46.endRadius, endpoint_bar_riser_r_46.baseRadius, endpoint_bar_riser_r_46.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_bar_riser_r_46) {
    mesh_bar_riser_r_46Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bar_riser_r_46 = new THREE.Mesh(
    mesh_bar_riser_r_46Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bar_riser_r_46.name = "Handlebar riser R";
  if (endpoint_bar_riser_r_46) {
    mesh_bar_riser_r_46.position.copy(endpoint_bar_riser_r_46.midpoint);
    mesh_bar_riser_r_46.quaternion.copy(endpoint_bar_riser_r_46.quaternion);
  }
  mesh_bar_riser_r_46.castShadow = options.castShadow ?? true;
  mesh_bar_riser_r_46.receiveShadow = options.receiveShadow ?? true;
  mesh_bar_riser_r_46.userData.sculptComponent = {"id": "bar-riser-r", "name": "Handlebar riser R", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Machined bar-clamp riser between the upper clamp and the bar.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.035, 1.0261, 0.3182], "localEnd": [-0.035, 1.2393, 0.2706], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.014, "endRadius": 0.014}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_bar_riser_r_46.add(mesh_bar_riser_r_46);
  meshes["bar-riser-r"] = mesh_bar_riser_r_46;
  colliders["bar-riser-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_bar_riser_r_46);

  const attachment_handlebar_47 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]};
  const endpoint_handlebar_47 = makeAttachmentEndpoint(attachment_handlebar_47);
  const node_handlebar_47 = new THREE.Group();
  node_handlebar_47.name = "Handlebar__pivot";
  node_handlebar_47.scale.set(1, 1, 1);
  if (endpoint_handlebar_47) {
    node_handlebar_47.position.copy(endpoint_handlebar_47.start);
    node_handlebar_47.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_handlebar_47.position.set(0.0, 0.0, 0.0);
    node_handlebar_47.rotation.set(-0.0, 0.0, -0.0);
  }
  node_handlebar_47.userData.sculptComponent = {"id": "handlebar", "name": "Handlebar", "level": "meso", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Bent tapered bar; swept tube through measured bend points.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[-0.39, 1.2842763284627168, 0.2106292152526396], [-0.26, 1.2692763284627167, 0.2406292152526396], [-0.12, 1.2442763284627167, 0.2706292152526396], [0.0, 1.2392763284627168, 0.2756292152526396], [0.12, 1.2442763284627167, 0.2706292152526396], [0.26, 1.2692763284627167, 0.2406292152526396], [0.39, 1.2842763284627168, 0.2106292152526396]], "radius": 0.012, "radialSegments": 10}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_handlebar_47.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_handlebar_47);
  nodes["handlebar"] = node_handlebar_47;
  const mesh_handlebar_47Geometry = endpoint_handlebar_47
    ? new THREE.CylinderGeometry(endpoint_handlebar_47.endRadius, endpoint_handlebar_47.baseRadius, endpoint_handlebar_47.length, 16, 6)
    : buildTubeGeometry({"points": [[-0.39, 1.2842763284627168, 0.2106292152526396], [-0.26, 1.2692763284627167, 0.2406292152526396], [-0.12, 1.2442763284627167, 0.2706292152526396], [0.0, 1.2392763284627168, 0.2756292152526396], [0.12, 1.2442763284627167, 0.2706292152526396], [0.26, 1.2692763284627167, 0.2406292152526396], [0.39, 1.2842763284627168, 0.2106292152526396]], "radius": 0.012, "radialSegments": 10});
  if (!endpoint_handlebar_47) {
    mesh_handlebar_47Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_handlebar_47 = new THREE.Mesh(
    mesh_handlebar_47Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handlebar_47.name = "Handlebar";
  if (endpoint_handlebar_47) {
    mesh_handlebar_47.position.copy(endpoint_handlebar_47.midpoint);
    mesh_handlebar_47.quaternion.copy(endpoint_handlebar_47.quaternion);
  }
  mesh_handlebar_47.castShadow = options.castShadow ?? true;
  mesh_handlebar_47.receiveShadow = options.receiveShadow ?? true;
  mesh_handlebar_47.userData.sculptComponent = {"id": "handlebar", "name": "Handlebar", "level": "meso", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Bent tapered bar; swept tube through measured bend points.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[-0.39, 1.2842763284627168, 0.2106292152526396], [-0.26, 1.2692763284627167, 0.2406292152526396], [-0.12, 1.2442763284627167, 0.2706292152526396], [0.0, 1.2392763284627168, 0.2756292152526396], [0.12, 1.2442763284627167, 0.2706292152526396], [0.26, 1.2692763284627167, 0.2406292152526396], [0.39, 1.2842763284627168, 0.2106292152526396]], "radius": 0.012, "radialSegments": 10}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_handlebar_47.add(mesh_handlebar_47);
  meshes["handlebar"] = mesh_handlebar_47;
  colliders["handlebar"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_handlebar_47);

  const attachment_grip_l_48 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.27, 1.2723, 0.2356], "localEnd": [0.4, 1.2853, 0.2086], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.017, "endRadius": 0.018};
  const endpoint_grip_l_48 = makeAttachmentEndpoint(attachment_grip_l_48);
  const node_grip_l_48 = new THREE.Group();
  node_grip_l_48.name = "Grip L__pivot";
  node_grip_l_48.scale.set(1, 1, 1);
  if (endpoint_grip_l_48) {
    node_grip_l_48.position.copy(endpoint_grip_l_48.start);
    node_grip_l_48.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_grip_l_48.position.set(0.0, 0.0, 0.0);
    node_grip_l_48.rotation.set(0.0, 0.0, 0.0);
  }
  node_grip_l_48.userData.sculptComponent = {"id": "grip-l", "name": "Grip L", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Rubber grip sleeve.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "seat-vinyl", "materialLayers": ["seat-vinyl"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(56, 57, 57, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for seat-vinyl)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.27, 1.2723, 0.2356], "localEnd": [0.4, 1.2853, 0.2086], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.017, "endRadius": 0.018}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "seat-vinyl"}}};
  node_grip_l_48.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "seat-vinyl"}};
  (nodes["root"] ?? root).add(node_grip_l_48);
  nodes["grip-l"] = node_grip_l_48;
  const mesh_grip_l_48Geometry = endpoint_grip_l_48
    ? new THREE.CylinderGeometry(endpoint_grip_l_48.endRadius, endpoint_grip_l_48.baseRadius, endpoint_grip_l_48.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_grip_l_48) {
    mesh_grip_l_48Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_grip_l_48 = new THREE.Mesh(
    mesh_grip_l_48Geometry,
    materialMap["seat-vinyl"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grip_l_48.name = "Grip L";
  if (endpoint_grip_l_48) {
    mesh_grip_l_48.position.copy(endpoint_grip_l_48.midpoint);
    mesh_grip_l_48.quaternion.copy(endpoint_grip_l_48.quaternion);
  }
  mesh_grip_l_48.castShadow = options.castShadow ?? true;
  mesh_grip_l_48.receiveShadow = options.receiveShadow ?? true;
  mesh_grip_l_48.userData.sculptComponent = {"id": "grip-l", "name": "Grip L", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Rubber grip sleeve.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "seat-vinyl", "materialLayers": ["seat-vinyl"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(56, 57, 57, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for seat-vinyl)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.27, 1.2723, 0.2356], "localEnd": [0.4, 1.2853, 0.2086], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.017, "endRadius": 0.018}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "seat-vinyl"}}};
  node_grip_l_48.add(mesh_grip_l_48);
  meshes["grip-l"] = mesh_grip_l_48;
  colliders["grip-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_grip_l_48);

  const endpoint_lever_l_49 = makeAttachmentEndpoint(null);
  const node_lever_l_49 = new THREE.Group();
  node_lever_l_49.name = "Clutch lever L__pivot";
  node_lever_l_49.scale.set(1, 1, 1);
  if (endpoint_lever_l_49) {
    node_lever_l_49.position.copy(endpoint_lever_l_49.start);
    node_lever_l_49.rotation.set(-0.0, 0.25, -0.0);
  } else {
    node_lever_l_49.position.set(0.28, 1.2443, 0.3406);
    node_lever_l_49.rotation.set(-0.0, 0.25, -0.0);
  }
  node_lever_l_49.userData.sculptComponent = {"id": "lever-l", "name": "Clutch lever L", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat forged lever blade.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.16, "height": 0.012, "depth": 0.02, "units": "m", "confidence": 0.5}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.28, 1.2443, 0.3406], "rotation": [-0.0, 0.25, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.28, 1.2443, 0.3406], "localEnd": [0.28, 1.2443, 0.3406], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_lever_l_49.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_lever_l_49);
  nodes["lever-l"] = node_lever_l_49;
  const mesh_lever_l_49Geometry = endpoint_lever_l_49
    ? new THREE.CylinderGeometry(endpoint_lever_l_49.endRadius, endpoint_lever_l_49.baseRadius, endpoint_lever_l_49.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_lever_l_49) {
    mesh_lever_l_49Geometry.scale(0.16, 0.012, 0.02);
  }
  const mesh_lever_l_49 = new THREE.Mesh(
    mesh_lever_l_49Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lever_l_49.name = "Clutch lever L";
  if (endpoint_lever_l_49) {
    mesh_lever_l_49.position.copy(endpoint_lever_l_49.midpoint);
    mesh_lever_l_49.quaternion.copy(endpoint_lever_l_49.quaternion);
  }
  mesh_lever_l_49.castShadow = options.castShadow ?? true;
  mesh_lever_l_49.receiveShadow = options.receiveShadow ?? true;
  mesh_lever_l_49.userData.sculptComponent = {"id": "lever-l", "name": "Clutch lever L", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat forged lever blade.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.16, "height": 0.012, "depth": 0.02, "units": "m", "confidence": 0.5}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.28, 1.2443, 0.3406], "rotation": [-0.0, 0.25, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.28, 1.2443, 0.3406], "localEnd": [0.28, 1.2443, 0.3406], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_lever_l_49.add(mesh_lever_l_49);
  meshes["lever-l"] = mesh_lever_l_49;
  colliders["lever-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_lever_l_49);

  const endpoint_lever_perch_l_50 = makeAttachmentEndpoint(null);
  const node_lever_perch_l_50 = new THREE.Group();
  node_lever_perch_l_50.name = "Lever perch L__pivot";
  node_lever_perch_l_50.scale.set(1, 1, 1);
  if (endpoint_lever_perch_l_50) {
    node_lever_perch_l_50.position.copy(endpoint_lever_perch_l_50.start);
    node_lever_perch_l_50.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_lever_perch_l_50.position.set(0.22, 1.2643, 0.2606);
    node_lever_perch_l_50.rotation.set(-0.0, 0.0, -0.0);
  }
  node_lever_perch_l_50.userData.sculptComponent = {"id": "lever-perch-l", "name": "Lever perch L", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Lever clamp block (red switch on the left in the photo).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.035, "depth": 0.04, "units": "m", "confidence": 0.5}, "material": "reflector-red", "materialLayers": ["reflector-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.2, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 15, 26, 1.0)", "secondaryAlbedo": "rgba(87, 7, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for reflector-red)"}, "transform": {"position": [0.22, 1.2643, 0.2606], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.22, 1.2643, 0.2606], "localEnd": [0.22, 1.2643, 0.2606], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}}};
  node_lever_perch_l_50.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}};
  (nodes["root"] ?? root).add(node_lever_perch_l_50);
  nodes["lever-perch-l"] = node_lever_perch_l_50;
  const mesh_lever_perch_l_50Geometry = endpoint_lever_perch_l_50
    ? new THREE.CylinderGeometry(endpoint_lever_perch_l_50.endRadius, endpoint_lever_perch_l_50.baseRadius, endpoint_lever_perch_l_50.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_lever_perch_l_50) {
    mesh_lever_perch_l_50Geometry.scale(0.035, 0.035, 0.04);
  }
  const mesh_lever_perch_l_50 = new THREE.Mesh(
    mesh_lever_perch_l_50Geometry,
    materialMap["reflector-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lever_perch_l_50.name = "Lever perch L";
  if (endpoint_lever_perch_l_50) {
    mesh_lever_perch_l_50.position.copy(endpoint_lever_perch_l_50.midpoint);
    mesh_lever_perch_l_50.quaternion.copy(endpoint_lever_perch_l_50.quaternion);
  }
  mesh_lever_perch_l_50.castShadow = options.castShadow ?? true;
  mesh_lever_perch_l_50.receiveShadow = options.receiveShadow ?? true;
  mesh_lever_perch_l_50.userData.sculptComponent = {"id": "lever-perch-l", "name": "Lever perch L", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Lever clamp block (red switch on the left in the photo).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.035, "depth": 0.04, "units": "m", "confidence": 0.5}, "material": "reflector-red", "materialLayers": ["reflector-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.2, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 15, 26, 1.0)", "secondaryAlbedo": "rgba(87, 7, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for reflector-red)"}, "transform": {"position": [0.22, 1.2643, 0.2606], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.22, 1.2643, 0.2606], "localEnd": [0.22, 1.2643, 0.2606], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}}};
  node_lever_perch_l_50.add(mesh_lever_perch_l_50);
  meshes["lever-perch-l"] = mesh_lever_perch_l_50;
  colliders["lever-perch-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_lever_perch_l_50);

  const attachment_grip_r_51 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.27, 1.2723, 0.2356], "localEnd": [-0.4, 1.2853, 0.2086], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.017, "endRadius": 0.018};
  const endpoint_grip_r_51 = makeAttachmentEndpoint(attachment_grip_r_51);
  const node_grip_r_51 = new THREE.Group();
  node_grip_r_51.name = "Grip R__pivot";
  node_grip_r_51.scale.set(1, 1, 1);
  if (endpoint_grip_r_51) {
    node_grip_r_51.position.copy(endpoint_grip_r_51.start);
    node_grip_r_51.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_grip_r_51.position.set(0.0, 0.0, 0.0);
    node_grip_r_51.rotation.set(0.0, 0.0, 0.0);
  }
  node_grip_r_51.userData.sculptComponent = {"id": "grip-r", "name": "Grip R", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Rubber grip sleeve.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "seat-vinyl", "materialLayers": ["seat-vinyl"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(56, 57, 57, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for seat-vinyl)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.27, 1.2723, 0.2356], "localEnd": [-0.4, 1.2853, 0.2086], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.017, "endRadius": 0.018}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "seat-vinyl"}}};
  node_grip_r_51.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "seat-vinyl"}};
  (nodes["root"] ?? root).add(node_grip_r_51);
  nodes["grip-r"] = node_grip_r_51;
  const mesh_grip_r_51Geometry = endpoint_grip_r_51
    ? new THREE.CylinderGeometry(endpoint_grip_r_51.endRadius, endpoint_grip_r_51.baseRadius, endpoint_grip_r_51.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_grip_r_51) {
    mesh_grip_r_51Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_grip_r_51 = new THREE.Mesh(
    mesh_grip_r_51Geometry,
    materialMap["seat-vinyl"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grip_r_51.name = "Grip R";
  if (endpoint_grip_r_51) {
    mesh_grip_r_51.position.copy(endpoint_grip_r_51.midpoint);
    mesh_grip_r_51.quaternion.copy(endpoint_grip_r_51.quaternion);
  }
  mesh_grip_r_51.castShadow = options.castShadow ?? true;
  mesh_grip_r_51.receiveShadow = options.receiveShadow ?? true;
  mesh_grip_r_51.userData.sculptComponent = {"id": "grip-r", "name": "Grip R", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Rubber grip sleeve.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "seat-vinyl", "materialLayers": ["seat-vinyl"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(56, 57, 57, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for seat-vinyl)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.27, 1.2723, 0.2356], "localEnd": [-0.4, 1.2853, 0.2086], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.017, "endRadius": 0.018}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "seat-vinyl"}}};
  node_grip_r_51.add(mesh_grip_r_51);
  meshes["grip-r"] = mesh_grip_r_51;
  colliders["grip-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_grip_r_51);

  const endpoint_lever_r_52 = makeAttachmentEndpoint(null);
  const node_lever_r_52 = new THREE.Group();
  node_lever_r_52.name = "Brake lever R__pivot";
  node_lever_r_52.scale.set(1, 1, 1);
  if (endpoint_lever_r_52) {
    node_lever_r_52.position.copy(endpoint_lever_r_52.start);
    node_lever_r_52.rotation.set(-0.0, -0.25, -0.0);
  } else {
    node_lever_r_52.position.set(-0.28, 1.2443, 0.3406);
    node_lever_r_52.rotation.set(-0.0, -0.25, -0.0);
  }
  node_lever_r_52.userData.sculptComponent = {"id": "lever-r", "name": "Brake lever R", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat forged lever blade.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.16, "height": 0.012, "depth": 0.02, "units": "m", "confidence": 0.5}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.28, 1.2443, 0.3406], "rotation": [-0.0, -0.25, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.28, 1.2443, 0.3406], "localEnd": [-0.28, 1.2443, 0.3406], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_lever_r_52.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_lever_r_52);
  nodes["lever-r"] = node_lever_r_52;
  const mesh_lever_r_52Geometry = endpoint_lever_r_52
    ? new THREE.CylinderGeometry(endpoint_lever_r_52.endRadius, endpoint_lever_r_52.baseRadius, endpoint_lever_r_52.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_lever_r_52) {
    mesh_lever_r_52Geometry.scale(0.16, 0.012, 0.02);
  }
  const mesh_lever_r_52 = new THREE.Mesh(
    mesh_lever_r_52Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lever_r_52.name = "Brake lever R";
  if (endpoint_lever_r_52) {
    mesh_lever_r_52.position.copy(endpoint_lever_r_52.midpoint);
    mesh_lever_r_52.quaternion.copy(endpoint_lever_r_52.quaternion);
  }
  mesh_lever_r_52.castShadow = options.castShadow ?? true;
  mesh_lever_r_52.receiveShadow = options.receiveShadow ?? true;
  mesh_lever_r_52.userData.sculptComponent = {"id": "lever-r", "name": "Brake lever R", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat forged lever blade.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.16, "height": 0.012, "depth": 0.02, "units": "m", "confidence": 0.5}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.28, 1.2443, 0.3406], "rotation": [-0.0, -0.25, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.28, 1.2443, 0.3406], "localEnd": [-0.28, 1.2443, 0.3406], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_lever_r_52.add(mesh_lever_r_52);
  meshes["lever-r"] = mesh_lever_r_52;
  colliders["lever-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_lever_r_52);

  const endpoint_lever_perch_r_53 = makeAttachmentEndpoint(null);
  const node_lever_perch_r_53 = new THREE.Group();
  node_lever_perch_r_53.name = "Lever perch R__pivot";
  node_lever_perch_r_53.scale.set(1, 1, 1);
  if (endpoint_lever_perch_r_53) {
    node_lever_perch_r_53.position.copy(endpoint_lever_perch_r_53.start);
    node_lever_perch_r_53.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_lever_perch_r_53.position.set(-0.22, 1.2643, 0.2606);
    node_lever_perch_r_53.rotation.set(-0.0, 0.0, -0.0);
  }
  node_lever_perch_r_53.userData.sculptComponent = {"id": "lever-perch-r", "name": "Lever perch R", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Lever clamp block (red switch on the left in the photo).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.035, "depth": 0.04, "units": "m", "confidence": 0.5}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [-0.22, 1.2643, 0.2606], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.22, 1.2643, 0.2606], "localEnd": [-0.22, 1.2643, 0.2606], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_lever_perch_r_53.userData.actionProfile = {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_lever_perch_r_53);
  nodes["lever-perch-r"] = node_lever_perch_r_53;
  const mesh_lever_perch_r_53Geometry = endpoint_lever_perch_r_53
    ? new THREE.CylinderGeometry(endpoint_lever_perch_r_53.endRadius, endpoint_lever_perch_r_53.baseRadius, endpoint_lever_perch_r_53.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_lever_perch_r_53) {
    mesh_lever_perch_r_53Geometry.scale(0.035, 0.035, 0.04);
  }
  const mesh_lever_perch_r_53 = new THREE.Mesh(
    mesh_lever_perch_r_53Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lever_perch_r_53.name = "Lever perch R";
  if (endpoint_lever_perch_r_53) {
    mesh_lever_perch_r_53.position.copy(endpoint_lever_perch_r_53.midpoint);
    mesh_lever_perch_r_53.quaternion.copy(endpoint_lever_perch_r_53.quaternion);
  }
  mesh_lever_perch_r_53.castShadow = options.castShadow ?? true;
  mesh_lever_perch_r_53.receiveShadow = options.receiveShadow ?? true;
  mesh_lever_perch_r_53.userData.sculptComponent = {"id": "lever-perch-r", "name": "Lever perch R", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Lever clamp block (red switch on the left in the photo).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.035, "height": 0.035, "depth": 0.04, "units": "m", "confidence": 0.5}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [-0.22, 1.2643, 0.2606], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.22, 1.2643, 0.2606], "localEnd": [-0.22, 1.2643, 0.2606], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "steering", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_lever_perch_r_53.add(mesh_lever_perch_r_53);
  meshes["lever-perch-r"] = mesh_lever_perch_r_53;
  colliders["lever-perch-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_lever_perch_r_53);

  const endpoint_headlight_mask_54 = makeAttachmentEndpoint(null);
  const node_headlight_mask_54 = new THREE.Group();
  node_headlight_mask_54.name = "Headlight number plate__pivot";
  node_headlight_mask_54.scale.set(1, 1, 1);
  if (endpoint_headlight_mask_54) {
    node_headlight_mask_54.position.copy(endpoint_headlight_mask_54.start);
    node_headlight_mask_54.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_headlight_mask_54.position.set(0.1, 0.0, 0.0);
    node_headlight_mask_54.rotation.set(0.0, -1.5708, 0.0);
  }
  node_headlight_mask_54.userData.sculptComponent = {"id": "headlight-mask", "name": "Headlight number plate", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin moulded mask; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.42, 0.86], [0.47, 0.88], [0.45, 1.03], [0.39, 1.05], [0.38, 0.95]], "depth": 0.18}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.1, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.1, 0.0, 0.0], "localEnd": [0.1, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_headlight_mask_54.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_headlight_mask_54);
  nodes["headlight-mask"] = node_headlight_mask_54;
  const mesh_headlight_mask_54Geometry = endpoint_headlight_mask_54
    ? new THREE.CylinderGeometry(endpoint_headlight_mask_54.endRadius, endpoint_headlight_mask_54.baseRadius, endpoint_headlight_mask_54.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.42, 0.86], [0.47, 0.88], [0.45, 1.03], [0.39, 1.05], [0.38, 0.95]], "depth": 0.18});
  if (!endpoint_headlight_mask_54) {
    mesh_headlight_mask_54Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_headlight_mask_54 = new THREE.Mesh(
    mesh_headlight_mask_54Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_headlight_mask_54.name = "Headlight number plate";
  if (endpoint_headlight_mask_54) {
    mesh_headlight_mask_54.position.copy(endpoint_headlight_mask_54.midpoint);
    mesh_headlight_mask_54.quaternion.copy(endpoint_headlight_mask_54.quaternion);
  }
  mesh_headlight_mask_54.castShadow = options.castShadow ?? true;
  mesh_headlight_mask_54.receiveShadow = options.receiveShadow ?? true;
  mesh_headlight_mask_54.userData.sculptComponent = {"id": "headlight-mask", "name": "Headlight number plate", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin moulded mask; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.42, 0.86], [0.47, 0.88], [0.45, 1.03], [0.39, 1.05], [0.38, 0.95]], "depth": 0.18}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.1, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.1, 0.0, 0.0], "localEnd": [0.1, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_headlight_mask_54.add(mesh_headlight_mask_54);
  meshes["headlight-mask"] = mesh_headlight_mask_54;
  colliders["headlight-mask"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_headlight_mask_54);

  const endpoint_front_fender_55 = makeAttachmentEndpoint(null);
  const node_front_fender_55 = new THREE.Group();
  node_front_fender_55.name = "Front fender__pivot";
  node_front_fender_55.scale.set(1, 1, 1);
  if (endpoint_front_fender_55) {
    node_front_fender_55.position.copy(endpoint_front_fender_55.start);
    node_front_fender_55.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_front_fender_55.position.set(0.075, 0.0, 0.0);
    node_front_fender_55.rotation.set(0.0, -1.5708, 0.0);
  }
  node_front_fender_55.userData.sculptComponent = {"id": "front-fender", "name": "Front fender", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "High-mount mudguard: thin curved shell, extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.36, 0.745], [0.52, 0.79], [0.72, 0.8], [0.9, 0.77], [1.02, 0.72], [1.0, 0.7], [0.88, 0.745], [0.7, 0.77], [0.52, 0.76], [0.37, 0.72]], "depth": 0.15}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-fender-kick", "kind": "contour", "description": "Long forward-reaching red fender tip."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.075, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.075, 0.0, 0.0], "localEnd": [0.075, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_front_fender_55.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}};
  (nodes["root"] ?? root).add(node_front_fender_55);
  nodes["front-fender"] = node_front_fender_55;
  const mesh_front_fender_55Geometry = endpoint_front_fender_55
    ? new THREE.CylinderGeometry(endpoint_front_fender_55.endRadius, endpoint_front_fender_55.baseRadius, endpoint_front_fender_55.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.36, 0.745], [0.52, 0.79], [0.72, 0.8], [0.9, 0.77], [1.02, 0.72], [1.0, 0.7], [0.88, 0.745], [0.7, 0.77], [0.52, 0.76], [0.37, 0.72]], "depth": 0.15});
  if (!endpoint_front_fender_55) {
    mesh_front_fender_55Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_front_fender_55 = new THREE.Mesh(
    mesh_front_fender_55Geometry,
    materialMap["red-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_fender_55.name = "Front fender";
  if (endpoint_front_fender_55) {
    mesh_front_fender_55.position.copy(endpoint_front_fender_55.midpoint);
    mesh_front_fender_55.quaternion.copy(endpoint_front_fender_55.quaternion);
  }
  mesh_front_fender_55.castShadow = options.castShadow ?? true;
  mesh_front_fender_55.receiveShadow = options.receiveShadow ?? true;
  mesh_front_fender_55.userData.sculptComponent = {"id": "front-fender", "name": "Front fender", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "High-mount mudguard: thin curved shell, extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.36, 0.745], [0.52, 0.79], [0.72, 0.8], [0.9, 0.77], [1.02, 0.72], [1.0, 0.7], [0.88, 0.745], [0.7, 0.77], [0.52, 0.76], [0.37, 0.72]], "depth": 0.15}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-fender-kick", "kind": "contour", "description": "Long forward-reaching red fender tip."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.075, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.075, 0.0, 0.0], "localEnd": [0.075, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_front_fender_55.add(mesh_front_fender_55);
  meshes["front-fender"] = mesh_front_fender_55;
  colliders["front-fender"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_front_fender_55);

  const endpoint_tank_56 = makeAttachmentEndpoint(null);
  const node_tank_56 = new THREE.Group();
  node_tank_56.name = "Fuel tank__pivot";
  node_tank_56.scale.set(1, 1, 1);
  if (endpoint_tank_56) {
    node_tank_56.position.copy(endpoint_tank_56.start);
    node_tank_56.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_tank_56.position.set(0.1, 0.0, 0.0);
    node_tank_56.rotation.set(0.0, -1.5708, 0.0);
  }
  node_tank_56.userData.sculptComponent = {"id": "tank", "name": "Fuel tank", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Tank volume mostly hidden under the shrouds; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.05, 0.86], [0.3, 0.96], [0.34, 0.9], [0.28, 0.76], [0.06, 0.74]], "depth": 0.2}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.1, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.1, 0.0, 0.0], "localEnd": [0.1, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_tank_56.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_tank_56);
  nodes["tank"] = node_tank_56;
  const mesh_tank_56Geometry = endpoint_tank_56
    ? new THREE.CylinderGeometry(endpoint_tank_56.endRadius, endpoint_tank_56.baseRadius, endpoint_tank_56.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.05, 0.86], [0.3, 0.96], [0.34, 0.9], [0.28, 0.76], [0.06, 0.74]], "depth": 0.2});
  if (!endpoint_tank_56) {
    mesh_tank_56Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tank_56 = new THREE.Mesh(
    mesh_tank_56Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tank_56.name = "Fuel tank";
  if (endpoint_tank_56) {
    mesh_tank_56.position.copy(endpoint_tank_56.midpoint);
    mesh_tank_56.quaternion.copy(endpoint_tank_56.quaternion);
  }
  mesh_tank_56.castShadow = options.castShadow ?? true;
  mesh_tank_56.receiveShadow = options.receiveShadow ?? true;
  mesh_tank_56.userData.sculptComponent = {"id": "tank", "name": "Fuel tank", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Tank volume mostly hidden under the shrouds; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.05, 0.86], [0.3, 0.96], [0.34, 0.9], [0.28, 0.76], [0.06, 0.74]], "depth": 0.2}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.1, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.1, 0.0, 0.0], "localEnd": [0.1, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_tank_56.add(mesh_tank_56);
  meshes["tank"] = mesh_tank_56;
  colliders["tank"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_tank_56);

  const attachment_fuel_cap_57 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.93, 0.17], "localEnd": [0.0, 0.965, 0.18], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.03, "endRadius": 0.028};
  const endpoint_fuel_cap_57 = makeAttachmentEndpoint(attachment_fuel_cap_57);
  const node_fuel_cap_57 = new THREE.Group();
  node_fuel_cap_57.name = "Fuel cap__pivot";
  node_fuel_cap_57.scale.set(1, 1, 1);
  if (endpoint_fuel_cap_57) {
    node_fuel_cap_57.position.copy(endpoint_fuel_cap_57.start);
    node_fuel_cap_57.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_fuel_cap_57.position.set(0.0, 0.0, 0.0);
    node_fuel_cap_57.rotation.set(0.0, 0.0, 0.0);
  }
  node_fuel_cap_57.userData.sculptComponent = {"id": "fuel-cap", "name": "Fuel cap", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round screw cap on the tank top.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.93, 0.17], "localEnd": [0.0, 0.965, 0.18], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.03, "endRadius": 0.028}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_fuel_cap_57.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_fuel_cap_57);
  nodes["fuel-cap"] = node_fuel_cap_57;
  const mesh_fuel_cap_57Geometry = endpoint_fuel_cap_57
    ? new THREE.CylinderGeometry(endpoint_fuel_cap_57.endRadius, endpoint_fuel_cap_57.baseRadius, endpoint_fuel_cap_57.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_fuel_cap_57) {
    mesh_fuel_cap_57Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_fuel_cap_57 = new THREE.Mesh(
    mesh_fuel_cap_57Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fuel_cap_57.name = "Fuel cap";
  if (endpoint_fuel_cap_57) {
    mesh_fuel_cap_57.position.copy(endpoint_fuel_cap_57.midpoint);
    mesh_fuel_cap_57.quaternion.copy(endpoint_fuel_cap_57.quaternion);
  }
  mesh_fuel_cap_57.castShadow = options.castShadow ?? true;
  mesh_fuel_cap_57.receiveShadow = options.receiveShadow ?? true;
  mesh_fuel_cap_57.userData.sculptComponent = {"id": "fuel-cap", "name": "Fuel cap", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Round screw cap on the tank top.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.93, 0.17], "localEnd": [0.0, 0.965, 0.18], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.03, "endRadius": 0.028}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_fuel_cap_57.add(mesh_fuel_cap_57);
  meshes["fuel-cap"] = mesh_fuel_cap_57;
  colliders["fuel-cap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_fuel_cap_57);

  const endpoint_seat_58 = makeAttachmentEndpoint(null);
  const node_seat_58 = new THREE.Group();
  node_seat_58.name = "Seat__pivot";
  node_seat_58.scale.set(1, 1, 1);
  if (endpoint_seat_58) {
    node_seat_58.position.copy(endpoint_seat_58.start);
    node_seat_58.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_seat_58.position.set(0.12, 0.0, 0.0);
    node_seat_58.rotation.set(0.0, -1.5708, 0.0);
  }
  node_seat_58.userData.sculptComponent = {"id": "seat", "name": "Seat", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Long flat enduro seat; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.24, 0.94], [0.12, 0.93], [-0.1, 0.905], [-0.45, 0.915], [-0.73, 0.935], [-0.74, 0.895], [-0.45, 0.855], [-0.05, 0.845], [0.14, 0.86], [0.26, 0.905]], "depth": 0.24}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "seat-vinyl", "materialLayers": ["seat-vinyl"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "seat-texture", "kind": "stitch", "description": "Fine grain texture on the black seat top."}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(56, 57, 57, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for seat-vinyl)"}, "transform": {"position": [0.12, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.12, 0.0, 0.0], "localEnd": [0.12, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "seat-vinyl"}}, "materialRegions": [{"regionId": "seat-vinyl", "materialId": "seat-vinyl", "profileId": "leather.matte", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/03-seat-vinyl.png", "bbox": {"x": 480, "y": 213, "width": 80, "height": 16}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0012}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "seat-vinyl"}};
  node_seat_58.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "seat-vinyl"}};
  (nodes["root"] ?? root).add(node_seat_58);
  nodes["seat"] = node_seat_58;
  const mesh_seat_58Geometry = endpoint_seat_58
    ? new THREE.CylinderGeometry(endpoint_seat_58.endRadius, endpoint_seat_58.baseRadius, endpoint_seat_58.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.24, 0.94], [0.12, 0.93], [-0.1, 0.905], [-0.45, 0.915], [-0.73, 0.935], [-0.74, 0.895], [-0.45, 0.855], [-0.05, 0.845], [0.14, 0.86], [0.26, 0.905]], "depth": 0.24});
  if (!endpoint_seat_58) {
    mesh_seat_58Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_seat_58 = new THREE.Mesh(
    mesh_seat_58Geometry,
    materialMap["seat-vinyl"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_seat_58.name = "Seat";
  if (endpoint_seat_58) {
    mesh_seat_58.position.copy(endpoint_seat_58.midpoint);
    mesh_seat_58.quaternion.copy(endpoint_seat_58.quaternion);
  }
  mesh_seat_58.castShadow = options.castShadow ?? true;
  mesh_seat_58.receiveShadow = options.receiveShadow ?? true;
  mesh_seat_58.userData.sculptComponent = {"id": "seat", "name": "Seat", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Long flat enduro seat; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.24, 0.94], [0.12, 0.93], [-0.1, 0.905], [-0.45, 0.915], [-0.73, 0.935], [-0.74, 0.895], [-0.45, 0.855], [-0.05, 0.845], [0.14, 0.86], [0.26, 0.905]], "depth": 0.24}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "seat-vinyl", "materialLayers": ["seat-vinyl"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "seat-texture", "kind": "stitch", "description": "Fine grain texture on the black seat top."}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(27, 28, 29, 1.0)", "secondaryAlbedo": "rgba(56, 57, 57, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for seat-vinyl)"}, "transform": {"position": [0.12, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.12, 0.0, 0.0], "localEnd": [0.12, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "seat-vinyl"}}, "materialRegions": [{"regionId": "seat-vinyl", "materialId": "seat-vinyl", "profileId": "leather.matte", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/03-seat-vinyl.png", "bbox": {"x": 480, "y": 213, "width": 80, "height": 16}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0012}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "seat-vinyl"}};
  node_seat_58.add(mesh_seat_58);
  meshes["seat"] = mesh_seat_58;
  colliders["seat"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_seat_58);

  const endpoint_shroud_l_59 = makeAttachmentEndpoint(null);
  const node_shroud_l_59 = new THREE.Group();
  node_shroud_l_59.name = "Radiator shroud L__pivot";
  node_shroud_l_59.scale.set(1, 1, 1);
  if (endpoint_shroud_l_59) {
    node_shroud_l_59.position.copy(endpoint_shroud_l_59.start);
    node_shroud_l_59.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_shroud_l_59.position.set(0.14, 0.0, 0.0);
    node_shroud_l_59.rotation.set(0.0, -1.5708, 0.0);
  }
  node_shroud_l_59.userData.sculptComponent = {"id": "shroud-l", "name": "Radiator shroud L", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin moulded shroud panel; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.05, 0.92], [0.36, 0.955], [0.49, 0.9], [0.45, 0.74], [0.32, 0.6], [0.2, 0.62], [0.1, 0.74]], "depth": 0.025}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.14, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.14, 0.0, 0.0], "localEnd": [0.14, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_shroud_l_59.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}};
  (nodes["root"] ?? root).add(node_shroud_l_59);
  nodes["shroud-l"] = node_shroud_l_59;
  const mesh_shroud_l_59Geometry = endpoint_shroud_l_59
    ? new THREE.CylinderGeometry(endpoint_shroud_l_59.endRadius, endpoint_shroud_l_59.baseRadius, endpoint_shroud_l_59.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.05, 0.92], [0.36, 0.955], [0.49, 0.9], [0.45, 0.74], [0.32, 0.6], [0.2, 0.62], [0.1, 0.74]], "depth": 0.025});
  if (!endpoint_shroud_l_59) {
    mesh_shroud_l_59Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shroud_l_59 = new THREE.Mesh(
    mesh_shroud_l_59Geometry,
    materialMap["red-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shroud_l_59.name = "Radiator shroud L";
  if (endpoint_shroud_l_59) {
    mesh_shroud_l_59.position.copy(endpoint_shroud_l_59.midpoint);
    mesh_shroud_l_59.quaternion.copy(endpoint_shroud_l_59.quaternion);
  }
  mesh_shroud_l_59.castShadow = options.castShadow ?? true;
  mesh_shroud_l_59.receiveShadow = options.receiveShadow ?? true;
  mesh_shroud_l_59.userData.sculptComponent = {"id": "shroud-l", "name": "Radiator shroud L", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin moulded shroud panel; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.05, 0.92], [0.36, 0.955], [0.49, 0.9], [0.45, 0.74], [0.32, 0.6], [0.2, 0.62], [0.1, 0.74]], "depth": 0.025}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.14, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.14, 0.0, 0.0], "localEnd": [0.14, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_shroud_l_59.add(mesh_shroud_l_59);
  meshes["shroud-l"] = mesh_shroud_l_59;
  colliders["shroud-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_shroud_l_59);

  const endpoint_side_panel_l_60 = makeAttachmentEndpoint(null);
  const node_side_panel_l_60 = new THREE.Group();
  node_side_panel_l_60.name = "Side number panel L__pivot";
  node_side_panel_l_60.scale.set(1, 1, 1);
  if (endpoint_side_panel_l_60) {
    node_side_panel_l_60.position.copy(endpoint_side_panel_l_60.start);
    node_side_panel_l_60.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_side_panel_l_60.position.set(0.125, 0.0, 0.0);
    node_side_panel_l_60.rotation.set(0.0, -1.5708, 0.0);
  }
  node_side_panel_l_60.userData.sculptComponent = {"id": "side-panel-l", "name": "Side number panel L", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin side cover panel under the seat; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.03, 0.855], [-0.66, 0.905], [-0.64, 0.8], [-0.4, 0.66], [-0.12, 0.6], [-0.06, 0.66]], "depth": 0.025}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.125, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.125, 0.0, 0.0], "localEnd": [0.125, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}, "materialRegions": [{"regionId": "red-gloss", "materialId": "red-plastic", "profileId": "plastic.glossy", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/00-red-gloss.png", "bbox": {"x": 335, "y": 250, "width": 50, "height": 22}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.001}}, {"regionId": "grey-stripe", "materialId": "grey-plastic", "profileId": "plastic.matte", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/02-grey-stripe.png", "bbox": {"x": 545, "y": 258, "width": 40, "height": 12}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0004}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "red-plastic"}};
  node_side_panel_l_60.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}};
  (nodes["root"] ?? root).add(node_side_panel_l_60);
  nodes["side-panel-l"] = node_side_panel_l_60;
  const mesh_side_panel_l_60Geometry = endpoint_side_panel_l_60
    ? new THREE.CylinderGeometry(endpoint_side_panel_l_60.endRadius, endpoint_side_panel_l_60.baseRadius, endpoint_side_panel_l_60.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.03, 0.855], [-0.66, 0.905], [-0.64, 0.8], [-0.4, 0.66], [-0.12, 0.6], [-0.06, 0.66]], "depth": 0.025});
  if (!endpoint_side_panel_l_60) {
    mesh_side_panel_l_60Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_side_panel_l_60 = new THREE.Mesh(
    mesh_side_panel_l_60Geometry,
    materialMap["red-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_side_panel_l_60.name = "Side number panel L";
  if (endpoint_side_panel_l_60) {
    mesh_side_panel_l_60.position.copy(endpoint_side_panel_l_60.midpoint);
    mesh_side_panel_l_60.quaternion.copy(endpoint_side_panel_l_60.quaternion);
  }
  mesh_side_panel_l_60.castShadow = options.castShadow ?? true;
  mesh_side_panel_l_60.receiveShadow = options.receiveShadow ?? true;
  mesh_side_panel_l_60.userData.sculptComponent = {"id": "side-panel-l", "name": "Side number panel L", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin side cover panel under the seat; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.03, 0.855], [-0.66, 0.905], [-0.64, 0.8], [-0.4, 0.66], [-0.12, 0.6], [-0.06, 0.66]], "depth": 0.025}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.125, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.125, 0.0, 0.0], "localEnd": [0.125, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}, "materialRegions": [{"regionId": "red-gloss", "materialId": "red-plastic", "profileId": "plastic.glossy", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/00-red-gloss.png", "bbox": {"x": 335, "y": 250, "width": 50, "height": 22}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.001}}, {"regionId": "grey-stripe", "materialId": "grey-plastic", "profileId": "plastic.matte", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/02-grey-stripe.png", "bbox": {"x": 545, "y": 258, "width": 40, "height": 12}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0004}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "red-plastic"}};
  node_side_panel_l_60.add(mesh_side_panel_l_60);
  meshes["side-panel-l"] = mesh_side_panel_l_60;
  colliders["side-panel-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_side_panel_l_60);

  const endpoint_shroud_r_61 = makeAttachmentEndpoint(null);
  const node_shroud_r_61 = new THREE.Group();
  node_shroud_r_61.name = "Radiator shroud R__pivot";
  node_shroud_r_61.scale.set(1, 1, 1);
  if (endpoint_shroud_r_61) {
    node_shroud_r_61.position.copy(endpoint_shroud_r_61.start);
    node_shroud_r_61.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_shroud_r_61.position.set(-0.14, 0.0, 0.0);
    node_shroud_r_61.rotation.set(0.0, -1.5708, 0.0);
  }
  node_shroud_r_61.userData.sculptComponent = {"id": "shroud-r", "name": "Radiator shroud R", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin moulded shroud panel; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.05, 0.92], [0.36, 0.955], [0.49, 0.9], [0.45, 0.74], [0.32, 0.6], [0.2, 0.62], [0.1, 0.74]], "depth": 0.025}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [-0.14, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.14, 0.0, 0.0], "localEnd": [-0.14, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_shroud_r_61.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}};
  (nodes["root"] ?? root).add(node_shroud_r_61);
  nodes["shroud-r"] = node_shroud_r_61;
  const mesh_shroud_r_61Geometry = endpoint_shroud_r_61
    ? new THREE.CylinderGeometry(endpoint_shroud_r_61.endRadius, endpoint_shroud_r_61.baseRadius, endpoint_shroud_r_61.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.05, 0.92], [0.36, 0.955], [0.49, 0.9], [0.45, 0.74], [0.32, 0.6], [0.2, 0.62], [0.1, 0.74]], "depth": 0.025});
  if (!endpoint_shroud_r_61) {
    mesh_shroud_r_61Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shroud_r_61 = new THREE.Mesh(
    mesh_shroud_r_61Geometry,
    materialMap["red-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shroud_r_61.name = "Radiator shroud R";
  if (endpoint_shroud_r_61) {
    mesh_shroud_r_61.position.copy(endpoint_shroud_r_61.midpoint);
    mesh_shroud_r_61.quaternion.copy(endpoint_shroud_r_61.quaternion);
  }
  mesh_shroud_r_61.castShadow = options.castShadow ?? true;
  mesh_shroud_r_61.receiveShadow = options.receiveShadow ?? true;
  mesh_shroud_r_61.userData.sculptComponent = {"id": "shroud-r", "name": "Radiator shroud R", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin moulded shroud panel; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.05, 0.92], [0.36, 0.955], [0.49, 0.9], [0.45, 0.74], [0.32, 0.6], [0.2, 0.62], [0.1, 0.74]], "depth": 0.025}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [-0.14, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.14, 0.0, 0.0], "localEnd": [-0.14, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_shroud_r_61.add(mesh_shroud_r_61);
  meshes["shroud-r"] = mesh_shroud_r_61;
  colliders["shroud-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_shroud_r_61);

  const endpoint_side_panel_r_62 = makeAttachmentEndpoint(null);
  const node_side_panel_r_62 = new THREE.Group();
  node_side_panel_r_62.name = "Side number panel R__pivot";
  node_side_panel_r_62.scale.set(1, 1, 1);
  if (endpoint_side_panel_r_62) {
    node_side_panel_r_62.position.copy(endpoint_side_panel_r_62.start);
    node_side_panel_r_62.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_side_panel_r_62.position.set(-0.125, 0.0, 0.0);
    node_side_panel_r_62.rotation.set(0.0, -1.5708, 0.0);
  }
  node_side_panel_r_62.userData.sculptComponent = {"id": "side-panel-r", "name": "Side number panel R", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin side cover panel under the seat; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.03, 0.855], [-0.66, 0.905], [-0.64, 0.8], [-0.4, 0.66], [-0.12, 0.6], [-0.06, 0.66]], "depth": 0.025}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [-0.125, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.125, 0.0, 0.0], "localEnd": [-0.125, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_side_panel_r_62.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}};
  (nodes["root"] ?? root).add(node_side_panel_r_62);
  nodes["side-panel-r"] = node_side_panel_r_62;
  const mesh_side_panel_r_62Geometry = endpoint_side_panel_r_62
    ? new THREE.CylinderGeometry(endpoint_side_panel_r_62.endRadius, endpoint_side_panel_r_62.baseRadius, endpoint_side_panel_r_62.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.03, 0.855], [-0.66, 0.905], [-0.64, 0.8], [-0.4, 0.66], [-0.12, 0.6], [-0.06, 0.66]], "depth": 0.025});
  if (!endpoint_side_panel_r_62) {
    mesh_side_panel_r_62Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_side_panel_r_62 = new THREE.Mesh(
    mesh_side_panel_r_62Geometry,
    materialMap["red-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_side_panel_r_62.name = "Side number panel R";
  if (endpoint_side_panel_r_62) {
    mesh_side_panel_r_62.position.copy(endpoint_side_panel_r_62.midpoint);
    mesh_side_panel_r_62.quaternion.copy(endpoint_side_panel_r_62.quaternion);
  }
  mesh_side_panel_r_62.castShadow = options.castShadow ?? true;
  mesh_side_panel_r_62.receiveShadow = options.receiveShadow ?? true;
  mesh_side_panel_r_62.userData.sculptComponent = {"id": "side-panel-r", "name": "Side number panel R", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Thin side cover panel under the seat; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.03, 0.855], [-0.66, 0.905], [-0.64, 0.8], [-0.4, 0.66], [-0.12, 0.6], [-0.06, 0.66]], "depth": 0.025}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [-0.125, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.125, 0.0, 0.0], "localEnd": [-0.125, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_side_panel_r_62.add(mesh_side_panel_r_62);
  meshes["side-panel-r"] = mesh_side_panel_r_62;
  colliders["side-panel-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_side_panel_r_62);

  const endpoint_rear_fender_63 = makeAttachmentEndpoint(null);
  const node_rear_fender_63 = new THREE.Group();
  node_rear_fender_63.name = "Rear fender__pivot";
  node_rear_fender_63.scale.set(1, 1, 1);
  if (endpoint_rear_fender_63) {
    node_rear_fender_63.position.copy(endpoint_rear_fender_63.start);
    node_rear_fender_63.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_rear_fender_63.position.set(0.11, 0.0, 0.0);
    node_rear_fender_63.rotation.set(0.0, -1.5708, 0.0);
  }
  node_rear_fender_63.userData.sculptComponent = {"id": "rear-fender", "name": "Rear fender", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Long upswept tail; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.4, 0.87], [-0.75, 0.915], [-1.04, 1.0], [-1.05, 0.975], [-0.78, 0.88], [-0.46, 0.82]], "depth": 0.22}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-fender-kick", "kind": "contour", "description": "Tail rises steeply to a sharp tip behind the seat."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.11, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.11, 0.0, 0.0], "localEnd": [0.11, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_rear_fender_63.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}};
  (nodes["root"] ?? root).add(node_rear_fender_63);
  nodes["rear-fender"] = node_rear_fender_63;
  const mesh_rear_fender_63Geometry = endpoint_rear_fender_63
    ? new THREE.CylinderGeometry(endpoint_rear_fender_63.endRadius, endpoint_rear_fender_63.baseRadius, endpoint_rear_fender_63.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.4, 0.87], [-0.75, 0.915], [-1.04, 1.0], [-1.05, 0.975], [-0.78, 0.88], [-0.46, 0.82]], "depth": 0.22});
  if (!endpoint_rear_fender_63) {
    mesh_rear_fender_63Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_fender_63 = new THREE.Mesh(
    mesh_rear_fender_63Geometry,
    materialMap["red-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_fender_63.name = "Rear fender";
  if (endpoint_rear_fender_63) {
    mesh_rear_fender_63.position.copy(endpoint_rear_fender_63.midpoint);
    mesh_rear_fender_63.quaternion.copy(endpoint_rear_fender_63.quaternion);
  }
  mesh_rear_fender_63.castShadow = options.castShadow ?? true;
  mesh_rear_fender_63.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_fender_63.userData.sculptComponent = {"id": "rear-fender", "name": "Rear fender", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Long upswept tail; extruded side profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.4, 0.87], [-0.75, 0.915], [-1.04, 1.0], [-1.05, 0.975], [-0.78, 0.88], [-0.46, 0.82]], "depth": 0.22}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "red-plastic", "materialLayers": ["red-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-fender-kick", "kind": "contour", "description": "Tail rises steeply to a sharp tip behind the seat."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(200, 16, 30, 1.0)", "secondaryAlbedo": "rgba(168, 3, 26, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for red-plastic)"}, "transform": {"position": [0.11, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.11, 0.0, 0.0], "localEnd": [0.11, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "macro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "red-plastic"}}};
  node_rear_fender_63.add(mesh_rear_fender_63);
  meshes["rear-fender"] = mesh_rear_fender_63;
  colliders["rear-fender"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["macro"] ??= [];
  destructionGroups["macro"].push(node_rear_fender_63);

  const endpoint_plate_hanger_64 = makeAttachmentEndpoint(null);
  const node_plate_hanger_64 = new THREE.Group();
  node_plate_hanger_64.name = "Licence plate hanger__pivot";
  node_plate_hanger_64.scale.set(1, 1, 1);
  if (endpoint_plate_hanger_64) {
    node_plate_hanger_64.position.copy(endpoint_plate_hanger_64.start);
    node_plate_hanger_64.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_plate_hanger_64.position.set(0.075, 0.0, 0.0);
    node_plate_hanger_64.rotation.set(0.0, -1.5708, 0.0);
  }
  node_plate_hanger_64.userData.sculptComponent = {"id": "plate-hanger", "name": "Licence plate hanger", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Flexible black plastic flap; extruded profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.99, 0.965], [-1.03, 0.98], [-1.1, 0.7], [-1.05, 0.68]], "depth": 0.15}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.075, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.075, 0.0, 0.0], "localEnd": [0.075, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_plate_hanger_64.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_plate_hanger_64);
  nodes["plate-hanger"] = node_plate_hanger_64;
  const mesh_plate_hanger_64Geometry = endpoint_plate_hanger_64
    ? new THREE.CylinderGeometry(endpoint_plate_hanger_64.endRadius, endpoint_plate_hanger_64.baseRadius, endpoint_plate_hanger_64.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.99, 0.965], [-1.03, 0.98], [-1.1, 0.7], [-1.05, 0.68]], "depth": 0.15});
  if (!endpoint_plate_hanger_64) {
    mesh_plate_hanger_64Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_plate_hanger_64 = new THREE.Mesh(
    mesh_plate_hanger_64Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plate_hanger_64.name = "Licence plate hanger";
  if (endpoint_plate_hanger_64) {
    mesh_plate_hanger_64.position.copy(endpoint_plate_hanger_64.midpoint);
    mesh_plate_hanger_64.quaternion.copy(endpoint_plate_hanger_64.quaternion);
  }
  mesh_plate_hanger_64.castShadow = options.castShadow ?? true;
  mesh_plate_hanger_64.receiveShadow = options.receiveShadow ?? true;
  mesh_plate_hanger_64.userData.sculptComponent = {"id": "plate-hanger", "name": "Licence plate hanger", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "Flexible black plastic flap; extruded profile.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.99, 0.965], [-1.03, 0.98], [-1.1, 0.7], [-1.05, 0.68]], "depth": 0.15}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [0.075, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.075, 0.0, 0.0], "localEnd": [0.075, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "meso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_plate_hanger_64.add(mesh_plate_hanger_64);
  meshes["plate-hanger"] = mesh_plate_hanger_64;
  colliders["plate-hanger"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["meso"] ??= [];
  destructionGroups["meso"].push(node_plate_hanger_64);

  const endpoint_plate_reflector_65 = makeAttachmentEndpoint(null);
  const node_plate_reflector_65 = new THREE.Group();
  node_plate_reflector_65.name = "Red reflector__pivot";
  node_plate_reflector_65.scale.set(1, 1, 1);
  if (endpoint_plate_reflector_65) {
    node_plate_reflector_65.position.copy(endpoint_plate_reflector_65.start);
    node_plate_reflector_65.rotation.set(-0.27, 0.0, -0.0);
  } else {
    node_plate_reflector_65.position.set(0.0, 0.705, -1.09);
    node_plate_reflector_65.rotation.set(-0.27, 0.0, -0.0);
  }
  node_plate_reflector_65.userData.sculptComponent = {"id": "plate-reflector", "name": "Red reflector", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small rectangular lens.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.07, "height": 0.03, "depth": 0.012, "units": "m", "confidence": 0.7}, "material": "reflector-red", "materialLayers": ["reflector-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "red-reflector", "kind": "emissive", "description": "Small red reflector at the bottom of the plate hanger."}], "surfaceDetail": {"macroRoughness": 0.2, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 15, 26, 1.0)", "secondaryAlbedo": "rgba(87, 7, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for reflector-red)"}, "transform": {"position": [0.0, 0.705, -1.09], "rotation": [-0.27, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.705, -1.09], "localEnd": [0.0, 0.705, -1.09], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}}, "materialRegions": [{"regionId": "red-reflector", "materialId": "reflector-red", "profileId": "plastic.glossy", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/11-red-reflector.png", "bbox": {"x": 200, "y": 322, "width": 30, "height": 14}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0004}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "reflector-red"}};
  node_plate_reflector_65.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}};
  (nodes["root"] ?? root).add(node_plate_reflector_65);
  nodes["plate-reflector"] = node_plate_reflector_65;
  const mesh_plate_reflector_65Geometry = endpoint_plate_reflector_65
    ? new THREE.CylinderGeometry(endpoint_plate_reflector_65.endRadius, endpoint_plate_reflector_65.baseRadius, endpoint_plate_reflector_65.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_plate_reflector_65) {
    mesh_plate_reflector_65Geometry.scale(0.07, 0.03, 0.012);
  }
  const mesh_plate_reflector_65 = new THREE.Mesh(
    mesh_plate_reflector_65Geometry,
    materialMap["reflector-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plate_reflector_65.name = "Red reflector";
  if (endpoint_plate_reflector_65) {
    mesh_plate_reflector_65.position.copy(endpoint_plate_reflector_65.midpoint);
    mesh_plate_reflector_65.quaternion.copy(endpoint_plate_reflector_65.quaternion);
  }
  mesh_plate_reflector_65.castShadow = options.castShadow ?? true;
  mesh_plate_reflector_65.receiveShadow = options.receiveShadow ?? true;
  mesh_plate_reflector_65.userData.sculptComponent = {"id": "plate-reflector", "name": "Red reflector", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Small rectangular lens.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.07, "height": 0.03, "depth": 0.012, "units": "m", "confidence": 0.7}, "material": "reflector-red", "materialLayers": ["reflector-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "red-reflector", "kind": "emissive", "description": "Small red reflector at the bottom of the plate hanger."}], "surfaceDetail": {"macroRoughness": 0.2, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 15, 26, 1.0)", "secondaryAlbedo": "rgba(87, 7, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for reflector-red)"}, "transform": {"position": [0.0, 0.705, -1.09], "rotation": [-0.27, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.705, -1.09], "localEnd": [0.0, 0.705, -1.09], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}}, "materialRegions": [{"regionId": "red-reflector", "materialId": "reflector-red", "profileId": "plastic.glossy", "crop": {"path": "/home/user/formafind/models/vent-baja/material-evidence/11-red-reflector.png", "bbox": {"x": 200, "y": 322, "width": 30, "height": 14}, "sourceWidth": 1280, "sourceHeight": 853, "loaderWarnings": [], "coverage": 0.0004}}], "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "reflector-red"}};
  node_plate_reflector_65.add(mesh_plate_reflector_65);
  meshes["plate-reflector"] = mesh_plate_reflector_65;
  colliders["plate-reflector"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_plate_reflector_65);

  const endpoint_tail_light_66 = makeAttachmentEndpoint(null);
  const node_tail_light_66 = new THREE.Group();
  node_tail_light_66.name = "Tail light__pivot";
  node_tail_light_66.scale.set(1, 1, 1);
  if (endpoint_tail_light_66) {
    node_tail_light_66.position.copy(endpoint_tail_light_66.start);
    node_tail_light_66.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_tail_light_66.position.set(0.0, 0.965, -1.03);
    node_tail_light_66.rotation.set(-0.0, 0.0, -0.0);
  }
  node_tail_light_66.userData.sculptComponent = {"id": "tail-light", "name": "Tail light", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Compact LED tail lamp under the fender tip.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.06, "height": 0.025, "depth": 0.04, "units": "m", "confidence": 0.6}, "material": "reflector-red", "materialLayers": ["reflector-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.2, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 15, 26, 1.0)", "secondaryAlbedo": "rgba(87, 7, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for reflector-red)"}, "transform": {"position": [0.0, 0.965, -1.03], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.965, -1.03], "localEnd": [0.0, 0.965, -1.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}}};
  node_tail_light_66.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}};
  (nodes["root"] ?? root).add(node_tail_light_66);
  nodes["tail-light"] = node_tail_light_66;
  const mesh_tail_light_66Geometry = endpoint_tail_light_66
    ? new THREE.CylinderGeometry(endpoint_tail_light_66.endRadius, endpoint_tail_light_66.baseRadius, endpoint_tail_light_66.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_tail_light_66) {
    mesh_tail_light_66Geometry.scale(0.06, 0.025, 0.04);
  }
  const mesh_tail_light_66 = new THREE.Mesh(
    mesh_tail_light_66Geometry,
    materialMap["reflector-red"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tail_light_66.name = "Tail light";
  if (endpoint_tail_light_66) {
    mesh_tail_light_66.position.copy(endpoint_tail_light_66.midpoint);
    mesh_tail_light_66.quaternion.copy(endpoint_tail_light_66.quaternion);
  }
  mesh_tail_light_66.castShadow = options.castShadow ?? true;
  mesh_tail_light_66.receiveShadow = options.receiveShadow ?? true;
  mesh_tail_light_66.userData.sculptComponent = {"id": "tail-light", "name": "Tail light", "level": "micro", "role": "body", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Compact LED tail lamp under the fender tip.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.06, "height": 0.025, "depth": 0.04, "units": "m", "confidence": 0.6}, "material": "reflector-red", "materialLayers": ["reflector-red"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.2, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 15, 26, 1.0)", "secondaryAlbedo": "rgba(87, 7, 18, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for reflector-red)"}, "transform": {"position": [0.0, 0.965, -1.03], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.0, 0.965, -1.03], "localEnd": [0.0, 0.965, -1.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "reflector-red"}}};
  node_tail_light_66.add(mesh_tail_light_66);
  meshes["tail-light"] = mesh_tail_light_66;
  colliders["tail-light"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_tail_light_66);

  const endpoint_livery_shroud_white_67 = makeAttachmentEndpoint(null);
  const node_livery_shroud_white_67 = new THREE.Group();
  node_livery_shroud_white_67.name = "Livery shroud white__pivot";
  node_livery_shroud_white_67.scale.set(1, 1, 1);
  if (endpoint_livery_shroud_white_67) {
    node_livery_shroud_white_67.position.copy(endpoint_livery_shroud_white_67.start);
    node_livery_shroud_white_67.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_livery_shroud_white_67.position.set(-0.166, 0.0, 0.0);
    node_livery_shroud_white_67.rotation.set(0.0, -1.5708, 0.0);
  }
  node_livery_shroud_white_67.userData.sculptComponent = {"id": "livery-shroud-white", "name": "Livery shroud white", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.1, 0.84], [0.4, 0.9], [0.47, 0.87], [0.38, 0.8], [0.16, 0.76]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.166, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.166, 0.0, 0.0], "localEnd": [-0.166, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_livery_shroud_white_67.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_livery_shroud_white_67);
  nodes["livery-shroud-white"] = node_livery_shroud_white_67;
  const mesh_livery_shroud_white_67Geometry = endpoint_livery_shroud_white_67
    ? new THREE.CylinderGeometry(endpoint_livery_shroud_white_67.endRadius, endpoint_livery_shroud_white_67.baseRadius, endpoint_livery_shroud_white_67.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.1, 0.84], [0.4, 0.9], [0.47, 0.87], [0.38, 0.8], [0.16, 0.76]], "depth": 0.003});
  if (!endpoint_livery_shroud_white_67) {
    mesh_livery_shroud_white_67Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_livery_shroud_white_67 = new THREE.Mesh(
    mesh_livery_shroud_white_67Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_livery_shroud_white_67.name = "Livery shroud white";
  if (endpoint_livery_shroud_white_67) {
    mesh_livery_shroud_white_67.position.copy(endpoint_livery_shroud_white_67.midpoint);
    mesh_livery_shroud_white_67.quaternion.copy(endpoint_livery_shroud_white_67.quaternion);
  }
  mesh_livery_shroud_white_67.castShadow = options.castShadow ?? true;
  mesh_livery_shroud_white_67.receiveShadow = options.receiveShadow ?? true;
  mesh_livery_shroud_white_67.userData.sculptComponent = {"id": "livery-shroud-white", "name": "Livery shroud white", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.1, 0.84], [0.4, 0.9], [0.47, 0.87], [0.38, 0.8], [0.16, 0.76]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.166, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.166, 0.0, 0.0], "localEnd": [-0.166, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_livery_shroud_white_67.add(mesh_livery_shroud_white_67);
  meshes["livery-shroud-white"] = mesh_livery_shroud_white_67;
  colliders["livery-shroud-white"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_livery_shroud_white_67);

  const endpoint_livery_shroud_grey_68 = makeAttachmentEndpoint(null);
  const node_livery_shroud_grey_68 = new THREE.Group();
  node_livery_shroud_grey_68.name = "Livery shroud grey__pivot";
  node_livery_shroud_grey_68.scale.set(1, 1, 1);
  if (endpoint_livery_shroud_grey_68) {
    node_livery_shroud_grey_68.position.copy(endpoint_livery_shroud_grey_68.start);
    node_livery_shroud_grey_68.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_livery_shroud_grey_68.position.set(-0.169, 0.0, 0.0);
    node_livery_shroud_grey_68.rotation.set(0.0, -1.5708, 0.0);
  }
  node_livery_shroud_grey_68.userData.sculptComponent = {"id": "livery-shroud-grey", "name": "Livery shroud grey", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.12, 0.86], [0.38, 0.905], [0.4, 0.89], [0.16, 0.835]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "grey-plastic", "materialLayers": ["grey-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(86, 98, 111, 1.0)", "secondaryAlbedo": "rgba(90, 103, 118, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for grey-plastic)"}, "transform": {"position": [-0.169, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.169, 0.0, 0.0], "localEnd": [-0.169, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grey-plastic"}}};
  node_livery_shroud_grey_68.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grey-plastic"}};
  (nodes["root"] ?? root).add(node_livery_shroud_grey_68);
  nodes["livery-shroud-grey"] = node_livery_shroud_grey_68;
  const mesh_livery_shroud_grey_68Geometry = endpoint_livery_shroud_grey_68
    ? new THREE.CylinderGeometry(endpoint_livery_shroud_grey_68.endRadius, endpoint_livery_shroud_grey_68.baseRadius, endpoint_livery_shroud_grey_68.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.12, 0.86], [0.38, 0.905], [0.4, 0.89], [0.16, 0.835]], "depth": 0.003});
  if (!endpoint_livery_shroud_grey_68) {
    mesh_livery_shroud_grey_68Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_livery_shroud_grey_68 = new THREE.Mesh(
    mesh_livery_shroud_grey_68Geometry,
    materialMap["grey-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_livery_shroud_grey_68.name = "Livery shroud grey";
  if (endpoint_livery_shroud_grey_68) {
    mesh_livery_shroud_grey_68.position.copy(endpoint_livery_shroud_grey_68.midpoint);
    mesh_livery_shroud_grey_68.quaternion.copy(endpoint_livery_shroud_grey_68.quaternion);
  }
  mesh_livery_shroud_grey_68.castShadow = options.castShadow ?? true;
  mesh_livery_shroud_grey_68.receiveShadow = options.receiveShadow ?? true;
  mesh_livery_shroud_grey_68.userData.sculptComponent = {"id": "livery-shroud-grey", "name": "Livery shroud grey", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.12, 0.86], [0.38, 0.905], [0.4, 0.89], [0.16, 0.835]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "grey-plastic", "materialLayers": ["grey-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(86, 98, 111, 1.0)", "secondaryAlbedo": "rgba(90, 103, 118, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for grey-plastic)"}, "transform": {"position": [-0.169, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.169, 0.0, 0.0], "localEnd": [-0.169, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grey-plastic"}}};
  node_livery_shroud_grey_68.add(mesh_livery_shroud_grey_68);
  meshes["livery-shroud-grey"] = mesh_livery_shroud_grey_68;
  colliders["livery-shroud-grey"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_livery_shroud_grey_68);

  const endpoint_livery_shroud_lower_white_69 = makeAttachmentEndpoint(null);
  const node_livery_shroud_lower_white_69 = new THREE.Group();
  node_livery_shroud_lower_white_69.name = "Livery shroud lower white__pivot";
  node_livery_shroud_lower_white_69.scale.set(1, 1, 1);
  if (endpoint_livery_shroud_lower_white_69) {
    node_livery_shroud_lower_white_69.position.copy(endpoint_livery_shroud_lower_white_69.start);
    node_livery_shroud_lower_white_69.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_livery_shroud_lower_white_69.position.set(-0.166, 0.0, 0.0);
    node_livery_shroud_lower_white_69.rotation.set(0.0, -1.5708, 0.0);
  }
  node_livery_shroud_lower_white_69.userData.sculptComponent = {"id": "livery-shroud-lower-white", "name": "Livery shroud lower white", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.3, 0.62], [0.44, 0.75], [0.46, 0.73], [0.33, 0.61]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.166, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.166, 0.0, 0.0], "localEnd": [-0.166, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_livery_shroud_lower_white_69.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_livery_shroud_lower_white_69);
  nodes["livery-shroud-lower-white"] = node_livery_shroud_lower_white_69;
  const mesh_livery_shroud_lower_white_69Geometry = endpoint_livery_shroud_lower_white_69
    ? new THREE.CylinderGeometry(endpoint_livery_shroud_lower_white_69.endRadius, endpoint_livery_shroud_lower_white_69.baseRadius, endpoint_livery_shroud_lower_white_69.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.3, 0.62], [0.44, 0.75], [0.46, 0.73], [0.33, 0.61]], "depth": 0.003});
  if (!endpoint_livery_shroud_lower_white_69) {
    mesh_livery_shroud_lower_white_69Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_livery_shroud_lower_white_69 = new THREE.Mesh(
    mesh_livery_shroud_lower_white_69Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_livery_shroud_lower_white_69.name = "Livery shroud lower white";
  if (endpoint_livery_shroud_lower_white_69) {
    mesh_livery_shroud_lower_white_69.position.copy(endpoint_livery_shroud_lower_white_69.midpoint);
    mesh_livery_shroud_lower_white_69.quaternion.copy(endpoint_livery_shroud_lower_white_69.quaternion);
  }
  mesh_livery_shroud_lower_white_69.castShadow = options.castShadow ?? true;
  mesh_livery_shroud_lower_white_69.receiveShadow = options.receiveShadow ?? true;
  mesh_livery_shroud_lower_white_69.userData.sculptComponent = {"id": "livery-shroud-lower-white", "name": "Livery shroud lower white", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.3, 0.62], [0.44, 0.75], [0.46, 0.73], [0.33, 0.61]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.166, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.166, 0.0, 0.0], "localEnd": [-0.166, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_livery_shroud_lower_white_69.add(mesh_livery_shroud_lower_white_69);
  meshes["livery-shroud-lower-white"] = mesh_livery_shroud_lower_white_69;
  colliders["livery-shroud-lower-white"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_livery_shroud_lower_white_69);

  const endpoint_livery_panel_grey_stripe_70 = makeAttachmentEndpoint(null);
  const node_livery_panel_grey_stripe_70 = new THREE.Group();
  node_livery_panel_grey_stripe_70.name = "Livery panel grey stripe__pivot";
  node_livery_panel_grey_stripe_70.scale.set(1, 1, 1);
  if (endpoint_livery_panel_grey_stripe_70) {
    node_livery_panel_grey_stripe_70.position.copy(endpoint_livery_panel_grey_stripe_70.start);
    node_livery_panel_grey_stripe_70.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_livery_panel_grey_stripe_70.position.set(-0.151, 0.0, 0.0);
    node_livery_panel_grey_stripe_70.rotation.set(0.0, -1.5708, 0.0);
  }
  node_livery_panel_grey_stripe_70.userData.sculptComponent = {"id": "livery-panel-grey-stripe", "name": "Livery panel grey stripe", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.06, 0.82], [-0.55, 0.875], [-0.55, 0.85], [-0.08, 0.795]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "grey-plastic", "materialLayers": ["grey-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(86, 98, 111, 1.0)", "secondaryAlbedo": "rgba(90, 103, 118, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for grey-plastic)"}, "transform": {"position": [-0.151, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.151, 0.0, 0.0], "localEnd": [-0.151, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grey-plastic"}}};
  node_livery_panel_grey_stripe_70.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grey-plastic"}};
  (nodes["root"] ?? root).add(node_livery_panel_grey_stripe_70);
  nodes["livery-panel-grey-stripe"] = node_livery_panel_grey_stripe_70;
  const mesh_livery_panel_grey_stripe_70Geometry = endpoint_livery_panel_grey_stripe_70
    ? new THREE.CylinderGeometry(endpoint_livery_panel_grey_stripe_70.endRadius, endpoint_livery_panel_grey_stripe_70.baseRadius, endpoint_livery_panel_grey_stripe_70.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.06, 0.82], [-0.55, 0.875], [-0.55, 0.85], [-0.08, 0.795]], "depth": 0.003});
  if (!endpoint_livery_panel_grey_stripe_70) {
    mesh_livery_panel_grey_stripe_70Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_livery_panel_grey_stripe_70 = new THREE.Mesh(
    mesh_livery_panel_grey_stripe_70Geometry,
    materialMap["grey-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_livery_panel_grey_stripe_70.name = "Livery panel grey stripe";
  if (endpoint_livery_panel_grey_stripe_70) {
    mesh_livery_panel_grey_stripe_70.position.copy(endpoint_livery_panel_grey_stripe_70.midpoint);
    mesh_livery_panel_grey_stripe_70.quaternion.copy(endpoint_livery_panel_grey_stripe_70.quaternion);
  }
  mesh_livery_panel_grey_stripe_70.castShadow = options.castShadow ?? true;
  mesh_livery_panel_grey_stripe_70.receiveShadow = options.receiveShadow ?? true;
  mesh_livery_panel_grey_stripe_70.userData.sculptComponent = {"id": "livery-panel-grey-stripe", "name": "Livery panel grey stripe", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.06, 0.82], [-0.55, 0.875], [-0.55, 0.85], [-0.08, 0.795]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "grey-plastic", "materialLayers": ["grey-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(86, 98, 111, 1.0)", "secondaryAlbedo": "rgba(90, 103, 118, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for grey-plastic)"}, "transform": {"position": [-0.151, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.151, 0.0, 0.0], "localEnd": [-0.151, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "grey-plastic"}}};
  node_livery_panel_grey_stripe_70.add(mesh_livery_panel_grey_stripe_70);
  meshes["livery-panel-grey-stripe"] = mesh_livery_panel_grey_stripe_70;
  colliders["livery-panel-grey-stripe"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_livery_panel_grey_stripe_70);

  const endpoint_livery_panel_white_lower_71 = makeAttachmentEndpoint(null);
  const node_livery_panel_white_lower_71 = new THREE.Group();
  node_livery_panel_white_lower_71.name = "Livery panel white lower__pivot";
  node_livery_panel_white_lower_71.scale.set(1, 1, 1);
  if (endpoint_livery_panel_white_lower_71) {
    node_livery_panel_white_lower_71.position.copy(endpoint_livery_panel_white_lower_71.start);
    node_livery_panel_white_lower_71.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_livery_panel_white_lower_71.position.set(-0.151, 0.0, 0.0);
    node_livery_panel_white_lower_71.rotation.set(0.0, -1.5708, 0.0);
  }
  node_livery_panel_white_lower_71.userData.sculptComponent = {"id": "livery-panel-white-lower", "name": "Livery panel white lower", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.1, 0.63], [-0.4, 0.69], [-0.6, 0.79], [-0.62, 0.76], [-0.38, 0.665], [-0.13, 0.605]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.151, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.151, 0.0, 0.0], "localEnd": [-0.151, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_livery_panel_white_lower_71.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_livery_panel_white_lower_71);
  nodes["livery-panel-white-lower"] = node_livery_panel_white_lower_71;
  const mesh_livery_panel_white_lower_71Geometry = endpoint_livery_panel_white_lower_71
    ? new THREE.CylinderGeometry(endpoint_livery_panel_white_lower_71.endRadius, endpoint_livery_panel_white_lower_71.baseRadius, endpoint_livery_panel_white_lower_71.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.1, 0.63], [-0.4, 0.69], [-0.6, 0.79], [-0.62, 0.76], [-0.38, 0.665], [-0.13, 0.605]], "depth": 0.003});
  if (!endpoint_livery_panel_white_lower_71) {
    mesh_livery_panel_white_lower_71Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_livery_panel_white_lower_71 = new THREE.Mesh(
    mesh_livery_panel_white_lower_71Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_livery_panel_white_lower_71.name = "Livery panel white lower";
  if (endpoint_livery_panel_white_lower_71) {
    mesh_livery_panel_white_lower_71.position.copy(endpoint_livery_panel_white_lower_71.midpoint);
    mesh_livery_panel_white_lower_71.quaternion.copy(endpoint_livery_panel_white_lower_71.quaternion);
  }
  mesh_livery_panel_white_lower_71.castShadow = options.castShadow ?? true;
  mesh_livery_panel_white_lower_71.receiveShadow = options.receiveShadow ?? true;
  mesh_livery_panel_white_lower_71.userData.sculptComponent = {"id": "livery-panel-white-lower", "name": "Livery panel white lower", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.1, 0.63], [-0.4, 0.69], [-0.6, 0.79], [-0.62, 0.76], [-0.38, 0.665], [-0.13, 0.605]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.151, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.151, 0.0, 0.0], "localEnd": [-0.151, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_livery_panel_white_lower_71.add(mesh_livery_panel_white_lower_71);
  meshes["livery-panel-white-lower"] = mesh_livery_panel_white_lower_71;
  colliders["livery-panel-white-lower"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_livery_panel_white_lower_71);

  const endpoint_logo_v0_72 = makeAttachmentEndpoint(null);
  const node_logo_v0_72 = new THREE.Group();
  node_logo_v0_72.name = "VENT logo letter V__pivot";
  node_logo_v0_72.scale.set(1, 1, 1);
  if (endpoint_logo_v0_72) {
    node_logo_v0_72.position.copy(endpoint_logo_v0_72.start);
    node_logo_v0_72.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_logo_v0_72.position.set(-0.155, 0.0, 0.0);
    node_logo_v0_72.rotation.set(0.0, -1.5708, 0.0);
  }
  node_logo_v0_72.userData.sculptComponent = {"id": "logo-v0", "name": "VENT logo letter V", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Raised logo glyph outline; extruded letter polygon (code-only typography).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.475, 0.845], [-0.457, 0.845], [-0.4551, 0.7852], [-0.418, 0.845], [-0.4, 0.845], [-0.4535, 0.76], [-0.4715, 0.76]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "vent-letter-0", "kind": "decal", "description": "White italic 'V' of the VENT side-panel logo."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.155, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.155, 0.0, 0.0], "localEnd": [-0.155, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_logo_v0_72.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_logo_v0_72);
  nodes["logo-v0"] = node_logo_v0_72;
  const mesh_logo_v0_72Geometry = endpoint_logo_v0_72
    ? new THREE.CylinderGeometry(endpoint_logo_v0_72.endRadius, endpoint_logo_v0_72.baseRadius, endpoint_logo_v0_72.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.475, 0.845], [-0.457, 0.845], [-0.4551, 0.7852], [-0.418, 0.845], [-0.4, 0.845], [-0.4535, 0.76], [-0.4715, 0.76]], "depth": 0.003});
  if (!endpoint_logo_v0_72) {
    mesh_logo_v0_72Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_logo_v0_72 = new THREE.Mesh(
    mesh_logo_v0_72Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_logo_v0_72.name = "VENT logo letter V";
  if (endpoint_logo_v0_72) {
    mesh_logo_v0_72.position.copy(endpoint_logo_v0_72.midpoint);
    mesh_logo_v0_72.quaternion.copy(endpoint_logo_v0_72.quaternion);
  }
  mesh_logo_v0_72.castShadow = options.castShadow ?? true;
  mesh_logo_v0_72.receiveShadow = options.receiveShadow ?? true;
  mesh_logo_v0_72.userData.sculptComponent = {"id": "logo-v0", "name": "VENT logo letter V", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Raised logo glyph outline; extruded letter polygon (code-only typography).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.475, 0.845], [-0.457, 0.845], [-0.4551, 0.7852], [-0.418, 0.845], [-0.4, 0.845], [-0.4535, 0.76], [-0.4715, 0.76]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "vent-letter-0", "kind": "decal", "description": "White italic 'V' of the VENT side-panel logo."}], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.155, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.155, 0.0, 0.0], "localEnd": [-0.155, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_logo_v0_72.add(mesh_logo_v0_72);
  meshes["logo-v0"] = mesh_logo_v0_72;
  colliders["logo-v0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_logo_v0_72);

  const endpoint_logo_e1_73 = makeAttachmentEndpoint(null);
  const node_logo_e1_73 = new THREE.Group();
  node_logo_e1_73.name = "VENT logo letter E__pivot";
  node_logo_e1_73.scale.set(1, 1, 1);
  if (endpoint_logo_e1_73) {
    node_logo_e1_73.position.copy(endpoint_logo_e1_73.start);
    node_logo_e1_73.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_logo_e1_73.position.set(-0.155, 0.0, 0.0);
    node_logo_e1_73.rotation.set(0.0, -1.5708, 0.0);
  }
  node_logo_e1_73.userData.sculptComponent = {"id": "logo-e1", "name": "VENT logo letter E", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Raised logo glyph outline; extruded letter polygon (code-only typography).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.41, 0.738], [-0.335, 0.738], [-0.3297, 0.756], [-0.3867, 0.756], [-0.3821, 0.7715], [-0.3364, 0.7715], [-0.3311, 0.7895], [-0.3769, 0.7895], [-0.3723, 0.805], [-0.3153, 0.805], [-0.31, 0.823], [-0.385, 0.823]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.155, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.155, 0.0, 0.0], "localEnd": [-0.155, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_logo_e1_73.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_logo_e1_73);
  nodes["logo-e1"] = node_logo_e1_73;
  const mesh_logo_e1_73Geometry = endpoint_logo_e1_73
    ? new THREE.CylinderGeometry(endpoint_logo_e1_73.endRadius, endpoint_logo_e1_73.baseRadius, endpoint_logo_e1_73.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.41, 0.738], [-0.335, 0.738], [-0.3297, 0.756], [-0.3867, 0.756], [-0.3821, 0.7715], [-0.3364, 0.7715], [-0.3311, 0.7895], [-0.3769, 0.7895], [-0.3723, 0.805], [-0.3153, 0.805], [-0.31, 0.823], [-0.385, 0.823]], "depth": 0.003});
  if (!endpoint_logo_e1_73) {
    mesh_logo_e1_73Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_logo_e1_73 = new THREE.Mesh(
    mesh_logo_e1_73Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_logo_e1_73.name = "VENT logo letter E";
  if (endpoint_logo_e1_73) {
    mesh_logo_e1_73.position.copy(endpoint_logo_e1_73.midpoint);
    mesh_logo_e1_73.quaternion.copy(endpoint_logo_e1_73.quaternion);
  }
  mesh_logo_e1_73.castShadow = options.castShadow ?? true;
  mesh_logo_e1_73.receiveShadow = options.receiveShadow ?? true;
  mesh_logo_e1_73.userData.sculptComponent = {"id": "logo-e1", "name": "VENT logo letter E", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Raised logo glyph outline; extruded letter polygon (code-only typography).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.41, 0.738], [-0.335, 0.738], [-0.3297, 0.756], [-0.3867, 0.756], [-0.3821, 0.7715], [-0.3364, 0.7715], [-0.3311, 0.7895], [-0.3769, 0.7895], [-0.3723, 0.805], [-0.3153, 0.805], [-0.31, 0.823], [-0.385, 0.823]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.155, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.155, 0.0, 0.0], "localEnd": [-0.155, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_logo_e1_73.add(mesh_logo_e1_73);
  meshes["logo-e1"] = mesh_logo_e1_73;
  colliders["logo-e1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_logo_e1_73);

  const endpoint_logo_n2_74 = makeAttachmentEndpoint(null);
  const node_logo_n2_74 = new THREE.Group();
  node_logo_n2_74.name = "VENT logo letter N__pivot";
  node_logo_n2_74.scale.set(1, 1, 1);
  if (endpoint_logo_n2_74) {
    node_logo_n2_74.position.copy(endpoint_logo_n2_74.start);
    node_logo_n2_74.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_logo_n2_74.position.set(-0.155, 0.0, 0.0);
    node_logo_n2_74.rotation.set(0.0, -1.5708, 0.0);
  }
  node_logo_n2_74.userData.sculptComponent = {"id": "logo-n2", "name": "VENT logo letter N", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Raised logo glyph outline; extruded letter polygon (code-only typography).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.32, 0.716], [-0.302, 0.716], [-0.2865, 0.7686], [-0.263, 0.716], [-0.245, 0.716], [-0.22, 0.801], [-0.238, 0.801], [-0.2535, 0.7484], [-0.277, 0.801], [-0.295, 0.801]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.155, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.155, 0.0, 0.0], "localEnd": [-0.155, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_logo_n2_74.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_logo_n2_74);
  nodes["logo-n2"] = node_logo_n2_74;
  const mesh_logo_n2_74Geometry = endpoint_logo_n2_74
    ? new THREE.CylinderGeometry(endpoint_logo_n2_74.endRadius, endpoint_logo_n2_74.baseRadius, endpoint_logo_n2_74.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.32, 0.716], [-0.302, 0.716], [-0.2865, 0.7686], [-0.263, 0.716], [-0.245, 0.716], [-0.22, 0.801], [-0.238, 0.801], [-0.2535, 0.7484], [-0.277, 0.801], [-0.295, 0.801]], "depth": 0.003});
  if (!endpoint_logo_n2_74) {
    mesh_logo_n2_74Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_logo_n2_74 = new THREE.Mesh(
    mesh_logo_n2_74Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_logo_n2_74.name = "VENT logo letter N";
  if (endpoint_logo_n2_74) {
    mesh_logo_n2_74.position.copy(endpoint_logo_n2_74.midpoint);
    mesh_logo_n2_74.quaternion.copy(endpoint_logo_n2_74.quaternion);
  }
  mesh_logo_n2_74.castShadow = options.castShadow ?? true;
  mesh_logo_n2_74.receiveShadow = options.receiveShadow ?? true;
  mesh_logo_n2_74.userData.sculptComponent = {"id": "logo-n2", "name": "VENT logo letter N", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Raised logo glyph outline; extruded letter polygon (code-only typography).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.32, 0.716], [-0.302, 0.716], [-0.2865, 0.7686], [-0.263, 0.716], [-0.245, 0.716], [-0.22, 0.801], [-0.238, 0.801], [-0.2535, 0.7484], [-0.277, 0.801], [-0.295, 0.801]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.155, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.155, 0.0, 0.0], "localEnd": [-0.155, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_logo_n2_74.add(mesh_logo_n2_74);
  meshes["logo-n2"] = mesh_logo_n2_74;
  colliders["logo-n2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_logo_n2_74);

  const endpoint_logo_t3_75 = makeAttachmentEndpoint(null);
  const node_logo_t3_75 = new THREE.Group();
  node_logo_t3_75.name = "VENT logo letter T__pivot";
  node_logo_t3_75.scale.set(1, 1, 1);
  if (endpoint_logo_t3_75) {
    node_logo_t3_75.position.copy(endpoint_logo_t3_75.start);
    node_logo_t3_75.rotation.set(0.0, -1.5708, 0.0);
  } else {
    node_logo_t3_75.position.set(-0.155, 0.0, 0.0);
    node_logo_t3_75.rotation.set(0.0, -1.5708, 0.0);
  }
  node_logo_t3_75.userData.sculptComponent = {"id": "logo-t3", "name": "VENT logo letter T", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Raised logo glyph outline; extruded letter polygon (code-only typography).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.205, 0.779], [-0.13, 0.779], [-0.1353, 0.761], [-0.1638, 0.761], [-0.1835, 0.694], [-0.2015, 0.694], [-0.1818, 0.761], [-0.2103, 0.761]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.155, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.155, 0.0, 0.0], "localEnd": [-0.155, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_logo_t3_75.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}};
  (nodes["root"] ?? root).add(node_logo_t3_75);
  nodes["logo-t3"] = node_logo_t3_75;
  const mesh_logo_t3_75Geometry = endpoint_logo_t3_75
    ? new THREE.CylinderGeometry(endpoint_logo_t3_75.endRadius, endpoint_logo_t3_75.baseRadius, endpoint_logo_t3_75.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.205, 0.779], [-0.13, 0.779], [-0.1353, 0.761], [-0.1638, 0.761], [-0.1835, 0.694], [-0.2015, 0.694], [-0.1818, 0.761], [-0.2103, 0.761]], "depth": 0.003});
  if (!endpoint_logo_t3_75) {
    mesh_logo_t3_75Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_logo_t3_75 = new THREE.Mesh(
    mesh_logo_t3_75Geometry,
    materialMap["white-plastic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_logo_t3_75.name = "VENT logo letter T";
  if (endpoint_logo_t3_75) {
    mesh_logo_t3_75.position.copy(endpoint_logo_t3_75.midpoint);
    mesh_logo_t3_75.quaternion.copy(endpoint_logo_t3_75.quaternion);
  }
  mesh_logo_t3_75.castShadow = options.castShadow ?? true;
  mesh_logo_t3_75.receiveShadow = options.receiveShadow ?? true;
  mesh_logo_t3_75.userData.sculptComponent = {"id": "logo-t3", "name": "VENT logo letter T", "level": "micro", "role": "decal", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "surface-relief", "topologyRationale": "Raised logo glyph outline; extruded letter polygon (code-only typography).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.205, 0.779], [-0.13, 0.779], [-0.1353, 0.761], [-0.1638, 0.761], [-0.1835, 0.694], [-0.2015, 0.694], [-0.1818, 0.761], [-0.2103, 0.761]], "depth": 0.003}}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "white-plastic", "materialLayers": ["white-plastic"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.3, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 240, 242, 1.0)", "secondaryAlbedo": "rgba(220, 223, 227, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for white-plastic)"}, "transform": {"position": [-0.155, 0.0, 0.0], "rotation": [0.0, -1.5708, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.155, 0.0, 0.0], "localEnd": [-0.155, 0.0, 0.0], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "white-plastic"}}};
  node_logo_t3_75.add(mesh_logo_t3_75);
  meshes["logo-t3"] = mesh_logo_t3_75;
  colliders["logo-t3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_logo_t3_75);

  const attachment_footpeg_l_76 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.09, 0.33, -0.03], "localEnd": [0.2, 0.33, -0.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.016, "endRadius": 0.016};
  const endpoint_footpeg_l_76 = makeAttachmentEndpoint(attachment_footpeg_l_76);
  const node_footpeg_l_76 = new THREE.Group();
  node_footpeg_l_76.name = "Footpeg L__pivot";
  node_footpeg_l_76.scale.set(1, 1, 1);
  if (endpoint_footpeg_l_76) {
    node_footpeg_l_76.position.copy(endpoint_footpeg_l_76.start);
    node_footpeg_l_76.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_footpeg_l_76.position.set(0.0, 0.0, 0.0);
    node_footpeg_l_76.rotation.set(0.0, 0.0, 0.0);
  }
  node_footpeg_l_76.userData.sculptComponent = {"id": "footpeg-l", "name": "Footpeg L", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Folding steel peg.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.09, 0.33, -0.03], "localEnd": [0.2, 0.33, -0.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.016, "endRadius": 0.016}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_footpeg_l_76.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_footpeg_l_76);
  nodes["footpeg-l"] = node_footpeg_l_76;
  const mesh_footpeg_l_76Geometry = endpoint_footpeg_l_76
    ? new THREE.CylinderGeometry(endpoint_footpeg_l_76.endRadius, endpoint_footpeg_l_76.baseRadius, endpoint_footpeg_l_76.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_footpeg_l_76) {
    mesh_footpeg_l_76Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_footpeg_l_76 = new THREE.Mesh(
    mesh_footpeg_l_76Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_footpeg_l_76.name = "Footpeg L";
  if (endpoint_footpeg_l_76) {
    mesh_footpeg_l_76.position.copy(endpoint_footpeg_l_76.midpoint);
    mesh_footpeg_l_76.quaternion.copy(endpoint_footpeg_l_76.quaternion);
  }
  mesh_footpeg_l_76.castShadow = options.castShadow ?? true;
  mesh_footpeg_l_76.receiveShadow = options.receiveShadow ?? true;
  mesh_footpeg_l_76.userData.sculptComponent = {"id": "footpeg-l", "name": "Footpeg L", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Folding steel peg.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [0.09, 0.33, -0.03], "localEnd": [0.2, 0.33, -0.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.016, "endRadius": 0.016}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_footpeg_l_76.add(mesh_footpeg_l_76);
  meshes["footpeg-l"] = mesh_footpeg_l_76;
  colliders["footpeg-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_footpeg_l_76);

  const attachment_footpeg_r_77 = {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.09, 0.33, -0.03], "localEnd": [-0.2, 0.33, -0.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.016, "endRadius": 0.016};
  const endpoint_footpeg_r_77 = makeAttachmentEndpoint(attachment_footpeg_r_77);
  const node_footpeg_r_77 = new THREE.Group();
  node_footpeg_r_77.name = "Footpeg R__pivot";
  node_footpeg_r_77.scale.set(1, 1, 1);
  if (endpoint_footpeg_r_77) {
    node_footpeg_r_77.position.copy(endpoint_footpeg_r_77.start);
    node_footpeg_r_77.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_footpeg_r_77.position.set(0.0, 0.0, 0.0);
    node_footpeg_r_77.rotation.set(0.0, 0.0, 0.0);
  }
  node_footpeg_r_77.userData.sculptComponent = {"id": "footpeg-r", "name": "Footpeg R", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Folding steel peg.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "footpeg-teeth-r", "kind": "fastener", "description": "Serrated steel footpeg teeth."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.09, 0.33, -0.03], "localEnd": [-0.2, 0.33, -0.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.016, "endRadius": 0.016}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_footpeg_r_77.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_footpeg_r_77);
  nodes["footpeg-r"] = node_footpeg_r_77;
  const mesh_footpeg_r_77Geometry = endpoint_footpeg_r_77
    ? new THREE.CylinderGeometry(endpoint_footpeg_r_77.endRadius, endpoint_footpeg_r_77.baseRadius, endpoint_footpeg_r_77.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_footpeg_r_77) {
    mesh_footpeg_r_77Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_footpeg_r_77 = new THREE.Mesh(
    mesh_footpeg_r_77Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_footpeg_r_77.name = "Footpeg R";
  if (endpoint_footpeg_r_77) {
    mesh_footpeg_r_77.position.copy(endpoint_footpeg_r_77.midpoint);
    mesh_footpeg_r_77.quaternion.copy(endpoint_footpeg_r_77.quaternion);
  }
  mesh_footpeg_r_77.castShadow = options.castShadow ?? true;
  mesh_footpeg_r_77.receiveShadow = options.receiveShadow ?? true;
  mesh_footpeg_r_77.userData.sculptComponent = {"id": "footpeg-r", "name": "Footpeg R", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Folding steel peg.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": 0.75}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "footpeg-teeth-r", "kind": "fastener", "description": "Serrated steel footpeg teeth."}], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.09, 0.33, -0.03], "localEnd": [-0.2, 0.33, -0.03], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"], "baseRadius": 0.016, "endRadius": 0.016}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_footpeg_r_77.add(mesh_footpeg_r_77);
  meshes["footpeg-r"] = mesh_footpeg_r_77;
  colliders["footpeg-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_footpeg_r_77);

  const endpoint_brake_pedal_78 = makeAttachmentEndpoint(null);
  const node_brake_pedal_78 = new THREE.Group();
  node_brake_pedal_78.name = "Rear brake pedal__pivot";
  node_brake_pedal_78.scale.set(1, 1, 1);
  if (endpoint_brake_pedal_78) {
    node_brake_pedal_78.position.copy(endpoint_brake_pedal_78.start);
    node_brake_pedal_78.rotation.set(0.25, 0.0, -0.0);
  } else {
    node_brake_pedal_78.position.set(-0.14, 0.33, 0.07);
    node_brake_pedal_78.rotation.set(0.25, 0.0, -0.0);
  }
  node_brake_pedal_78.userData.sculptComponent = {"id": "brake-pedal", "name": "Rear brake pedal", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Forged brake pedal ahead of the right peg (silver in the photo).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.015, "height": 0.02, "depth": 0.14, "units": "m", "confidence": 0.5}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.14, 0.33, 0.07], "rotation": [0.25, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.14, 0.33, 0.07], "localEnd": [-0.14, 0.33, 0.07], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_brake_pedal_78.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_brake_pedal_78);
  nodes["brake-pedal"] = node_brake_pedal_78;
  const mesh_brake_pedal_78Geometry = endpoint_brake_pedal_78
    ? new THREE.CylinderGeometry(endpoint_brake_pedal_78.endRadius, endpoint_brake_pedal_78.baseRadius, endpoint_brake_pedal_78.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_brake_pedal_78) {
    mesh_brake_pedal_78Geometry.scale(0.015, 0.02, 0.14);
  }
  const mesh_brake_pedal_78 = new THREE.Mesh(
    mesh_brake_pedal_78Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_brake_pedal_78.name = "Rear brake pedal";
  if (endpoint_brake_pedal_78) {
    mesh_brake_pedal_78.position.copy(endpoint_brake_pedal_78.midpoint);
    mesh_brake_pedal_78.quaternion.copy(endpoint_brake_pedal_78.quaternion);
  }
  mesh_brake_pedal_78.castShadow = options.castShadow ?? true;
  mesh_brake_pedal_78.receiveShadow = options.receiveShadow ?? true;
  mesh_brake_pedal_78.userData.sculptComponent = {"id": "brake-pedal", "name": "Rear brake pedal", "level": "micro", "role": "handle", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Forged brake pedal ahead of the right peg (silver in the photo).", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.015, "height": 0.02, "depth": 0.14, "units": "m", "confidence": 0.5}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.14, 0.33, 0.07], "rotation": [0.25, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.14, 0.33, 0.07], "localEnd": [-0.14, 0.33, 0.07], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_brake_pedal_78.add(mesh_brake_pedal_78);
  meshes["brake-pedal"] = mesh_brake_pedal_78;
  colliders["brake-pedal"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_brake_pedal_78);

  const endpoint_rear_caliper_79 = makeAttachmentEndpoint(null);
  const node_rear_caliper_79 = new THREE.Group();
  node_rear_caliper_79.name = "Rear brake caliper__pivot";
  node_rear_caliper_79.scale.set(1, 1, 1);
  if (endpoint_rear_caliper_79) {
    node_rear_caliper_79.position.copy(endpoint_rear_caliper_79.start);
    node_rear_caliper_79.rotation.set(-0.0, 0.0, -0.0);
  } else {
    node_rear_caliper_79.position.set(-0.085, 0.33, -0.62);
    node_rear_caliper_79.rotation.set(-0.0, 0.0, -0.0);
  }
  node_rear_caliper_79.userData.sculptComponent = {"id": "rear-caliper", "name": "Rear brake caliper", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cast caliper over the disc edge.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.03, "height": 0.06, "depth": 0.07, "units": "m", "confidence": 0.6}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.085, 0.33, -0.62], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.085, 0.33, -0.62], "localEnd": [-0.085, 0.33, -0.62], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_rear_caliper_79.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}};
  (nodes["root"] ?? root).add(node_rear_caliper_79);
  nodes["rear-caliper"] = node_rear_caliper_79;
  const mesh_rear_caliper_79Geometry = endpoint_rear_caliper_79
    ? new THREE.CylinderGeometry(endpoint_rear_caliper_79.endRadius, endpoint_rear_caliper_79.baseRadius, endpoint_rear_caliper_79.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rear_caliper_79) {
    mesh_rear_caliper_79Geometry.scale(0.03, 0.06, 0.07);
  }
  const mesh_rear_caliper_79 = new THREE.Mesh(
    mesh_rear_caliper_79Geometry,
    materialMap["brushed-steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_caliper_79.name = "Rear brake caliper";
  if (endpoint_rear_caliper_79) {
    mesh_rear_caliper_79.position.copy(endpoint_rear_caliper_79.midpoint);
    mesh_rear_caliper_79.quaternion.copy(endpoint_rear_caliper_79.quaternion);
  }
  mesh_rear_caliper_79.castShadow = options.castShadow ?? true;
  mesh_rear_caliper_79.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_caliper_79.userData.sculptComponent = {"id": "rear-caliper", "name": "Rear brake caliper", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Cast caliper over the disc edge.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.03, "height": 0.06, "depth": 0.07, "units": "m", "confidence": 0.6}, "material": "brushed-steel", "materialLayers": ["brushed-steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.32, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(169, 177, 178, 1.0)", "secondaryAlbedo": "rgba(136, 142, 140, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for brushed-steel)"}, "transform": {"position": [-0.085, 0.33, -0.62], "rotation": [-0.0, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.085, 0.33, -0.62], "localEnd": [-0.085, 0.33, -0.62], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "brushed-steel"}}};
  node_rear_caliper_79.add(mesh_rear_caliper_79);
  meshes["rear-caliper"] = mesh_rear_caliper_79;
  colliders["rear-caliper"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_rear_caliper_79);

  const endpoint_front_caliper_80 = makeAttachmentEndpoint(null);
  const node_front_caliper_80 = new THREE.Group();
  node_front_caliper_80.name = "Front brake caliper__pivot";
  node_front_caliper_80.scale.set(1, 1, 1);
  if (endpoint_front_caliper_80) {
    node_front_caliper_80.position.copy(endpoint_front_caliper_80.start);
    node_front_caliper_80.rotation.set(-0.4712, 0.0, -0.0);
  } else {
    node_front_caliper_80.position.set(-0.1, 0.34, 0.66);
    node_front_caliper_80.rotation.set(-0.4712, 0.0, -0.0);
  }
  node_front_caliper_80.userData.sculptComponent = {"id": "front-caliper", "name": "Front brake caliper", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Caliper on the fork leg behind the disc.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.03, "height": 0.08, "depth": 0.05, "units": "m", "confidence": 0.6}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [-0.1, 0.34, 0.66], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.1, 0.34, 0.66], "localEnd": [-0.1, 0.34, 0.66], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_front_caliper_80.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}};
  (nodes["root"] ?? root).add(node_front_caliper_80);
  nodes["front-caliper"] = node_front_caliper_80;
  const mesh_front_caliper_80Geometry = endpoint_front_caliper_80
    ? new THREE.CylinderGeometry(endpoint_front_caliper_80.endRadius, endpoint_front_caliper_80.baseRadius, endpoint_front_caliper_80.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_front_caliper_80) {
    mesh_front_caliper_80Geometry.scale(0.03, 0.08, 0.05);
  }
  const mesh_front_caliper_80 = new THREE.Mesh(
    mesh_front_caliper_80Geometry,
    materialMap["black-frame"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_caliper_80.name = "Front brake caliper";
  if (endpoint_front_caliper_80) {
    mesh_front_caliper_80.position.copy(endpoint_front_caliper_80.midpoint);
    mesh_front_caliper_80.quaternion.copy(endpoint_front_caliper_80.quaternion);
  }
  mesh_front_caliper_80.castShadow = options.castShadow ?? true;
  mesh_front_caliper_80.receiveShadow = options.receiveShadow ?? true;
  mesh_front_caliper_80.userData.sculptComponent = {"id": "front-caliper", "name": "Front brake caliper", "level": "micro", "role": "support", "importance": 0.6, "confidence": 0.75, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Caliper on the fork leg behind the disc.", "geometryDescriptor": {"topologyIntent": "clean low-poly real-time mesh", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "dimensions": {"width": 0.03, "height": 0.08, "depth": 0.05, "units": "m", "confidence": 0.6}, "material": "black-frame", "materialLayers": ["black-frame"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.05, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(20, 21, 23, 1.0)", "secondaryAlbedo": "rgba(32, 31, 26, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRef": "material-evidence (region for black-frame)"}, "transform": {"position": [-0.1, 0.34, 0.66], "rotation": [-0.4712, 0.0, -0.0]}, "attachment": {"parentId": "root", "parentSocket": "root-mount", "localStart": [-0.1, 0.34, 0.66], "localEnd": [-0.1, 0.34, 0.66], "contactType": "butt", "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "micro", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "black-frame"}}};
  node_front_caliper_80.add(mesh_front_caliper_80);
  meshes["front-caliper"] = mesh_front_caliper_80;
  colliders["front-caliper"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy per part."};
  destructionGroups["micro"] ??= [];
  destructionGroups["micro"].push(node_front_caliper_80);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createVentBaja50DirtBikeLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Vent Baja 50 Dirt Bike look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "color": "#FFFFFF", "intensity": 2.4, "direction": [-0.4, -0.8, 0.45], "notes": "Large soft studio key from upper front-left; exposure 1.0 with ACES filmic tone mapping."}, {"id": "fill", "type": "hemisphere", "skyColor": "#FFFFFF", "groundColor": "#D8D8D8", "intensity": 1.1, "notes": "Bright white-sweep fill keeps shadows open (high-key studio)."}, {"id": "rim", "type": "directional", "color": "#FFFFFF", "intensity": 1.2, "direction": [0.5, -0.4, -0.6], "notes": "Back rim light producing the bright specular on the red plastics."}, {"id": "ground", "type": "contact-shadow", "opacity": 0.35, "notes": "Soft ground shadow / contact shadow under both tyres on a white floor."}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createVentBaja50DirtBikeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameVentBaja50DirtBikeCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createVentBaja50DirtBikePresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureVentBaja50DirtBikeRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createVentBaja50DirtBikeInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
