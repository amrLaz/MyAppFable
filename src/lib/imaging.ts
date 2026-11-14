// Traitement d'image local : détection du document, redressement, filtres.

export interface Pt { x: number; y: number }
/** Coins normalisés (0..1) dans l'ordre : haut-gauche, haut-droit, bas-droit, bas-gauche. */
export type Quad = [Pt, Pt, Pt, Pt];
export type Filter = 'original' | 'auto' | 'bw' | 'gray' | 'light';

export const FULL_QUAD: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export const DEFAULT_QUAD: Quad = [{ x: 0.06, y: 0.06 }, { x: 0.94, y: 0.06 }, { x: 0.94, y: 0.94 }, { x: 0.06, y: 0.94 }];

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true })!;
}

export async function blobToCanvas(blob: Blob, maxSide = 4000): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = makeCanvas(bmp.width * s, bmp.height * s);
  ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export function scaledCopy(src: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = makeCanvas(src.width * s, src.height * s);
  ctx2d(c).drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function rotate90(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.height, src.width);
  const ctx = ctx2d(c);
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('Conversion de l’image impossible'))), 'image/jpeg', quality),
  );
}

/** Image en niveaux de gris réduite à `side` pixels sur son grand côté. */
function grayAt(source: CanvasImageSource, sw: number, sh: number, side: number) {
  const s = side / Math.max(sw, sh);
  const w = Math.max(8, Math.round(sw * s));
  const h = Math.max(8, Math.round(sh * s));
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return { g, w, h };
}

function box3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : y, y1 = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : x, x1 = x < w - 1 ? x + 1 : x;
      out[y * w + x] =
        (src[y0 * w + x0] + src[y0 * w + x] + src[y0 * w + x1] +
          src[y * w + x0] + src[y * w + x] + src[y * w + x1] +
          src[y1 * w + x0] + src[y1 * w + x] + src[y1 * w + x1]) / 9;
    }
  }
  return out;
}

/** Érosion (keep = 1) ou dilatation (keep = 0) d'un masque binaire, voisinage en croix. */
function morph(mask: Uint8Array, w: number, h: number, erode: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = x > 0 ? mask[i - 1] : mask[i], r = x < w - 1 ? mask[i + 1] : mask[i];
      const u = y > 0 ? mask[i - w] : mask[i], d = y < h - 1 ? mask[i + w] : mask[i];
      out[i] = erode ? mask[i] & l & r & u & d : mask[i] | l | r | u | d;
    }
  }
  return out;
}

function otsu(g: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (total - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function convexHull(points: Pt[]): Pt[] {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const hull: Pt[] = [];
  for (const pass of [p, p.slice().reverse()]) {
    const start = hull.length;
    for (const pt of pass) {
      while (hull.length - start >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], pt) <= 0) hull.pop();
      hull.push(pt);
    }
    hull.pop();
  }
  return hull;
}

