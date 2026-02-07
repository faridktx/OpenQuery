import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import type { SafePolicySettings } from '../App';
import { getOpenAIKey } from '../lib/secretStore';

interface Props {
  password: string;
  activeProfile: string | null;
  activeProfileType: string | null;
  safePolicy: SafePolicySettings;
  powerEnabled: boolean;
  draft: { question?: string; sql?: string } | null;
  onDraftConsumed: () => void;
  onNavigateSetup: () => void;
  onNavigateSettings: () => void;
}

interface SqlClassification {
  classification: 'read' | 'write' | 'dangerous';
}

interface WritePreviewData {
  classification: string;
  kind: string;
  impactedTables: string[];
  hasWhereClause: boolean;
  summary: string;
  estimatedRowsAffected: number | null;
  warnings: string[];
  requiresConfirmation: boolean;
  confirmationPhrase: string;
  requiresDangerousConfirmation: boolean;
  dangerousConfirmationPhrase: string;
}

interface WorkspaceResult {
  status: string;
  source: 'ask' | 'sql';
  sql: string;
  params: unknown[];
  validation?: any;
  classification?: any;
  explainSummary?: any;
  explainWarnings?: string[];
  explainBlockers?: string[];
  executionResult?: {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    truncated: boolean;
    execMs: number;
  } | null;
  model?: string;
  confidence?: number;
  error?: string;
}

function classifySqlText(sql: string): SqlClassification {
  const trimmed = sql.trim().toUpperCase();
  if (
    trimmed.startsWith('DROP') ||
    trimmed.startsWith('TRUNCATE') ||
    trimmed.startsWith('GRANT') ||
    trimmed.startsWith('REVOKE')
  ) {
    return { classification: 'dangerous' };
  }
  if (
    trimmed.startsWith('INSERT') ||
    trimmed.startsWith('UPDATE') ||
    trimmed.startsWith('DELETE') ||
    trimmed.startsWith('CREATE') ||
    trimmed.startsWith('ALTER')
  ) {
    return { classification: 'write' };
  }
  return { classification: 'read' };
}

