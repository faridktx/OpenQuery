import { useState, useEffect } from 'react';
import * as api from '../api';

export default function HistoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [mdExport, setMdExport] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const list = await api.historyList(50);
      setItems(list);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  useEffect(() => { load(); }, []);

  const handleShow = async (id: string) => {
    setError(''); setMdExport('');
    try {
      const d = await api.historyShow(id);
      setDetail(d);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const handleExportMd = async (id: string) => {
    try {
      const md = await api.historyExportMd(id);
      setMdExport(md);
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openquery-report-${id.slice(0, 8)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  return (
    <div className="page">
      <h2>Query History</h2>
      {error && <div className="msg error">{error}</div>}

      <button className="btn btn-sm" onClick={load}>Refresh</button>

      {items.length === 0 && <p className="muted">No queries in history yet.</p>}

      {items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr><th>ID</th><th>Question</th><th>Time</th><th>Status</th><th>Rows</th><th>ms</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((item: any) => (
              <tr key={item.id} className="clickable" onClick={() => handleShow(item.id)}>
                <td className="muted">{item.id?.slice(0, 8)}</td>
                <td>{item.question?.length > 60 ? item.question.slice(0, 57) + '...' : item.question}</td>
                <td className="muted">{item.askedAt}</td>
                <td><span className={`badge ${item.status === 'ok' ? 'badge-ok' : item.status === 'blocked' ? 'badge-warn' : 'badge-err'}`}>{item.status ?? '-'}</span></td>
                <td>{item.rowCount ?? '-'}</td>
                <td>{item.execMs ?? '-'}</td>
                <td><button className="btn-sm" onClick={(e) => { e.stopPropagation(); handleExportMd(item.id); }}>MD</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail && (
        <div className="detail-card">
          <div className="detail-header">
            <h3>Query Detail</h3>
            <button className="btn-sm" onClick={() => setDetail(null)}>Close</button>
          </div>
          <p><strong>ID:</strong> {detail.query?.id}</p>
          <p><strong>Question:</strong> {detail.query?.question}</p>
          <p><strong>Mode:</strong> {detail.query?.mode}</p>
          <p><strong>Asked at:</strong> {detail.query?.askedAt}</p>

          {detail.generation && (
            <>
              <h4>Generation</h4>
              <pre className="sql-block"><code>{detail.generation.generatedSql}</code></pre>
              <p className="muted">Model: {detail.generation.model} | Confidence: {(detail.generation.confidence * 100).toFixed(0)}%</p>
              {detail.generation.assumptions?.length > 0 && (
                <p className="muted">Assumptions: {detail.generation.assumptions.join('; ')}</p>
              )}
            </>
          )}

          {detail.run && (
            <>
              <h4>Execution</h4>
              <p>Status: <span className={`badge ${detail.run.status === 'ok' ? 'badge-ok' : 'badge-err'}`}>{detail.run.status}</span></p>
              {detail.run.rewrittenSql && (
                <pre className="sql-block"><code>{detail.run.rewrittenSql}</code></pre>
              )}
              <p>Exec time: {detail.run.execMs}ms | Rows: {detail.run.rowCount}</p>
              {detail.run.errorText && <p className="text-err">{detail.run.errorText}</p>}
              {detail.run.explainSummary && typeof detail.run.explainSummary === 'object' && (
                <p className="muted">
                  EXPLAIN: est. rows {(detail.run.explainSummary as any).estimatedRows}, cost {(detail.run.explainSummary as any).estimatedCost}
                </p>
              )}
            </>
          )}

          <p className="muted">Result rows are not stored in history.</p>
        </div>
      )}
    </div>
  );
}
