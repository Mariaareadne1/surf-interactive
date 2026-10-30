import { clampToSea } from '../scene/sea';
import type { BoardKind } from '../surfers/look';

/** The persisted sea: which surfers there are and where they were put. Plain, versioned, immutable. */

export interface SurferRecord {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly seed: number;
  /** Size from the drawing, 0.85–1.15. */
  readonly size: number;
  readonly board: BoardKind;
}

export interface SurfDoc {
  readonly version: 1;
  readonly surfers: readonly SurferRecord[];
}

export const DOC_VERSION = 1;
export const MAX_SURFERS = 24;
export const SIZE_MIN = 0.85;
export const SIZE_MAX = 1.15;
/** How far (m) a coordinate may stray from the middle before validation clamps it. */
const FAR = 40;

export const emptyDoc = (): SurfDoc => ({ version: DOC_VERSION, surfers: [] });

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1e6;
  return `s${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newSeed(): number {
  return Math.floor(Math.random() * 1e6);
}

export function addSurfer(doc: SurfDoc, s: SurferRecord): SurfDoc {
  return { ...doc, surfers: [...doc.surfers, s] };
}

export function updateSurfer(doc: SurfDoc, id: string, patch: Partial<Omit<SurferRecord, 'id'>>): SurfDoc {
  return { ...doc, surfers: doc.surfers.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function removeSurfer(doc: SurfDoc, id: string): SurfDoc {
  return { ...doc, surfers: doc.surfers.filter((s) => s.id !== id) };
}

export function findSurfer(doc: SurfDoc, id: string | null): SurferRecord | undefined {
  return id ? doc.surfers.find((s) => s.id === id) : undefined;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ID = /^[\w-]{1,40}$/;

/**
 * Validate untrusted input (localStorage, imported files). Bad entries are
 * dropped rather than failing the whole file; a wrong shape returns null.
 */
export function parseDoc(input: unknown): SurfDoc | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as { version?: unknown; surfers?: unknown };
  if (raw.version !== DOC_VERSION || !Array.isArray(raw.surfers)) return null;
  const surfers: SurferRecord[] = [];
  const seen = new Set<string>();
  for (const item of raw.surfers.slice(0, MAX_SURFERS * 2)) {
    if (surfers.length >= MAX_SURFERS) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!isNum(r.x) || !isNum(r.z) || !isNum(r.heading) || !isNum(r.seed)) continue;
    const id = typeof r.id === 'string' && ID.test(r.id) && !seen.has(r.id) ? r.id : newId();
    seen.add(id);
    const [x, z] = clampToSea(Math.max(-FAR, Math.min(FAR, r.x)), Math.max(-FAR, Math.min(FAR, r.z)));
    surfers.push({
      id,
      x,
      z,
      heading: Math.abs(r.heading) <= Math.PI ? r.heading : Math.atan2(Math.sin(r.heading), Math.cos(r.heading)),
      seed: Math.abs(Math.floor(r.seed)) % 1e6,
      size: isNum(r.size) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, r.size)) : 1,
      board: r.board === 'long' ? 'long' : 'short',
    });
  }
  return { version: DOC_VERSION, surfers };
}

/** What a first-time visitor sees: a few surfers waiting for a wave. */
export function defaultDoc(): SurfDoc {
  return {
    version: DOC_VERSION,
    surfers: [
      { id: 'kai', x: -4.5, z: -3.2, heading: 0.3, seed: 12, size: 1, board: 'short' },
      { id: 'mia', x: 1.5, z: 2.6, heading: 0.1, seed: 27, size: 1, board: 'long' },
      { id: 'leo', x: 6.2, z: -1.5, heading: 0.5, seed: 41, size: 1, board: 'short' },
    ],
  };
}

/** A reproducible line-up across the sea, for screenshots and the demo. */
export function showcaseDoc(): SurfDoc {
  return {
    version: DOC_VERSION,
    surfers: [
      { id: 'kai', x: -6.5, z: -4.6, heading: 0.3, seed: 12, size: 1, board: 'short' },
      { id: 'mia', x: -1.5, z: 1.8, heading: 0.1, seed: 27, size: 1.05, board: 'long' },
      { id: 'leo', x: 5.0, z: -2.5, heading: 0.5, seed: 41, size: 1, board: 'short' },
      { id: 'ana', x: -8.0, z: 3.5, heading: -0.2, seed: 53, size: 0.95, board: 'short' },
      { id: 'sam', x: 2.5, z: 5.2, heading: 0.4, seed: 66, size: 1, board: 'long' },
      { id: 'rio', x: 8.0, z: 3.0, heading: 0.2, seed: 78, size: 1, board: 'short' },
    ],
  };
}
