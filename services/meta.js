export default async function ({ metaPayload, metaPixelId, metaAccessToken, metaTestCode }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
        const res = await fetch(
            `https://graph.facebook.com/v18.0/${metaPixelId}/events?access_token=${metaAccessToken}${metaTestCode ? `&test_event_code=${metaTestCode}` : ''}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(metaPayload),
                signal: controller.signal
            }
        )

        const text = await res.text()

        if (!res.ok) {
            try {
                const json = JSON.parse(text)
                console.error(`Meta request error (${json.error?.error_user_msg || json.error?.message || text})`)
                return
            } catch {
                console.error(`Meta request error (${text})`)
                return
            }
        }
    } catch {
        console.error(`Meta request failed`)
        return
    } finally {
        clearTimeout(timeout)
    }

    console.info('Meta event processed successfully')
    return
}