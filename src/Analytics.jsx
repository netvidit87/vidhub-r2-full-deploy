import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const GA_ID = 'G-1C81BZTY3P'

// Hanya path yang sah yang dikirim ke GA
const ALLOWED = [
  /^\/$/,
  /^\/v\/?$/,
  /^\/v\/[a-zA-Z0-9_-]+\/?$/,
  /^\/upload\/?$/,
  /^\/terms(-of-service)?\/?$/,
  /^\/privacy(-policy)?\/?$/,
  /^\/report\/?$/,
]

function isAllowedPath(pathname, search) {
  // /v/?id=xxx juga sah
  if (pathname === '/v' || pathname === '/v/') {
    const params = new URLSearchParams(search)
    if (params.get('id') || params.get('v')) return true
  }
  return ALLOWED.some((re) => re.test(pathname))
}

export default function Analytics() {
  const location = useLocation()

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') return

    const { pathname, search } = location

    // Path aneh / bot → jangan kirim pageview ke GA
    if (!isAllowedPath(pathname, search)) {
      return
    }

    const page_path = pathname + (search || '')
    window.gtag('config', GA_ID, {
      page_path,
      page_title: 'Vidhub - Free and Simple Video Hosting',
      page_location: window.location.origin + page_path,
    })
  }, [location])

  return null
}
