# Feuillet

Scanner de documents dans le navigateur : photo, détection de la feuille, recadrage,
filtres, lecture du texte (OCR) et export PDF. Tout le traitement se fait sur l'appareil,
les documents sont enregistrés localement (IndexedDB) et ne sont envoyés nulle part.

## Tester sur Vercel

1. Sur vercel.com : **Add New → Project**, puis importer ce dépôt GitHub.
2. Vercel détecte Vite. Laisser les réglages proposés (`npm run build`, dossier `dist`).
3. **Deploy**, puis ouvrir l'adresse fournie sur un téléphone (la caméra exige HTTPS, ce que Vercel fournit).

## En local

```bash
npm install
npm run dev
```

## Organisation

- `src/lib/imaging.ts` : détection du contour, redressement de perspective, filtres
- `src/lib/ocr.ts` : lecture du texte (Tesseract en WebAssembly, servi depuis `/ocr`)
- `src/lib/export.ts` : PDF (avec calque de texte), JPG, TXT
- `src/lib/store.ts` : stockage local des documents
- `src/screens/` : Bibliothèque, Capture, Recadrage, Amélioration, Document
- `docs/etude-feuillet.html` : maquette et étude du projet