function intersect(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * Réduit un polygone convexe à quatre côtés : on supprime tour à tour le côté
 * dont la disparition (en prolongeant ses deux voisins) ajoute le moins de surface.
 * Les quatre côtés restants suivent les quatre vrais bords de la feuille,
 * même si elle est tournée ou si un coin est corné.
 */
function reduceToQuad(hull: Pt[]): Pt[] | null {
  const v = hull.slice();
  while (v.length > 4) {
    const n = v.length;
    let bestI = -1, bestArea = Infinity, bestP: Pt | null = null;
    for (let i = 0; i < n; i++) {
      const a = v[(i + n - 1) % n], b = v[i], c = v[(i + 1) % n], d = v[(i + 2) % n];
      const P = intersect(a, { x: b.x - a.x, y: b.y - a.y }, d, { x: c.x - d.x, y: c.y - d.y });
      if (!P) continue;
      // Le point d'intersection doit se trouver au-delà du côté supprimé, du côté extérieur.
      if ((P.x - b.x) * (b.x - a.x) + (P.y - b.y) * (b.y - a.y) < 0) continue;
      if ((P.x - c.x) * (c.x - d.x) + (P.y - c.y) * (c.y - d.y) < 0) continue;
      const area = Math.abs(cross(b, P, c)) / 2;
      if (area < bestArea) { bestArea = area; bestI = i; bestP = P; }
    }
    if (bestI < 0 || !bestP) return null;
    v[bestI] = bestP;
    v.splice((bestI + 1) % n, 1);
  }
  return v.length === 4 ? v : null;
}

/**
 * Trouve les quatre droites qui portent le plus de points du contour (tirages
 * aléatoires de paires de points, puis ajustement). Un objet clair collé à la
 * feuille ou un coin corné ne forme qu'un petit segment et n'est donc pas retenu.
 */
function dominantQuad(pts: Pt[], size: number): Pt[] | null {
  let seed = 12345;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  const minLen = size * 0.12;
  let rest = pts.slice();
  const lines: { p: Pt; d: Pt; ang: number }[] = [];
  for (let attempt = 0; lines.length < 4 && attempt < 7; attempt++) {
    if (rest.length < minLen) return null;
    let bestN = 0, bp: Pt | null = null, bd: Pt | null = null;
    for (let it = 0; it < 350; it++) {
      const a = rest[(rand() * rest.length) | 0], b = rest[(rand() * rest.length) | 0];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < minLen) continue;
      const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
      let cnt = 0;
      for (const q of rest) if (Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) <= 1.5) cnt++;
      if (cnt > bestN) { bestN = cnt; bp = a; bd = { x: dx, y: dy }; }
    }
    if (!bp || !bd || bestN < minLen) return null;
    // Ajustement de la droite sur ses points.
    const inl = rest.filter((q) => Math.abs((q.x - bp!.x) * bd!.y - (q.y - bp!.y) * bd!.x) <= 2);
    let mx = 0, my = 0;
    for (const q of inl) { mx += q.x; my += q.y; }
    mx /= inl.length; my /= inl.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const q of inl) { sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; sxy += (q.x - mx) * (q.y - my); }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const d = { x: Math.cos(ang), y: Math.sin(ang) };
    rest = rest.filter((q) => Math.abs((q.x - mx) * d.y - (q.y - my) * d.x) > 4);
    // Écarte un doublon : presque parallèle à un côté déjà trouvé et tout proche de lui.
    const dup = lines.some((l) => Math.abs(l.d.x * d.x + l.d.y * d.y) > 0.96 && Math.abs((mx - l.p.x) * l.d.y - (my - l.p.y) * l.d.x) < size * 0.08);
    if (!dup) lines.push({ p: { x: mx, y: my }, d, ang: Math.atan2(my - cy, mx - cx) });
  }
  if (lines.length < 4) return null;
  lines.sort((a, b) => a.ang - b.ang);
  const quad: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const P = intersect(lines[i].p, lines[i].d, lines[(i + 1) % 4].p, lines[(i + 1) % 4].d);
    if (!P) return null;
    quad.push(P);
  }
  // Le résultat doit être convexe et rester dans l'image (avec une petite tolérance).
  const sign = Math.sign(cross(quad[0], quad[1], quad[2]));
  for (let i = 0; i < 4; i++) {
    if (Math.sign(cross(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4])) !== sign) return null;
  }
  return quad;
}

/**
 * Affine chaque côté sur une image plus fine : le long du côté, on cherche de part
 * et d'autre le plus fort passage clair → sombre, puis on ajuste une droite sur ces points.
 */
