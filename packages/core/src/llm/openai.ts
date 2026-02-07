/**
 * OpenAI provider for SQL plan generation.
 * Reads OPENAI_API_KEY and OPENQUERY_MODEL from environment.
 */

import OpenAI from 'openai';
import Ajv from 'ajv';
import type { LlmSqlPlan } from './types.js';
import { llmSqlPlanSchema } from './schema_json.js';
import { buildMessages, buildRepairMessages } from './prompt.js';
import { buildSchemaContext, type SchemaContextOpts } from './schema.js';
import type { SchemaSnapshot } from '../db/types.js';
import type { GuardrailMode } from '../policy/types.js';

const DEFAULT_MODEL = 'gpt-4o-mini';

export interface GeneratePlanInput {
  question: string;
  schema: SchemaSnapshot;
  dialect: string;
  mode: GuardrailMode;
  blockedTables?: string[];
  schemaOpts?: SchemaContextOpts;
}

export interface GeneratePlanResult {
  plan: LlmSqlPlan;
  model: string;
  rawOutput: string;
  retried: boolean;
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'OpenAI API key is not configured. ' +
        'Desktop users: set it in Settings > AI Provider. ' +
        'CLI users: set OPENAI_API_KEY in your shell.',
    );
  }
  return key;
}

function getModel(): string {
  return process.env.OPENQUERY_MODEL || DEFAULT_MODEL;
}

/**
 * Extract JSON from a string that may contain markdown fences or extra text.
 */
function extractJson(text: string): string {
  // Try to find JSON in markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  // Try to find a top-level JSON object
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }
  return text.trim();
}

export class OpenAIProvider {
  private client: OpenAI;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private validate: any;

  constructor() {
    this.client = new OpenAI({ apiKey: getApiKey() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AjvClass = (Ajv as any).default ?? Ajv;
    const ajv = new AjvClass({ allErrors: true });
    this.validate = ajv.compile(llmSqlPlanSchema);
  }

  async generatePlan(input: GeneratePlanInput): Promise<GeneratePlanResult> {
    const model = getModel();
    const schemaContext = buildSchemaContext(input.question, input.schema, input.schemaOpts);

    const messages = buildMessages({
      dialect: input.dialect,
      question: input.question,
      schemaContext,
      mode: input.mode,
      blockedTables: input.blockedTables,
    });

    // First attempt
    const rawOutput = await this.callOpenAI(model, messages);
    const firstResult = this.tryParse(rawOutput);

    if (firstResult.ok) {
      return { plan: firstResult.plan!, model, rawOutput, retried: false };
    }

    // Retry with repair prompt
    const repairMessages = buildRepairMessages(messages, rawOutput, firstResult.errors!);
    const repairOutput = await this.callOpenAI(model, repairMessages);
    const secondResult = this.tryParse(repairOutput);

    if (secondResult.ok) {
      return { plan: secondResult.plan!, model, rawOutput: repairOutput, retried: true };
    }

    // Both attempts failed
    const snippet = repairOutput.slice(0, 200) + (repairOutput.length > 200 ? '...' : '');
    throw new Error(
      `LLM output failed schema validation after retry.\n` +
        `Validation errors: ${secondResult.errors}\n` +
        `Output snippet: ${snippet}`,
    );
  }

  private async callOpenAI(
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: 0.1,
      max_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned empty response.');
    }
    return content;
  }

  private tryParse(raw: string): { ok: boolean; plan?: LlmSqlPlan; errors?: string } {
    const jsonStr = extractJson(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return { ok: false, errors: `Invalid JSON: ${jsonStr.slice(0, 100)}...` };
    }

    if (this.validate(parsed)) {
      return { ok: true, plan: parsed as LlmSqlPlan };
    }

    const errors = this.validate.errors
      ?.map((e: { instancePath?: string; message?: string }) => `${e.instancePath || '/'}: ${e.message}`)
      .join('; ');
    return { ok: false, errors: errors ?? 'Unknown validation error' };
  }
}
