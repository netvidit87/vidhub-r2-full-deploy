/**
 * Cloudflare Worker - R2 CDN + Interstitial HTML
 *
 * Domain: cdn.vidhub.sbs
 * Bucket: vidrush (binding name: R2_BUCKET)
 *
 * Behaviour:
 *   - Browser buka https://cdn.vidhub.sbs/xxxx.mp4  → tampil HTML interstitial + ad
 *   - <video> / Range request                         → stream file dari R2
 *   - POST /api/upload                                → upload langsung ke R2
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\//, '')

    // ===== CORS preflight =====
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Range',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    // ===== HEALTH / DEBUG =====
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({
        ok: true,
        hasR2: !!env.R2_BUCKET,
        time: new Date().toISOString(),
      })
    }

    // ===== UPLOAD ke R2 =====
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      return handleUpload(request, env, url)
    }

    // ===== LIST (debug, optional) =====
    if (url.pathname === '/api/list' && request.method === 'GET') {
      if (!env.R2_BUCKET) return json({ error: 'no r2' }, 500)
      const listed = await env.R2_BUCKET.list({ limit: 20 })
      return json({
        objects: listed.objects.map((o) => ({
          key: o.key,
          size: o.size,
          uploaded: o.uploaded,
        })),
      })
    }

    // ===== VIDEO / IMAGE dari R2 =====
    // Cocok: /xxxx.mp4  atau  /cdn/xxxx.mp4
    const match =
      path.match(/^cdn\/([a-zA-Z0-9_-]+)(?:\.(mp4|webm|mov|jpg|jpeg|png|gif|webp|avif))?$/i) ||
      path.match(/^([a-zA-Z0-9_-]+)\.(mp4|webm|mov|jpg|jpeg|png|gif|webp|avif)$/i)

    if (match && (request.method === 'GET' || request.method === 'HEAD')) {
      const id = match[1]
      const ext = (match[2] || 'mp4').toLowerCase()
      const key = `${id}.${ext}`

      // Cek apakah request ini dari browser (navigasi langsung) atau dari <video>/<img>
      const accept = request.headers.get('Accept') || ''
      const range = request.headers.get('Range')
      const isBrowserNav =
        !range &&
        accept.includes('text/html') &&
        !accept.includes('video/') &&
        !accept.includes('image/')

      // Kalau browser buka langsung link → tampilkan interstitial HTML
      if (isBrowserNav && ['mp4', 'webm', 'mov', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext)) {
        return serveInterstitial(id, ext, url)
      }

      // Selain itu → stream dari R2
      return serveFromR2(env, key, request, ext)
    }

    return new Response('Not Found', { status: 404 })
  },
}

/* ============================================================
   UPLOAD HANDLER (simpan ke R2)
   ============================================================ */
async function handleUpload(request, env, url) {
  try {
    if (!env.R2_BUCKET) {
      return json({ error: 'R2 binding not configured. Add R2_BUCKET binding to this Worker.' }, 500)
    }

    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return json({ error: 'No file' }, 400)
    }

    // hanya video
    if (file.type && !file.type.startsWith('video/')) {
      return json({ error: 'Only video files allowed' }, 400)
    }

    // max 500MB
    if (file.size && file.size > 500 * 1024 * 1024) {
      return json({ error: 'File too large (max 500MB)' }, 400)
    }

    // generate id acak
    const id = generateId(10)
    const key = `${id}.mp4`

    // Baca file sebagai ArrayBuffer agar lebih reliable di Worker
    const buffer = await file.arrayBuffer()

    await env.R2_BUCKET.put(key, buffer, {
      httpMetadata: {
        contentType: file.type || 'video/mp4',
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        originalName: file.name || 'video.mp4',
        uploadedAt: new Date().toISOString(),
        size: String(file.size || buffer.byteLength),
      },
    })

    // verifikasi langsung
    const check = await env.R2_BUCKET.head(key)
    if (!check) {
      return json({ error: 'Upload succeeded but file not found in R2' }, 502)
    }

    return json({
      id,
      url: `https://cdn.vidhub.sbs/${id}.mp4`,
      page: `https://vidhub.sbs/v/?id=${id}`,
      size: check.size,
    })
  } catch (err) {
    return json({ error: err.message || 'Upload error', stack: String(err) }, 502)
  }
}

/* ============================================================
   SERVE FILE DARI R2 (dengan support Range)
   ============================================================ */
