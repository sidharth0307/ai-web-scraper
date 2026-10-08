import { z } from "zod";

export const SummarizeRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .url("Invalid URL format.")
    .max(2048, "URL is too long (maximum 2048 characters).")
    .refine(
      (val) => val.startsWith("http://") || val.startsWith("https://"),
      "Only http and https protocols are supported."
    ),
});

export const HeaderSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .regex(/^gsk_[a-zA-Z0-9]{20,}/, "Invalid Groq API key format.")
    .optional(),
  provider: z.enum(["groq"]).default("groq"),
});