import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from '../scene/shaderChunks';
import type { WorldUniforms } from '../scene/world';
import type { SurferLook } from './look';

/**
 * One painted material for every part of a surfer and board. Flat colour
 * fields as in the reference; the gouache light ramp, softened so white
 * boards and foam-pale skin never go lilac in shade; the watercolour bloom
 * reveal (POND's); the underwater tint for whatever sinks below the surface
 * (a duck-dive, a tumble); the wet edge of fresh paint; the selection rim.
 */

export const PART = { board: 0, skin: 1, hair: 2, torso: 3, leg: 4 } as const;

export interface SurferUniforms {
  [name: string]: THREE.IUniform;
  uReveal: THREE.IUniform<number>;
  uRevealOrigin: THREE.IUniform<THREE.Vector3>;
  uRevealRadius: THREE.IUniform<number>;
  uSeed: THREE.IUniform<number>;
  uHighlight: THREE.IUniform<number>;
  uSkin: THREE.IUniform<THREE.Color>;
  uHair: THREE.IUniform<THREE.Color>;
  uSuit: THREE.IUniform<THREE.Color>;
  uBoard: THREE.IUniform<THREE.Color>;
  uStripe: THREE.IUniform<THREE.Color>;
  /** x: swimsuit cut, y: board stripe style, z: board length. */
  uStyle: THREE.IUniform<THREE.Vector3>;
}

export function createSurferUniforms(seed: number, look: SurferLook, boardLength: number): SurferUniforms {
  return {
    uReveal: { value: 1 },
    uRevealOrigin: { value: new THREE.Vector3() },
    uRevealRadius: { value: 1 },
    uSeed: { value: (seed % 97) + 0.37 },
    uHighlight: { value: 0 },
    uSkin: { value: look.skin.clone() },
    uHair: { value: look.hair.clone() },
    uSuit: { value: look.suit.clone() },
    uBoard: { value: look.board.clone() },
    uStripe: { value: look.stripe.clone() },
    uStyle: { value: new THREE.Vector3(look.cut, look.stripeStyle, boardLength) },
  };
}

const UNIFORMS_GLSL = /* glsl */ `
uniform float uReveal;
uniform vec3 uRevealOrigin;
uniform float uRevealRadius;
uniform float uSeed;
uniform float uHighlight;
uniform vec3 uSkin;
uniform vec3 uHair;
uniform vec3 uSuit;
uniform vec3 uBoard;
uniform vec3 uStripe;
uniform vec3 uStyle;
uniform float uPart;
`;

const vertex = /* glsl */ `
attribute float aAO;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAO;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vLocal = position;
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vAO = aAO;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAO;

// POND's watercolour bloom: paint spreads out from the drawing's centre with a wet, irregular edge.
float revealClip(vec3 world) {
  if (uReveal >= 0.999) return 0.0;
  vec3 q = (world - uRevealOrigin) / uRevealRadius;
  vec2 w = world.xz / uRevealRadius;
  float n = vnoise(w * 4.0 + uSeed) * 0.62 + vnoise(w * 11.0 - uSeed) * 0.38;
  float gap = uReveal * 1.5 - (length(q.xz) * 0.9 + abs(q.y) * 0.25 + n * 0.45);
  if (gap < 0.0) discard;
  return 1.0 - smoothstep(0.0, 0.15, gap);
}

vec3 albedo(out float keep) {
  keep = 0.0;
  vec3 p = vLocal;
  if (uPart < 0.5) {
    // the board: its colour, a stringer or a painted nose, a slightly darker rail
    vec3 c = uBoard;
    float halfL = uStyle.z * 0.5;
    if (uStyle.y > 0.5 && uStyle.y < 1.5) c = mix(c, uStripe, smoothstep(0.016, 0.008, abs(p.z)) * 0.9);
    if (uStyle.y > 1.5) c = mix(c, uStripe, smoothstep(halfL * 0.62, halfL * 0.66, p.x));
    c *= 1.0 - 0.06 * smoothstep(0.03, 0.0, p.y - 0.01);
    keep = 0.35;
    return c;
  }
  if (uPart < 1.5) return uSkin;
  if (uPart < 2.5) { keep = 0.2; return uHair; }
  if (uPart < 3.5) {
    // the torso, pelvis (x = 0) to shoulders: trunks, a one-piece, or a rash vest and trunks
    float t = p.x / 0.28;
    if (uStyle.x > 0.5) return uSuit;
    return t < 0.42 ? uSuit : (uStyle.x > 1.5 ? mix(uSuit, vec3(0.95), 0.55) : uSkin);
  }
  // legs: the trunks reach a little way down the thigh
  float t = p.x / 0.3;
  return (uStyle.x < 0.5 || uStyle.x > 1.5) && t < 0.28 ? uSuit : uSkin;
}

void main() {
  float front = revealClip(vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  float keep;
  vec3 base = albedo(keep) * (0.96 + 0.06 * vnoise(vLocal.xz * 80.0 + uSeed));
  float sunVis = castLight(vWorld, 0.01);
  vec3 lit = paintLight(base, N, sunVis, mix(0.6, 1.0, vAO), 0.45);
  // shade stays gentle on these small, flat, bright shapes
  lit = mix(lit, base * mix(vec3(0.86, 0.9, 0.95), vec3(1.0), sunVis), 0.35 + keep * 0.5);
  vec3 flatPaint = base * 0.97;
  vec3 col = mix(flatPaint, lit, smoothstep(0.45, 1.0, uReveal));
  col = underwater(col, -vWorld.y * 1.4);
  col = mix(col, col * 0.84, smoothstep(0.5, 0.95, front) * 0.7);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  col += vec3(0.12, 0.3, 0.75) * uHighlight * rim * 0.7;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createPartMaterial(world: WorldUniforms, u: SurferUniforms, part: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...world, ...u, uPart: { value: part } },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
}
