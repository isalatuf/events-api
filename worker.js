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
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: corsHeaders })

    if (request.method !== 'POST')
      return new Response('Wrong request method', { status: 405, headers: corsHeaders })

    let body
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders })
    }

    ctx.waitUntil((async () => {

      const metaAccessToken = env.META_ACCESS_TOKEN || null
      const gaSecretKey = env.GA_SECRET_KEY || null
      const gadsCustomerId = env.GADS_CUSTOMER_ID || null
      const gadsAccessToken = env.GADS_ACCESS_TOKEN || null
      const gadsDeveloperToken = env.GADS_DEVELOPER_TOKEN || null

      try {
        body = toCamelDeep(body)

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
        } = data || {}

        const {
          metaPixelId,
          metaTestCode,
          gaMeasurementId
        } = meta || {}

        if (!eventId) {
          console.error(`Event ID is missing`)
          return
        }

        if (!eventUrl) {
          console.error(`Event URL is missing`)
          return
        }

        if (!userId) {
          console.error(`User ID is missing`)
          return
        }

        const headers = Object.fromEntries(request.headers.entries())

        const clientIp =
          headers['cf-connecting-ip'] ||
          headers['x-forwarded-for']?.split(',')[0].trim() ||
          null

        const userAgent = headers['user-agent'] || null

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

        const timestamp = Math.floor(Date.now() / 1000)
        const eventUtms = extractUtms(eventUrl)

        const tasks = []

        if (metaEvent && metaPixelId && metaAccessToken) {
          console.info(`Meta event [${metaEvent}] process started`)

          const metaPayload = {
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
          }

          tasks.push(metaService({ metaPayload, metaPixelId, metaAccessToken, metaTestCode }))
        } else {
          console.warn(`Meta event skipped`)
        }

        if (gaEvent && gaMeasurementId && gaSecretKey) {
          console.info(`Google Analytics event [${gaEvent}] process started`)

          const gaPayload = {
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
          }

          tasks.push(gaService({ gaPayload, gaMeasurementId, gaSecretKey }))
        } else {
          console.warn(`Google Analytics event skipped`)
        }

        if (cookieGclid && gadsConversionLabel && gadsCustomerId && gadsAccessToken && gadsDeveloperToken) {
          console.info(`Google Ads conversion [${gadsConversionLabel}] process started`)

          const gadsPayload = {
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
          }

          tasks.push(gadsService({ gadsPayload, gadsCustomerId, gadsAccessToken, gadsDeveloperToken }))
        } else {
          console.warn(`Google Ads conversion skipped`)
        }

        await Promise.allSettled(tasks)

      } catch (err) {
        console.error('Background execution error', err)
      }

    })())

    return new Response('Events API worker started', { status: 200, headers: corsHeaders })
  }
}