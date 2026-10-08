const MAX_BYTES = 8 * 1024 * 1024; // 8 MB safe ceiling

export async function fetchWithSafeLimit(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  if (!response.ok) {
    throw new Error(`TARGET_HTTP_ERROR: Upstream returned HTTP status ${response.status}`);
  }

  // 1. Content-Type Check
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("UNSUPPORTED_MEDIA_TYPE: URL did not return an HTML or text payload.");
  }

  // 2. Early Content-Length Check
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && parseInt(declaredLength, 10) > MAX_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE: Page size exceeds 2 MB limit.");
  }

  // 3. Chunk-wise Stream Capping (Protects against chunked transfer without Content-Length)
  if (!response.body) {
    throw new Error("EMPTY_RESPONSE_BODY: No readable stream returned.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let totalBytes = 0;
  let accumulatedText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > MAX_BYTES) {
      reader.cancel();
      throw new Error("PAYLOAD_TOO_LARGE: Page payload exceeded 2 MB during streaming.");
    }

    accumulatedText += decoder.decode(value, { stream: true });
  }

  accumulatedText += decoder.decode(); // Flush remainder
  return accumulatedText;
}