// Stockage local des documents (IndexedDB). Rien ne quitte l'appareil.
import { get, set, del } from 'idb-keyval';

export interface OcrLine { text: string; x0: number; y0: number; x1: number; y1: number }
export interface PageRec { blob: Blob; w: number; h: number; ocr?: { text: string; lines: OcrLine[] } }
export interface DocRec { id: string; title: string; createdAt: number; pages: PageRec[]; thumb: string }
export interface DocMeta { id: string; title: string; createdAt: number; pageCount: number; size: number; thumb: string; text: string }

const INDEX = 'feuillet:index';
const key = (id: string) => `feuillet:doc:${id}`;

export async function listDocs(): Promise<DocMeta[]> {
  return ((await get<DocMeta[]>(INDEX)) ?? []).sort((a, b) => b.createdAt - a.createdAt);
}

export function getDoc(id: string): Promise<DocRec | undefined> {
  return get<DocRec>(key(id));
}

export async function saveDoc(doc: DocRec): Promise<void> {
  await set(key(doc.id), doc);
  const meta: DocMeta = {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    pageCount: doc.pages.length,
    size: doc.pages.reduce((s, p) => s + p.blob.size, 0),
    thumb: doc.thumb,
    text: doc.pages.map((p) => p.ocr?.text ?? '').join('\n'),
  };
  const index = (await get<DocMeta[]>(INDEX)) ?? [];
  await set(INDEX, [meta, ...index.filter((m) => m.id !== doc.id)]);
}

export async function deleteDoc(id: string): Promise<void> {
  await del(key(id));
  const index = (await get<DocMeta[]>(INDEX)) ?? [];
  await set(INDEX, index.filter((m) => m.id !== id));
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
