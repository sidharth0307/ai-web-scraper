import { AIProvider } from "./types";
import { GroqProvider } from "./providers/groq";

export type SupportedProvider = "groq";

export function getAIProvider(provider: SupportedProvider = "groq"): AIProvider {
  switch (provider) {
    case "groq":
      return new GroqProvider();
    default:
      throw new Error(`Unsupported AI Provider: ${provider}`);
  }
}