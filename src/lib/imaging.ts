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

export async function blobToCanvas(blob: Blob, maxSide = 3000): Promise<HTMLCanvasElement> {
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

/**
 * Cherche la feuille dans l'image : seuil d'Otsu sur une version réduite,
 * plus grande zone claire, puis ses quatre points extrêmes.
 * Renvoie null si rien de convaincant (fond clair, feuille hors cadre...).
 */
export function detectQuad(source: CanvasImageSource, sw: number, sh: number): Quad | null {
  if (!sw || !sh) return null;
  const s = 200 / Math.max(sw, sh);
  const w = Math.max(8, Math.round(sw * s));
  const h = Math.max(8, Math.round(sh * s));
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.drawImage(source, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) raw[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;

  // Flou 3x3 pour gommer le texte et le bruit.
  const g = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += raw[yy * w + xx];
          cnt++;
        }
      }
      g[y * w + x] = sum / cnt;
    }
  }

  // Seuil d'Otsu.
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) hist[g[i]]++;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (total - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }

  // Plus grande composante claire, avec ses points extrêmes.
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let bestCount = 0;
  let bestExt: number[] | null = null;
  for (let start = 0; start < n; start++) {
    if (seen[start] || g[start] <= thr) continue;
    let sp = 0, count = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let tl = Infinity, br = -Infinity, tr = -Infinity, bl = Infinity;
    let iTl = start, iBr = start, iTr = start, iBl = start;
    while (sp) {
      const i = stack[--sp];
      count++;
      const x = i % w, y = (i - x) / w;
      const a = x + y, b = x - y;
      if (a < tl) { tl = a; iTl = i; }
      if (a > br) { br = a; iBr = i; }
      if (b > tr) { tr = b; iTr = i; }
      if (b < bl) { bl = b; iBl = i; }
      if (x > 0 && !seen[i - 1] && g[i - 1] > thr) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && !seen[i + 1] && g[i + 1] > thr) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !seen[i - w] && g[i - w] > thr) { seen[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && !seen[i + w] && g[i + w] > thr) { seen[i + w] = 1; stack[sp++] = i + w; }
    }
    if (count > bestCount) { bestCount = count; bestExt = [iTl, iTr, iBr, iBl]; }
  }
  if (!bestExt || bestCount < n * 0.12) return null;

  const pts = bestExt.map((i) => ({ x: i % w, y: Math.floor(i / w) }));
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = pts[i], q = pts[(i + 1) % 4];
    area += p.x * q.y - q.x * p.y;
  }
  area = Math.abs(area) / 2;
  // La zone claire doit ressembler à un quadrilatère plein, ni minuscule ni égal au cadre entier.
  if (area < n * 0.1 || area > n * 0.985 || bestCount / area < 0.7 || bestCount / area > 1.25) return null;
  return pts.map((p) => ({ x: p.x / (w - 1), y: p.y / (h - 1) })) as Quad;
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

/** Redresse le quadrilatère en rectangle (homographie + échantillonnage bilinéaire). */
export function warp(src: HTMLCanvasElement, quad: Quad, maxSide = 2400): HTMLCanvasElement {
  const p = quad.map((q) => ({ x: q.x * (src.width - 1), y: q.y * (src.height - 1) }));
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.max(dist(p[0], p[1]), dist(p[3], p[2]));
  let H = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
  const k = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(2, Math.round(W * k));
  H = Math.max(2, Math.round(H * k));

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
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let r = 0, g = 0, b = 0;
      const y1 = Math.min(h, (gy + 1) * bs), x1 = Math.min(w, (gx + 1) * bs);
      for (let y = gy * bs; y < y1; y += 2) {
        for (let x = gx * bs; x < x1; x += 2) {
          const i = (y * w + x) * 4;
          if (d[i] > r) r = d[i];
          if (d[i + 1] > g) g = d[i + 1];
          if (d[i + 2] > b) b = d[i + 2];
        }
      }
      const o = (gy * gw + gx) * 3;
      grid[o] = r; grid[o + 1] = g; grid[o + 2] = b;
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

function lut(fn: (v: number) => number): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = Math.round(fn(i / 255) * 255);
  return t;
}

const LUT_AUTO = lut((v) => Math.pow(Math.min(1, v * 1.05), 1.35));
const LUT_BW = lut((v) => Math.min(1, Math.max(0, (v - 0.5) / 0.32)));
const LUT_GRAY = lut((v) => Math.pow(Math.min(1, v * 1.03), 1.15));

/** Applique un filtre et renvoie un nouveau canevas. */
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
      let nr = 0, ng = 0, nb = 0;
      for (let ch = 0; ch < 3; ch++) {
        const bg = (grid[a + ch] * (1 - tx) + grid[b + ch] * tx) * (1 - ty) + (grid[c + ch] * (1 - tx) + grid[e + ch] * tx) * ty;
        const v = Math.min(255, (d[i + ch] * 255) / Math.max(bg, 48));
        if (ch === 0) nr = v; else if (ch === 1) ng = v; else nb = v;
      }
      if (filter === 'auto') {
        d[i] = LUT_AUTO[nr | 0]; d[i + 1] = LUT_AUTO[ng | 0]; d[i + 2] = LUT_AUTO[nb | 0];
      } else {
        const l = (nr * 77 + ng * 150 + nb * 29) >> 8;
        const v = filter === 'bw' ? LUT_BW[l] : LUT_GRAY[l];
        d[i] = v; d[i + 1] = v; d[i + 2] = v;
      }
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}
