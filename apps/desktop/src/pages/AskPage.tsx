import { useState } from 'react';
import * as api from '../api';
import { getOpenAIKey } from '../lib/secretStore';

interface Props {
  password: string;
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

export default function AskPage({ password }: Props) {
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<'safe' | 'standard'>('safe');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [openAiKeyMissing, setOpenAiKeyMissing] = useState(false);

  // Write confirmation modal state
  const [writePreview, setWritePreview] = useState<WritePreviewData | null>(null);
  const [showWriteModal, setShowWriteModal] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');
  const [dangerousPhraseInput, setDangerousPhraseInput] = useState('');
  const [pendingSql, setPendingSql] = useState('');
  const [pendingParams, setPendingParams] = useState<unknown[]>([]);

  const handleAsk = async (execute: boolean) => {
    if (!question.trim()) return;
    if (!password) {
      setError('Enter a password in the sidebar first.');
      return;
    }
    setError(''); setResult(null); setLoading(true);
    try {
      const [storedKey, settings] = await Promise.all([
        getOpenAIKey(),
        api.settingsStatus(),
      ]);
      const keyPresent = Boolean(storedKey) || Boolean(settings.openAiKeySet);
      setOpenAiKeyMissing(!keyPresent);
      if (!keyPresent) {
        throw new Error('No OpenAI API key set. Open Settings to save a key.');
      }
      const r = execute
        ? await api.askRun(question, mode, password, storedKey)
        : await api.askDryRun(question, mode, password, storedKey);
      setResult(r);

      // Check if the generated SQL is a write that was blocked due to policy
      // If the plan was generated but blocked, offer write preview if available
      if (r?.plan?.sql && r?.status === 'blocked' && r?.validation?.reason?.includes('POWER mode')) {
        // User needs to enable power mode first
      }
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setLoading(false);
    }
  };

  const handleWritePreview = async (sql: string, params: unknown[]) => {
    if (!password) {
      setError('Enter a password in the sidebar first.');
      return;
    }
    setError('');
    try {
      const preview = await api.writePreview(sql, params, password);
      setWritePreview(preview);
      setPendingSql(sql);
      setPendingParams(params);
      setPhraseInput('');
      setDangerousPhraseInput('');
      setShowWriteModal(true);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const handleWriteConfirm = async () => {
    if (!writePreview) return;

    // Verify phrase
    if (phraseInput.trim() !== writePreview.confirmationPhrase) {
      setError('Confirmation phrase does not match.');
      return;
    }
    if (writePreview.requiresDangerousConfirmation && dangerousPhraseInput.trim() !== writePreview.dangerousConfirmationPhrase) {
      setError('Dangerous operation phrase does not match.');
      return;
    }

    setShowWriteModal(false);
    setLoading(true);
    setError('');
    try {
      const writeResult = await api.writeExecute(pendingSql, pendingParams, password);
      setResult({
        ...result,
        writeResult,
        status: writeResult.success ? 'ok' : 'error',
        error: writeResult.error,
      });
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!result?.executionResult) return;
    const { columns, rows } = result.executionResult;
    const escape = (v: string) => v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [columns.join(',')];
    for (const row of rows) {
      lines.push(columns.map((c: string) => escape(String(row[c] ?? ''))).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openquery-${result.queryId?.slice(0, 8) ?? 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const phraseMatch = writePreview ? phraseInput.trim() === writePreview.confirmationPhrase : false;
  const dangerousPhraseMatch = writePreview?.requiresDangerousConfirmation
    ? dangerousPhraseInput.trim() === writePreview.dangerousConfirmationPhrase
    : true;

  return (
    <div className="page">
      <h2>Ask</h2>
      {error && <div className="msg error">{error}</div>}
      {openAiKeyMissing && (
        <div className="callout">
          <strong>OpenAI key not set.</strong>
          <p>Set it in Settings to enable Ask. SQL mode remains available without a key.</p>
        </div>
      )}

      <div className="ask-input">
        <textarea
          rows={3}
          placeholder="Ask a question about your data..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAsk(true);
          }}
        />
        <div className="ask-controls">
          <select value={mode} onChange={(e) => setMode(e.target.value as 'safe' | 'standard')}>
            <option value="safe">Safe mode</option>
            <option value="standard">Standard mode</option>
          </select>
          <button className="btn btn-secondary" onClick={() => handleAsk(false)} disabled={loading || openAiKeyMissing}>
            {loading ? 'Working...' : 'Dry Run'}
          </button>
          <button className="btn" onClick={() => handleAsk(true)} disabled={loading || openAiKeyMissing}>
            {loading ? 'Working...' : 'Run'}
          </button>
        </div>
      </div>

      {result && (
        <div className="ask-result">
          <div className="result-section">
            <h3>Generated SQL <span className="muted">({result.model}{result.retried ? ', retried' : ''}, {(result.plan?.confidence * 100).toFixed(0)}%)</span></h3>
            <pre className="sql-block">
              <code>{result.plan?.sql}</code>
              <button className="btn-copy" onClick={() => copyToClipboard(result.plan?.sql ?? '')}>Copy</button>
            </pre>
            {result.plan?.params?.length > 0 && (
              <p className="muted">Params: {JSON.stringify(result.plan.params.map((p: any) => ({ [p.name]: p.value })))}</p>
            )}
            {result.plan?.assumptions?.length > 0 && (
              <p className="muted">Assumptions: {result.plan.assumptions.join('; ')}</p>
            )}
          </div>

          <div className="result-section">
            <h3>Policy: <span className={result.validation?.allowed ? 'text-ok' : 'text-err'}>
              {result.validation?.allowed ? 'ALLOWED' : 'DENIED'}
            </span></h3>
            {result.validation?.warnings?.map((w: string, i: number) => (
              <p key={i} className="warning">Warning: {w}</p>
            ))}
            {!result.validation?.allowed && <p className="text-err">{result.validation?.reason}</p>}
            {!result.validation?.allowed && result.validation?.suggestedFix && (
              <p className="muted">Suggestion: {result.validation.suggestedFix}</p>
            )}
          </div>

          {result.explainSummary && (
            <div className="result-section">
              <h3>EXPLAIN</h3>
              <p>Est. rows: {result.explainSummary.estimatedRows} | Cost: {result.explainSummary.estimatedCost} | Seq scan: {result.explainSummary.hasSeqScan ? 'yes' : 'no'}</p>
              {result.explainWarnings?.map((w: string, i: number) => (
                <p key={i} className="warning">{w}</p>
              ))}
              {result.explainBlockers?.map((b: string, i: number) => (
                <p key={i} className="text-err">BLOCKED: {b}</p>
              ))}
            </div>
          )}

          {result.executionResult && (
            <div className="result-section">
              <div className="result-header">
                <h3>Results ({result.executionResult.rowCount} rows, {result.executionResult.execMs}ms)</h3>
                <div>
                  <button className="btn-sm" onClick={exportCsv}>Export CSV</button>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {result.executionResult.columns.map((col: string) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.executionResult.rows.slice(0, 200).map((row: any, i: number) => (
                      <tr key={i}>
                        {result.executionResult.columns.map((col: string) => (
                          <td key={col}>{row[col] != null ? String(row[col]) : <span className="muted">NULL</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.executionResult.truncated && <p className="warning">Results truncated.</p>}
            </div>
          )}

          {/* Write execution result */}
          {result.writeResult && (
            <div className="result-section">
              {result.writeResult.success ? (
                <p className="text-ok">
                  Write executed: {result.writeResult.rowsAffected} row{result.writeResult.rowsAffected !== 1 ? 's' : ''} affected in {result.writeResult.execMs}ms
                </p>
              ) : (
                <p className="text-err">Write failed: {result.writeResult.error}</p>
              )}
            </div>
          )}

          {/* Offer write preview if the statement was allowed but is a write */}
          {result.validation?.allowed && result.plan?.sql && !result.executionResult && !result.writeResult && result.status === 'dry-run' && (
            <div className="result-section">
              <button className="btn" onClick={() => handleWritePreview(result.plan.sql, result.plan.params?.map((p: any) => p.value) ?? [])}>
                Preview Write Operation
              </button>
            </div>
          )}

          {result.status === 'dry-run' && !result.writeResult && (
            <div className="result-section">
              <p className="muted">Dry run — query was not executed.</p>
            </div>
          )}

          <p className="muted">Query ID: {result.queryId}</p>
        </div>
      )}

      {/* Write Confirmation Modal */}
      {showWriteModal && writePreview && (
        <div className="modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="modal" style={{
            backgroundColor: 'var(--bg, #fff)', padding: '1.5rem', borderRadius: '8px',
            maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto',
          }}>
            <h3 style={{ color: '#cc3333', marginTop: 0 }}>Write Operation Confirmation</h3>

            <div style={{
              padding: '0.75rem', borderRadius: '4px',
              backgroundColor: 'rgba(255,0,0,0.05)', border: '1px solid rgba(255,0,0,0.2)',
              marginBottom: '1rem',
            }}>
              <p style={{ margin: 0, fontWeight: 'bold' }}>{writePreview.summary}</p>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>
                Tables: {writePreview.impactedTables.join(', ') || 'unknown'}
                {writePreview.estimatedRowsAffected !== null && (
                  <> | Est. rows affected: {writePreview.estimatedRowsAffected}</>
                )}
              </p>
            </div>

            {writePreview.warnings.map((w, i) => (
              <p key={i} style={{ color: '#cc6600', fontSize: '0.85rem', margin: '0.25rem 0' }}>{w}</p>
            ))}

            <div style={{ marginTop: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                Type this phrase exactly: <strong>{writePreview.confirmationPhrase}</strong>
              </label>
              <input
                type="text"
                value={phraseInput}
                onChange={(e) => setPhraseInput(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
                placeholder="Type confirmation phrase..."
                autoFocus
              />
            </div>

            {writePreview.requiresDangerousConfirmation && (
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#cc3333' }}>
                  Additional dangerous op phrase: <strong>{writePreview.dangerousConfirmationPhrase}</strong>
                </label>
                <input
                  type="text"
                  value={dangerousPhraseInput}
                  onChange={(e) => setDangerousPhraseInput(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
                  placeholder="Type dangerous confirmation phrase..."
                />
              </div>
            )}

            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowWriteModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={!phraseMatch || !dangerousPhraseMatch}
                onClick={handleWriteConfirm}
                style={{ opacity: phraseMatch && dangerousPhraseMatch ? 1 : 0.5 }}
              >
                Confirm Write
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
