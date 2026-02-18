import metaService from './services/meta.js'
import gaService from './services/ga.js'
import gadsService from './services/gads.js'

function toCamelDeep(obj) {
  if (Array.isArray(obj)) return obj.map(toCamelDeep)
  if (obj !== null && typeof obj === 'object') {
    const out = {}
    for (const k in obj) {
      out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = toCamelDeep(obj[k])
    }
    return out
  }
  return obj
}

function parseName(input) {
  let output = { name: null, firstName: null, lastName: null }
  if (!input) return output
  input = input.replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim()
  if (!input) return output
  output.name = input.split(" ").map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ")
  const parts = input.split(" ")
  const connectors = ["de", "do", "da", "dos", "das"]
  output.firstName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()
  if (parts.length > 1) {
    let i = parts.length - 1
    const lastParts = [parts[i]]
    while (i > 0 && connectors.includes(parts[i - 1].toLowerCase())) {
      lastParts.unshift(parts[i - 1])
      i--
    }
    output.lastName = lastParts.map(p => {
      const l = p.toLowerCase()
      return connectors.includes(l) ? l : l.charAt(0).toUpperCase() + l.slice(1)
    }).join(" ")
  }
  return output
}

async function sha256(value) {
  if (!value) return null
  const data = new TextEncoder().encode(value.trim().toLowerCase())
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")
}

function extractUtms(input) {
  const output = {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null
  }
  if (input) {
    const queryIndex = input.indexOf('?')
    if (queryIndex !== -1) {
      const parts = input.slice(queryIndex + 1).split('&')
      for (let i = 0; i < parts.length; i++) {
        const [key, value] = parts[i].split('=')
        if (key in output && value) output[key] = decodeURIComponent(value)
      }
    }
  }
  return output
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, referer'
}

