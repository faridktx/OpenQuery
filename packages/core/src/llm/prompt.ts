/**
 * Prompt construction for LLM SQL generation.
 */

import type { GuardrailMode } from '../policy/types.js';

export interface PromptInput {
  dialect: string;
  question: string;
  schemaContext: string;
  mode: GuardrailMode;
  blockedTables?: string[];
}

const JSON_FORMAT_INSTRUCTIONS = `You must respond with ONLY a JSON object matching this exact schema:
{
  "sql": "<single SQL statement with $1, $2 etc. placeholders>",
  "params": [{"name": "<param_name>", "type": "<string|number|boolean|date|timestamp>", "value": <literal>}],
  "assumptions": ["<assumption 1>", ...],
  "safetyNotes": ["<note 1>", ...],
  "confidence": <0.0 to 1.0>,
  "referencedEntities": [{"schema": "<optional>", "table": "<name>", "columns": ["<col1>", ...]}]
}

Rules:
- Do NOT wrap in markdown code fences.
- Do NOT include any text before or after the JSON.`;

export function buildMessages(input: PromptInput): Array<{ role: 'system' | 'user'; content: string }> {
  const modeConstraint =
    input.mode === 'safe' || input.mode === 'standard'
      ? 'You MUST generate only SELECT statements or CTE (WITH ... SELECT) statements. No INSERT, UPDATE, DELETE, DROP, or DDL.'
      : 'You MUST generate only SELECT statements or CTE (WITH ... SELECT) statements.';

  const blockedTablesNote =
    input.blockedTables && input.blockedTables.length > 0
      ? `\nForbidden tables (NEVER reference these): ${input.blockedTables.join(', ')}`
      : '';

  const systemPrompt = `You are a SQL query generator for ${input.dialect} databases.

CONSTRAINTS:
- Generate a SINGLE SQL statement only. Never multiple statements.
- ${modeConstraint}
- Prefer explicit column lists over SELECT *.
- Parameterize literal values into the params array. Use $1, $2, etc. placeholders in the SQL (Postgres style).
- Always include a LIMIT clause (it will be injected if missing, but include one for best results).
- Do NOT reference tables not present in the provided schema.${blockedTablesNote}

${JSON_FORMAT_INSTRUCTIONS}`;

  const userPrompt = `${input.schemaContext}

Question: ${input.question}

Generate the SQL query as a JSON object.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Build a repair prompt when the first attempt produced invalid JSON/schema.
 */
export function buildRepairMessages(
  originalMessages: Array<{ role: 'system' | 'user'; content: string }>,
  rawAssistantOutput: string,
  validationErrors: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    ...originalMessages,
    { role: 'assistant' as const, content: rawAssistantOutput },
    {
      role: 'user' as const,
      content: `Your previous response was invalid. Errors:\n${validationErrors}\n\nPlease return ONLY a corrected JSON object matching the required schema. No explanation, no markdown fences.`,
    },
  ];
}
