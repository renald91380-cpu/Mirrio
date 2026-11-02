// Mirrio — lecture, dessin et écriture de petites images PNG, sans dépendance (module `_` : ce n'est pas une route).
//
// Sert à composer le bandeau d'une carte de fidélité Apple Wallet : image du salon + pastilles de tampons (une par passage, pleines ou vides).
// Lit les PNG 8 bits (gris, gris+alpha, couleurs indexées, RVB, RVBA, sans entrelacement) : c'est ce que produit le navigateur à l'envoi de l'image
// (canvas.toBlob('image/png')). Écrit toujours du RVBA 8 bits. Image = { w, h, d: Uint8ClampedArray RVBA }.

import zlib from 'node:zlib';

const TABLE = (() => { const t = []; for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
const crc = b => { let c = 0xFFFFFFFF; for(let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

export function decoderPng(buf, maxPixels = 4_000_000){
  if(!Buffer.isBuffer(buf) || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504E47) throw new Error('PNG attendu.');
  let p = 8, w = 0, h = 0, prof = 0, type = 0, entrelace = 0, palette = null, trns = null; const idat = [];
  while(p + 8 <= buf.length){
    const n = buf.readUInt32BE(p), nom = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + n); p += 12 + n;
    if(nom === 'IHDR'){ w = d.readUInt32BE(0); h = d.readUInt32BE(4); prof = d[8]; type = d[9]; entrelace = d[12]; }
    else if(nom === 'PLTE') palette = d; else if(nom === 'tRNS') trns = d; else if(nom === 'IDAT') idat.push(d); else if(nom === 'IEND') break;
  }
  if(!w || !h || w * h > maxPixels) throw new Error('Image trop grande.');
  if(prof !== 8 || entrelace) throw new Error('PNG non géré (8 bits sans entrelacement seulement).');
  const canaux = { 0:1, 2:3, 3:1, 4:2, 6:4 }[type]; if(!canaux) throw new Error('PNG non géré.');
  const brut = zlib.inflateSync(Buffer.concat(idat)), ligne = w * canaux, sortie = new Uint8Array(h * ligne);
  for(let y = 0; y < h; y++){
    const f = brut[y * (ligne + 1)], src = y * (ligne + 1) + 1, dst = y * ligne;
    for(let x = 0; x < ligne; x++){
      const a = x >= canaux ? sortie[dst + x - canaux] : 0, b = y ? sortie[dst - ligne + x] : 0, c = x >= canaux && y ? sortie[dst - ligne + x - canaux] : 0;
      let v = brut[src + x];
      if(f === 1) v += a; else if(f === 2) v += b; else if(f === 3) v += (a + b) >> 1;
      else if(f === 4){ const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      sortie[dst + x] = v & 255;
    }
  }
  const d = new Uint8ClampedArray(w * h * 4);
  for(let i = 0; i < w * h; i++){
    const s = i * canaux, o = i * 4;
    if(type === 6){ d[o] = sortie[s]; d[o + 1] = sortie[s + 1]; d[o + 2] = sortie[s + 2]; d[o + 3] = sortie[s + 3]; }
    else if(type === 2){ d[o] = sortie[s]; d[o + 1] = sortie[s + 1]; d[o + 2] = sortie[s + 2]; d[o + 3] = 255; }
    else if(type === 0){ d[o] = d[o + 1] = d[o + 2] = sortie[s]; d[o + 3] = 255; }
    else if(type === 4){ d[o] = d[o + 1] = d[o + 2] = sortie[s]; d[o + 3] = sortie[s + 1]; }
    else { const k = sortie[s]; d[o] = palette[k * 3]; d[o + 1] = palette[k * 3 + 1]; d[o + 2] = palette[k * 3 + 2]; d[o + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { w, h, d };
}

export function encoderPng(img){
  const { w, h, d } = img, brut = Buffer.alloc(h * (w * 4 + 1));
  for(let y = 0; y < h; y++){ brut[y * (w * 4 + 1)] = 0; Buffer.from(d.buffer, d.byteOffset + y * w * 4, w * 4).copy(brut, y * (w * 4 + 1) + 1); }
  const bloc = (nom, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(nom, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut, { level: 9 })), bloc('IEND', Buffer.alloc(0))]);
}

export const creer = (w, h, rvba = [0, 0, 0, 0]) => { const d = new Uint8ClampedArray(w * h * 4); for(let i = 0; i < w * h; i++){ d[i * 4] = rvba[0]; d[i * 4 + 1] = rvba[1]; d[i * 4 + 2] = rvba[2]; d[i * 4 + 3] = rvba[3]; } return { w, h, d }; };

// Redimensionne (moyenne des pixels couverts : net en réduction, correct en agrandissement). Avec `couvrir`, l'image remplit le cadre en étant recadrée au centre.
export function redimensionner(img, w, h, couvrir = false){
  let sx = 0, sy = 0, sw = img.w, sh = img.h;
  if(couvrir){ const r = Math.max(w / img.w, h / img.h); sw = w / r; sh = h / r; sx = (img.w - sw) / 2; sy = (img.h - sh) / 2; }
  const out = creer(w, h);
  for(let y = 0; y < h; y++){
    const y0 = sy + y * sh / h, y1 = sy + (y + 1) * sh / h;
    for(let x = 0; x < w; x++){
      const x0 = sx + x * sw / w, x1 = sx + (x + 1) * sw / w; let r = 0, g = 0, b = 0, a = 0, tot = 0;
      for(let yy = Math.floor(y0); yy < Math.min(img.h, Math.ceil(y1)); yy++){
        const hy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for(let xx = Math.floor(x0); xx < Math.min(img.w, Math.ceil(x1)); xx++){
          const k = hy * (Math.min(xx + 1, x1) - Math.max(xx, x0)), o = (yy * img.w + xx) * 4, al = img.d[o + 3] / 255;
          r += img.d[o] * al * k; g += img.d[o + 1] * al * k; b += img.d[o + 2] * al * k; a += al * k; tot += k;
        }
      }
      const o = (y * w + x) * 4; if(tot > 0 && a > 0){ out.d[o] = r / a; out.d[o + 1] = g / a; out.d[o + 2] = b / a; out.d[o + 3] = a / tot * 255; }
    }
  }
  return out;
}

const melange = (img, o, r, g, b, a) => { const al = a / 255, ia = img.d[o + 3] / 255, so = al + ia * (1 - al); if(so <= 0) return; img.d[o] = (r * al + img.d[o] * ia * (1 - al)) / so; img.d[o + 1] = (g * al + img.d[o + 1] * ia * (1 - al)) / so; img.d[o + 2] = (b * al + img.d[o + 2] * ia * (1 - al)) / so; img.d[o + 3] = so * 255; };

// Dégradé vertical transparent (haut) vers une couleur (bas), pour que les pastilles restent lisibles sur n'importe quelle photo.
export function voileBas(img, rvb, depuis = 0.45, maxAlpha = 0.78){
  for(let y = 0; y < img.h; y++){ const t = Math.max(0, (y / img.h - depuis) / (1 - depuis)), a = t * t * maxAlpha * 255; if(a < 1) continue; for(let x = 0; x < img.w; x++) melange(img, (y * img.w + x) * 4, rvb[0], rvb[1], rvb[2], a); }
}
// Rectangle arrondi lissé (distance signée, un pixel de transition), rempli de rvba.
export function rectArrondi(img, x, y, w, h, r, rvba){
  for(let py = Math.floor(y) - 1; py <= Math.ceil(y + h) + 1; py++) for(let px = Math.floor(x) - 1; px <= Math.ceil(x + w) + 1; px++){
    if(px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
    const cx = Math.abs(px + 0.5 - (x + w / 2)) - (w / 2 - r), cy = Math.abs(py + 0.5 - (y + h / 2)) - (h / 2 - r);
    const dist = Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) + Math.min(Math.max(cx, cy), 0) - r;   // < 0 : dedans
    const couv = Math.max(0, Math.min(1, 0.5 - dist)); if(couv <= 0) continue;
    melange(img, (py * img.w + px) * 4, rvba[0], rvba[1], rvba[2], rvba[3] * couv);
  }
}
