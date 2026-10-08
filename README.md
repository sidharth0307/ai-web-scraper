# Enterprise BYOK AI Web Scraper & Summarizer

An enterprise-ready, high-performance web content extraction and summarization platform engineered with **Next.js (App Router)**, **TypeScript**, **Cheerio**, and **Groq Cloud Inference**. 

The system implements a zero-trust **Bring Your Own Key (BYOK)** security model, robust defense-in-depth against Server-Side Request Forgery (SSRF) and memory exhaustion attacks, multi-tier automated model failover, and low-latency Server-Sent Events (SSE) token streaming with in-memory LRU caching.

---

## Architecture Overview

```text
                      +-------------------------------------------------------------+

                      |                      Client Browser                         |
                      |  - sessionStorage BYOK Isolation (No cross-tab leaks)       |
                      |  - Native ReadableStream SSE Parser (Typewriter UI)         |
                      +------------------------------+------------------------------+
                                                     |
                         HTTPS (x-user-api-key, x-ai-provider, JSON payload)
                                                     v
+---------------------------------------------------------------------------------------------------+

| Next.js Edge / Node.js Runtime Gateway (`/api/summarize`)                                         |
|                                                                                                   |
|  1. Request Schema Guard (Zod)                                                                    |
|     - URL length cap (2048 chars), protocol validation (HTTP/HTTPS only)                          |
|     - Header validation (Format regex for user-provided API keys)                                 |
|                                                                                                   |
|  2. Token Bucket Rate Limiting (Sliding Window)                                                   |
|     - Restricts anonymous/server-fallback users to 10 req/min                                     |
|     - Automatically bypasses rate limits for authenticated BYOK clients                           |
|                                                                                                   |
|  3. Pre-Flight DNS Resolution & SSRF Defense                                                      |
|     - Performs forward DNS lookup (`node:dns/promises`)                                           |
|     - Validates resolved IPv4/IPv6 addresses against loopback, RFC 1918 subnets, & metadata IPs   |
|                                                                                                   |
|  4. In-Memory LRU Cache Interceptor (SHA-256 Keyed)                                               |
|     - Checks cache for `hash(provider + url)`                                                     |
|     - [Cache Hit]  -> Instantly yields synthetic SSE stream (TTFB < 30ms)                         |
|     - [Cache Miss] -> Continues pipeline                                                          |
|                                                                                                   |
|  5. Stream-Capped Upstream Fetcher                                                                |
|     - Verifies `Content-Type` header (strictly `text/html`, `text/plain`)                         |
|     - Reads chunks via `ReadableStreamDefaultReader` with hard 8 MB cap                           |
|     - Prevents Zip-Bomb / infinite-stream Denial of Service (OOM)                                 |
|                                                                                                   |
|  6. Content Sanitization & Context Window Truncation (Cheerio)                                    |
|     - Strips scripts, stylesheets, navigation, SVG, iframe, ads, and forms                        |
|     - Normalizes whitespace; extracts high-density content up to 15,000 characters                |
|                                                                                                   |
|  7. Pluggable AI Engine Orchestrator                                                              |
|     - Instantiates provider dynamically via factory pattern (`getAIProvider()`)                   |
|     - Traverses model failover priority queue on upstream rate-limits or deprecations             |
|                                                                                                   |
|  8. Asynchronous Token Streaming & Cache Accumulator                                              |
|     - Flushes metadata frame (`type: "meta"`) with token count and active model                   |
|     - Pipes LLM tokens to client using chunked transfer encoding (`text/event-stream`)            |
|     - Asynchronously writes completed payload to LRU Cache on `[DONE]`                            |
+---------------------------------------------------------------------------------------------------+

                               |                                           |
             Upstream HTTP GET |                         Groq SDK Streams  |
                               v                                           v
                 +---------------------------+              +-----------------------------+

                 |    Target Public Site     |              |     Groq Cloud Inference    |
                 | (Wikipedia, Blogs, Docs)  |              |  - openai/gpt-oss-120b      |
                 +---------------------------+              |  - openai/gpt-oss-20b       |

                                                            |  - qwen/qwen3.8-27b         |
                                                            +-----------------------------+
```

---

## Directory Tree

```text
ai-web-scraper/
├── .env.example
├── .env.local
├── .gitignore
├── next.config.ts
├── package.json
├── postcss.config.mjs
├── README.md
├── tailwind.config.ts
├── tsconfig.json
└── src/
    ├── app/
    │   ├── api/
    │   │   └── summarize/
    │   │       └── route.ts
    │   ├── favicon.ico
    │   ├── globals.css
    │   ├── layout.tsx
    │   └── page.tsx
    └── lib/
        ├── ai/
        │   ├── index.ts
        │   ├── types.ts
        │   └── providers/
        │       └── groq.ts
        ├── cache/
        │   └── index.ts
        └── security/
            ├── fetcher.ts
            ├── ssrf.ts
            └── validation.ts
```

---

## Quickstart & Local Setup

### Prerequisites
- **Node.js:** `18.17.0+` or `20+` installed.
- **API Access:** A free API key from the **Groq Cloud Console**.

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/ai-web-scraper.git
cd ai-web-scraper
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Edit `.env.local` to define your optional server-side fallback key:
```env
# Optional: Global fallback API key used if the client does not provide a BYOK key.
# Public/unauthenticated requests hitting this fallback are strictly rate-limited.
GROQ_API_KEY=gsk_your_actual_groq_key_here
```

### 3. Run Development Server
```bash
npm run dev
```
Navigate to `http://localhost:3000` in your browser.