function refineQuad(quad: Pt[], g: Uint8Array, w: number, h: number): Pt[] {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const reach = Math.max(6, Math.round(Math.max(w, h) * 0.03));
  const at = (x: number, y: number) => {
    const xi = x < 0 ? 0 : x > w - 1 ? w - 1 : Math.round(x);
    const yi = y < 0 ? 0 : y > h - 1 ? h - 1 : Math.round(y);
    return g[yi * w + xi];
  };
  const lines: { p: Pt; d: Pt }[] = [];
  for (let s = 0; s < 4; s++) {
    const a = quad[s], b = quad[(s + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let nx = -dir.y, ny = dir.x;
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    let pts: Pt[] = [];
    const N = 48;
    for (let k = 0; k < N; k++) {
      const t = 0.08 + (0.84 * k) / (N - 1);
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      let best = 10, bestD = NaN; // contraste minimal pour compter comme un bord
      for (let d = -reach; d <= reach; d++) {
        const inside = at(px + nx * (d - 2), py + ny * (d - 2)) + at(px + nx * (d - 3), py + ny * (d - 3));
        const outside = at(px + nx * (d + 2), py + ny * (d + 2)) + at(px + nx * (d + 3), py + ny * (d + 3));
        const grad = (inside - outside) / 2;
        if (grad > best) { best = grad; bestD = d; }
      }
      if (!Number.isNaN(bestD)) pts.push({ x: px + nx * bestD, y: py + ny * bestD });
    }
    let line = { p: a, d: dir };
    // Ajustement par moindres carrés, en écartant deux fois les points aberrants.
    for (let iter = 0; iter < 3 && pts.length >= 10; iter++) {
      let mx = 0, my = 0;
      for (const q of pts) { mx += q.x; my += q.y; }
      mx /= pts.length; my /= pts.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const q of pts) { sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; sxy += (q.x - mx) * (q.y - my); }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      line = { p: { x: mx, y: my }, d: { x: Math.cos(ang), y: Math.sin(ang) } };
      const res = pts.map((q) => Math.abs((q.x - mx) * -line.d.y + (q.y - my) * line.d.x));
      const sorted = res.slice().sort((x, y) => x - y);
      const limit = Math.max(1.2, sorted[sorted.length >> 1] * 2.5);
      pts = pts.filter((_, i) => res[i] <= limit);
    }
    // On ne garde la droite affinée que si elle reste proche du côté de départ.
    if (Math.abs(line.d.x * dir.x + line.d.y * dir.y) < 0.985) line = { p: a, d: dir };
    lines.push(line);
  }
  return quad.map((orig, i) => {
    const P = intersect(lines[(i + 3) % 4].p, lines[(i + 3) % 4].d, lines[i].p, lines[i].d);
    return P && Math.hypot(P.x - orig.x, P.y - orig.y) < reach * 2.5 ? P : orig;
  });
}

/**
 * Cherche la feuille dans l'image.
 * 1. Zone claire principale (seuil d'Otsu, nettoyage morphologique) sur une image réduite.
 * 2. Enveloppe convexe réduite à ses quatre côtés dominants.
 * 3. Si `precise`, chaque côté est recalé sur le vrai bord dans une image plus fine.
 * Renvoie null si rien de convaincant (fond aussi clair que la feuille, feuille hors cadre...).
 */
export function detectQuad(source: CanvasImageSource, sw: number, sh: number, precise = true): Quad | null {
  if (!sw || !sh) return null;
  const fine = precise ? grayAt(source, sw, sh, 960) : null;
  const { g: raw, w, h } = grayAt(fine ? sourceFromGray(fine) : source, fine ? fine.w : sw, fine ? fine.h : sh, 240);
  const g = box3(raw, w, h);
  const n = w * h;
  const thr = otsu(g);
  let mask: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = g[i] > thr ? 1 : 0;
  // Ouverture : coupe les ponts fins vers d'autres objets clairs et les reflets isolés.
  mask = morph(morph(mask, w, h, true), w, h, true);
  mask = morph(morph(mask, w, h, false), w, h, false);

  // Plus grande zone claire d'un seul tenant ; on retient ses extrémités ligne par ligne.
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let bestCount = 0;
  let bestRows: Int32Array | null = null;
  let bestCols: Int32Array | null = null;
  for (let start = 0; start < n; start++) {
    if (seen[start] || !mask[start]) continue;
    const rows = new Int32Array(h * 2).fill(-1);
    const cols = new Int32Array(w * 2).fill(-1);
    let sp = 0, count = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp) {
      const i = stack[--sp];
      count++;
      const x = i % w, y = (i - x) / w;
      if (rows[y * 2] < 0 || x < rows[y * 2]) rows[y * 2] = x;
      if (x > rows[y * 2 + 1]) rows[y * 2 + 1] = x;
      if (cols[x * 2] < 0 || y < cols[x * 2]) cols[x * 2] = y;
      if (y > cols[x * 2 + 1]) cols[x * 2 + 1] = y;
      if (x > 0 && !seen[i - 1] && mask[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && !seen[i + 1] && mask[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !seen[i - w] && mask[i - w]) { seen[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && !seen[i + w] && mask[i + w]) { seen[i + w] = 1; stack[sp++] = i + w; }
    }
    if (count > bestCount) { bestCount = count; bestRows = rows; bestCols = cols; }
  }
  if (!bestRows || !bestCols || bestCount < n * 0.1) return null;

  const border: Pt[] = [];
  for (let y = 0; y < h; y++) {
    if (bestRows[y * 2] < 0) continue;
    // Bords des pixels (et non leurs centres) pour ne pas rogner la feuille d'un demi-pixel.
    border.push({ x: bestRows[y * 2], y }, { x: bestRows[y * 2], y: y + 1 }, { x: bestRows[y * 2 + 1] + 1, y }, { x: bestRows[y * 2 + 1] + 1, y: y + 1 });
  }
  // Points du contour (centres des pixels de bord, décalés d'un demi-pixel vers l'extérieur).
  const contour: Pt[] = [];
  for (let y = 0; y < h; y++) {
    if (bestRows[y * 2] < 0) continue;
    contour.push({ x: bestRows[y * 2], y: y + 0.5 }, { x: bestRows[y * 2 + 1] + 1, y: y + 0.5 });
  }
  for (let x = 0; x < w; x++) {
    if (bestCols[x * 2] < 0) continue;
    contour.push({ x: x + 0.5, y: bestCols[x * 2] }, { x: x + 0.5, y: bestCols[x * 2 + 1] + 1 });
  }
  const inFrame = (q: Pt[] | null) => !!q && q.every((p) => p.x > -w * 0.08 && p.x < w * 1.08 && p.y > -h * 0.08 && p.y < h * 1.08);
  let quad = dominantQuad(contour, Math.min(w, h));
  if (!inFrame(quad)) quad = reduceToQuad(convexHull(border));
  if (!quad) return null;

  let area = 0;
  for (let i = 0; i < 4; i++) area += quad[i].x * quad[(i + 1) % 4].y - quad[(i + 1) % 4].x * quad[i].y;
  area = Math.abs(area) / 2;
  // La zone claire doit remplir le quadrilatère, qui ne doit être ni minuscule ni égal au cadre entier.
  if (area < n * 0.08 || area > n * 0.985 || bestCount / area < 0.72 || bestCount / area > 1.35) return null;

  let W = w, H = h;
  if (fine) {
    const k = fine.w / w;
    quad = refineQuad(quad.map((p) => ({ x: p.x * k, y: p.y * k })), box3(fine.g, fine.w, fine.h), fine.w, fine.h);
    W = fine.w; H = fine.h;
  }

  // Ordre : haut-gauche, haut-droit, bas-droit, bas-gauche.
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const sorted = quad.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[first].x + sorted[first].y) first = i;
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return [0, 1, 2, 3].map((i) => {
    const p = sorted[(first + i) % 4];
    return { x: clamp(p.x / W), y: clamp(p.y / H) };
  }) as Quad;
}

/** Canevas gris temporaire, pour réduire une seconde fois sans relire la source d'origine. */
function sourceFromGray(img: { g: Uint8Array; w: number; h: number }): HTMLCanvasElement {
  const c = makeCanvas(img.w, img.h);
  const ctx = ctx2d(c);
  const id = ctx.createImageData(img.w, img.h);
  for (let i = 0, j = 0; i < img.g.length; i++, j += 4) {
    id.data[j] = id.data[j + 1] = id.data[j + 2] = img.g[i];
    id.data[j + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    [b[i], b[piv]] = [b[piv], b[i]];
    const d = A[i][i] || 1e-12;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / d;
      if (!f) continue;
      for (let k = i; k < n; k++) A[r][k] -= f * A[i][k];
      b[r] -= f * b[i];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= A[i][k] * x[k];
    x[i] = s / (A[i][i] || 1e-12);
  }
  return x;
}

/**
 * Mesure la courbure réelle de chaque bord de la feuille (papier bombé, plié, corné).
 * Pour chaque côté, on relève l'écart entre la corde tendue entre les deux coins et
 * le vrai bord, en plusieurs points. Renvoie ces écarts, en pixels de la source,
 * avec la direction (normale extérieure) dans laquelle ils s'appliquent.
 */
function edgeCurves(src: HTMLCanvasElement, p: Pt[]) {
  const N = 64;
  const { g: raw, w, h } = grayAt(src, src.width, src.height, 1000);
  const g = box3(raw, w, h);
  const k = w / src.width;
  const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4, cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;
  const reach = Math.round(Math.max(w, h) * 0.035);
  const at = (x: number, y: number) => {
    const xi = x < 0 ? 0 : x > w - 1 ? w - 1 : Math.round(x);
    const yi = y < 0 ? 0 : y > h - 1 ? h - 1 : Math.round(y);
    return g[yi * w + xi];
  };
  // Côtés dans l'ordre : haut (0→1), droite (1→2), bas (3→2), gauche (0→3).
  const sides: [number, number][] = [[0, 1], [1, 2], [3, 2], [0, 3]];
  return sides.map(([ia, ib]) => {
    const a = p[ia], b = p[ib];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const dev = new Float32Array(N + 1);
    const ok = new Uint8Array(N + 1);
    let found = 0;
    for (let s = 2; s <= N - 2; s++) {
      const t = s / N;
      const px = (a.x + (b.x - a.x) * t) * k, py = (a.y + (b.y - a.y) * t) * k;
      let best = 9, bestD = NaN;
      for (let dd = -reach; dd <= reach; dd++) {
        const inside = at(px + nx * (dd - 2), py + ny * (dd - 2)) + at(px + nx * (dd - 3), py + ny * (dd - 3));
        const outside = at(px + nx * (dd + 2), py + ny * (dd + 2)) + at(px + nx * (dd + 3), py + ny * (dd + 3));
        // À contraste égal, on préfère le bord le plus proche de la corde.
        const grad = (inside - outside) / 2 - Math.abs(dd) * 0.15;
        if (grad > best) { best = grad; bestD = dd; }
      }
      if (!Number.isNaN(bestD)) { dev[s] = bestD; ok[s] = 1; found++; }
    }
    const flat = { nx, ny, dev: new Float32Array(N + 1) };
    if (found < N * 0.6) return flat;
    // Aux deux bouts, on prolonge la première et la dernière mesure : un coin posé un peu
    // à côté (bord courbe) est ainsi ramené sur la feuille. Les trous sont interpolés.
    let first = 2, lastOk = N - 2;
    while (!ok[first]) first++;
    while (!ok[lastOk]) lastOk--;
    ok[0] = ok[N] = 1; dev[0] = dev[first]; dev[N] = dev[lastOk];
    for (let s = 1, last = 0; s <= N; s++) {
      if (!ok[s]) continue;
      for (let m = last + 1; m < s; m++) dev[m] = dev[last] + ((dev[s] - dev[last]) * (m - last)) / (s - last);
      last = s;
    }
    // Médiane glissante (écarte les faux bords isolés) puis lissage.
    const med = new Float32Array(N + 1);
    for (let s = 0; s <= N; s++) {
      const win: number[] = [];
      for (let m = -3; m <= 3; m++) win.push(dev[Math.min(N, Math.max(0, s + m))]);
      med[s] = win.sort((x, y) => x - y)[3];
    }
    let max = 0;
    for (let s = 0; s <= N; s++) {
      let sum = 0;
      for (let m = -2; m <= 2; m++) sum += med[Math.min(N, Math.max(0, s + m))];
      flat.dev[s] = sum / 5 / k;
      max = Math.max(max, Math.abs(flat.dev[s] * k));
    }
    if (max < 1.5) flat.dev.fill(0); // bord droit : pas de correction
    return flat;
  });
}

function resample(dev: Float32Array, len: number): Float32Array {
  const out = new Float32Array(len);
  const N = dev.length - 1;
  for (let i = 0; i < len; i++) {
    const f = (i / Math.max(1, len - 1)) * N;
    const i0 = Math.min(N - 1, f | 0);
    out[i] = dev[i0] + (dev[i0 + 1] - dev[i0]) * (f - i0);
  }
  return out;
}


/**
 * Redresse et aplatit la feuille : homographie pour la perspective, plus une
 * correction qui suit la courbure mesurée des quatre bords (papier bombé ou plié).
 */
export function warp(src: HTMLCanvasElement, quad: Quad, maxSide = 3000): HTMLCanvasElement {
  const p = quad.map((q) => ({ x: q.x * (src.width - 1), y: q.y * (src.height - 1) }));
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.max(dist(p[0], p[1]), dist(p[3], p[2]));
  let H = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
  const k = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(2, Math.round(W * k));
  H = Math.max(2, Math.round(H * k));
  // Feuille proche du format A4 : on rétablit ses proportions exactes (1 : 1,414).
  const A4 = Math.SQRT2;
  if (Math.abs(H / W / A4 - 1) < 0.05) H = Math.round(W * A4);
  else if (Math.abs(W / H / A4 - 1) < 0.05) W = Math.round(H * A4);

  const dst: Pt[] = [{ x: 0, y: 0 }, { x: W - 1, y: 0 }, { x: W - 1, y: H - 1 }, { x: 0, y: H - 1 }];
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i];
    const { x, y } = p[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); B.push(y);
  }
  const [a, b, c, d, e, f, g, h] = solve(A, B);

  const [cT, cR, cB, cL] = edgeCurves(src, p);
  const dT = resample(cT.dev, W), dB = resample(cB.dev, W), dL = resample(cL.dev, H), dR = resample(cR.dev, H);
  const curved = [cT, cR, cB, cL].some((c) => c.dev.some((v) => v !== 0));

  const sw = src.width, sh = src.height;
  const sd = ctx2d(src).getImageData(0, 0, sw, sh).data;
  const out = makeCanvas(W, H);
  const octx = ctx2d(out);
  const img = octx.createImageData(W, H);
  const od = img.data;
  let o = 0;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const den = g * u + h * v + 1;
      let x = (a * u + b * v + c) / den;
      let y = (d * u + e * v + f) / den;
      if (curved) {
        const un = u / (W - 1), vn = v / (H - 1);
        const oT = (1 - vn) * dT[u], oB = vn * dB[u], oL = (1 - un) * dL[v], oR = un * dR[v];
        x += oT * cT.nx + oB * cB.nx + oL * cL.nx + oR * cR.nx;
        y += oT * cT.ny + oB * cB.ny + oL * cL.ny + oR * cR.ny;
      }
      if (x < 0) x = 0; else if (x > sw - 1.001) x = sw - 1.001;
      if (y < 0) y = 0; else if (y > sh - 1.001) y = sh - 1.001;
      const x0 = x | 0, y0 = y | 0;
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      od[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      od[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      od[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      od[o + 3] = 255;
      o += 4;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Estime la couleur du papier (fond) sur une grille grossière, canal par canal. */
function backgroundGrid(d: Uint8ClampedArray, w: number, h: number) {
  const bs = Math.max(8, Math.round(Math.max(w, h) / 48));
  const gw = Math.ceil(w / bs), gh = Math.ceil(h / bs);
  let grid = new Float32Array(gw * gh * 3);
  const hist = new Uint32Array(256 * 3);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      let cnt = 0;
      const y1 = Math.min(h, (gy + 1) * bs), x1 = Math.min(w, (gx + 1) * bs);
      for (let y = gy * bs; y < y1; y += 2) {
        for (let x = gx * bs; x < x1; x += 2) {
          const i = (y * w + x) * 4;
          hist[d[i]]++; hist[256 + d[i + 1]]++; hist[512 + d[i + 2]]++;
          cnt++;
        }
      }
      // 90e centile : le papier sans le texte, et sans se laisser tromper par le bruit comme un maximum.
      const o = (gy * gw + gx) * 3;
      const target = cnt * 0.1;
      for (let ch = 0; ch < 3; ch++) {
        let acc = 0, v = 255;
        for (; v > 0; v--) { acc += hist[ch * 256 + v]; if (acc >= target) break; }
        grid[o + ch] = v;
      }
    }
  }
  // Une passe de maximum (efface les gros blocs sombres), puis deux passes de flou.
  const pass = (mode: 'max' | 'avg') => {
    const out = new Float32Array(grid.length);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        for (let ch = 0; ch < 3; ch++) {
          let acc = 0, cnt = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = gy + dy;
            if (yy < 0 || yy >= gh) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = gx + dx;
              if (xx < 0 || xx >= gw) continue;
              const v = grid[(yy * gw + xx) * 3 + ch];
              if (mode === 'max') acc = Math.max(acc, v); else acc += v;
              cnt++;
            }
          }
          out[(gy * gw + gx) * 3 + ch] = mode === 'max' ? acc : acc / cnt;
        }
      }
    }
    grid = out;
  };
  pass('max'); pass('avg'); pass('avg');
  return { grid, gw, gh, bs };
}

