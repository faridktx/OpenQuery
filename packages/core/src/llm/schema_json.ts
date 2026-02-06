/**
 * AJV JSON Schema for validating LlmSqlPlan from the LLM.
 * Using plain object schema (not JSONSchemaType) to avoid complex union type issues.
 */

export const llmSqlPlanSchema = {
  type: 'object' as const,
  properties: {
    sql: { type: 'string' as const, minLength: 1 },
    params: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          type: { type: 'string' as const, enum: ['string', 'number', 'boolean', 'date', 'timestamp'] },
          value: {
            oneOf: [
              { type: 'string' as const },
              { type: 'number' as const },
              { type: 'boolean' as const },
            ],
          },
        },
        required: ['name', 'type', 'value'] as const,
        additionalProperties: false,
      },
    },
    assumptions: {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
    safetyNotes: {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
    confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
    referencedEntities: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          schema: { type: 'string' as const, nullable: true },
          table: { type: 'string' as const },
          columns: {
            type: 'array' as const,
            items: { type: 'string' as const },
          },
        },
        required: ['table', 'columns'] as const,
        additionalProperties: false,
      },
    },
  },
  required: ['sql', 'params', 'assumptions', 'safetyNotes', 'confidence', 'referencedEntities'] as const,
  additionalProperties: false,
};
