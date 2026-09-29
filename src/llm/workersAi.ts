import type { Env } from "../env";

export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.2-1b-instruct";

export interface WorkersAiTurnArgs {
  env: Env;
  modelId?: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

export interface WorkersAiTurnResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Small, no-external-key chat path for the portfolio web widget.
 * Workers AI returns `{ response: string }` for this model. The extra
 * fallbacks make this tolerant of minor response-shape changes.
 */
export async function runWorkersAiTurn(
  args: WorkersAiTurnArgs,
): Promise<WorkersAiTurnResult> {
  const result = (await args.env.AI.run(
    args.modelId || DEFAULT_WORKERS_AI_MODEL,
    {
      messages: [
        { role: "system", content: args.system },
        ...args.messages,
      ],
      max_tokens: args.maxTokens ?? 256,
      temperature: args.temperature ?? 0.2,
    } as any,
  )) as any;

  const text = String(
    result?.response ?? result?.text ?? result?.output_text ?? "",
  ).trim();
  if (!text) throw new Error("Workers AI returned an empty response");

  const usage = result?.usage ?? {};
  return {
    text,
    inputTokens: Number(
      usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? 0,
    ),
    outputTokens: Number(
      usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? 0,
    ),
  };
}
