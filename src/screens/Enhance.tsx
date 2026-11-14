import { useEffect, useMemo, useRef, useState } from 'react';
import { type Filter, applyFilter, canvasToBlob, scaledCopy } from '../lib/imaging';
import type { PageRec } from '../lib/store';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'bw', label: 'Noir et blanc' },
  { id: 'gray', label: 'Gris' },
  { id: 'light', label: 'Éclaircir' },
  { id: 'original', label: 'Original' },
];

interface Props {
  warped: HTMLCanvasElement;
  pageNumber: number;
  onBack: () => void;
  onAccept: (page: PageRec, canvas: HTMLCanvasElement, more: boolean) => void;
}

export function Enhance({ warped, pageNumber, onBack, onAccept }: Props) {
  const [filter, setFilter] = useState<Filter>('auto');
  const [busy, setBusy] = useState(false);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const result = useMemo(() => applyFilter(warped, filter), [warped, filter]);

  const thumbs = useMemo(() => {
    const small = scaledCopy(warped, 150);
    return Object.fromEntries(FILTERS.map((f) => [f.id, applyFilter(small, f.id).toDataURL('image/jpeg', 0.7)]));
  }, [warped]);

  useEffect(() => {
    const c = viewRef.current!;
    c.width = result.width;
    c.height = result.height;
    c.getContext('2d')!.drawImage(result, 0, 0);
  }, [result]);

  const accept = async (more: boolean) => {
    setBusy(true);
    const blob = await canvasToBlob(result, 0.9);
    onAccept({ blob, w: result.width, h: result.height }, result, more);
  };

  return (
    <div className="screen">
      <header className="bar">
        <button className="link" onClick={onBack}>Recadrer</button>
        <span className="hint">Page {pageNumber}</span>
      </header>
      <div className="stage light">
        <canvas ref={viewRef} className="result" />
      </div>
      <div className="filters" role="radiogroup" aria-label="Filtre">
        {FILTERS.map((f) => (
          <button key={f.id} role="radio" aria-checked={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
            <img src={thumbs[f.id]} alt="" />
            {f.label}
          </button>
        ))}
      </div>
      <footer className="tools">
        <button className="btn ghost" disabled={busy} onClick={() => accept(true)}>+ Page suivante</button>
        <button className="btn" disabled={busy} onClick={() => accept(false)}>Terminer</button>
      </footer>
    </div>
  );
}
