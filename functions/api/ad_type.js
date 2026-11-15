/**
 * GET /api/ad_type
 * Hanya 3 iklan yang dikonfigurasi.
 * Setiap request: kadang 1 iklan, kadang 2 iklan (acak).
 */

const AD1 = `<script data-cfasync="false" src="https://ahuramazda.org/1/d4b3da13003ae6d27d4378a79cb4332d"></script>`

const AD2 = `<script>
  atOptions = {
    'key' : 'e3390cf0a8cdf953ded85bdaaf3046a5',
    'format' : 'iframe',
    'height' : 250,
    'width' : 300,
    'params' : {}
  };
</script>
<script src="https://biomanos.org/22/e3390cf0a8cdf953ded85bdaaf3046a5"></script>`

const AD3 = `<script async="async" data-cfasync="false" src="https://biomanos.org/21/d3e082d534e1581e0f78d3cfe456f0d9"></script>
<div id="container-d3e082d534e1581e0f78d3cfe456f0d9"></div>`

const ALL_ADS = [AD1, AD2, AD3]

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
}

function pickAds() {
  // 50% chance: 1 iklan, 50% chance: 2 iklan
  const count = Math.random() < 0.5 ? 1 : 2

  // acak urutan tanpa duplikat
  const shuffled = [...ALL_ADS].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count).join('\n')
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

export async function onRequestGet() {
  try {
    const banner_300x250 = pickAds()

    return new Response(
      JSON.stringify({
        type: 'exo',
        code: '',
        banner_300x250,
      }),
      { status: 200, headers: corsHeaders() }
    )
  } catch {
    // fallback: 1 iklan saja
    return new Response(
      JSON.stringify({
        type: 'exo',
        code: '',
        banner_300x250: AD1,
      }),
      { status: 200, headers: corsHeaders() }
    )
  }
}
