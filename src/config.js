/**
 * CDN base untuk video.
 * Selalu pakai domain CDN custom: cdn.vidhub.sbs
 */
export function getCdnBase() {
  return 'https://cdn.vidhub.sbs'
}

export function getVideoUrl(id) {
  // hanya izinkan karakter aman (alphanumeric, dash, underscore)
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safe) return ''
  return `${getCdnBase()}/${safe}.mp4`
}
