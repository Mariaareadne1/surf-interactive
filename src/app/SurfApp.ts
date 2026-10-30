import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { Store } from '../state/store';
import {
  addSurfer, emptyDoc, findSurfer, MAX_SURFERS, newId, newSeed, removeSurfer, SIZE_MAX, SIZE_MIN, updateSurfer,
  type SurfDoc, type SurferRecord,
} from '../state/document';
import { saveDoc } from '../state/persistence';
import { analyzeStroke, type Pt } from '../interaction/stroke';
import { clampToSea, seaRegion } from '../scene/sea';
import { BOARD_LENGTH } from '../surfers/geometry';
import { formationFor, SURFER_SCALE, surferLength } from '../surfers/SurfManager';
import type { BoardKind } from '../surfers/look';

/**
 * Application commands. UI and pointer input call these; they turn intent
 * into document edits (undoable) or live animation requests (not undoable).
 */

export type StrokeResult = { ok: true; id: string } | { ok: false; message: string };

/** Drawn longer than this (m), an Auto board is a longboard. */
const LONG_FROM = (BOARD_LENGTH.short + BOARD_LENGTH.long) / 2 * SURFER_SCALE * 1.05;

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export class SurfApp {
  private drag: { id: string; offsetX: number; offsetZ: number; startX: number; startZ: number } | null = null;
  private lastRotate = { id: '', at: 0 };
  private saveTimer = 0;
  private readonly unsub: (() => void)[] = [];
  hoverId: string | null = null;

  constructor(readonly engine: Engine, readonly store: Store) {}

  get surf() {
    return this.engine.surf;
  }

  start(): void {
    let prevDoc: SurfDoc | null = null;
    const onChange = () => {
      const doc = this.store.doc;
      if (doc !== prevDoc) {
        prevDoc = doc;
        this.surf.sync(doc);
        window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => saveDoc(this.store.doc), 250);
      }
      this.engine.waves.calm = this.store.get().calm;
    };
    this.unsub.push(this.store.subscribe(onChange));
    onChange();
    this.engine.waves.onBigSet = (phase) => {
      if (phase === 'warning') this.store.toast('A big set is coming…');
    };
    this.store.set({ loading: false });
    this.unsub.push(this.engine.onFrame(() => this.surf.setHighlight(this.store.get().selectedId, this.hoverId)));
  }

  get rect(): DOMRect {
    return this.engine.canvas.getBoundingClientRect();
  }

  /** Where a screen point meets the still sea. */
  toWater(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.rect;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, this.engine.camera);
    const d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = -ray.ray.origin.y / d.y;
    return t > 0 ? ray.ray.origin.clone().addScaledVector(d, t) : null;
  }

  // --- drawing ----------------------------------------------------------------------

  /** Any short stroke or loop becomes a surfer facing the way it was drawn. */
  createFromStroke(points: readonly Pt[]): StrokeResult {
    const a = analyzeStroke(points);
    if (!a.valid) return { ok: false, message: 'Draw a little longer — a quick stroke will do.' };
    if (this.store.doc.surfers.length >= MAX_SURFERS) return { ok: false, message: 'The line-up is full. Send someone in to make room.' };
    const reading = readStroke(points);
    const c = this.toWater(reading.centre.x, reading.centre.y);
    const head = this.toWater(reading.centre.x + reading.dir.x * reading.half, reading.centre.y + reading.dir.y * reading.half);
    const tail = this.toWater(reading.centre.x - reading.dir.x * reading.half, reading.centre.y - reading.dir.y * reading.half);
    if (!c || !head || !tail) return { ok: false, message: 'Draw on the water.' };
    if (seaRegion(c.x, c.z, 0.2) < 0) return { ok: false, message: 'Draw a little further from the edge.' };
    if (this.engine.waves.foamAt(c.x, c.z, this.engine.elapsed)) return { ok: false, message: 'Wait for the white water to pass, then draw.' };
    const [x, z] = clampToSea(c.x, c.z);
    const length = head.distanceTo(tail);
    const picked = this.store.get().drawBoard;
    const board: BoardKind = picked === 'auto' ? (length > LONG_FROM ? 'long' : 'short') : picked;
    const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, length / (BOARD_LENGTH[board] * SURFER_SCALE)));
    const heading = Math.atan2(-(head.z - tail.z), head.x - tail.x);
    const record: SurferRecord = { id: newId(), x, z, heading, seed: newSeed(), size, board };
    this.beginFormation(record);
    this.store.commit(addSurfer(this.store.doc, record), { hasDrawn: true });
    return { ok: true, id: record.id };
  }

  private beginFormation(r: SurferRecord, duration = 1.2): void {
    const d = this.engine.reducedMotion ? duration * 0.5 : duration;
    this.surf.expectFormation(r.id, formationFor(r, d));
    // the pigment spreads on the wet surface first; a ring follows as it settles
    this.engine.ripples.bloom(r.x, r.z, surferLength(r) * 0.62, this.surf.bloomColorOf(r));
    window.setTimeout(() => this.engine.ripples.add(r.x, r.z, 0.9), d * 650);
  }

  // --- selection & dragging ----------------------------------------------------------

  pickAt(clientX: number, clientY: number): string | null {
    const r = this.rect;
    return this.surf.pick(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1));
  }

  select(id: string | null): void {
    if (this.store.get().selectedId !== id) this.store.set({ selectedId: id });
  }

  beginDrag(id: string, clientX: number, clientY: number): void {
    const live = this.surf.get(id);
    if (!live) return;
    const hit = this.toWater(clientX, clientY);
    const { x, z } = live.controller;
    this.drag = { id, offsetX: hit ? x - hit.x : 0, offsetZ: hit ? z - hit.z : 0, startX: x, startZ: z };
    this.surf.setHeld(id, true);
  }

  dragTo(clientX: number, clientY: number): boolean {
    const d = this.drag;
    if (!d) return false;
    const hit = this.toWater(clientX, clientY);
    if (!hit) return false;
    const tx = hit.x + d.offsetX;
    const tz = hit.z + d.offsetZ;
    const [x, z] = clampToSea(tx, tz);
    this.surf.dragTo(d.id, x, z);
    return Math.hypot(x - tx, z - tz) < 0.5;
  }

  endDrag(cancel = false): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.surf.setHeld(d.id, false);
    const live = this.surf.get(d.id);
    if (!live) return;
    if (cancel) {
      this.surf.dragTo(d.id, d.startX, d.startZ);
      return;
    }
    const { x, z } = live.controller;
    if (Math.hypot(x - d.startX, z - d.startZ) > 0.01) this.store.commit(updateSurfer(this.store.doc, d.id, { x, z }));
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  // --- per-surfer commands -------------------------------------------------------------

  get selected(): SurferRecord | undefined {
    return findSurfer(this.store.doc, this.store.get().selectedId);
  }

  act(action: string, id = this.selected?.id): void {
    if (id) this.surf.act(id, action);
  }

  rotate(delta: number, id = this.selected?.id): void {
    const rec = findSurfer(this.store.doc, id ?? null);
    if (!rec) return;
    const live = this.surf.get(rec.id);
    const h = (live?.controller.heading ?? rec.heading) + delta;
    if (live && !live.controller.busy) live.controller.heading = h;
    const next = updateSurfer(this.store.doc, rec.id, { heading: Math.atan2(Math.sin(h), Math.cos(h)) });
    const now = performance.now();
    // a burst of rotation (wheel, held key) is one undo step
    if (this.lastRotate.id === rec.id && now - this.lastRotate.at < 700) this.store.amend(next);
    else this.store.commit(next);
    this.lastRotate = { id: rec.id, at: now };
  }

  duplicate(id = this.selected?.id): void {
    const rec = findSurfer(this.store.doc, id ?? null);
    if (!rec) return;
    if (this.store.doc.surfers.length >= MAX_SURFERS) {
      this.store.toast('The line-up is full.');
      return;
    }
    const live = this.surf.get(rec.id)?.controller;
    const len = surferLength(rec);
    const [x, z] = clampToSea((live?.x ?? rec.x) + Math.sin(live?.heading ?? rec.heading) * len * 0.8, (live?.z ?? rec.z) + Math.cos(live?.heading ?? rec.heading) * len * 0.8);
    const copy: SurferRecord = { ...rec, id: newId(), seed: newSeed(), x, z };
    this.beginFormation(copy, 0.9);
    this.store.commit(addSurfer(this.store.doc, copy), { selectedId: copy.id });
  }

  remove(id = this.selected?.id): void {
    if (!id) return;
    this.store.commit(removeSurfer(this.store.doc, id), { selectedId: null });
  }

  // --- the sea -----------------------------------------------------------------------------

  bigSet(): void {
    this.engine.waves.callBigSet(this.engine.elapsed, 2.5);
  }

  setCalm(calm: boolean): void {
    this.store.set({ calm });
    this.store.toast(calm ? 'Calm: no new waves for now.' : 'The waves are back.');
  }

  reset(): void {
    if (this.store.doc.surfers.length === 0) return;
    this.store.commit(emptyDoc(), { selectedId: null });
    this.store.toast('The sea is empty. Undo brings everyone back.');
  }

  loadDoc(doc: SurfDoc): void {
    this.store.commit(doc, { selectedId: null });
  }

  undo(): void {
    this.store.undo();
  }

  redo(): void {
    this.store.redo();
  }

  dispose(): void {
    window.clearTimeout(this.saveTimer);
    for (const u of this.unsub) u();
  }
}

/**
 * The stroke's main direction and which way along it the surfer faces: the
 * end the stroke was drawn toward (for a loop, where it was heading as it
 * closed). Screen px, y down.
 */
export function readStroke(points: readonly Pt[]): { centre: Pt; dir: Pt; half: number } {
  let cx = 0, cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(ang);
  let dy = Math.sin(ang);
  let min = Infinity, max = -Infinity;
  for (const p of points) {
    const a = (p.x - cx) * dx + (p.y - cy) * dy;
    min = Math.min(min, a);
    max = Math.max(max, a);
  }
  // face the way the pen was travelling: the end of the stroke against its start
  const first = points[0];
  const last = points[points.length - 1];
  const tail = points[Math.max(0, points.length - 6)];
  let drawn = (last.x - first.x) * dx + (last.y - first.y) * dy;
  if (Math.abs(drawn) < 8) drawn = (last.x - tail.x) * dx + (last.y - tail.y) * dy;
  if (drawn < 0) {
    dx = -dx;
    dy = -dy;
  }
  return { centre: { x: cx, y: cy }, dir: { x: dx, y: dy }, half: Math.max(8, (max - min) / 2) };
}
