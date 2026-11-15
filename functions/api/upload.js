/**
 * POST /api/upload
 * Proxy upload ke Worker CDN (yang menyimpan ke R2)
 * Endpoint Worker: https://cdn.vidhub.sbs/api/upload
 */
export async function onRequestPost({ request }) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return Response.json({ error: 'No file' }, { status: 400 })
    }

    // batasi tipe
    if (file.type && !file.type.startsWith('video/')) {
      return Response.json({ error: 'Only video files allowed' }, { status: 400 })
    }

    // batasi ukuran ~500MB
    if (file.size && file.size > 500 * 1024 * 1024) {
      return Response.json({ error: 'File too large (max 500MB)' }, { status: 400 })
    }

    const upstreamForm = new FormData()
    upstreamForm.append('file', file, file.name || 'video.mp4')

    // Kirim ke Worker CDN yang sudah terhubung ke R2
    const upstream = await fetch('https://cdn.vidhub.sbs/api/upload', {
      method: 'POST',
      body: upstreamForm,
      headers: {
        Accept: 'application/json',
      },
    })

    const data = await upstream.json().catch(() => ({}))

    if (!upstream.ok || !data.id) {
      return Response.json(
        { error: data.error || 'Upload failed' },
        { status: upstream.status || 502 }
      )
    }

    // sanitize id
    const id = String(data.id).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id) {
      return Response.json({ error: 'Invalid response' }, { status: 502 })
    }

    return Response.json({
      id,
      url: data.url || `https://cdn.vidhub.sbs/${id}.mp4`,
      page: data.page || `https://vidhub.sbs/v/?id=${id}`,
    })
  } catch (err) {
    return Response.json({ error: 'Proxy error' }, { status: 502 })
  }
}
