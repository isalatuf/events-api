export default async function ({ gaPayload, gaMeasurementId, gaSecretKey }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
        const res = await fetch(
            `https://www.google-analytics.com/mp/collect?measurement_id=${gaMeasurementId}&api_secret=${gaSecretKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(gaPayload),
                signal: controller.signal
            }
        )

        if (!res.ok) {
            const text = await res.text()
            return 'Event request error: ' + text
        }
    } catch {
        return 'Event request failed'
    } finally {
        clearTimeout(timeout)
    }

    return `Event processed succesfully`
}