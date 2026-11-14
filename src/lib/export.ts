// Export PDF / JPG / TXT et enregistrement des fichiers.
import type { PageRec } from './store';
import { blobToCanvas } from './imaging';

export type Quality = 'light' | 'standard' | 'max';
const QUALITY: Record<Quality, { side: number; q: number }> = {
  light: { side: 1200, q: 0.5 },
  standard: { side: 1700, q: 0.72 },
  max: { side: 2400, q: 0.9 },
};

export async function pageJpeg(page: PageRec, quality: Quality): Promise<{ dataUrl: string; w: number; h: number }> {
  const { side, q } = QUALITY[quality];
  const c = await blobToCanvas(page.blob, side);
  return { dataUrl: c.toDataURL('image/jpeg', q), w: c.width, h: c.height };
}

export async function buildPdf(pages: PageRec[], quality: Quality, searchable: boolean): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const PW = 210; // largeur A4 en mm
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const page of pages) {
    const { dataUrl, w, h } = await pageJpeg(page, quality);
    const ph = (PW * h) / w;
    const orientation = PW > ph ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ unit: 'mm', format: [PW, ph], orientation, compress: true });
    else pdf.addPage([PW, ph], orientation);
    pdf.addImage(dataUrl, 'JPEG', 0, 0, PW, ph, undefined, 'FAST');
    if (searchable && page.ocr) {
      const k = PW / page.w;
      for (const l of page.ocr.lines) {
        // Les polices PDF standard ne couvrent pas l'arabe : ces lignes restent en image seule.
        if (/[^\u0000-ɏ‐-›€]/.test(l.text)) continue;
        const hmm = (l.y1 - l.y0) * k;
        pdf.setFontSize(Math.max(4, hmm * 2.83465 * 0.78));
        pdf.text(l.text, l.x0 * k, l.y1 * k - hmm * 0.2, { renderingMode: 'invisible' });
      }
    }
  }
  return pdf!.output('blob');
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function safeName(title: string): string {
  // Nom de fichier sans accents ni caractères spéciaux, accepté par tous les systèmes.
  const ascii = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ascii.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'document';
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function canShareFiles(files: File[]): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files });
}
