import * as THREE from 'three';
import { SurferView, type SurferFrame } from './SurferView';
import { SurferController, type SeaSense } from './SurferController';
import { bodyGeometries, BOARD_LENGTH, type SurferGeometries } from './geometry';
import { bloomColor, lookFromSeed } from './look';
import type { SurfDoc, SurferRecord } from '../state/document';
import type { WorldUniforms } from '../scene/world';
import type { Ripples } from '../scene/water';
import type { WaveField } from '../scene/waves';
import { WATER_Y } from '../scene/sea';

/**
 * Keeps the surfers in step with the document. The document says who is
 * out there and where they were put; controllers own the moment-to-moment
 * life against the wave field. This class paints surfers in, answers
 * picking, and carries out actions.
 */

/** World metres per board-length unit at size 1: the sea is a miniature, surfers are drawn larger than life. */
export const SURFER_SCALE = 2.1;
const REVEAL = 1.2;
const FADE_IN = 0.6;
const LEAVE = 0.45;

export interface FormationRequest {
  origin: THREE.Vector3;
  radius: number;
  duration: number;
}

interface Entry {
  record: SurferRecord;
  controller: SurferController;
  view: SurferView;
  formation: { t: number; req: FormationRequest } | null;
  lastFrame: SurferFrame | null;
}

export const surferScale = (r: Pick<SurferRecord, 'size'>) => SURFER_SCALE * r.size;
export const surferLength = (r: Pick<SurferRecord, 'size' | 'board'>) => surferScale(r) * BOARD_LENGTH[r.board];

export function formationFor(r: SurferRecord, duration = REVEAL): FormationRequest {
  return { origin: new THREE.Vector3(r.x, WATER_Y + 0.1, r.z), radius: surferLength(r) * 0.6, duration };
}

export class SurfManager {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, FormationRequest>();
  private readonly leaving: { view: SurferView; t: number }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly geo: Omit<SurferGeometries, 'board'> = bodyGeometries();
  private time = 0;
  viewportHeight = 900;

  readonly sense: SeaSense = {
    time: 0,
    sample: (x, z) => this.waves.sample(x, z, this.time),
    foamAt: (x, z) => this.waves.foamAt(x, z, this.time),
    approaching: (x, z) => this.waves.approaching(x, z, this.time),
    ripple: (x, z, s) => this.ripples.add(x, z, s),
    splash: (x, z, s) => {
      // a burst of rings for the white water flung up
      this.ripples.add(x, z, 0.9 * s + 0.3);
      for (let i = 0; i < Math.round(2 + 3 * s); i++) {
        const a = (i / 5) * Math.PI * 2 + s;
        this.ripples.add(x + Math.cos(a) * 0.35, z + Math.sin(a) * 0.35, 0.35 * s);
      }
    },
  };

  constructor(
    private readonly world: WorldUniforms,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly ripples: Ripples,
    private readonly waves: WaveField,
  ) {
    this.group.name = 'surfers';
  }

  get size(): number {
    return this.entries.size;
  }

  expectFormation(id: string, req: FormationRequest): void {
    this.pending.set(id, req);
  }

  sync(doc: SurfDoc): void {
    const seen = new Set<string>();
    for (const r of doc.surfers) {
      seen.add(r.id);
      const e = this.entries.get(r.id);
      if (!e) this.create(r);
      else this.updateEntry(e, r);
    }
    for (const [id, e] of this.entries) if (!seen.has(id)) this.remove(id, e);
  }

  private create(r: SurferRecord): void {
    const controller = new SurferController(r.seed, r.x, r.z, r.heading);
    controller.scale = surferScale(r);
    const view = new SurferView(r.id, r.seed, r.board, this.geo, this.world);
    view.setScale(controller.scale);
    const req = this.pending.get(r.id) ?? formationFor(r, FADE_IN);
    this.pending.delete(r.id);
    view.setFormation(0, req.origin, req.radius);
    this.entries.set(r.id, { record: r, controller, view, formation: { t: 0, req }, lastFrame: null });
    this.group.add(view.group);
  }

