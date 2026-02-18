# Events API – Cloudflare Worker

Server-side tracking API built on **Cloudflare Workers** to send events in parallel to:

- Meta Conversions API  
- Google Analytics 4 (Measurement Protocol)  
- Google Ads (Offline Conversions)

The Worker responds immediately and processes tracking requests asynchronously in the background using `ctx.waitUntil()`.

---

# Architecture

## Flow

1. Frontend sends a `POST` request with event data.
2. Worker immediately returns:

200 – Events API worker started

3. Tracking requests are processed in parallel in the background:
   - Meta
   - GA4
   - Google Ads
4. Execution logs are available in Cloudflare Worker logs.

Parallel execution is handled with:

Promise.allSettled(tasks)

---

# Request Format

## Endpoint

POST /

## Headers

Content-Type: application/json

## Body Example

{
  "data": {
    "metaEvent": "PageView",
    "gaEvent": "page_view",
    "gadsConversionLabel": "ABC123",
    "eventUrl": "https://example.com",
    "eventId": "uuid",
    "userId": "uuid",
    "userData": {
      "email": "user@example.com",
      "phone": "5511999999999",
      "name": "John Doe"
    },
    "cookieFbp": "...",
    "cookieFbc": "...",
    "cookieGclid": "..."
  },
  "meta": {
    "metaPixelId": "123456789",
    "metaTestCode": null,
    "gaMeasurementId": "G-XXXXXXX"
  }
}

---

# Environment Variables

Set these in your Cloudflare Worker environment:

META_ACCESS_TOKEN
GA_SECRET_KEY
GADS_CUSTOMER_ID
GADS_ACCESS_TOKEN
GADS_DEVELOPER_TOKEN

---

# Supported Platforms

## Meta Conversions API

- Uses Graph API v18.0
- Sends SHA-256 hashed user data
- Supports:
  - fn
  - ln
  - em
  - ph
  - fbp
  - fbc
  - client_ip_address
  - client_user_agent

Documentation:
https://developers.facebook.com/docs/marketing-api/conversions-api/

---

## Google Analytics 4

- Uses GA4 Measurement Protocol
- Requires:
  - measurement_id
  - api_secret

Documentation:
https://developers.google.com/analytics/devguides/collection/protocol/ga4

---

## Google Ads Offline Conversions

- Requires:
  - customer_id
  - developer_token
  - oauth access_token

Documentation:
https://developers.google.com/google-ads/api/docs/conversions/upload-offline

---

# Security

- All PII is hashed using SHA-256 before transmission.
- No platform responses are exposed to the client.
- Fully server-side execution.
- Stateless processing model.

---

# Response Behavior

Immediate response:

200 OK
Events API worker started

All platform integrations execute asynchronously in the background.

---

# Logging

Logs are available via:

- Cloudflare Dashboard → Workers → Logs
- Wrangler CLI:

wrangler tail

Logs include:

- Event start
- Event skipped
- Platform errors
- Background execution errors

---

# Deployment

Using Wrangler:

wrangler deploy

Tail logs:

wrangler tail

---

# Design Decisions

- Uses ctx.waitUntil() to avoid blocking response time.
- Uses Promise.allSettled() to prevent one platform failure from affecting others.
- Designed for high-throughput event ingestion.
- Stateless execution model.

---

# License

MIT