/** Flou moyen de rayon r (deux passes à somme glissante). */
function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0, cnt = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) { sum += src[row + x]; cnt++; }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / cnt;
      const add = x + r + 1, rem = x - r;
      if (add < w) { sum += src[row + add]; cnt++; }
      if (rem >= 0) { sum -= src[row + rem]; cnt--; }
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0, cnt = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) { sum += tmp[y * w + x]; cnt++; }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / cnt;
      const add = y + r + 1, rem = y - r;
      if (add < h) { sum += tmp[add * w + x]; cnt++; }
      if (rem >= 0) { sum -= tmp[rem * w + x]; cnt--; }
    }
  }
  return out;
}

function lut(lo: number, hi: number, gamma = 1): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, Math.max(0, (i / 255 - lo) / (hi - lo)));
    t[i] = Math.round(Math.pow(v, gamma) * 255);
  }
  return t;
}

// Point noir, point blanc : en dessous le trait devient noir, au-dessus le papier devient blanc.
const LUT_AUTO = lut(0.25, 0.88, 1.1);
const LUT_GRAY = lut(0.15, 0.92);
const LUT_BW = lut(0.52, 0.74);

/**
 * Applique un filtre et renvoie un nouveau canevas.
 * Auto, Gris et Noir et blanc suivent les mêmes étapes :
 * 1. division par la couleur locale du papier (supprime ombres et dominante),
 * 2. réduction du bruit si la photo en contient,
 * 3. renforcement des traits (différence entre l'image et sa version floutée),
 * 4. courbe de contraste : papier blanc, encre foncée.
 */
