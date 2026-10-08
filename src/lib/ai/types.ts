export interface SummarizeOptions {
  apiKey?: string;
  model?: string;
}

export interface SummarizeResult {
  summary: string;
  modelUsed: string;
}

export interface StreamResult {
  stream: AsyncIterable<string>; // Each yielded item is a text token/delta
  modelUsed: string;
}

export interface AIProvider {
  summarize(text: string, title: string, options?: SummarizeOptions): Promise<SummarizeResult>;
  summarizeStream(text: string, title: string, options?: SummarizeOptions): Promise<StreamResult>;
}