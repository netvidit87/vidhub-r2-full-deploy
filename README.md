# Vidhub

Free and simple video hosting (React + Vite + Cloudflare Pages + R2).

## Fitur

- Upload video langsung ke **R2 bucket** sendiri (via Worker)
- Video src otomatis: `https://cdn.vidhub.sbs/<id>.mp4`
- **Interstitial HTML** di CDN (ketika dibuka langsung di browser) + iklan
- **Iklan di halaman /v/** load dari API sendiri (`/api/ad_type`)
- Support Range request (seek video)

## Struktur

```
├── functions/api/
│   ├── ad_type.js      → Ads API (hanya dipakai di halaman /v/)
│   └── upload.js       → Proxy upload ke Worker CDN → R2
├── src/
│   ├── config.js       → CDN base = https://cdn.vidhub.sbs
│   └── pages/
│       └── VideoPlayer.jsx  → title tetap "Vidhub - Free and Simple Video Hosting"
├── worker/
│   ├── video-proxy.js  → Worker CDN + R2 + interstitial
│   └── wrangler.toml   → binding R2_BUCKET = vidrush
└── public/
```

## Deploy Step-by-step

### 1. Binding R2 ke Worker (wajib)

1. Cloudflare Dashboard → **Workers & Pages** → **vidrush-cdn**
2. **Settings** → **Bindings** → **Add** → **R2 bucket**
3. Variable name: `R2_BUCKET`
4. R2 bucket: pilih **vidrush**
5. Save

### 2. Deploy Worker CDN

```bash
cd worker
npx wrangler deploy
```

Pastikan custom domain **cdn.vidhub.sbs** sudah terpasang di worker ini.

### 3. Deploy Pages (frontend + functions)

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name=vidhub
```

Atau pakai project name yang sudah ada (sesuaikan).

### 4. Domain

- Frontend: `vidhub.sbs` (atau yang kamu pakai) → Pages
- CDN: `cdn.vidhub.sbs` → Worker `vidrush-cdn`

## Cara kerja

| Request | Hasil |
|---------|-------|
| Browser buka `cdn.vidhub.sbs/xxxx.mp4` | HTML interstitial + iklan |
| `<video src="cdn.vidhub.sbs/xxxx.mp4">` | Stream video dari R2 (Range) |
| POST `/api/upload` (Pages) | Proxy ke Worker → simpan R2 |
| GET `/api/ad_type` | Iklan untuk halaman /v/ |

## Title untuk Google Analytics

Di halaman `/v/:id` title **selalu**:
```
Vidhub - Free and Simple Video Hosting
```
(tidak berubah berdasarkan ID video)

## Iklan

- **CDN interstitial** (`cdn.vidhub.sbs`):  
  `https://asiaso.org/4/df50998274e1f40d49267336947b0d81`

- **Halaman /v/**: tetap dari `/api/ad_type` (popunder + banner)

## Local dev

```bash
npm install
npm run dev
```
