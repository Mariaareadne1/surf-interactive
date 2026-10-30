import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SurfApp } from '../SurfApp';
import { useAppState } from '../../state/store';
import { findSurfer } from '../../state/document';
import { surferLength } from '../../surfers/SurfManager';
import { Icon } from './icons';

/**
 * A thin blue box around the selected surfer with a world-unit readout,
 * plus its own small bar of actions. Positions are written straight to the
 * DOM every frame — no React renders.
 */

/** Project a surfer's world bounds to a screen rectangle. */
export function screenBox(app: SurfApp, box3: THREE.Box3): { minX: number; minY: number; maxX: number; maxY: number } {
  const corner = new THREE.Vector3();
  const cam = app.engine.camera;
  const rect = app.rect;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z).project(cam);
    const sx = ((corner.x + 1) / 2) * rect.width;
    const sy = ((1 - corner.y) / 2) * rect.height;
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  return { minX, minY, maxX, maxY };
}

/** A surfer's contextual actions, in bar order (keys 1–4 follow this order). */
export const SURFER_ACTIONS: { id: string; label: string }[] = [
  { id: 'paddle', label: 'Paddle out' },
  { id: 'wait', label: 'Wait' },
  { id: 'catch', label: 'Catch the next wave' },
  { id: 'wipeout', label: 'Wipe out' },
];

export function SelectionOverlay({ app }: { app: SurfApp }) {
  const selectedId = useAppState(app.store, (s) => s.selectedId);
  const record = useAppState(app.store, (s) => findSurfer(s.history.present, s.selectedId));
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    const box3 = new THREE.Box3();
    const size = new THREE.Vector3();
    const update = () => {
      const live = app.surf.get(selectedId);
      const box = boxRef.current;
      const bar = barRef.current;
      if (!live || !box || !bar) return;
      live.view.bounds(box3);
      if (box3.isEmpty()) return;
      const { minX, minY, maxX, maxY } = screenBox(app, box3);
      const rect = app.rect;
      const pad = 6;
      box.style.transform = `translate(${(minX - pad).toFixed(1)}px, ${(minY - pad).toFixed(1)}px)`;
      box.style.width = `${(maxX - minX + pad * 2).toFixed(1)}px`;
      box.style.height = `${(maxY - minY + pad * 2).toFixed(1)}px`;
      box3.getSize(size);
      const dist = app.engine.camera.position.distanceTo(live.view.rider.position);
      const length = surferLength(live.record);
      if (labelRef.current) {
        labelRef.current.textContent = `${length.toFixed(2)} × ${(length * 0.29).toFixed(2)} m  ·  ${dist.toFixed(dist < 20 ? 1 : 0)} m away`;
      }
      // the action bar sits under the box, or above it near the bottom edge
      const barW = bar.offsetWidth;
      const barH = bar.offsetHeight;
      const cx = Math.min(rect.width - barW / 2 - 12, Math.max(barW / 2 + 12, (minX + maxX) / 2));
      const below = maxY + pad + 34 + barH < rect.height - 120;
      const y = below ? maxY + pad + 30 : minY - pad - barH - 12;
      bar.style.transform = `translate(${(cx - barW / 2).toFixed(1)}px, ${Math.max(8, y).toFixed(1)}px)`;
    };
    update();
    return app.engine.onBeforeRender(update);
  }, [app, selectedId]);

  if (!selectedId || !record) return null;
  return (
    <>
      <div className="select-box" ref={boxRef} aria-hidden="true">
        <i className="h tl" /><i className="h tr" /><i className="h bl" /><i className="h br" />
        <span className="select-label" ref={labelRef} />
      </div>
      <div className="creature-bar" ref={barRef} role="toolbar" aria-label="Selected surfer">
        {SURFER_ACTIONS.map((a, i) => (
          <button key={a.id} className="chip" data-action={a.id} title={`${a.label} (${i + 1})`} onClick={() => app.act(a.id)}>
            {a.label}
          </button>
        ))}
        <span className="sep" />
        <button className="icon-btn" title="Turn left (Q)" aria-label="Turn left" onClick={() => app.rotate(0.4)}>
          <Icon name="rotateL" />
        </button>
        <button className="icon-btn" title="Turn right (E)" aria-label="Turn right" onClick={() => app.rotate(-0.4)}>
          <Icon name="rotateR" />
        </button>
        <span className="sep" />
        <button className="icon-btn" title="Duplicate (Shift+D)" aria-label="Duplicate surfer" onClick={() => app.duplicate()}>
          <Icon name="duplicate" />
        </button>
        <button className="icon-btn" title="Remove (Delete)" aria-label="Remove surfer" onClick={() => app.remove()}>
          <Icon name="trash" />
        </button>
      </div>
    </>
  );
}
