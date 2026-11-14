import { useEffect, useMemo, useState } from 'react';
import { type DocRec, deleteDoc, formatDate, formatSize, getDoc, saveDoc } from '../lib/store';
import { LANGS, ocrPages } from '../lib/ocr';
import { type Quality, buildPdf, canShareFiles, dataUrlToBlob, download, pageJpeg, safeName } from '../lib/export';

type Format = 'pdf' | 'jpg' | 'txt';
const LANG_KEY = 'feuillet:lang';

function readLang(): string {
  try { return localStorage.getItem(LANG_KEY) || 'fra'; } catch { return 'fra'; }
}

export function DocView({ id, onBack, onAddPage }: { id: string; onBack: () => void; onAddPage: () => void }) {
  const [doc, setDoc] = useState<DocRec | null>(null);
  const [missing, setMissing] = useState(false);
  const [panel, setPanel] = useState<'none' | 'text' | 'export' | 'delete'>('none');
  const [lang, setLang] = useState(readLang);
  const [progress, setProgress] = useState<{ label: string; ratio: number } | null>(null);
  const [error, setError] = useState('');
  const [format, setFormat] = useState<Format>('pdf');
  const [quality, setQuality] = useState<Quality>('standard');
  const [searchable, setSearchable] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getDoc(id).then((d) => (d ? setDoc(d) : setMissing(true)));
  }, [id]);

  const urls = useMemo(() => doc?.pages.map((p) => URL.createObjectURL(p.blob)) ?? [], [doc]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  if (missing) {
    return (
      <div className="screen">
        <header className="bar"><button className="link" onClick={onBack}>Documents</button></header>
        <p className="hint center">Ce document n’existe plus.</p>
      </div>
    );
  }
  if (!doc) return <div className="screen"><p className="hint center">Ouverture…</p></div>;

  const hasText = doc.pages.every((p) => p.ocr);
  const text = doc.pages.map((p) => p.ocr?.text ?? '').join('\n\n').trim();
  const size = doc.pages.reduce((s, p) => s + p.blob.size, 0);
  const busy = progress !== null;

  const update = async (next: DocRec) => {
    setDoc(next);
    await saveDoc(next);
  };

  const runOcr = async (): Promise<DocRec | null> => {
    setError('');
    setProgress({ label: 'Préparation du moteur de lecture', ratio: 0 });
    try {
      const results = await ocrPages(doc.pages, lang, (label, ratio) => setProgress({ label, ratio }));
      const next = { ...doc, pages: doc.pages.map((p, i) => ({ ...p, ocr: results[i] })) };
      await update(next);
      return next;
    } catch {
      setError('La lecture du texte a échoué. Vérifiez la connexion pour charger le moteur de lecture, puis réessayez.');
      return null;
    } finally {
      setProgress(null);
    }
  };

  const changeLang = (code: string) => {
    setLang(code);
    try { localStorage.setItem(LANG_KEY, code); } catch { /* préférence non enregistrée */ }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Copie impossible. Sélectionnez le texte à la main.');
    }
  };

  const makeFiles = async (): Promise<File[] | null> => {
    setError('');
    const name = safeName(doc.title);
    let current = doc;
    if ((format === 'txt' || (format === 'pdf' && searchable)) && !hasText) {
      const next = await runOcr();
      if (!next) return null;
      current = next;
    }
    setProgress({ label: 'Création du fichier', ratio: 1 });
    try {
      if (format === 'pdf') {
        return [new File([await buildPdf(current.pages, quality, searchable)], `${name}.pdf`, { type: 'application/pdf' })];
      }
      if (format === 'txt') {
        const t = current.pages.map((p) => p.ocr?.text ?? '').join('\n\n');
        return [new File([t], `${name}.txt`, { type: 'text/plain' })];
      }
      const files: File[] = [];
      for (let i = 0; i < current.pages.length; i++) {
        const { dataUrl } = await pageJpeg(current.pages[i], quality);
        const suffix = current.pages.length > 1 ? `-${i + 1}` : '';
        files.push(new File([dataUrlToBlob(dataUrl)], `${name}${suffix}.jpg`, { type: 'image/jpeg' }));
      }
      return files;
    } catch {
      setError('La création du fichier a échoué. Essayez une qualité plus légère.');
      return null;
    } finally {
      setProgress(null);
    }
  };

  const exportNow = async (share: boolean) => {
    const files = await makeFiles();
    if (!files) return;
    if (share && canShareFiles(files)) {
      try { await navigator.share({ files, title: doc.title }); } catch { /* partage annulé */ }
    } else {
      files.forEach((f, i) => setTimeout(() => download(f, f.name), i * 400));
    }
    setPanel('none');
  };

  const removePage = (i: number) => {
    if (doc.pages.length === 1) return setPanel('delete');
    void update({ ...doc, pages: doc.pages.filter((_, k) => k !== i) });
  };

  const shareSupported = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';

  return (
    <div className="screen">
      <header className="bar">
        <button className="link" onClick={onBack}>Documents</button>
        <button className="link danger" onClick={() => setPanel('delete')}>Supprimer</button>
      </header>
      <div className="pad">
        <input
          id="doc-title"
          className="title"
          aria-label="Titre du document"
          value={doc.title}
          onChange={(e) => setDoc({ ...doc, title: e.target.value })}
          onBlur={() => saveDoc(doc)}
        />
        <p className="hint">
          {doc.pages.length} page{doc.pages.length > 1 ? 's' : ''} · {formatSize(size)} · {formatDate(doc.createdAt)}
        </p>
      </div>
      <main className="scroll pages">
        {doc.pages.map((_, i) => (
          <figure key={urls[i]}>
            <img src={urls[i]} alt={`Page ${i + 1}`} />
            <figcaption>
              <span>Page {i + 1}</span>
              <button className="link danger" onClick={() => removePage(i)}>Retirer</button>
            </figcaption>
          </figure>
        ))}
      </main>
      <footer className="tools">
        <button className="btn ghost" onClick={onAddPage}>+ Page</button>
        <button className="btn ghost" onClick={() => setPanel('text')}>Texte</button>
        <button className="btn" onClick={() => setPanel('export')}>Exporter</button>
      </footer>

      {panel !== 'none' && (
        <div className="scrim" onClick={() => !busy && setPanel('none')}>
          <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {panel === 'text' && (
              <>
                <div className="sheet-head"><h2>Texte du document</h2><button className="link" disabled={busy} onClick={() => setPanel('none')}>Fermer</button></div>
                <label className="field" htmlFor="ocr-lang">
                  Langue du document
                  <select id="ocr-lang" value={lang} disabled={busy} onChange={(e) => changeLang(e.target.value)}>
                    {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </label>
                {hasText && <textarea id="ocr-text" className="ocr" readOnly dir="auto" value={text || '(aucun texte trouvé sur ces pages)'} />}
                {!hasText && !busy && <p className="hint">Le texte est lu sur votre appareil, rien n’est envoyé. La première lecture charge le moteur (quelques Mo) et prend un peu plus de temps.</p>}
                {busy && <Progress {...progress!} />}
                {error && <p className="error">{error}</p>}
                <div className="row">
                  <button className="btn ghost" disabled={busy} onClick={runOcr}>{hasText ? 'Relire' : 'Lire le texte'}</button>
                  {hasText && text && <button className="btn" onClick={copy}>{copied ? 'Copié' : 'Copier'}</button>}
                </div>
              </>
            )}
            {panel === 'export' && (
              <>
                <div className="sheet-head"><h2>Exporter</h2><button className="link" disabled={busy} onClick={() => setPanel('none')}>Annuler</button></div>
                <Segment label="Format" value={format} onChange={setFormat} options={[['pdf', 'PDF'], ['jpg', 'JPG'], ['txt', 'Texte']]} />
                {format !== 'txt' && (
                  <Segment label="Qualité" value={quality} onChange={setQuality} options={[['light', 'Légère'], ['standard', 'Standard'], ['max', 'Maximale']]} />
                )}
                {format === 'pdf' && (
                  <label className="switch" htmlFor="searchable">
                    <span>PDF interrogeable<small>Texte sélectionnable et recherchable (caractères latins)</small></span>
                    <input id="searchable" type="checkbox" checked={searchable} onChange={(e) => setSearchable(e.target.checked)} />
                  </label>
                )}
                {busy && <Progress {...progress!} />}
                {error && <p className="error">{error}</p>}
                <div className="row">
                  {shareSupported && <button className="btn ghost" disabled={busy} onClick={() => exportNow(true)}>Partager</button>}
                  <button className="btn" disabled={busy} onClick={() => exportNow(false)}>Télécharger</button>
                </div>
              </>
            )}
            {panel === 'delete' && (
              <>
                <div className="sheet-head"><h2>Supprimer ce document ?</h2></div>
                <p className="hint">« {doc.title} » et ses {doc.pages.length} page{doc.pages.length > 1 ? 's' : ''} seront effacés de cet appareil. Cette action est définitive.</p>
                <div className="row">
                  <button className="btn ghost" onClick={() => setPanel('none')}>Conserver</button>
                  <button className="btn danger" onClick={async () => { await deleteDoc(doc.id); onBack(); }}>Supprimer</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Progress({ label, ratio }: { label: string; ratio: number }) {
  return (
    <div className="progress" role="status">
      <span>{label}</span>
      <div><i style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
    </div>
  );
}

function Segment<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="field">
      {label}
      <div className="segment" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}
