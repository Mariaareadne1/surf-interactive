import * as THREE from 'three';
import { createPartMaterial, createSurferUniforms, PART, type SurferUniforms } from './material';
import { BOARD_LENGTH, boardGeometry, type SurferGeometries } from './geometry';
import { lookFromSeed, type BoardKind, type SurferLook } from './look';
import { SHADOW_LAYER } from '../engine/shadows';
import type { WorldUniforms } from '../scene/world';
import type { SurfKey, Pose } from './pose';

/** How far into the reveal before the shadow arrives (MEADOW's threshold). */
export const SHADOW_AT = 0.6;

export interface BoardFrame {
  x: number;
  y: number;
  z: number;
  heading: number;
}

/** What a controller hands its view each frame: the rider and, separately, the board. */
export interface SurferFrame {
  x: number;
  y: number;
  z: number;
  heading: number;
  pose: Pose<SurfKey>;
  board: BoardFrame;
}

/**
 * A surfer and their board. The rider and the board are separate roots, so
 * a wipeout can tumble one and send the other skidding away. The rider is a
 * small rig — pelvis, spine, head, two arms, two legs — posed from a flat
 * record; everything is painted with one material on shared uniforms.
 */
export class SurferView {
  readonly group = new THREE.Group();
  readonly rider = new THREE.Group();
  readonly boardRoot = new THREE.Group();
  readonly uniforms: SurferUniforms;
  readonly proxy: THREE.Mesh;
  readonly look: SurferLook;
  private readonly tumble = new THREE.Group();
  private readonly pelvis = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shoulderL = new THREE.Group();
  private readonly shoulderR = new THREE.Group();
  private readonly hipL = new THREE.Group();
  private readonly hipR = new THREE.Group();
  private readonly boardTilt = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly casters: THREE.Mesh[] = [];
  private readonly boardGeo: THREE.BufferGeometry;
  private casting = true;
  formation = 1;

  constructor(readonly id: string, seed: number, readonly boardKind: BoardKind, geo: Omit<SurferGeometries, 'board'>, private readonly world: WorldUniforms) {
    this.look = lookFromSeed(seed);
    this.uniforms = createSurferUniforms(seed, this.look, BOARD_LENGTH[boardKind]);
    this.group.name = `surfer-${id}`;
    this.group.add(this.rider, this.boardRoot);

    this.boardGeo = boardGeometry(boardKind);
    this.boardRoot.add(this.boardTilt);
    this.part(this.boardTilt, this.boardGeo, PART.board);

    this.rider.add(this.tumble);
    this.tumble.add(this.pelvis);
    this.pelvis.rotation.order = 'YXZ';
    this.pelvis.add(this.upper);
    this.part(this.upper, geo.torso, PART.torso);
    this.head.position.set(0.335, 0.004, 0);
    this.head.rotation.order = 'YZX';
    this.upper.add(this.head);
    this.part(this.head, geo.head, PART.skin);
    this.part(this.head, geo.hair, PART.hair);
    if (this.look.longHair) this.part(this.head, geo.hairLong, PART.hair);
    for (const [shoulder, s] of [[this.shoulderL, -1], [this.shoulderR, 1]] as const) {
      shoulder.position.set(0.255, 0.012, 0.088 * s);
      shoulder.rotation.order = 'YZX';
      this.part(shoulder, geo.arm, PART.skin);
      this.upper.add(shoulder);
    }
    for (const [hip, s] of [[this.hipL, -1], [this.hipR, 1]] as const) {
      hip.position.set(0.0, -0.005, 0.045 * s);
      hip.rotation.order = 'YZX';
      const leg = this.part(hip, geo.leg, PART.leg);
      leg.rotation.y = Math.PI; // legs run back from the hips
      this.pelvis.add(hip);
    }

    this.proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.scale.set(0.62 * BOARD_LENGTH[boardKind], 0.25, 0.3);
    this.proxy.userData.surferId = id;
    this.boardRoot.add(this.proxy);
  }

  private part(parent: THREE.Object3D, geo: THREE.BufferGeometry, part: number): THREE.Mesh {
    const m = createPartMaterial(this.world, this.uniforms, part);
    const mesh = new THREE.Mesh(geo, m);
    mesh.layers.enable(SHADOW_LAYER);
    this.casters.push(mesh);
    this.materials.push(m);
    parent.add(mesh);
    return mesh;
  }

  setScale(k: number): void {
    this.rider.scale.setScalar(k);
    this.boardRoot.scale.setScalar(k);
  }

  /** 0..1: how much of the surfer is painted in; the shadow arrives part way. */
  setFormation(progress: number, origin?: THREE.Vector3, radius?: number): void {
    this.formation = progress;
    this.uniforms.uReveal.value = progress;
    if (origin) this.uniforms.uRevealOrigin.value.copy(origin);
    if (radius) this.uniforms.uRevealRadius.value = radius;
    const casting = progress > SHADOW_AT;
    if (casting !== this.casting) {
      this.casting = casting;
      for (const m of this.casters) {
        if (casting) m.layers.enable(SHADOW_LAYER);
        else m.layers.disable(SHADOW_LAYER);
      }
    }
  }

  get isCastingShadow(): boolean {
    return this.casting;
  }

  setHighlight(v: number): void {
    this.uniforms.uHighlight.value = v;
  }

  apply(f: SurferFrame): void {
    const p = f.pose;
    this.rider.position.set(f.x, f.y - p.sink * this.rider.scale.x, f.z);
    this.rider.rotation.set(0, f.heading, 0);
    this.boardRoot.position.set(f.board.x, f.board.y, f.board.z);
    this.boardRoot.rotation.set(0, f.board.heading, 0);
    this.boardTilt.rotation.set(p.boardRoll, 0, p.boardPitch, 'YXZ');
    this.boardTilt.position.y = -p.boardDip;

    // a tumble spins the whole rider end over end and rolls it
    this.tumble.position.set(0, 0.06, 0);
    this.tumble.rotation.set(p.tumbleRoll, 0, p.tumble, 'YXZ');
    const sq = p.squash;
    this.tumble.scale.set(1.2 * (1 + sq * 0.3), 1.2 * (1 - sq), 1.2 * (1 + sq * 0.3));
    this.pelvis.position.set(p.pelvisX, p.pelvisY, 0);
    this.pelvis.rotation.set(p.roll, p.twist, 0, 'YXZ');
    this.upper.rotation.set(0, 0, p.spine);
    this.head.rotation.set(0, p.headYaw, p.headPitch);
    this.shoulderL.rotation.set(0, p.spreadL, p.armL);
    this.shoulderR.rotation.set(0, -p.spreadR, p.armR);
    this.hipL.rotation.set(0, -p.splayL, p.legL);
    this.hipR.rotation.set(0, p.splayR, p.legR);
  }

  /** World-space bounds of rider and board (for the selection box and tests). */
  bounds(target = new THREE.Box3()): THREE.Box3 {
    this.group.updateMatrixWorld(true);
    target.makeEmpty();
    for (const mesh of this.casters) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      target.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
    }
    return target;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    this.boardGeo.dispose();
    this.proxy.geometry.dispose();
    (this.proxy.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