export function applyFilter(src: HTMLCanvasElement, filter: Filter): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const out = makeCanvas(w, h);
  const octx = ctx2d(out);
  octx.drawImage(src, 0, 0);
  if (filter === 'original') return out;
  const img = octx.getImageData(0, 0, w, h);
  const d = img.data;

  if (filter === 'light') {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] * 1.18 + 12; d[i + 1] = d[i + 1] * 1.18 + 12; d[i + 2] = d[i + 2] * 1.18 + 12;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  // 1. Normalisation par le fond, écrite sur place ; L reçoit la luminance.
  const n = w * h;
  const L = new Uint8Array(n);
  const { grid, gw, gh, bs } = backgroundGrid(d, w, h);
  const half = bs / 2;
  for (let y = 0; y < h; y++) {
    let fy = (y - half) / bs;
    if (fy < 0) fy = 0; else if (fy > gh - 1) fy = gh - 1;
    const y0 = Math.min(gh - 1, fy | 0), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      let fx = (x - half) / bs;
      if (fx < 0) fx = 0; else if (fx > gw - 1) fx = gw - 1;
      const x0 = Math.min(gw - 1, fx | 0), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const a = (y0 * gw + x0) * 3, b = (y0 * gw + x1) * 3, c = (y1 * gw + x0) * 3, e = (y1 * gw + x1) * 3;
      const i = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const bg = (grid[a + ch] * (1 - tx) + grid[b + ch] * tx) * (1 - ty) + (grid[c + ch] * (1 - tx) + grid[e + ch] * tx) * ty;
        d[i + ch] = (d[i + ch] * 255) / Math.max(bg, 40);
      }
      L[y * w + x] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    }
  }

  // 2. Bruit : écart médian entre l'image et sa version lissée. Une photo propre n'est pas lissée.
  const smooth = box3(L, w, h);
  const diffHist = new Uint32Array(256);
  let samples = 0;
  for (let i = 0; i < n; i += 7) { diffHist[Math.abs(L[i] - smooth[i])]++; samples++; }
  let med = 0;
  for (let acc = 0; med < 255; med++) { acc += diffHist[med]; if (acc >= samples / 2) break; }
  const k = Math.min(1, Math.max(0, (med - 1.5) / 3));
  const base = smooth;
  if (k < 1) for (let i = 0; i < n; i++) base[i] = L[i] * (1 - k) + smooth[i] * k;

  // 3 et 4. Renforcement des traits puis courbe de contraste.
  const wide = boxBlur(base, w, h, Math.max(2, Math.round(Math.max(w, h) / 600)));
  const amount = filter === 'bw' ? 1.2 : 0.9;
  const curve = filter === 'auto' ? LUT_AUTO : filter === 'bw' ? LUT_BW : LUT_GRAY;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    let v = base[p] + amount * (base[p] - wide[p]);
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    const lp = curve[v | 0];
    if (filter === 'auto') {
      // La couleur (tampon, signature, surlignage) est conservée ; les faibles écarts, dus au bruit, sont neutralisés.
      for (let ch = 0; ch < 3; ch++) {
        let cdiff = d[i + ch] - L[p];
        cdiff = cdiff > 8 ? cdiff - 8 : cdiff < -8 ? cdiff + 8 : 0;
        d[i + ch] = lp + cdiff * 1.15;
      }
    } else {
      d[i] = d[i + 1] = d[i + 2] = lp;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Mesure de netteté d'une image (énergie des contours) : sert à garder la vue la plus nette. */
export function sharpness(source: CanvasImageSource, sw: number, sh: number): number {
  const { g, w, h } = grayAt(source, sw, sh, 480);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += lap * lap;
    }
  }
  return sum / (w * h);
}
