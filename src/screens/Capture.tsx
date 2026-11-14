import { useEffect, useRef, useState } from 'react';
import { type Quad, blobToCanvas, detectQuad, makeCanvas } from '../lib/imaging';
import { useFit } from '../lib/useFit';

interface Props {
  count: number;
  onShot: (src: HTMLCanvasElement) => void;
  onClose: () => void;
  onDone?: () => void;
}

export function Capture({ count, onShot, onClose, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'starting' | 'live' | 'unavailable'>('starting');
  const [ratio, setRatio] = useState(3 / 4);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [busy, setBusy] = useState(false);
  const { ref, box } = useFit(ratio);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const v = videoRef.current!;
        v.srcObject = s;
        v.onloadedmetadata = () => {
          setRatio(v.videoWidth / v.videoHeight);
          setStatus('live');
          void v.play().catch(() => {});
        };
      })
      .catch(() => setStatus('unavailable'));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Détection en direct du contour de la feuille.
  useEffect(() => {
    if (status !== 'live') return;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (v && v.videoWidth) setQuad(detectQuad(v, v.videoWidth, v.videoHeight, false));
    }, 350);
    return () => clearInterval(t);
  }, [status]);

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = makeCanvas(v.videoWidth, v.videoHeight);
    c.getContext('2d', { willReadFrequently: true })!.drawImage(v, 0, 0);
    onShot(c);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onShot(await blobToCanvas(file));
    } catch {
      setBusy(false);
      alert('Cette image ne peut pas être ouverte. Essayez un fichier JPG ou PNG.');
    }
  };

  const pts = quad?.map((p) => `${p.x * box.w},${p.y * box.h}`).join(' ');

  return (
    <div className="screen cam">
      <header className="bar">
        <button className="link" onClick={onClose}>Fermer</button>
        <span className="hint">{count > 0 ? `${count} page${count > 1 ? 's' : ''} prête${count > 1 ? 's' : ''}` : 'Nouvelle page'}</span>
      </header>
      <div className="stage" ref={ref}>
        <div className="fitbox" style={{ width: box.w, height: box.h }} hidden={status === 'unavailable'}>
          <video ref={videoRef} playsInline muted />
          {pts && (
            <svg width={box.w} height={box.h} aria-hidden="true">
              <polygon points={pts} className="quad" />
              {quad!.map((p, i) => <circle key={i} cx={p.x * box.w} cy={p.y * box.h} r="6" className="corner" />)}
            </svg>
          )}
        </div>
        {status === 'live' && (
          <span className={'pill' + (quad ? ' ok' : '')}>{quad ? 'Document détecté' : 'Placez la feuille sur un fond sombre'}</span>
        )}
        {status === 'starting' && <p className="hint center">Ouverture de la caméra…</p>}
        {status === 'unavailable' && (
          <div className="empty">
            <h2>Caméra indisponible</h2>
            <p>L’accès à la caméra est refusé ou absent sur cet appareil. Vous pouvez prendre une photo avec l’appareil photo du téléphone ou choisir une image existante.</p>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? 'Ouverture…' : 'Prendre ou choisir une photo'}
            </button>
          </div>
        )}
      </div>
      <footer className="shoot">
        <button className="side" onClick={() => fileRef.current?.click()} disabled={busy}>Importer</button>
        <button className="shutter" onClick={shoot} disabled={status !== 'live'} aria-label="Prendre la photo" />
        {onDone ? <button className="side strong" onClick={onDone}>Terminer ({count})</button> : <span className="side" />}
      </footer>
      <input id="file-input" ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}