export default function WorkspacePage({
  password,
  activeProfile,
  activeProfileType,
  safePolicy,
  powerEnabled,
  draft,
  onDraftConsumed,
  onNavigateSetup,
  onNavigateSettings,
}: Props) {
  const [schemaSnapshot, setSchemaSnapshot] = useState<any | null>(null);
  const [schemaSearch, setSchemaSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState<any | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [activityLabel, setActivityLabel] = useState('');

  const [tab, setTab] = useState<'ask' | 'sql'>('ask');
  const [askMode, setAskMode] = useState<'safe' | 'standard'>('safe');
  const [sqlMode, setSqlMode] = useState<'safe' | 'standard'>('safe');
  const [question, setQuestion] = useState('');
  const [sqlText, setSqlText] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WorkspaceResult | null>(null);
  const [openAiKeyMissing, setOpenAiKeyMissing] = useState(false);
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);
  const [checkingOpenAiKey, setCheckingOpenAiKey] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  const [writePreview, setWritePreview] = useState<WritePreviewData | null>(null);
  const [showWriteModal, setShowWriteModal] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');
  const [dangerousPhraseInput, setDangerousPhraseInput] = useState('');
  const [pendingSql, setPendingSql] = useState('');
  const [pendingParams, setPendingParams] = useState<unknown[]>([]);

  const [page, setPage] = useState(1);
  const pageSize = 25;
  const examplePrompts = ['Show active users', 'Top spenders', 'Recent paid orders'];
  const requiresPassword = activeProfileType !== 'sqlite';

  const loadSnapshot = async (): Promise<void> => {
    if (!activeProfile) {
      setSchemaSnapshot(null);
      setSelectedTable(null);
      return;
    }
    try {
      const snapshot = await api.schemaGetSnapshot();
      setSchemaSnapshot(snapshot);
      if (!snapshot?.tables?.length) {
        setSelectedTable(null);
        return;
      }
      if (!selectedTable) {
        setSelectedTable(snapshot.tables[0]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  useEffect(() => {
    loadSnapshot();
  }, [activeProfile]);

  useEffect(() => {
    if (!draft) return;
    if (draft.question) {
      setQuestion(draft.question);
      setTab('ask');
    }
    if (draft.sql) {
      setSqlText(draft.sql);
      setTab('sql');
    }
    onDraftConsumed();
  }, [draft, onDraftConsumed]);

  useEffect(() => {
    const refreshOpenAiState = async (): Promise<void> => {
      setCheckingOpenAiKey(true);
      try {
        const [storedKey, settings] = await Promise.all([
          getOpenAIKey(),
          api.settingsStatus(),
        ]);
        const present = Boolean(storedKey) || Boolean(settings.openAiKeySet);
        setHasOpenAiKey(present);
        setOpenAiKeyMissing(!present);
      } catch {
        setHasOpenAiKey(false);
        setOpenAiKeyMissing(true);
      } finally {
        setCheckingOpenAiKey(false);
      }
    };
    void refreshOpenAiState();
  }, []);

  const filteredTables = useMemo(() => {
    const tables = schemaSnapshot?.tables ?? [];
    if (!schemaSearch.trim()) return tables;
    const q = schemaSearch.toLowerCase();
    return tables.filter((table: any) => {
      const full = `${table.schema || 'public'}.${table.name}`.toLowerCase();
      if (full.includes(q)) return true;
      return table.columns?.some((col: any) => col.name.toLowerCase().includes(q));
    });
  }, [schemaSnapshot, schemaSearch]);

  const rows = result?.executionResult?.rows ?? [];
  const columns = result?.executionResult?.columns ?? [];
  const maxPage = Math.max(1, Math.ceil(rows.length / pageSize));
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [result?.executionResult?.rowCount]);

  const copyResults = async (): Promise<void> => {
    if (!rows.length) return;
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    setStatus('Copied current result set to clipboard.');
  };

  const exportCsv = (): void => {
    if (!columns.length) return;
    const escape = (value: string) =>
      value.includes(',') || value.includes('"') || value.includes('\n')
        ? `"${value.replace(/"/g, '""')}"`
        : value;
    const lines = [columns.join(',')];
    for (const row of rows) {
      lines.push(columns.map((col) => escape(String(row[col] ?? ''))).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openquery-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRefreshSchema = async (): Promise<void> => {
    if (!activeProfile) return;
    const resolvedPassword = requiresPassword ? password.trim() : '';
    if (requiresPassword && !resolvedPassword) {
      setError('Enter a session password, then refresh schema.');
      return;
    }
    setRunning(true);
    setActivityLabel('Refreshing schema...');
    setError('');
    setStatus('');
    setLoadingSchema(true);
    try {
      await api.schemaRefresh(resolvedPassword);
      await loadSnapshot();
      setStatus('Schema snapshot refreshed.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRunning(false);
      setLoadingSchema(false);
      setActivityLabel('');
    }
  };

  const runAsk = async (execute: boolean): Promise<void> => {
    if (!question.trim()) return;
    const resolvedPassword = requiresPassword ? password.trim() : '';
    if (requiresPassword && !resolvedPassword) {
      setError('Enter a session password before running Ask.');
      return;
    }
    setRunning(true);
    setActivityLabel(execute ? 'Generating SQL, validating policy, and executing query...' : 'Generating SQL and validating policy...');
    setError('');
    setStatus('');
    let storedKey: string | null = null;
    try {
      storedKey = await getOpenAIKey();
      const settings = await api.settingsStatus();
      const keyPresent = Boolean(storedKey) || Boolean(settings.openAiKeySet);
      setHasOpenAiKey(keyPresent);
      setOpenAiKeyMissing(!keyPresent);
      if (!keyPresent) {
        setError('No OpenAI API key set. Set it in Settings, or use SQL mode directly.');
        return;
      }
      const askResult = execute
        ? await api.askRun(question, askMode, resolvedPassword, storedKey)
        : await api.askDryRun(question, askMode, resolvedPassword, storedKey);
      const classification = classifySqlText(askResult?.plan?.sql ?? '');
      setResult({
        status: askResult.status,
        source: 'ask',
        sql: askResult?.plan?.sql ?? '',
        params: (askResult?.plan?.params ?? []).map((p: any) => p.value),
        validation: askResult.validation,
        classification,
        explainSummary: askResult.explainSummary,
        explainWarnings: askResult.explainWarnings ?? [],
        explainBlockers: askResult.explainBlockers ?? [],
        executionResult: askResult.executionResult ?? null,
        model: askResult.model,
        confidence: askResult?.plan?.confidence,
        error: askResult.error,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('OPENAI_API_KEY') || msg.includes('OpenAI API key')) {
        setOpenAiKeyMissing(true);
        setHasOpenAiKey(false);
        setError('No OpenAI API key set. You can still run SQL directly, or use dry-run with local fixtures.');
        return;
      }
      setError(msg);
    } finally {
      setRunning(false);
      setActivityLabel('');
    }
  };

  const runSqlAction = async (action: 'run' | 'dry-run' | 'explain'): Promise<void> => {
    if (!sqlText.trim()) return;
    const resolvedPassword = requiresPassword ? password.trim() : '';
    if (requiresPassword && !resolvedPassword) {
      setError('Enter a session password before running SQL.');
      return;
    }
    setRunning(true);
    setActivityLabel(
      action === 'run'
        ? 'Validating policy, running EXPLAIN, and executing SQL...'
        : action === 'explain'
          ? 'Running EXPLAIN preflight...'
          : 'Validating policy and preparing dry run...',
    );
    setError('');
    setStatus('');
    try {
      const sqlResult = await api.workspaceSql({
        sql: sqlText,
        mode: sqlMode,
        action,
        password: resolvedPassword,
        policy: safePolicy,
      });
      setResult({
        status: sqlResult.status,
        source: 'sql',
        sql: sqlResult.rewrittenSql ?? sqlText,
        params: [],
        validation: sqlResult.validation,
        classification: sqlResult.classification,
        explainSummary: sqlResult.explainSummary,
        explainWarnings: sqlResult.explainWarnings ?? [],
        explainBlockers: sqlResult.explainBlockers ?? [],
        executionResult: sqlResult.executionResult ?? null,
        error: sqlResult.error,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRunning(false);
      setActivityLabel('');
    }
  };

  const openWritePreview = async (sql: string, params: unknown[]): Promise<void> => {
    if (!powerEnabled) {
      setError('POWER mode is disabled for the active profile. Enable it in Profiles.');
      return;
    }
    const resolvedPassword = requiresPassword ? password.trim() : '';
    if (requiresPassword && !resolvedPassword) {
      setError('Enter a session password before write preview.');
      return;
    }
    setRunning(true);
    setActivityLabel('Preparing POWER write preview...');
    setError('');
    try {
      const preview = await api.writePreview(sql, params, resolvedPassword);
      setWritePreview(preview);
      setPendingSql(sql);
      setPendingParams(params);
      setPhraseInput('');
      setDangerousPhraseInput('');
      setShowWriteModal(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRunning(false);
      setActivityLabel('');
    }
  };

  const executeWrite = async (): Promise<void> => {
    if (!writePreview) return;
    if (phraseInput.trim() !== writePreview.confirmationPhrase) {
      setError('Confirmation phrase does not match.');
      return;
    }
    if (
      writePreview.requiresDangerousConfirmation &&
      dangerousPhraseInput.trim() !== writePreview.dangerousConfirmationPhrase
    ) {
      setError('Dangerous operation phrase does not match.');
      return;
    }
    setShowWriteModal(false);
    setRunning(true);
    setActivityLabel('Executing POWER write...');
    setError('');
    const resolvedPassword = requiresPassword ? password.trim() : '';
    try {
      const writeResult = await api.writeExecute(pendingSql, pendingParams, resolvedPassword);
      setResult((prev) => ({
        ...(prev ?? {
          status: 'ok',
          source: 'sql',
          sql: pendingSql,
          params: pendingParams,
        }),
        status: writeResult.success ? 'ok' : 'error',
        error: writeResult.error,
      }));
      if (writeResult.success) {
        setStatus(
          `Write executed: ${writeResult.rowsAffected} row${writeResult.rowsAffected === 1 ? '' : 's'} affected in ${writeResult.execMs}ms.`,
        );
      } else {
        setError(writeResult.error || 'Write execution failed.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRunning(false);
      setActivityLabel('');
    }
  };

  const selectStarWarning =
    result?.validation?.warnings?.some((w: string) => w.toLowerCase().includes('select *')) ||
    result?.validation?.details?.toLowerCase?.().includes('select *');
  const enforcedLimitWarning =
    result?.validation?.warnings?.some((w: string) => w.toLowerCase().includes('limit'));
  const hasSchemaTables = Array.isArray(schemaSnapshot?.tables) && schemaSnapshot.tables.length > 0;
  const isBlocked = result?.status === 'blocked' || result?.validation?.allowed === false;
  const summaryReason =
    result?.validation?.reason ||
    result?.error ||
    (result ? 'Query evaluated. Review policy and SQL details below.' : 'Run a query to see policy and execution summary.');
  const policyFixSuggestion =
    isBlocked
      ? selectStarWarning
        ? 'Fix it: list explicit columns instead of SELECT *.'
        : enforcedLimitWarning
          ? 'Fix it: use a tighter LIMIT or add filters to reduce row volume.'
          : 'Fix it: switch to Safe-compatible SQL or use POWER preview for writes.'
      : null;

  if (!activeProfile) {
    return (
      <div className="empty-card">
        <h2>No active profile selected</h2>
        <p>Choose or create a profile in Setup before running any query.</p>
        <button type="button" className="btn" onClick={onNavigateSetup}>
          Go to Setup
        </button>
      </div>
    );
  }

  if (!hasSchemaTables) {
    return (
      <section className="workspace-shell">
        {error && <div className="inline-error preserve-lines">{error}</div>}
        {status && <div className="inline-success">{status}</div>}
        <div className="workspace-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowHelp(true)}>
            Help
          </button>
        </div>
        <div className="empty-card">
          <h2>Schema snapshot is missing</h2>
          <p>Refresh schema to enable Ask generation, policy checks, and explain gating.</p>
          <div className="action-row">
            <button
              type="button"
              className="btn"
              onClick={handleRefreshSchema}
              disabled={running || loadingSchema}
            >
              {loadingSchema ? 'Refreshing...' : 'Refresh schema'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onNavigateSetup}>
              Go to Setup
            </button>
          </div>
        </div>
        {showHelp && (
          <div className="modal-overlay">
            <div className="modal-card help-modal">
              <div className="section-header">
                <h3>How OpenQuery Works</h3>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowHelp(false)}>
                  Close
                </button>
              </div>
              <ol className="checklist">
                <li>Select a profile</li>
                <li>Refresh schema</li>
                <li>Ask or paste SQL</li>
                <li>Guardrails validate and rewrite</li>
                <li>EXPLAIN gates risk</li>
                <li>Execute and inspect results</li>
              </ol>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="workspace-shell">
      {error && <div className="inline-error preserve-lines">{error}</div>}
      {status && <div className="inline-success">{status}</div>}
      {running && activityLabel && <div className="inline-warning">{activityLabel}</div>}
      <div className="workspace-header">
        <div>
          <h2>Workspace</h2>
          <p className="muted prose">Ask in natural language or run SQL directly with policy and explain guardrails.</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowHelp(true)}>
          Help
        </button>
      </div>

      <div className="workspace-main-grid">
        <section className="panel workspace-left">
          <div className="section-header">
            <h3>Query Builder</h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRefreshSchema}
              disabled={running || loadingSchema}
            >
              {loadingSchema ? 'Refreshing...' : 'Refresh schema'}
            </button>
          </div>

          <details className="schema-accordion" open>
            <summary>Schema Explorer</summary>
            <div className="schema-accordion__body">
              <input
                type="text"
                placeholder="Search tables or columns"
                value={schemaSearch}
                onChange={(e) => setSchemaSearch(e.target.value)}
              />
              <div className="schema-list">
                {filteredTables.map((table: any) => {
                  const fullName = `${table.schema || 'public'}.${table.name}`;
                  return (
                    <button
                      key={fullName}
                      type="button"
                      className={selectedTable?.name === table.name ? 'schema-item active' : 'schema-item'}
                      onClick={() => setSelectedTable(table)}
                    >
                      {fullName}
                    </button>
                  );
                })}
              </div>
              {selectedTable && (
                <div className="table-detail">
                  <h4>{selectedTable.schema || 'public'}.{selectedTable.name}</h4>
                  <ul>
                    {(selectedTable.columns ?? []).map((col: any) => (
                      <li key={col.name}>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => navigator.clipboard.writeText(col.name)}
                        >
                          {col.name}
                        </button>
                        <span className="muted">{col.dataType}</span>
                        {col.isPrimaryKey && <span className="badge">PK</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>

          <div className="tab-row">
            <button type="button" className={tab === 'ask' ? 'tab active' : 'tab'} onClick={() => setTab('ask')}>
              Ask (AI)
            </button>
            <button type="button" className={tab === 'sql' ? 'tab active' : 'tab'} onClick={() => setTab('sql')}>
              Run SQL
            </button>
          </div>

          {tab === 'ask' ? (
            <div className="editor-block">
              {(openAiKeyMissing || !hasOpenAiKey) && !checkingOpenAiKey && (
                <div className="callout">
                  <strong>OpenAI key not set.</strong>
                  <p>Ask is disabled until a key is saved in Settings.</p>
                  <div className="action-row">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onNavigateSettings}>
                      Go to Settings
                    </button>
                  </div>
                </div>
              )}
              {checkingOpenAiKey && <p className="muted">Checking AI key status...</p>}
              <textarea
                rows={6}
                value={question}
                placeholder="Example: show active users with recent paid orders"
                onChange={(e) => setQuestion(e.target.value)}
              />
              <div className="chip-row">
                {examplePrompts.map((chip) => (
                  <button key={chip} type="button" className="chip-btn" onClick={() => setQuestion(chip)}>
                    {chip}
                  </button>
                ))}
              </div>
              <details className="inspector-section">
                <summary>Advanced</summary>
                <div className="inspector-body">
                  <label className="stack-sm">
                    <span className="muted">Mode</span>
                    <select value={askMode} onChange={(e) => setAskMode(e.target.value as 'safe' | 'standard')}>
                      <option value="safe">Safe mode</option>
                      <option value="standard">Power mode</option>
                    </select>
                  </label>
                </div>
              </details>
              <div className="action-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => runAsk(false)}
                  disabled={running || !hasOpenAiKey || checkingOpenAiKey}
                >
                  Generate (dry run)
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => runAsk(true)}
                  disabled={running || !hasOpenAiKey || checkingOpenAiKey}
                >
                  Generate + Run
                </button>
              </div>
            </div>
          ) : (
            <div className="editor-block">
              <textarea
                rows={10}
                value={sqlText}
                placeholder="SELECT id, email FROM users WHERE is_active = true LIMIT 50;"
                onChange={(e) => setSqlText(e.target.value)}
              />
              <details className="inspector-section">
                <summary>Advanced</summary>
                <div className="inspector-body">
                  <label className="stack-sm">
                    <span className="muted">Mode</span>
                    <select value={sqlMode} onChange={(e) => setSqlMode(e.target.value as 'safe' | 'standard')}>
                      <option value="safe">Safe mode</option>
                      <option value="standard">Power mode</option>
                    </select>
                  </label>
                </div>
              </details>
              <div className="action-row">
                <button type="button" className="btn" onClick={() => runSqlAction('run')} disabled={running}>
                  Run
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => runSqlAction('explain')} disabled={running}>
                  Explain
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => runSqlAction('dry-run')} disabled={running}>
                  Dry run
                </button>
                <button type="button" className="btn btn-danger" onClick={() => openWritePreview(sqlText, [])} disabled={running || !sqlText.trim()}>
                  Preview Write
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="panel workspace-right">
          <details className="inspector-section" open>
            <summary>Summary</summary>
            <div className="inspector-body">
              <div className="action-row">
                <span className={`status-pill ${isBlocked ? 'status-error' : 'status-ok'}`}>
                  {result ? (isBlocked ? 'Blocked' : 'Allowed') : 'Idle'}
                </span>
                {result && (
                  <span className="status-pill">
                    {result?.classification?.classification ?? 'n/a'}
                  </span>
                )}
              </div>
              <p className="prose">{summaryReason}</p>
              {result && (
                <div className="metric-grid">
                  <div className="metric-pill">
                    <span className="subtle">Explain Cost</span>
                    <strong>{result?.explainSummary?.estimatedCost ?? '-'}</strong>
                  </div>
                  <div className="metric-pill">
                    <span className="subtle">Est Rows</span>
                    <strong>{result?.explainSummary?.estimatedRows ?? '-'}</strong>
                  </div>
                  <div className="metric-pill">
                    <span className="subtle">Exec ms</span>
                    <strong>{result?.executionResult?.execMs ?? '-'}</strong>
                  </div>
                  <div className="metric-pill">
                    <span className="subtle">Rows</span>
                    <strong>{result?.executionResult?.rowCount ?? '-'}</strong>
                  </div>
                </div>
              )}
              {policyFixSuggestion && (
                <div className="stack-sm">
                  <p className="warning"><strong>How to fix:</strong> {policyFixSuggestion}</p>
                  <ul className="checklist">
                    <li>Tighten filters and add LIMIT.</li>
                    <li>Select explicit columns instead of wildcard output.</li>
                    <li>Use write preview if you need POWER mode changes.</li>
                  </ul>
                  <div className="action-row">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTab('sql')}>
                      Edit SQL
                    </button>
                    {tab === 'ask' && (
                      <button type="button" className="btn btn-sm" onClick={() => void runAsk(false)} disabled={running || !hasOpenAiKey}>
                        Regenerate with constraints
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </details>

          <details className="inspector-section">
            <summary>SQL</summary>
            {result?.sql ? (
              <div className="inspector-body">
                <div className="action-row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(result.sql)}>
                    Copy SQL
                  </button>
                </div>
                <pre><code>{result.sql}</code></pre>
              </div>
            ) : (
              <p className="muted">No SQL yet. Generate or run a query to populate this section.</p>
            )}
          </details>

          <details className="inspector-section">
            <summary>Policy</summary>
            <div className="inspector-body">
              <p><strong>Status:</strong> {result?.status ?? 'idle'}</p>
              <p><strong>Classification:</strong> {result?.classification?.classification ?? 'n/a'}</p>
              {result?.validation?.reason ? (
                <p className="text-err">{result.validation.reason}</p>
              ) : (
                <p className="muted">No policy warnings.</p>
              )}
              {(result?.explainWarnings ?? []).map((warning) => (
                <p key={warning} className="warning">{warning}</p>
              ))}
              {(result?.explainBlockers ?? []).map((blocker) => (
                <p key={blocker} className="text-err">{blocker}</p>
              ))}
              <details>
                <summary>Details</summary>
                <pre><code>{JSON.stringify(result?.validation ?? {}, null, 2)}</code></pre>
              </details>
            </div>
          </details>

          {!isBlocked && (
          <details className="inspector-section" open={Boolean(result?.executionResult)}>
            <summary>Results</summary>
            <div className="inspector-body">
              <div className="action-row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={copyResults} disabled={!rows.length}>
                  Copy
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!rows.length}>
                  Export CSV
                </button>
              </div>
              {!result && <p className="muted">Run a query to view rows.</p>}
              {result && !result.executionResult && <p className="muted">No result rows for this action.</p>}
              {result?.executionResult && (
                <>
                  <p className="muted">
                    {result.executionResult.rowCount} rows in {result.executionResult.execMs}ms
                    {result.executionResult.truncated ? ' (truncated)' : ''}
                  </p>
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {columns.map((col) => (
                            <th key={col}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedRows.map((row, idx) => (
                          <tr key={idx}>
                            {columns.map((col) => (
                              <td key={col}>{row[col] == null ? <span className="muted">NULL</span> : String(row[col])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pager">
                    <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </button>
                    <span className="muted">Page {page} / {maxPage}</span>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          </details>
          )}
        </aside>
      </div>

      {showWriteModal && writePreview && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>POWER Write Confirmation</h3>
            <p>{writePreview.summary}</p>
            <pre><code>{pendingSql}</code></pre>
            <p className="muted">Tables: {writePreview.impactedTables.join(', ') || 'n/a'}</p>
            {writePreview.estimatedRowsAffected !== null && (
              <p className="muted">Estimated rows affected: {writePreview.estimatedRowsAffected}</p>
            )}
            {writePreview.warnings.map((warning) => (
              <p key={warning} className="warning">{warning}</p>
            ))}
            <label>
              <span>Type phrase: <strong>{writePreview.confirmationPhrase}</strong></span>
              <input
                type="text"
                value={phraseInput}
                onChange={(e) => setPhraseInput(e.target.value)}
              />
            </label>
            {writePreview.requiresDangerousConfirmation && (
              <label>
                <span>Danger phrase: <strong>{writePreview.dangerousConfirmationPhrase}</strong></span>
                <input
                  type="text"
                  value={dangerousPhraseInput}
                  onChange={(e) => setDangerousPhraseInput(e.target.value)}
                />
              </label>
            )}
            <div className="action-row">
              <button type="button" className="btn btn-secondary" onClick={() => setShowWriteModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={executeWrite}
                disabled={
                  phraseInput.trim() !== writePreview.confirmationPhrase ||
                  (writePreview.requiresDangerousConfirmation &&
                    dangerousPhraseInput.trim() !== writePreview.dangerousConfirmationPhrase)
                }
              >
                Execute
              </button>
            </div>
          </div>
        </div>
      )}
      {showHelp && (
        <div className="modal-overlay">
          <div className="modal-card help-modal">
            <div className="section-header">
              <h3>Workspace Help</h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>
            <h4>Mental model</h4>
            <ol className="checklist">
              <li>Select profile</li>
              <li>Refresh schema</li>
              <li>Ask or paste SQL</li>
              <li>Guardrails validate and rewrite</li>
              <li>EXPLAIN gates risk</li>
              <li>Execute, view results</li>
            </ol>
            <h4>Glossary</h4>
            <ul className="checklist">
              <li><strong>Safe mode:</strong> strict validation and conservative limits.</li>
              <li><strong>POWER mode:</strong> write actions with typed confirmation.</li>
              <li><strong>EXPLAIN gating:</strong> blocks risky plans before execution.</li>
              <li><strong>SELECT * blocked:</strong> encourages explicit columns and smaller payloads.</li>
            </ul>
            <h4>Common fixes</h4>
            <ul className="checklist">
              <li>Docker not running: start Docker Desktop, then retest connection.</li>
              <li>Port in use: run fixture on `OPENQUERY_PG_PORT=55432`.</li>
              <li>Connection failed: verify host, port, user, password, and SSL settings.</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