### 4. Production Build Verification
To ensure all TypeScript interfaces, Zod schemas, and Next.js route segments compile cleanly:
```bash
npm run build
npm run start
```

---

## Testing Workflow & Verification

Run these validation checks using Windows PowerShell or bash to verify the operational resilience of every layer.

### 1. Functional End-to-End Test
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/summarize" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"url":"https://en.wikipedia.org/wiki/Artificial_intelligence"}'
```
- **Expected Output:** Returns an open HTTP 200 chunked stream. The initial frame contains `{"type":"meta", ...}`, followed by real-time token frames, and is terminated by `data: [DONE]`.

### 2. Cache Hit Verification
Run the exact same command immediately a second time.
- **Expected Output:** The stream executes in **under 50ms**, returning the pre-calculated summary from memory without dispatching upstream network requests or consuming Groq token credits.

### 3. Security Boundary Verification

#### Test A: Loopback / SSRF Defense
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/summarize" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"url":"http://127.0.0.1:3000"}'
```
Expected Output: **HTTP 403 Forbidden** (`FORBIDDEN_HOST` or `FORBIDDEN_IP`).

#### Test B: Cloud Instance Metadata Protection (AWS / GCP / Azure)
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/summarize" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"url":"http://169.254.169"}'
```
Expected Output: **HTTP 403 Forbidden** (`FORBIDDEN_IP: Cloud metadata endpoint access prohibited.`).

#### Test C: Request Payload Validation Guard
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/summarize" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"url":"not-a-valid-url"}'
```
Expected Output: **HTTP 400 Bad Request** (`{"error":"Invalid URL format."}`).

#### Test D: Non-HTML / Binary File Rejection
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/summarize" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"url":"https://unsplash.com"}'
```
Expected Output: **HTTP 400 Bad Request** (`UNSUPPORTED_MEDIA_TYPE: URL did not return an HTML or text payload.`).

#### Test E: Upstream Bot Protection (403/429 Handling)
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/summarize" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"url":"https://w3.org"}'
```
Expected Output: **HTTP 502 Bad Gateway** returning a user-friendly alert rather than an unhandled 500 crash.

---

## System Architecture Decisions & Trade-Offs

### 1. Bring Your Own Key (BYOK) vs. Centralized Secret Management
* **Decision:** Pass the user's API key ephemerally through custom request headers (`x-user-api-key`) and isolate it within the browser's `sessionStorage`. Keys are completely omitted from databases, server-side cookies, operational logs, and telemetry.
* **Trade-Offs:**
  * **Pros:** Zero liability for compromised third-party keys; no database compliance overhead (SOC2, HIPAA, PCI-DSS); users have complete agency over their rate limits and billing.
  * **Cons:** Keys are scoped only to the active browser tab (closing the tab requires re-entering the key); users must trust the front-end bundle not to leak keys to malicious third-party scripts.

### 2. Ephemeral In-Memory Storage vs. Persistent Distributed Caching (Redis)
* **Decision:** Implement an in-memory sliding-window token bucket and an in-memory LRU cache with SHA-256 hashed keys directly inside the Node.js process runtime.
* **Trade-Offs:**
  * **Pros:** Zero external cloud infrastructure dependencies; no network serialization overhead (retrieval latency is < 1ms internally, yielding sub-30ms client response times); completely free to operate.
  * **Cons:** In serverless environments (e.g., AWS Lambda, Vercel Serverless), memory is not shared across isolated micro-containers. Cold starts begin with a blank cache. Under distributed production scale, this layer should be swapped for an external Redis instance (such as Upstash Redis).

### 3. Pre-Flight DNS Resolution vs. Post-Fetch Inspection
* **Decision:** Resolve hostnames to actual IP addresses via `node:dns/promises` before dispatching an HTTP client socket.
* **Trade-Offs:**
  * **Pros:** Complete mitigation of DNS-rebinding attacks where a domain resolves to a public address during validation, but shifts to 127.0.0.1 upon socket connection. Rejects private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopbacks, and link-local cloud metadata addresses (`169.254.169.254`).
  * **Cons:** Incurs a minor DNS resolution latency penalty (~15–30ms) on cache misses; edge runtimes lacking full Node.js POSIX socket interfaces require Node.js-compatible runtime configurations.

### 4. Server-Sent Events (SSE) vs. WebSocket vs. Buffered REST
* **Decision:** Implement unidirectional Server-Sent Events (`text/event-stream`) using native Web Streams (`ReadableStream`).
* **Trade-Offs:**
  * **Pros:** Native HTTP/HTTPS protocol compliance; works through corporate firewalls, reverse proxies, and edge networks without WebSocket handshake overhead; enables sub-500ms Time-To-First-Byte (TTFB); drastically reduces memory hold times on serverless functions.
  * **Cons:** Unidirectional only (the client cannot push messages over the same stream without issuing a new HTTP request); requires manual event boundary chunk reconstruction (`data: ...\n\n`) on the client parser.

### 5. Multi-Model Cascade Failover vs. Single Model Fallback
* **Decision:** Construct a prioritized fallback queue of active inference models (`openai/gpt-oss-120b` → `openai/gpt-oss-20b` → `qwen/qwen3.8-27b` → `allam-2-7b`).
* **Trade-Offs:**
  * **Pros:** Eliminates client-facing outages caused by rate-limiting (HTTP 429), dynamic model deprecations, or regional capacity blackouts; transitions downstream execution automatically.
  * **Cons:** If the initial model fails mid-stream, the stream must cleanly abort and restart generation on the secondary model, consuming compute time.



