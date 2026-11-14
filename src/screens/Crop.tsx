import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_QUAD, FULL_QUAD, type Quad, detectQuad, rotate90, scaledCopy } from '../lib/imaging';
import { useFit } from '../lib/useFit';

interface Props {
  src: HTMLCanvasElement;
  pageNumber: number;
  onRetake: () => void;
  onNext: (src: HTMLCanvasElement, quad: Quad) => void;
}

const PAD = 18; // marge autour de l'image pour pouvoir saisir les coins au bord

export function Crop({ src: initial, pageNumber, onRetake, onNext }: Props) {
  const [src, setSrc] = useState(initial);
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD);
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const drag = useRef<number | null>(null);
  const { ref, box } = useFit(src.width / src.height);
  const preview = useMemo(() => scaledCopy(src, 1400).toDataURL('image/jpeg', 0.85), [src]);

  const auto = (c: HTMLCanvasElement) => {
    const q = detectQuad(c, c.width, c.height);
    setFound(!!q);
    setQuad(q ?? DEFAULT_QUAD);
  };
  useEffect(() => auto(src), [src]);

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current === null) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setQuad((q) => q.map((p, i) => (i === drag.current ? { x, y } : p)) as Quad);
  };

  const pts = quad.map((p) => `${p.x * box.w},${p.y * box.h}`).join(' ');

  return (
    <div className="screen cam">
      <header className="bar">
        <button className="link" onClick={onRetake}>Reprendre</button>
        <span className="hint">Page {pageNumber} · {found ? 'contour détecté' : 'ajustez les coins'}</span>
      </header>
      <div className="stage" ref={ref} style={{ padding: PAD }}>
        <div className="fitbox" style={{ width: box.w, height: box.h }}>
          <img src={preview} alt="Photo à recadrer" draggable={false} />
          <svg
            width={box.w}
            height={box.h}
            className="cropper"
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <polygon points={pts} className="quad" />
            {quad.map((p, i) => (
              <g key={i}>
                <circle cx={p.x * box.w} cy={p.y * box.h} r="9" className="handle" />
                <circle
                  cx={p.x * box.w}
                  cy={p.y * box.h}
                  r="26"
                  className="hit"
                  data-corner={i}
                  onPointerDown={(e) => {
                    drag.current = i;
                    (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                  }}
                />
              </g>
            ))}
          </svg>
        </div>
      </div>
      <footer className="tools">
        <button className="side" onClick={() => setSrc(rotate90(src))}>Pivoter</button>
        <button className="side" onClick={() => auto(src)}>Détection auto</button>
        <button className="side" onClick={() => setQuad(FULL_QUAD)}>Page entière</button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            // Laisse l'interface afficher l'état avant le calcul.
            setTimeout(() => onNext(src, quad), 30);
          }}
        >
          {busy ? 'Redressement…' : 'Suivant'}
        </button>
      </footer>
    </div>
  );
}
