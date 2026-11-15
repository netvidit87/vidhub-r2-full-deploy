# Vidhub

Free and simple video hosting — React + Vite + Cloudflare Pages + R2.

## Fitur

- Upload video → R2 bucket sendiri
- Video URL: `https://cdn.vidhub.sbs/<id>.mp4` (HTML interstitial + smartlink)
- Halaman player: `https://vidhub.sbs/v/?id=<id>`
- Iklan `/v/`: 3 script, random 1 atau 2 per view
- Iklan CDN: smartlink asiaso.org
- GA hanya track path yang sah (filter bot/spam path)
- robots.txt + security headers

## Deploy (step by step)

### A. Worker CDN (R2)

1. Pastikan binding di dashboard:
   - Worker `vidrush-cdn` → Settings → Bindings
   - `R2_BUCKET` → bucket `vidrush`
2. Domain custom: `cdn.vidhub.sbs` → worker ini
3. Deploy:
```bash
cd worker
npx wrangler deploy
```

### B. Pages (frontend)

1. Push isi project ke GitHub repo yang sudah connected
   (atau upload file ke repo `vidhub-r2-full-deploy`)
2. Atau manual:
```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name=vidrush-ads-api-random
```
3. Domain: `vidhub.sbs` → Pages project

### C. Cek setelah deploy

| Tes | Hasil yang diharapkan |
|-----|------------------------|
| `cdn.vidhub.sbs/api/list` | 404 |
| `cdn.vidhub.sbs/api/list?key=VIDHUB_SECRET_2026` | list file |
| `cdn.vidhub.sbs/<id>.mp4` | HTML + video + smartlink |
| `vidhub.sbs/v/?id=<id>` | player + iklan API |
| Title tab `/v/` | `Vidhub - Free and Simple Video Hosting` |
| Path aneh di GA | tidak bertambah (difilter) |

## GA spam path

Path seperti `/aesure`, `/alpinvest`, `/di dalam/` biasanya bot.
App hanya mengirim pageview untuk:

- `/`
- `/v` dan `/v/?id=...` / `/v/:id`
- `/terms`, `/privacy`, `/report`, `/upload`

Di Google Analytics bisa tambah filter View (opsional):
Admin → Data Filters → Exclude traffic from known bots.

## Struktur

```
functions/api/ad_type.js   → iklan 1-2 dari 3 script
functions/api/upload.js    → proxy upload ke Worker → R2
worker/video-proxy.js      → CDN + R2 + interstitial
src/Analytics.jsx          → filter path GA
public/robots.txt
public/_headers
```
