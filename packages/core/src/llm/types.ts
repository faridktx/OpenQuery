/**
 * LLM output types for SQL generation.
 */

export type ParamType = 'string' | 'number' | 'boolean' | 'date' | 'timestamp';

export interface LlmSqlPlan {
  /** Single SQL statement with $1-style placeholders */
  sql: string;
  /** Parameterized values */
  params: Array<{
    name: string;
    type: ParamType;
    value: string | number | boolean;
  }>;
  /** Assumptions the model made about the question */
  assumptions: string[];
  /** Safety notes from the model */
  safetyNotes: string[];
  /** Confidence score 0..1 */
  confidence: number;
  /** Tables and columns referenced */
  referencedEntities: Array<{
    schema?: string;
    table: string;
    columns: string[];
  }>;
}