async function serveFromR2(env, key, request, ext) {
  if (!env.R2_BUCKET) {
    return new Response('R2 not configured', { status: 500 })
  }

  const rangeHeader = request.headers.get('Range')

  let object
  try {
    if (rangeHeader) {
      // parse simple bytes=start-end
      const m = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      if (m) {
        const start = parseInt(m[1], 10)
        const end = m[2] ? parseInt(m[2], 10) : undefined
        object = await env.R2_BUCKET.get(key, {
          range: end !== undefined ? { offset: start, length: end - start + 1 } : { offset: start },
        })
      } else {
        object = await env.R2_BUCKET.get(key)
      }
    } else {
      object = await env.R2_BUCKET.get(key)
    }
  } catch (e) {
    return new Response('R2 get error: ' + e.message, { status: 500 })
  }

  if (!object) {
    return new Response('File not found in R2: ' + key, { status: 404 })
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')

  // Content-Type fallback
  if (!headers.has('Content-Type')) {
    const mime = {
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
    }
    headers.set('Content-Type', mime[ext] || 'application/octet-stream')
  }

  // Range response
  if (object.range) {
    const offset = object.range.offset || 0
    const length = object.range.length || object.size
    headers.set(
      'Content-Range',
      `bytes ${offset}-${offset + length - 1}/${object.size}`
    )
    headers.set('Content-Length', String(length))
    return new Response(object.body, {
      status: 206,
      headers,
    })
  }

  if (object.size != null) {
    headers.set('Content-Length', String(object.size))
  }

  return new Response(object.body, {
    status: 200,
    headers,
  })
}

/* ============================================================
   INTERSTITIAL HTML
   ============================================================ */
function serveInterstitial(id, ext, url) {
  const isVideo = ['mp4', 'webm', 'mov'].includes(ext)
  const contentUrl = `${url.origin}/${id}.${ext}`

  const adTextsEn = [
    'Click here to unlock more',
    'Get instant access',
    "See what's next",
    'See for yourself',
    "You'll want to see this",
    'Just one click away...',
  ]
  const adTextsId = [
    'Klik di sini untuk buka lebih banyak',
    'Dapatkan akses sekarang',
    'Lihat selanjutnya',
    'Lihat sendiri',
    'Kamu pasti ingin lihat ini',
    'Hanya satu klik lagi...',
  ]

  const adLink = 'https://asiaso.org/4/df50998274e1f40d49267336947b0d81'

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${id}.${ext}</title>
  <style>
/*! tailwindcss v4.1.18 | MIT License | https://tailwindcss.com */
@layer properties{@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b)))){*,:before,:after,::backdrop{--tw-font-weight:initial;--tw-blur:initial;--tw-brightness:initial;--tw-contrast:initial;--tw-grayscale:initial;--tw-hue-rotate:initial;--tw-invert:initial;--tw-opacity:initial;--tw-saturate:initial;--tw-sepia:initial;--tw-drop-shadow:initial;--tw-drop-shadow-color:initial;--tw-drop-shadow-alpha:100%;--tw-drop-shadow-size:initial}}}@layer theme{:root,:host{--font-sans:ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji";--font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;--color-blue-300:oklch(80.9% .105 251.813);--color-blue-400:oklch(70.7% .165 254.624);--color-gray-200:oklch(92.8% .006 264.531);--color-neutral-950:oklch(14.5% 0 0);--color-white:#fff;--spacing:.25rem;--text-sm:.875rem;--text-sm--line-height:calc(1.25/.875);--text-4xl:2.25rem;--text-4xl--line-height:calc(2.5/2.25);--font-weight-semibold:600;--font-weight-bold:700;--default-font-family:var(--font-sans);--default-mono-font-family:var(--font-mono)}}@layer base{*,:after,:before,::backdrop{box-sizing:border-box;border:0 solid;margin:0;padding:0}::file-selector-button{box-sizing:border-box;border:0 solid;margin:0;padding:0}html,:host{-webkit-text-size-adjust:100%;tab-size:4;line-height:1.5;font-family:var(--default-font-family,ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji");font-feature-settings:var(--default-font-feature-settings,normal);font-variation-settings:var(--default-font-variation-settings,normal);-webkit-tap-highlight-color:transparent}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;-webkit-text-decoration:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:var(--default-mono-font-family,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace);font-feature-settings:var(--default-mono-font-feature-settings,normal);font-variation-settings:var(--default-mono-font-variation-settings,normal);font-size:1em}small{font-size:80%}sub,sup{vertical-align:baseline;font-size:75%;line-height:0;position:relative}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}:-moz-focusring{outline:auto}progress{vertical-align:baseline}summary{display:list-item}ol,ul,menu{list-style:none}img,svg,video,canvas,audio,iframe,embed,object{vertical-align:middle;display:block}img,video{max-width:100%;height:auto}button,input,select,optgroup,textarea{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}::file-selector-button{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}:where(select:is([multiple],[size])) optgroup{font-weight:bolder}:where(select:is([multiple],[size])) optgroup option{padding-inline-start:20px}::file-selector-button{margin-inline-end:4px}::placeholder{opacity:1}@supports (not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px){::placeholder{color:currentColor}@supports (color:color-mix(in lab,red,red)){::placeholder{color:color-mix(in oklab,currentcolor 50%,transparent)}}}textarea{resize:vertical}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-date-and-time-value{min-height:1lh;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-datetime-edit{padding-block:0}::-webkit-datetime-edit-year-field{padding-block:0}::-webkit-datetime-edit-month-field{padding-block:0}::-webkit-datetime-edit-day-field{padding-block:0}::-webkit-datetime-edit-hour-field{padding-block:0}::-webkit-datetime-edit-minute-field{padding-block:0}::-webkit-datetime-edit-second-field{padding-block:0}::-webkit-datetime-edit-millisecond-field{padding-block:0}::-webkit-datetime-edit-meridiem-field{padding-block:0}::-webkit-calendar-picker-indicator{line-height:1}:-moz-ui-invalid{box-shadow:none}button,input:where([type=button],[type=reset],[type=submit]){appearance:button}::file-selector-button{appearance:button}::-webkit-inner-spin-button{height:auto}::-webkit-outer-spin-button{height:auto}[hidden]:where(:not([hidden=until-found])){display:none!important}*,:before,:after{border-color:var(--color-gray-200,currentColor)}html,body{background-color:#0a0a0a}}@layer components;@layer utilities{.mt-2{margin-top:calc(var(--spacing)*2)}.block{display:block}.flex{display:flex}.hidden{display:none}.max-h-\\[calc\\(100vh-100px\\)\\]{max-height:calc(100vh - 100px)}.min-h-screen{min-height:100vh}.w-full{width:100%}.max-w-\\[720px\\]{max-width:720px}.flex-col{flex-direction:column}.items-center{align-items:center}.justify-center{justify-content:center}.rounded{border-radius:.25rem}.bg-neutral-950{background-color:var(--color-neutral-950)}.object-contain{object-fit:contain}.text-center{text-align:center}.text-4xl{font-size:var(--text-4xl);line-height:var(--tw-leading,var(--text-4xl--line-height))}.text-sm{font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height))}.font-bold{--tw-font-weight:var(--font-weight-bold);font-weight:var(--font-weight-bold)}.font-semibold{--tw-font-weight:var(--font-weight-semibold);font-weight:var(--font-weight-semibold)}.text-blue-400{color:var(--color-blue-400)}.text-white{color:var(--color-white)}.filter{filter:var(--tw-blur,)var(--tw-brightness,)var(--tw-contrast,)var(--tw-grayscale,)var(--tw-hue-rotate,)var(--tw-invert,)var(--tw-saturate,)var(--tw-sepia,)var(--tw-drop-shadow,)}@media(hover:hover){.hover\\:text-blue-300:hover{color:var(--color-blue-300)}}}@property --tw-font-weight{syntax:"*";inherits:false}@property --tw-blur{syntax:"*";inherits:false}@property --tw-brightness{syntax:"*";inherits:false}@property --tw-contrast{syntax:"*";inherits:false}@property --tw-grayscale{syntax:"*";inherits:false}@property --tw-hue-rotate{syntax:"*";inherits:false}@property --tw-invert{syntax:"*";inherits:false}@property --tw-opacity{syntax:"*";inherits:false}@property --tw-saturate{syntax:"*";inherits:false}@property --tw-sepia{syntax:"*";inherits:false}@property --tw-drop-shadow{syntax:"*";inherits:false}@property --tw-drop-shadow-color{syntax:"*";inherits:false}@property --tw-drop-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-drop-shadow-size{syntax:"*";inherits:false}
  </style>
</head>
<body>
  <div id="content" class="min-h-screen flex-col items-center justify-center bg-neutral-950 flex">
    <div class="flex w-full max-w-[720px] flex-col">
      ${isVideo
        ? `<video id="video-el" class="max-h-[calc(100vh-100px)] w-full rounded" controls autoplay playsinline src="${contentUrl}"></video>`
        : `<img id="img-el" alt="" class="max-h-[calc(100vh-100px)] w-full rounded object-contain" src="${contentUrl}">`
      }
      <div class="text-center mt-2">
        <a id="ad-link" href="${adLink}" target="_blank" rel="noopener noreferrer"
           class="text-blue-400 font-semibold text-sm hover:text-blue-300"></a>
      </div>
    </div>
  </div>

  <script type="module">
    const adTextsEn = ${JSON.stringify(adTextsEn)};
    const adTextsId = ${JSON.stringify(adTextsId)};
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const isId = ['Asia/Jakarta','Asia/Pontianak','Asia/Makassar','Asia/Jayapura'].includes(tz);
    const texts = isId ? adTextsId : adTextsEn;
    const el = document.getElementById('ad-link');
    if (el) {
      el.textContent = texts[Math.floor(Math.random() * texts.length)];
    }
  </script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/* ============================================================
   HELPERS
   ============================================================ */
function generateId(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length]
  }
  return result
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
