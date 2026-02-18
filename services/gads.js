export default async function ({ gadsPayload, gadsCustomerId, gadsAccessToken, gadsDeveloperToken }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
        const res = await fetch(
            `https://googleads.googleapis.com/v14/customers/${gadsCustomerId}:uploadClickConversions`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${gadsAccessToken}`,
                    'developer-token': gadsDeveloperToken
                },
                body: JSON.stringify(gadsPayload),
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

    return 'Event processed successfully'
}
