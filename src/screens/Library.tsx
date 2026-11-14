import { useEffect, useMemo, useState } from 'react';
import { type DocMeta, formatDate, formatSize, listDocs } from '../lib/store';

export function Library({ onScan, onOpen }: { onScan: () => void; onOpen: (id: string) => void }) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    listDocs().then(setDocs).catch(() => setDocs([]));
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!docs || !needle) return docs ?? [];
    return docs.filter((d) => d.title.toLowerCase().includes(needle) || d.text.toLowerCase().includes(needle));
  }, [docs, q]);

  return (
    <div className="screen">
      <header className="bar">
        <h1>Mes documents</h1>
        {docs && docs.length > 0 && <span className="count">{docs.length}</span>}
      </header>
      {docs && docs.length > 0 && (
        <div className="pad">
          <input
            id="search"
            className="search"
            type="search"
            placeholder="Rechercher un titre ou un mot du texte"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      )}
      <main className="scroll">
        {docs && docs.length === 0 && (
          <div className="empty">
            <div className="empty-sheet" aria-hidden="true"><i /><i /><i /><i /></div>
            <h2>Aucun document pour l’instant</h2>
            <p>Photographiez une facture, un contrat ou une page de cours. Le scan est redressé, nettoyé et rangé ici, sans quitter votre appareil.</p>
            <button className="btn" onClick={onScan}>Scanner un document</button>
          </div>
        )}
        {docs && docs.length > 0 && shown.length === 0 && <p className="hint center">Aucun document ne contient « {q} ».</p>}
        <ul className="doclist">
          {shown.map((d) => (
            <li key={d.id}>
              <button className="doc" onClick={() => onOpen(d.id)}>
                <img src={d.thumb} alt="" />
                <span>
                  <b>{d.title}</b>
                  <small>
                    {d.pageCount} page{d.pageCount > 1 ? 's' : ''} · {formatSize(d.size)} · {formatDate(d.createdAt)}
                    {d.text ? ' · texte lu' : ''}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
      {docs && docs.length > 0 && (
        <button className="fab" onClick={onScan} aria-label="Scanner un document">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M8 12h8" />
          </svg>
          Scanner
        </button>
      )}
    </div>
  );
}
