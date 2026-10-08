import Groq from "groq-sdk";
import { AIProvider, SummarizeOptions, SummarizeResult, StreamResult } from "../types";

const FALLBACK_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "allam-2-7b",
];

export class GroqProvider implements AIProvider {
  private getClient(apiKey?: string): Groq {
    const key = apiKey || process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error("GROQ_API_KEY_MISSING: Provide a Groq API key via the BYOK settings modal.");
    }
    return new Groq({ apiKey: key });
  }

  private getModelQueue(preferredModel?: string): string[] {
    return preferredModel
      ? [preferredModel, ...FALLBACK_MODELS.filter((m) => m !== preferredModel)]
      : FALLBACK_MODELS;
  }

  // 1. Buffered Generation (Useful for caching full responses)
  async summarize(text: string, title: string, options?: SummarizeOptions): Promise<SummarizeResult> {
    const groq = this.getClient(options?.apiKey);
    const modelQueue = this.getModelQueue(options?.model);
    let lastError: any = null;

    for (const model of modelQueue) {
      try {
        const completion = await groq.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are an objective web content summarizer. Output a concise 2-3 sentence overview followed by 3-5 structured bullet points.",
            },
            {
              role: "user",
              content: `Title: ${title}\n\nContent:\n${text}`,
            },
          ],
          stream: false,
          temperature: 0.3,
          max_tokens: 1024,
        });

        const summary = completion.choices[0]?.message?.content;
        if (summary) return { summary, modelUsed: model };
      } catch (err: any) {
        lastError = err;
        console.warn(`[Groq Fallback] Model '${model}' failed:`, err?.message || err);
      }
    }

    throw new Error(`ALL_MODELS_FAILED: All fallback models were exhausted. Last error: ${lastError?.message || "Unknown error"}`);
  }

  // 2. Token Streaming (Low latency SSE)
  async summarizeStream(text: string, title: string, options?: SummarizeOptions): Promise<StreamResult> {
    const groq = this.getClient(options?.apiKey);
    const modelQueue = this.getModelQueue(options?.model);
    let lastError: any = null;

    for (const model of modelQueue) {
      try {
        const rawStream = await groq.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are an objective web content summarizer. Output a concise 2-3 sentence overview followed by 3-5 structured bullet points.",
            },
            {
              role: "user",
              content: `Title: ${title}\n\nContent:\n${text}`,
            },
          ],
          stream: true,
          temperature: 0.3,
          max_tokens: 1024,
        });

        // Normalize SDK chunk generator into a clean AsyncIterable<string>
        async function* normalizeStream() {
          for await (const chunk of rawStream) {
            const token = chunk.choices[0]?.delta?.content || "";
            if (token) yield token;
          }
        }

        return { stream: normalizeStream(), modelUsed: model };
      } catch (err: any) {
        lastError = err;
        console.warn(`[Groq Fallback Stream] Model '${model}' failed:`, err?.message || err);
      }
    }

    throw new Error(`ALL_MODELS_FAILED: All streaming fallback models were exhausted. Last error: ${lastError?.message || "Unknown error"}`);
  }
}