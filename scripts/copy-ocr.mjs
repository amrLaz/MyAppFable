// Copie le moteur de lecture de texte et les langues dans public/ocr,
// pour que l'application ne dépende d'aucun serveur tiers.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const out = 'public/ocr';
mkdirSync(`${out}/lang`, { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`);
for (const f of readdirSync('node_modules/tesseract.js-core')) {
  if (f.endsWith('lstm.wasm.js')) cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/${f}`);
}
for (const lang of ['fra', 'ara', 'eng']) {
  cpSync(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `${out}/lang/${lang}.traineddata.gz`);
}
console.log('Moteur OCR copié dans public/ocr');