export default {
  async fetch(request, env) {

    console.log('REQUEST METHOD:', request.method)

    if (request.method === 'OPTIONS') {
      console.log('OPTIONS REQUEST')
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (request.method !== 'POST') {
      console.log('INVALID METHOD')
      return new Response('Wrong request method', { status: 405, headers: corsHeaders })
    }

    let body
    try {
      body = await request.json()
      console.log('BODY RECEIVED:', body)
    } catch (e) {
      console.log('JSON PARSE ERROR:', e)
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders })
    }

    const metaAccessToken = env.META_ACCESS_TOKEN || null
    const gaSecretKey = env.GA_SECRET_KEY || null
    const gadsCustomerId = env.GADS_CUSTOMER_ID || null
    const gadsAccessToken = env.GADS_ACCESS_TOKEN || null
    const gadsDeveloperToken = env.GADS_DEVELOPER_TOKEN || null

    console.log('ENV VALUES:', {
      metaAccessToken,
      gaSecretKey,
      gadsCustomerId,
      gadsAccessToken,
      gadsDeveloperToken
    })

    body = toCamelDeep(body)
    console.log('BODY CAMEL:', body)

    const { data = {}, meta = {} } = body

    const {
      metaEvent,
      gaEvent,
      gadsConversionLabel,
      eventUrl,
      eventId,
      userId,
      userData = {},
      cookieFbp,
      cookieFbc,
      cookieGclid
    } = data

    const {
      metaPixelId,
      metaTestCode,
      gaMeasurementId
    } = meta

    console.log('EXTRACTED DATA:', {
      metaEvent,
      gaEvent,
      gadsConversionLabel,
      eventUrl,
      eventId,
      userId,
      metaPixelId,
      gaMeasurementId
    })

    if (!metaEvent && !gaEvent && !gadsConversionLabel) {
      console.log('NO EVENT TYPE')
      return new Response('Event/conversion is missing', { status: 400, headers: corsHeaders })
    }

    if (!eventId) {
      console.log('NO EVENT ID')
      return new Response('Event ID is missing', { status: 400, headers: corsHeaders })
    }

    if (!eventUrl) {
      console.log('NO EVENT URL')
      return new Response('Event URL is missing', { status: 400, headers: corsHeaders })
    }

    if (!userId) {
      console.log('NO USER ID')
      return new Response('User ID is missing', { status: 400, headers: corsHeaders })
    }

    const headers = Object.fromEntries(request.headers.entries())

    const clientIp =
      headers['cf-connecting-ip'] ||
      headers['x-forwarded-for']?.split(',')[0].trim() ||
      null

    const userAgent = headers['user-agent'] || null

    console.log('CLIENT INFO:', { clientIp, userAgent })

    const parsedUserName =
      userData.name && (!userData.firstName || !userData.lastName)
        ? parseName(userData.name)
        : null

    const userFirstName = userData.firstName ?? parsedUserName?.firstName ?? null
    const userLastName = userData.lastName ?? parsedUserName?.lastName ?? null

    const hashedUserFirstName = userFirstName ? await sha256(userFirstName) : null
    const hashedUserLastName = userLastName ? await sha256(userLastName) : null
    const hashedUserEmail = userData.email ? await sha256(userData.email) : null
    const hashedUserPhone = userData.phone ? await sha256(userData.phone) : null

    console.log('HASHED DATA:', {
      hashedUserFirstName,
      hashedUserLastName,
      hashedUserEmail,
      hashedUserPhone
    })

    const timestamp = Math.floor(Date.now() / 1000)
    const eventUtms = extractUtms(eventUrl)

    console.log('UTMS:', eventUtms)

    let metaPromise = Promise.resolve('Event skipped')
    let gaPromise = Promise.resolve('Event skipped')
    let gadsPromise = Promise.resolve('Event skipped')

    if (metaEvent && metaPixelId && metaAccessToken) {
      console.log('META SERVICE CALLING')
      metaPromise = metaService({ metaPayload: {
        data: [{
          event_name: metaEvent,
          event_id: eventId,
          event_time: timestamp,
          action_source: 'website',
          event_source_url: eventUrl,
          user_data: {
            fn: hashedUserFirstName,
            ln: hashedUserLastName,
            em: hashedUserEmail,
            ph: hashedUserPhone,
            fbp: cookieFbp,
            fbc: cookieFbc,
            client_user_agent: userAgent,
            client_ip_address: clientIp
          },
          custom_data: {
            page_referrer: eventUrl,
            ...eventUtms
          }
        }]
      }, metaPixelId, metaAccessToken, metaTestCode })
    } else {
      console.log('META SKIPPED')
    }

    if (gaEvent && gaMeasurementId && gaSecretKey) {
      console.log('GA SERVICE CALLING')
      gaPromise = gaService({ gaPayload: {
        client_id: userId,
        events: [{
          name: gaEvent,
          params: {
            page_location: eventUrl,
            page_referrer: eventUrl,
            event_id: eventId,
            engagement_time_msec: 1,
            ...eventUtms
          }
        }]
      }, gaMeasurementId, gaSecretKey })
    } else {
      console.log('GA SKIPPED')
    }

    if (cookieGclid && gadsConversionLabel && gadsCustomerId && gadsAccessToken && gadsDeveloperToken) {
      console.log('GADS SERVICE CALLING')
      gadsPromise = gadsService({ gadsPayload: {
        conversions: [{
          conversionAction: `customers/${gadsCustomerId}/conversionActions/${gadsConversionLabel}`,
          gclid: cookieGclid,
          conversionDateTime: new Date().toISOString().replace('T', ' ').replace('Z', '+00:00'),
          conversionValue: 1,
          currencyCode: 'BRL',
          orderId: eventId,
          userIdentifiers: [
            hashedUserEmail && { hashedEmail: hashedUserEmail },
            hashedUserPhone && { hashedPhoneNumber: hashedUserPhone }
          ].filter(Boolean)
        }],
        partialFailure: true
      }, gadsCustomerId, gadsAccessToken, gadsDeveloperToken })
    } else {
      console.log('GADS SKIPPED')
    }

    console.log('AWAITING PROMISES')

    const [metaResult, gaResult, gadsResult] = await Promise.all([
      metaPromise,
      gaPromise,
      gadsPromise
    ])

    console.log('RESULTS:', { metaResult, gaResult, gadsResult })

    const finalJson = {
      Meta: metaResult,
      'Google Analytics': gaResult,
      'Google Ads': gadsResult
    }

    console.log('FINAL JSON:', finalJson)

    return new Response(
      JSON.stringify(finalJson),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
}
