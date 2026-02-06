/**
 * Policy engine — AST-based SQL evaluation, rewriting, and EXPLAIN gating.
 *
 * The DefaultPolicyEngine replaces the Phase 0/1 stub with real
 * AST-based analysis using node-sql-parser.
 */

import {
  type PolicyConfig,
  type SafeModeConfig,
  type ValidationResult,
  type ExplainEvaluation,
  defaultPolicyConfig,
  defaultSafeModeConfig,
  defaultStandardModeConfig,
} from './types.js';
import { parseSql } from './parse.js';
import { ensureLimit } from './rewrite.js';
import { validateAst } from './rules.js';
import { classifyStatement, type ClassificationResult } from './classify.js';

export interface PolicyEngine {
  /** Validate and rewrite a SQL statement */
  validateAndRewrite(sql: string): ValidationResult;

  /** Classify a statement and validate it against the current policy */
  classifyAndValidate(sql: string): { validation: ValidationResult; classification: ClassificationResult };

  /** Evaluate EXPLAIN results against thresholds */
  evaluateExplain(explainResult: ExplainData): ExplainEvaluation;

  /** Get the current policy config */
  getConfig(): PolicyConfig;

  /** Get the current safe mode config */
  getSafeModeConfig(): SafeModeConfig;

  /** Update the policy config */
  setConfig(config: Partial<PolicyConfig>): void;

  /** Update safe mode config */
  setSafeModeConfig(config: Partial<SafeModeConfig>): void;
}

/** Data passed from the EXPLAIN adapter result */
export interface ExplainData {
  estimatedRows: number;
  estimatedCost: number;
  hasSeqScan: boolean;
  warnings: string[];
}

/**
 * Default policy engine with AST-based SQL analysis.
 */
export class DefaultPolicyEngine implements PolicyEngine {
  private config: PolicyConfig;
  private safeModeConfig: SafeModeConfig;

  constructor(config?: Partial<PolicyConfig>, safeModeConfig?: Partial<SafeModeConfig>) {
    this.config = { ...defaultPolicyConfig(), ...config };
    const base =
      this.config.mode === 'standard' ? defaultStandardModeConfig() : defaultSafeModeConfig();
    this.safeModeConfig = { ...base, ...safeModeConfig };
  }

  validateAndRewrite(sql: string): ValidationResult {
    // Step 1: Parse
    const parseResult = parseSql(sql);

    if (!parseResult.ok) {
      return {
        allowed: false,
        warnings: [],
        reason: parseResult.error,
        details: 'The SQL could not be parsed. It may contain syntax errors.',
        suggestedFix: 'Check your SQL syntax.',
      };
    }

    // Step 2: Validate AST against rules
    const validation = validateAst(
      parseResult.ast,
      parseResult.kind,
      parseResult.statementCount,
      this.safeModeConfig,
      this.config,
    );

    if (!validation.allowed) {
      const firstViolation = validation.violations[0];
      return {
        allowed: false,
        warnings: validation.warnings,
        reason: firstViolation?.reason ?? 'Policy violation',
        details: validation.violations.map((v) => `[${v.rule}] ${v.reason}`).join('\n'),
        suggestedFix: firstViolation?.suggestedFix,
      };
    }

    // Step 3: Rewrite (LIMIT injection/clamping)
    const warnings = [...validation.warnings];
    let rewrittenSql = parseResult.normalizedSql;

    if (this.safeModeConfig.enforceLimit && parseResult.kind === 'select') {
      const rewrite = ensureLimit(
        parseResult.normalizedSql,
        this.safeModeConfig.defaultLimit,
        this.safeModeConfig.maxLimit,
      );
      rewrittenSql = rewrite.rewrittenSql;

      if (rewrite.limitApplied && !rewrite.clamped) {
        warnings.push(`LIMIT ${this.safeModeConfig.defaultLimit} injected (no LIMIT was present).`);
      }
      if (rewrite.clamped) {
        warnings.push(
          `LIMIT clamped from ${rewrite.originalLimit} to ${this.safeModeConfig.maxLimit}.`,
        );
      }
    }

    return {
      allowed: true,
      rewrittenSql,
      warnings,
      reason: 'Statement allowed',
    };
  }

  classifyAndValidate(sql: string): { validation: ValidationResult; classification: ClassificationResult } {
    const classification = classifyStatement(sql);
    const validation = this.validateAndRewrite(sql);
    return { validation, classification };
  }

  evaluateExplain(data: ExplainData): ExplainEvaluation {
    const warnings: string[] = [...data.warnings];
    const blockers: string[] = [];

    if (data.estimatedRows > this.safeModeConfig.maxEstimatedRows) {
      blockers.push(
        `Estimated rows (${data.estimatedRows.toLocaleString()}) exceeds threshold ` +
          `(${this.safeModeConfig.maxEstimatedRows.toLocaleString()}).`,
      );
    }

    if (data.estimatedCost > this.safeModeConfig.maxEstimatedCost) {
      blockers.push(
        `Estimated cost (${data.estimatedCost.toLocaleString()}) exceeds threshold ` +
          `(${this.safeModeConfig.maxEstimatedCost.toLocaleString()}).`,
      );
    }

    if (data.hasSeqScan) {
      warnings.push('Query plan includes a sequential scan.');
    }

    return {
      allowed: blockers.length === 0,
      warnings,
      blockers,
      summary: {
        estimatedRows: data.estimatedRows,
        estimatedCost: data.estimatedCost,
        hasSeqScan: data.hasSeqScan,
      },
    };
  }

  getConfig(): PolicyConfig {
    return { ...this.config };
  }

  getSafeModeConfig(): SafeModeConfig {
    return { ...this.safeModeConfig };
  }

  setConfig(config: Partial<PolicyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setSafeModeConfig(config: Partial<SafeModeConfig>): void {
    this.safeModeConfig = { ...this.safeModeConfig, ...config };
  }
}

// Keep StubPolicyEngine for backwards compat (Phase 0 tests)
export { StubPolicyEngine } from './stub-engine.js';
