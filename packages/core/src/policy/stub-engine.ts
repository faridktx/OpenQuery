/**
 * Stub policy engine for Phase 0 backwards compatibility.
 * Not used in Phase 2+.
 */

import {
  type PolicyConfig,
  type PolicyDecision,
  type AuditEvent,
  defaultPolicyConfig,
} from './types.js';

export class StubPolicyEngine {
  private config: PolicyConfig;

  constructor(config?: Partial<PolicyConfig>) {
    this.config = { ...defaultPolicyConfig(), ...config };
  }

  evaluate(sql: string, config?: PolicyConfig): PolicyDecision {
    const effectiveConfig = config ?? this.config;
    const now = new Date();

    const auditEvent: AuditEvent = {
      timestamp: now,
      mode: effectiveConfig.mode,
      sql,
      decision: 'denied',
      reason: 'Stub engine — use DefaultPolicyEngine',
      risk: 'medium',
    };

    return {
      allowed: false,
      reason: 'Stub engine — use DefaultPolicyEngine for real policy evaluation.',
      risk: 'medium',
      auditEvent,
    };
  }

  getConfig(): PolicyConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<PolicyConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
