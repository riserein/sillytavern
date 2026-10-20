/** Shared public-resource policy for export and soundscapes. No credentials or local hosts. */
export function publicResource(value) {
    try {
        const url = new URL(value),
            host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.hash ||
            host === 'localhost' ||
            !host.includes('.') ||
            /(?:\.local|\.localhost|\.internal|\.test|\.invalid)$/.test(host) ||
            /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
            host.startsWith('[')
        )
            return null;
        if (
            [...url.searchParams.keys()].some((key) =>
                /^(?:expires?|expiry|token|signature|sign|auth|x-amz-.+|x-goog-.+)$/i.test(key),
            )
        )
            return null;
        return url.href;
    } catch {
        return null;
    }
}
