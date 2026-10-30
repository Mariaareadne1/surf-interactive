import * as THREE from 'three';
import { LIGHTING_GLSL, NOISE_GLSL, WORLD_UNIFORMS_GLSL } from './shaderChunks';
import { MAX_BLOOMS, MAX_RIPPLES, type WorldUniforms } from './world';
import { MAX_WAVES, WAVES_GLSL } from './waves';
import { WATER_Y } from './sea';

/**
 * The whole sea in one painted layer, as in the reference: flat turquoise
 * laid in rounded cells, a net of pale light lines drifting and breathing
 * over it, the slow swell, breaking waves (stippled white water with a deep
 * teal face in shadow ahead of it), the cool shadows of surfers, ripple
 * rings, the watercolour stain of a creature being painted in, and a fine
 * pigment grain over everything.
 */

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
${WORLD_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${WAVES_GLSL}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
varying vec3 vWorld;

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// The light network: Voronoi cells on a slowly warped, drifting plane.
// x = distance to the nearest cell border (in cell units), y = a hash of the cell.
vec2 lightCells(vec2 p, float t) {
  vec2 w = p * 0.5 + vec2(t * 0.03, -t * 0.018);
  w += 0.32 * vec2(sin(w.y * 1.3 + t * 0.45), cos(w.x * 1.1 - t * 0.38));
  w += 0.12 * vec2(vnoise(w * 2.0 + t * 0.2), vnoise(w * 2.0 - t * 0.17)) - 0.06;
  vec2 ip = floor(w), fp = fract(w);
  float d1 = 9.0, d2 = 9.0;
  vec2 id = ip;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(ip + g);
    o = 0.5 + 0.38 * sin(t * 0.35 + 6.2831 * o);
    vec2 r = g + o - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = ip + g; }
    else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d2) - sqrt(d1), hash12(id));
}

vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }

