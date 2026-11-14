// Reconnaissance de texte dans le navigateur (Tesseract compilé en WebAssembly).
// Le moteur et les langues sont servis par l'application elle-même (dossier /ocr), sans serveur tiers.
import type { PageRec } from './store';

export const LANGS: { code: string; label: string }[] = [
  { code: 'fra', label: 'Français' },
  { code: 'fra+ara', label: 'Français + arabe' },
  { code: 'ara', label: 'Arabe' },
  { code: 'eng', label: 'Anglais' },
  { code: 'fra+eng', label: 'Français + anglais' },
];

export async function ocrPages(
  pages: PageRec[],
  langs: string,
  onProgress: (label: string, ratio: number) => void,
): Promise<NonNullable<PageRec['ocr']>[]> {
  const { createWorker } = await import('tesseract.js');
  let current = 0;
  const worker = await createWorker(langs.split('+'), 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr',
    langPath: '/ocr/lang',
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress(`Lecture de la page ${current + 1} sur ${pages.length}`, (current + m.progress) / pages.length);
      } else {
        onProgress('Préparation du moteur de lecture', 0);
      }
    },
  });
  try {
    const results: NonNullable<PageRec['ocr']>[] = [];
    for (current = 0; current < pages.length; current++) {
      const { data } = await worker.recognize(pages[current].blob, {}, { text: true, blocks: true });
      const lines = (data.blocks ?? []).flatMap((b) =>
        b.paragraphs.flatMap((p) =>
          p.lines.map((l) => ({ text: l.text.trim(), x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 })),
        ),
      ).filter((l) => l.text);
      results.push({ text: data.text.trim(), lines });
    }
    return results;
  } finally {
    await worker.terminate();
  }
}
