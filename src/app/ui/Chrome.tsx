import { useEffect, useRef, useState } from 'react';
import type { SurfApp } from '../SurfApp';
import { useAppState, type DrawBoard } from '../../state/store';
import { canRedo, canUndo } from '../../state/history';
import { showcaseDoc } from '../../state/document';
import { exportDocFile, importDocFile } from '../../state/persistence';
import { Icon } from './icons';

interface ChromeProps {
  app: SurfApp;
  onCapture: () => void;
  onRecord: () => void;
}

const SHORTCUTS: [string, string][] = [
  ['Draw · Move', 'D · V'],
  ['Board', 'A auto · S short · L long'],
  ['Surfer actions', '1 – 4'],
  ['Turn', 'Q · E  or scroll'],
  ['Duplicate', 'Shift D'],
  ['Remove', 'Delete'],
  ['Big set · Calm', 'B · C'],
  ['Undo · Redo', '⌘Z · ⇧⌘Z'],
  ['Next surfer', 'Tab'],
  ['Deselect / cancel', 'Esc'],
  ['Hide interface', 'H'],
];

const BOARDS: { id: DrawBoard; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'short', label: 'Short' },
  { id: 'long', label: 'Long' },
];

export function Chrome({ app, onCapture, onRecord }: ChromeProps) {
  const { store } = app;
  const tool = useAppState(store, (s) => s.tool);
  const drawBoard = useAppState(store, (s) => s.drawBoard);
  const calm = useAppState(store, (s) => s.calm);
  const history = useAppState(store, (s) => s.history);
  const hasDrawn = useAppState(store, (s) => s.hasDrawn);
  const count = useAppState(store, (s) => s.history.present.surfers.length);
  const toast = useAppState(store, (s) => s.toast);
  const recording = useAppState(store, (s) => s.recording);
  const sound = useAppState(store, (s) => s.sound);
  const selectedId = useAppState(store, (s) => s.selectedId);
  const [panel, setPanel] = useState<'none' | 'help' | 'menu'>('none');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (panel === 'none') return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.panel, .top-actions')) setPanel('none');
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [panel]);

  const quiet = hasDrawn || selectedId !== null || count > 8;
  const hint = quiet ? null : tool === 'draw' ? 'Draw a surfer.' : 'Drag a surfer to move them.';

  const runMenu = (action: string) => {
    setPanel('none');
    if (action === 'reset') app.reset();
    if (action === 'showcase') app.loadDoc(showcaseDoc());
    if (action === 'export') exportDocFile(store.doc);
    if (action === 'import') fileRef.current?.click();
    if (action === 'hide') store.set({ uiHidden: true });
    if (action === 'record') onRecord();
    if (action === 'sound') store.set({ sound: !sound });
  };

  return (
    <>
      <header className="wordmark">
        <h1>SURF</h1>
        <p>a place to draw surfers</p>
      </header>

      <div className="top-actions">
        <button className="icon-btn ghost" aria-label="Help" aria-expanded={panel === 'help'} title="Help" onClick={() => setPanel(panel === 'help' ? 'none' : 'help')}>
          <Icon name="help" />
        </button>
        <button className="icon-btn ghost" aria-label="Sea menu" aria-expanded={panel === 'menu'} title="More" onClick={() => setPanel(panel === 'menu' ? 'none' : 'menu')}>
          <Icon name="menu" />
        </button>
      </div>

      {panel === 'help' && (
        <section className="panel help" aria-label="How to play">
          <p className="lede">Draw a quick stroke on the water and a surfer paddles out of it, facing the way you drew. Click a surfer to send them out, have them wait, or go for the next wave. Every so often a big set comes through.</p>
          <dl>
            {SHORTCUTS.map(([what, key]) => (
              <div key={what}><dt>{what}</dt><dd>{key}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {panel === 'menu' && (
        <section className="panel menu" aria-label="Sea menu">
          <button onClick={() => runMenu('showcase')}>Showcase arrangement</button>
          <button onClick={() => runMenu('record')} disabled={recording}>Record 12-second clip</button>
          <button onClick={() => runMenu('hide')}>Hide interface <kbd>H</kbd></button>
          <button onClick={() => runMenu('sound')} aria-pressed={sound}>Sound <kbd>{sound ? 'on' : 'off'}</kbd></button>
          <hr />
          <button onClick={() => runMenu('export')}>Export scene…</button>
          <button onClick={() => runMenu('import')}>Import scene…</button>
          <hr />
          <button className="danger" onClick={() => runMenu('reset')} disabled={count === 0}>Clear the sea</button>
        </section>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            app.loadDoc(await importDocFile(file));
            store.toast('Scene imported.');
          } catch (err) {
            store.toast(err instanceof Error ? err.message : 'Could not import that file.');
          }
        }}
      />

      {hint && <p className="hint" aria-live="polite">{hint}</p>}
      
      <div className="dock">
        {tool === 'draw' && (
          <div className="picker" role="radiogroup" aria-label="Board">
            <span className="picker-label">Board</span>
            {BOARDS.map((k) => (
              <button
                key={k.id}
                role="radio"
                aria-checked={drawBoard === k.id}
                className={drawBoard === k.id ? 'seg on' : 'seg'}
                onClick={() => store.set({ drawBoard: k.id })}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}
        <nav className="toolbar" aria-label="Tools">
          <button className={tool === 'draw' ? 'tool on' : 'tool'} aria-pressed={tool === 'draw'} title="Draw (D)" onClick={() => store.set({ tool: 'draw' })}>
            <Icon name="draw" /><span>Draw</span>
          </button>
          <button className={tool === 'move' ? 'tool on' : 'tool'} aria-pressed={tool === 'move'} title="Move (V)" onClick={() => store.set({ tool: 'move' })}>
            <Icon name="move" /><span>Move</span>
          </button>
          <span className="sep" />
          <button className="tool" title="Big set (B)" onClick={() => app.bigSet()}>
            <Icon name="wave" /><span>Big set</span>
          </button>
          <button className={calm ? 'tool on' : 'tool'} aria-pressed={calm} title="Calm: pause new waves (C)" onClick={() => app.setCalm(!calm)}>
            <Icon name="calm" /><span>Calm</span>
          </button>
          <span className="sep" />
          <button className="icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo(history)} onClick={() => app.undo()}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo(history)} onClick={() => app.redo()}>
            <Icon name="redo" />
          </button>
          <span className="sep" />
          <button className="icon-btn" aria-label="Save image" title="Save image" onClick={onCapture}>
            <Icon name="camera" />
          </button>
        </nav>
      </div>

      {recording && <p className="rec" aria-live="polite"><i />Recording</p>}
      {toast && <Toast key={toast.id} text={toast.text} />}
    </>
  );
}

function Toast({ text }: { text: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), 3200);
    return () => window.clearTimeout(t);
  }, []);
  if (gone) return null;
  return <p className="toast" role="status">{text}</p>;
}