  private updateEntry(e: Entry, r: SurferRecord): void {
    const prev = e.record;
    e.record = r;
    if (prev.x !== r.x || prev.z !== r.z) e.controller.placeAt(r.x, r.z);
    if (prev.heading !== r.heading) e.controller.heading = r.heading;
    if (prev.size !== r.size) {
      e.controller.scale = surferScale(r);
      e.view.setScale(e.controller.scale);
    }
    if (prev.board !== r.board || prev.seed !== r.seed) {
      // a different board (or person) is a new view on the same controller
      e.view.dispose();
      e.view = new SurferView(r.id, r.seed, r.board, this.geo, this.world);
      e.view.setScale(e.controller.scale);
      this.group.add(e.view.group);
    }
  }

  private remove(id: string, e: Entry, animate = true): void {
    this.entries.delete(id);
    if (!animate) {
      e.view.dispose();
      return;
    }
    e.view.setFormation(1, e.view.boardRoot.position.clone(), surferLength(e.record) * 0.6);
    this.leaving.push({ view: e.view, t: 0 });
  }

  update(dt: number): void {
    this.time += dt;
    (this.sense as { time: number }).time = this.time;
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const l = this.leaving[i];
      l.t += dt;
      const p = 1 - l.t / LEAVE;
      if (p <= 0) {
        l.view.dispose();
        this.leaving.splice(i, 1);
      } else l.view.setFormation(p * p);
    }
    this.separate(dt);
    for (const e of this.entries.values()) {
      const f = e.controller.update(dt, this.sense);
      e.lastFrame = f;
      e.view.apply(f);
      if (e.formation) {
        e.formation.t += dt;
        const p = Math.min(1, e.formation.t / e.formation.req.duration);
        e.view.setFormation(p);
        if (p >= 1) e.formation = null;
      }
    }
  }

  /** Surfers give each other room: a soft, continuous push apart when two are too close. */
  private separate(dt: number): void {
    const list = [...this.entries.values()].filter((e) => !e.controller.held && !e.controller.riding);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].controller;
        const b = list[j].controller;
        const room = (surferLength(list[i].record) + surferLength(list[j].record)) * 0.42;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 1e-3;
        if (d >= room) continue;
        const push = Math.min(0.6, (room - d) * 1.2) * dt;
        const nx = dx / d;
        const nz = dz / d;
        a.nudge(-nx * push, -nz * push);
        b.nudge(nx * push, nz * push);
      }
    }
  }

  // --- queries -------------------------------------------------------------------------

  get(id: string): { view: SurferView; controller: SurferController; record: SurferRecord } | undefined {
    const e = this.entries.get(id);
    return e ? { view: e.view, controller: e.controller, record: e.record } : undefined;
  }

  frameOf(id: string): SurferFrame | null {
    return this.entries.get(id)?.lastFrame ?? null;
  }

  isFormed(id: string): boolean {
    const e = this.entries.get(id);
    return !!e && !e.formation;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** The surfer (or their board) under a screen point (NDC). Forming surfers can already be picked. */
  pick(ndc: THREE.Vector2): string | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.entries.values()].map((e) => e.view.proxy), false);
    return hits.length ? (hits[0].object.userData.surferId as string) : null;
  }

  setHighlight(id: string | null, hoverId: string | null): void {
    for (const [eid, e] of this.entries) e.view.setHighlight(eid === id ? 1 : eid === hoverId ? 0.45 : 0);
  }

  setHeld(id: string, held: boolean): void {
    const c = this.entries.get(id)?.controller;
    if (c) c.held = held;
  }

  dragTo(id: string, x: number, z: number): void {
    this.entries.get(id)?.controller.placeAt(x, z);
  }

  pixelsPerMeterAt(p: THREE.Vector3): number {
    const d = p.clone().applyMatrix4(this.camera.matrixWorldInverse).z * -1;
    return this.viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * Math.max(0.1, d));
  }

  bloomColorOf(r: SurferRecord): THREE.Color {
    return bloomColor(lookFromSeed(r.seed));
  }

  // --- actions ---------------------------------------------------------------------------

  act(id: string, action: string): void {
    const c = this.entries.get(id)?.controller;
    if (!c) return;
    if (action === 'paddle') c.paddleOut();
    if (action === 'wait') c.wait();
    if (action === 'catch') c.catchNext();
    if (action === 'wipeout') {
      c.wipeOut();
      this.sense.splash(c.x, c.z, 0.9);
    }
  }

  dispose(): void {
    for (const [id, e] of this.entries) this.remove(id, e, false);
    for (const l of this.leaving) l.view.dispose();
    this.leaving.length = 0;
    for (const g of Object.values(this.geo)) g.dispose();
  }
}
