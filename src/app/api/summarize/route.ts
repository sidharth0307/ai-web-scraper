import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getAIProvider, SupportedProvider } from "@/lib/ai";
import { validateSafeTargetUrl } from "@/lib/security/ssrf";
import { fetchWithSafeLimit } from "@/lib/security/fetcher";
import {
  getCacheKey,
  getCachedSummary,
  setCachedSummary,
  checkRateLimit,
} from "@/lib/cache";
import { SummarizeRequestSchema, HeaderSchema } from "@/lib/security/validation";

export async function POST(req: NextRequest) {
  let parsedUrl: URL | null = null;

  try {
    // 1. Validate Headers
    const headerValidation = HeaderSchema.safeParse({
      apiKey: req.headers.get("x-user-api-key") || undefined,
      provider: req.headers.get("x-ai-provider") || "groq",
    });

    if (!headerValidation.success) {
      return NextResponse.json(
        { error: headerValidation.error.issues[0]?.message || "Invalid request headers." },
        { status: 400 }
      );
    }

    const { apiKey: userApiKey, provider } = headerValidation.data;

    // 2. Validate Body (Parsed only once)
    const rawBody = await req.json().catch(() => null);
    const bodyValidation = SummarizeRequestSchema.safeParse(rawBody);

    if (!bodyValidation.success) {
      return NextResponse.json(
        { error: bodyValidation.error.issues[0]?.message || "Invalid payload." },
        { status: 400 }
      );
    }

    const { url } = bodyValidation.data;
    parsedUrl = new URL(url);

    // 3. Rate Limiting for fallback users (BYOK users are exempt)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
    if (!userApiKey && !checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "RATE_LIMIT_EXCEEDED: Maximum 10 requests/min. Please configure your own BYOK API key." },
        { status: 429 }
      );
    }

    // 4. DNS-level SSRF Validation
    await validateSafeTargetUrl(parsedUrl);

    // 5. Cache Check
    const cacheKey = getCacheKey(parsedUrl.toString(), provider);
    const cached = getCachedSummary(cacheKey);

    const encoder = new TextEncoder();

    // If cache hit: Return immediately as an SSE stream for UI consistency
    if (cached) {
      const cachedStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "meta",
                title: cached.title,
                url: parsedUrl?.toString(),
                modelUsed: cached.modelUsed,
                characterCount: cached.characterCount,
                fromCache: true,
              })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "token", text: cached.summary })}\n\n`)
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(cachedStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        },
      });
    }

    // 6. Safe Stream-Capped Fetch
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 8000);

    let html = "";
    try {
      html = await fetchWithSafeLimit(parsedUrl.toString(), abortController.signal);
    } finally {
      clearTimeout(timeout);
    }

    // 7. Clean HTML & Extract Text
    const $= cheerio.load(html);$("script, style, noscript, nav, footer, header, svg, iframe, form, button, [aria-hidden='true']").remove();

    const title = $("title").first().text().trim() || $("h1").first().text().trim() || "Webpage";
    const rawText = $("body").text().replace(/\s+/g, " ").trim();

    if (rawText.length < 60) {
      return NextResponse.json(
        { error: "INSUFFICIENT_CONTENT: Could not extract sufficient readable text." },
        { status: 422 }
      );
    }

    const truncatedText = rawText.slice(0, 15000);

    // 8. Execute AI Stream via Pluggable Provider
    const aiPlugin = getAIProvider(provider as SupportedProvider);
    const { stream, modelUsed } = await aiPlugin.summarizeStream(truncatedText, title, {
      apiKey: userApiKey,
    });

    // 9. Pipe SSE to Client & Accumulate Chunks for Cache
    let accumulatedSummary = "";

    const responseStream = new ReadableStream({
      async start(controller) {
        // Send initial metadata
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "meta",
              title,
              url: parsedUrl?.toString(),
              modelUsed,
              characterCount: truncatedText.length,
              fromCache: false,
            })}\n\n`
          )
        );

        try {
          for await (const token of stream) {
            accumulatedSummary += token;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "token", text: token })}\n\n`)
            );
          }

          // Cache the completed result for subsequent visits
          if (accumulatedSummary.trim()) {
            setCachedSummary(cacheKey, {
              title,
              summary: accumulatedSummary,
              characterCount: truncatedText.length,
              modelUsed,
            });
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (streamErr) {
          controller.error(streamErr);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (error: any) {
    if (error.name === "AbortError") {
      return NextResponse.json({ error: "TIMEOUT: Target URL took longer than 8s to respond." }, { status: 504 });
    }

    console.error(`[Scrape Error] Host: ${parsedUrl?.hostname || "unknown"} | Code: ${error?.message}`);

    const message: string = error?.message || "An internal error occurred.";
    let status = 500;

    if (message.startsWith("INVALID_") || message.startsWith("UNSUPPORTED_")) status = 400;
    if (message.startsWith("FORBIDDEN_")) status = 403;
    if (message.startsWith("PAYLOAD_TOO_LARGE")) status = 413;
    if (message.startsWith("GROQ_API_KEY_MISSING")) status = 401;

    if (message.startsWith("TARGET_HTTP_ERROR")) {
      status = 502;
      return NextResponse.json(
        { error: "The target website is blocking automated scrapers (HTTP 403/429). Try another URL." },
        { status }
      );
    }

    return NextResponse.json({ error: message }, { status });
  }
}