void main() {
  vec2 xz = vWorld.xz;
  float t = uTime;

  // --- the calm water and its light net ------------------------------------
  vec2 cell = lightCells(xz, t);
  vec3 mint = mix(srgb(vec3(0.49, 0.82, 0.77)), srgb(vec3(0.55, 0.86, 0.80)), cell.y);
  mint *= 0.96 + 0.06 * fbm2lite(xz * 0.08 + 3.0);
  // lines are soft, a touch wider where cells meet in threes, and broken like dry brush
  float brush = vnoise(xz * 3.1) * 0.6 + vnoise(xz * 7.3) * 0.4;
  float line = 1.0 - smoothstep(0.012 + 0.025 * brush, 0.07 + 0.06 * brush, cell.x);
  line *= smoothstep(0.1, 0.5, brush + 0.1) * (0.75 + 0.25 * vnoise(xz * 1.3));
  vec3 col = mix(mint, srgb(vec3(0.79, 0.94, 0.90)), line * 0.85);
  // a faint second, larger net, so the pattern never looks tiled
  vec2 cell2 = lightCells(xz * 0.47 + 11.0, t * 0.7);
  col = mix(col, col * 1.05, (1.0 - smoothstep(0.02, 0.09, cell2.x)) * 0.35);

  // --- the swell: gentle light and shade across long, slow rolls ------------
  float sl = 0.31 * 0.05 * cos(xz.x * 0.31 + xz.y * 0.08 + t * 0.9) + 0.17 * 0.035 * cos(xz.x * 0.17 - xz.y * 0.23 + t * 0.62 + 1.3);
  col *= 1.0 + sl * 2.2;

  // --- a big set coming: the sea darkens and draws back ---------------------
  col = mix(col, col * vec3(0.78, 0.9, 0.92), uBigWarning * 0.5);

  // --- breaking waves ---------------------------------------------------------
  float u = dot(xz, WAVE_ACROSS);
  float a = dot(xz, WAVE_DIR);
  float foam = 0.0;
  float face = 0.0;
  float streak = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    float pw = wavePower(A, B, t) * waveEnvelope(B, u);
    if (pw <= 0.0) continue;
    float e = a - crestAt(A, B, u, t);
    float foamW = (4.2 + 3.5 * B.w + 1.2 * sin(u * 0.37 + B.z)) * min(1.0, pw + 0.2);
    float faceW = 1.25 + 1.0 * B.w;
    // ragged edges, laid with a dry brush
    // lumpy, cauliflower edges laid with a dry brush
    float rag = (vnoise(vec2(u * 0.9, a * 0.4) + B.z) - 0.5) * 1.1 + (vnoise(vec2(u * 2.6, a * 1.2) - B.z) - 0.5) * 0.45 + (vnoise(xz * 6.0 + B.z) - 0.5) * 0.22;
    // the face: deep teal just ahead of the crest, darkest near it
    // measured from the foam's own lumpy front, so the shadow hugs it
    float ef = e - rag;
    float fr = (vnoise(vec2(u * 1.3, 7.0) + B.z) - 0.5) * 0.5;
    float f = (1.0 - smoothstep(faceW * 0.5, faceW, ef + fr)) * smoothstep(-0.25, 0.05, ef);
    face = max(face, f * min(1.0, pw * 1.2) * (0.75 + 0.25 * smoothstep(faceW, 0.0, ef)));
    // white water: dense at the crest, thinning behind it into streaks
    float behind = -e + rag;
    float dense = smoothstep(-0.05, 0.3, behind) * (1.0 - smoothstep(foamW * 0.5, foamW * (0.9 + 0.3 * vnoise(vec2(u * 0.5, 3.0) + B.z)), behind));
    float thin = smoothstep(foamW * 0.45, foamW * 0.85, behind) * (1.0 - smoothstep(foamW * 1.0, foamW * 2.6, behind));
    float stripes = smoothstep(0.4, 0.68, vnoise(vec2(u * 1.6, a * 0.3) + B.z)) * 0.7 + 0.3 * smoothstep(0.5, 0.8, vnoise(xz * 3.0 - B.z));
    foam = max(foam, pw * dense);
    streak = max(streak, pw * thin * stripes);
  }
  // white water is stippled: denser to the crest, breaking into specks at its edges
  float grain = hash12(floor(xz * 38.0));
  float speck = step(grain, foam * 1.25);
  float foamA = clamp(max(smoothstep(0.55, 0.9, foam), speck * 0.95) + streak * 0.55, 0.0, 1.0);
  vec3 faceCol = mix(srgb(vec3(0.17, 0.61, 0.66)), srgb(vec3(0.12, 0.53, 0.59)), smoothstep(0.4, 1.0, face));
  col = mix(col, faceCol, face * 0.95);

  // --- shadows of surfers and boards: a cooler teal drop shadow, offset down and right
  // as in the reference (looked up as if this point were a little up and to the left)
  float sunVis = castLight(vWorld + vec3(-0.34, 0.0, -0.3), 0.02);
  col = mix(col, srgb(vec3(0.25, 0.63, 0.66)), (1.0 - sunVis) * 0.8);

  // --- the watercolour stain of a surfer being painted in -------------------
  vec4 layer = vec4(col, 1.0);
  for (int i = 0; i < ${MAX_BLOOMS}; i++) {
    vec4 b = uBlooms[i];
    float age = t - b.z;
    if (age < 0.0 || age > 2.6) continue;
    float grow = 1.0 - exp(-age * 3.0);
    float r = b.w * (0.25 + 0.8 * grow);
    vec2 q = (xz - b.xy) / b.w;
    float n = vnoise(q * 2.4 + float(i) * 7.1) * 0.6 + vnoise(q * 6.5 - float(i) * 3.3) * 0.4;
    float d = length(xz - b.xy) / r + (n - 0.5) * 0.5;
    float inside = smoothstep(1.0, 0.9, d);
    float rim = smoothstep(0.68, 0.95, d) * inside;
    float fade = 1.0 - smoothstep(1.0, 2.6, age);
    float sa = (0.12 + 0.22 * rim) * inside * fade;
    layer = over(vec4(uBloomColors[i] * (1.0 - 0.3 * rim) * sa, sa), layer);
  }

  // --- foam over everything below it ------------------------------------------
  vec3 white = mix(srgb(vec3(0.95, 0.97, 0.96)), vec3(1.0), smoothstep(0.6, 1.0, foam));
  layer = over(vec4(white * foamA, foamA), layer);

  // --- ripple rings and wake lines: pale crests ------------------------------
  float crest = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = t - r.z;
    if (age < 0.0 || age > 2.6 || r.w <= 0.0) continue;
    float life = 1.0 - age / 2.6;
    float rad = 0.1 + age * (0.5 + 0.2 * r.w);
    float d = length(xz - r.xy) - rad;
    float w = 0.022 + age * 0.018;
    crest += exp(-pow(d / w, 2.0)) * r.w * life * life;
  }
  float ca = clamp(crest * 0.6, 0.0, 0.8);
  layer = over(vec4(srgb(vec3(0.93, 0.98, 0.96)) * ca, ca), layer);

  // pigment grain over the whole print
  vec3 outc = layer.rgb * (0.965 + 0.06 * vnoise(xz * 24.0) + 0.02 * (hash12(floor(xz * 60.0)) - 0.5));
  gl_FragColor = vec4(outc, 1.0);
}
`;

export function createWater(world: WorldUniforms): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(160, 120, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, WATER_Y, 0);
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: world, vertexShader: vertex, fragmentShader: fragment }));
  mesh.name = 'sea';
  return mesh;
}

/** A pool of ripple rings (and wake marks) written straight into the shared uniforms. */
export class Ripples {
  private next = 0;
  private nextBloom = 0;

  constructor(private readonly world: WorldUniforms) {}

  add(x: number, z: number, strength = 1): void {
    this.world.uRipples.value[this.next].set(x, z, this.world.uTime.value, Math.max(0, Math.min(1.6, strength)));
    this.next = (this.next + 1) % MAX_RIPPLES;
  }

  /** A watercolour stain blooming on the water (x, z, radius in m, linear colour). */
  bloom(x: number, z: number, radius: number, color: THREE.Color): void {
    const i = this.nextBloom;
    this.world.uBlooms.value[i].set(x, z, this.world.uTime.value, radius);
    this.world.uBloomColors.value[i].copy(color);
    this.nextBloom = (i + 1) % MAX_BLOOMS;
  }

  clear(): void {
    for (const r of this.world.uRipples.value) r.set(0, 0, -100, 0);
  }
}
