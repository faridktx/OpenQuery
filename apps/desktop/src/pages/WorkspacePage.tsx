import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import type { SafePolicySettings } from '../App';

interface Props {
  password: string;
  activeProfile: string | null;
  safePolicy: SafePolicySettings;
  powerEnabled: boolean;
  draft: { question?: string; sql?: string } | null;
  onDraftConsumed: () => void;
  onNavigateProfiles: () => void;
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
  safePolicy,
  powerEnabled,
  draft,
  onDraftConsumed,
  onNavigateProfiles,
}: Props) {
  const [schemaSnapshot, setSchemaSnapshot] = useState<any | null>(null);
  const [schemaSearch, setSchemaSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState<any | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const [tab, setTab] = useState<'ask' | 'sql'>('ask');
  const [askMode, setAskMode] = useState<'safe' | 'standard'>('safe');
  const [sqlMode, setSqlMode] = useState<'safe' | 'standard'>('safe');
  const [question, setQuestion] = useState('');
  const [sqlText, setSqlText] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WorkspaceResult | null>(null);
  const [openAiKeyMissing, setOpenAiKeyMissing] = useState(false);

  const [writePreview, setWritePreview] = useState<WritePreviewData | null>(null);
  const [showWriteModal, setShowWriteModal] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');
  const [dangerousPhraseInput, setDangerousPhraseInput] = useState('');
  const [pendingSql, setPendingSql] = useState('');
  const [pendingParams, setPendingParams] = useState<unknown[]>([]);

  const [page, setPage] = useState(1);
  const pageSize = 25;

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
    if (!password.trim()) {
      setError('Enter a session password, then refresh schema.');
      return;
    }
    setRunning(true);
    setError('');
    setStatus('');
    setLoadingSchema(true);
    try {
      await api.schemaRefresh(password);
      await loadSnapshot();
      setStatus('Schema snapshot refreshed.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRunning(false);
      setLoadingSchema(false);
    }
  };

  const runAsk = async (execute: boolean): Promise<void> => {
    if (!question.trim()) return;
    if (!password.trim()) {
      setError('Enter a session password before running Ask.');
      return;
    }
    setRunning(true);
    setError('');
    setStatus('');
    setOpenAiKeyMissing(false);
    try {
      const askResult = execute
        ? await api.askRun(question, askMode, password)
        : await api.askDryRun(question, askMode, password);
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
      if (msg.includes('OPENAI_API_KEY')) {
        setOpenAiKeyMissing(true);
      }
      setError(msg);
    } finally {
      setRunning(false);
    }
  };

  const runSqlAction = async (action: 'run' | 'dry-run' | 'explain'): Promise<void> => {
    if (!sqlText.trim()) return;
    if (!password.trim()) {
      setError('Enter a session password before running SQL.');
      return;
    }
    setRunning(true);
    setError('');
    setStatus('');
    try {
      const sqlResult = await api.workspaceSql({
        sql: sqlText,
        mode: sqlMode,
        action,
        password,
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
    }
  };

  const openWritePreview = async (sql: string, params: unknown[]): Promise<void> => {
    if (!powerEnabled) {
      setError('POWER mode is disabled for the active profile. Enable it in Profiles.');
      return;
    }
    if (!password.trim()) {
      setError('Enter a session password before write preview.');
      return;
    }
    setRunning(true);
    setError('');
    try {
      const preview = await api.writePreview(sql, params, password);
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
    setError('');
    try {
      const writeResult = await api.writeExecute(pendingSql, pendingParams, password);
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
    }
  };

  const selectStarWarning =
    result?.validation?.warnings?.some((w: string) => w.toLowerCase().includes('select *')) ||
    result?.validation?.details?.toLowerCase?.().includes('select *');
  const enforcedLimitWarning =
    result?.validation?.warnings?.some((w: string) => w.toLowerCase().includes('limit'));

  if (!activeProfile) {
    return (
      <div className="empty-card">
        <h2>Select or create a profile</h2>
        <p>Workspace actions require an active database profile.</p>
        <button type="button" className="btn" onClick={onNavigateProfiles}>
          Go to Profiles
        </button>
      </div>
    );
  }

  return (
    <section className="workspace-shell">
      {error && <div className="inline-error preserve-lines">{error}</div>}
      {status && <div className="inline-success">{status}</div>}

      <div className="workspace-grid">
        <aside className="panel schema-panel">
          <div className="section-header">
            <h3>Schema Explorer</h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRefreshSchema}
              disabled={running || loadingSchema}
            >
              {loadingSchema ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <input
            type="text"
            placeholder="Search tables or columns"
            value={schemaSearch}
            onChange={(e) => setSchemaSearch(e.target.value)}
          />
          {!schemaSnapshot?.tables?.length ? (
            <div className="empty-mini">
              <p>No schema snapshot found.</p>
              <p className="muted">Refresh schema after testing your profile connection.</p>
            </div>
          ) : (
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
          )}
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
        </aside>

        <section className="panel editor-panel">
          <div className="tab-row">
            <button type="button" className={tab === 'ask' ? 'tab active' : 'tab'} onClick={() => setTab('ask')}>
              Ask
            </button>
            <button type="button" className={tab === 'sql' ? 'tab active' : 'tab'} onClick={() => setTab('sql')}>
              SQL
            </button>
          </div>

          {tab === 'ask' ? (
            <div className="editor-block">
              {openAiKeyMissing && (
                <div className="callout">
                  <strong>OpenAI key not set.</strong>
                  <p>Set <code>OPENAI_API_KEY</code> in your shell, then relaunch desktop.</p>
                </div>
              )}
              <textarea
                rows={5}
                value={question}
                placeholder="Ask: show active users with recent paid orders"
                onChange={(e) => setQuestion(e.target.value)}
              />
              <div className="action-row">
                <select value={askMode} onChange={(e) => setAskMode(e.target.value as 'safe' | 'standard')}>
                  <option value="safe">Safe</option>
                  <option value="standard">Standard</option>
                </select>
                <button type="button" className="btn btn-secondary" onClick={() => runAsk(false)} disabled={running}>
                  Generate
                </button>
                <button type="button" className="btn" onClick={() => runAsk(false)} disabled={running}>
                  Dry Run
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => runAsk(true)} disabled={running}>
                  Run
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
              <div className="action-row">
                <select value={sqlMode} onChange={(e) => setSqlMode(e.target.value as 'safe' | 'standard')}>
                  <option value="safe">Safe</option>
                  <option value="standard">Standard</option>
                </select>
                <button type="button" className="btn" onClick={() => runSqlAction('run')} disabled={running}>
                  Run
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => runSqlAction('explain')} disabled={running}>
                  Explain
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => runSqlAction('dry-run')} disabled={running}>
                  Dry Run
                </button>
                <button type="button" className="btn btn-danger" onClick={() => openWritePreview(sqlText, [])} disabled={running || !sqlText.trim()}>
                  Preview Write
                </button>
              </div>
            </div>
          )}

          {result?.sql && (
            <div className="sql-preview">
              <div className="section-header">
                <h4>SQL Preview</h4>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigator.clipboard.writeText(result.sql)}
                >
                  Copy SQL
                </button>
              </div>
              <pre><code>{result.sql}</code></pre>
            </div>
          )}
        </section>

        <aside className="panel insight-panel">
          <div className="safety-panel">
            <h3>Safety</h3>
            <p><strong>Classification:</strong> {result?.classification?.classification ?? 'n/a'}</p>
            <p><strong>Status:</strong> {result?.status ?? 'idle'}</p>
            <p><strong>Select * detected:</strong> {selectStarWarning ? 'yes' : 'no'}</p>
            <p><strong>LIMIT enforced:</strong> {enforcedLimitWarning ? 'yes' : 'no'}</p>
            <p><strong>Blocked tables:</strong> none detected</p>
            {result?.validation?.reason && result.status === 'blocked' && (
              <p className="text-err">{result.validation.reason}</p>
            )}
          </div>

          <div className="explain-panel">
            <h3>Explain</h3>
            {result?.explainSummary ? (
              <>
                <p><strong>Estimated rows:</strong> {result.explainSummary.estimatedRows}</p>
                <p><strong>Estimated cost:</strong> {result.explainSummary.estimatedCost}</p>
                <p><strong>Seq scan:</strong> {result.explainSummary.hasSeqScan ? 'yes' : 'no'}</p>
              </>
            ) : (
              <p className="muted">No explain summary yet.</p>
            )}
            {(result?.explainWarnings ?? []).map((warning) => (
              <p key={warning} className="warning">{warning}</p>
            ))}
            {(result?.explainBlockers ?? []).map((blocker) => (
              <p key={blocker} className="text-err">{blocker}</p>
            ))}
          </div>
        </aside>
      </div>

      <section className="panel results-panel">
        <div className="section-header">
          <h3>Results</h3>
          <div className="action-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={copyResults} disabled={!rows.length}>
              Copy
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </button>
          </div>
        </div>
        {!result && <p className="muted">Run a query to view results.</p>}
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
      </section>

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
    </section>
  );
}
