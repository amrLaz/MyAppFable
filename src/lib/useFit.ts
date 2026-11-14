import { useEffect, useRef, useState } from 'react';

/** Calcule la plus grande boîte de rapport `ratio` (largeur / hauteur) qui tient dans le conteneur. */
export function useFit(ratio: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch || !ratio) return;
      const w = Math.min(cw, ch * ratio);
      setBox({ w: Math.floor(w), h: Math.floor(w / ratio) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  return { ref, box };
}
