import { useCallback, useState } from 'react';
import { Library } from './screens/Library';
import { Capture } from './screens/Capture';
import { Crop } from './screens/Crop';
import { Enhance } from './screens/Enhance';
import { DocView } from './screens/DocView';
import { type Quad, scaledCopy, warp } from './lib/imaging';
import { type DocRec, type PageRec, getDoc, newId, saveDoc } from './lib/store';

type View =
  | { name: 'library' }
  | { name: 'capture' }
  | { name: 'crop'; src: HTMLCanvasElement }
  | { name: 'enhance'; src: HTMLCanvasElement; warped: HTMLCanvasElement }
  | { name: 'doc'; id: string };

/** Scan en cours : pages déjà validées, et document cible si on ajoute des pages à un existant. */
interface Draft { docId?: string; pages: PageRec[]; thumb?: string }

function defaultTitle(): string {
  const d = new Date();
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return `Scan du ${day} à ${time}`;
}

export function App() {
  const [view, setView] = useState<View>({ name: 'library' });
  const [draft, setDraft] = useState<Draft>({ pages: [] });

  const startScan = useCallback((docId?: string) => {
    setDraft({ docId, pages: [] });
    setView({ name: 'capture' });
  }, []);

  const cancelScan = () => {
    setView(draft.docId ? { name: 'doc', id: draft.docId } : { name: 'library' });
    setDraft({ pages: [] });
  };

  const finish = async (pages: PageRec[], thumb: string) => {
    let doc: DocRec;
    const existing = draft.docId ? await getDoc(draft.docId) : undefined;
    if (existing) doc = { ...existing, pages: [...existing.pages, ...pages] };
    else doc = { id: newId(), title: defaultTitle(), createdAt: Date.now(), pages, thumb };
    await saveDoc(doc);
    setDraft({ pages: [] });
    setView({ name: 'doc', id: doc.id });
  };

  switch (view.name) {
    case 'library':
      return <Library onScan={() => startScan()} onOpen={(id) => setView({ name: 'doc', id })} />;
    case 'capture':
      return (
        <Capture
          count={draft.pages.length}
          onShot={(src) => setView({ name: 'crop', src })}
          onClose={cancelScan}
          onDone={draft.pages.length ? () => finish(draft.pages, draft.thumb!) : undefined}
        />
      );
    case 'crop':
      return (
        <Crop
          src={view.src}
          pageNumber={draft.pages.length + 1}
          onRetake={() => setView({ name: 'capture' })}
          onNext={(src: HTMLCanvasElement, quad: Quad) => setView({ name: 'enhance', src, warped: warp(src, quad) })}
        />
      );
    case 'enhance':
      return (
        <Enhance
          warped={view.warped}
          pageNumber={draft.pages.length + 1}
          onBack={() => setView({ name: 'crop', src: view.src })}
          onAccept={(page, canvas, more) => {
            const thumb = draft.thumb ?? scaledCopy(canvas, 160).toDataURL('image/jpeg', 0.7);
            const pages = [...draft.pages, page];
            if (more) {
              setDraft({ ...draft, pages, thumb });
              setView({ name: 'capture' });
            } else {
              void finish(pages, thumb);
            }
          }}
        />
      );
    case 'doc':
      return <DocView id={view.id} onBack={() => setView({ name: 'library' })} onAddPage={() => startScan(view.id)} />;
  }
}
