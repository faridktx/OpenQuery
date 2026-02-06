import { useState } from 'react';
import * as api from '../api';

interface Props {
  password: string;
}

export default function SchemaPage({ password }: Props) {
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [tableDetail, setTableDetail] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!password) {
      setError('Enter a password in the sidebar first.');
      return;
    }
    setError(''); setStatus(''); setRefreshing(true);
    try {
      const result = await api.schemaRefresh(password);
      setStatus(`Schema refreshed: ${result.tables} tables, ${result.columns} columns.`);
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setRefreshing(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setError('');
    try {
      const results = await api.schemaSearch(searchQuery);
      setSearchResults(results);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const handleTableClick = async (table: string, schema?: string) => {
    setError('');
    try {
      const detail = await api.schemaTableDetail(table, schema);
      setTableDetail(detail);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  return (
    <div className="page">
      <h2>Schema Browser</h2>
      {error && <div className="msg error">{error}</div>}
      {status && <div className="msg success">{status}</div>}

      <div className="toolbar">
        <button className="btn" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh Schema'}
        </button>
      </div>

      <div className="search-bar">
        <input
          placeholder="Search tables and columns..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button className="btn" onClick={handleSearch}>Search</button>
      </div>

      {searchResults.length > 0 && (
        <table className="data-table">
          <thead>
            <tr><th>Schema</th><th>Table</th><th>Column</th><th>Type</th></tr>
          </thead>
          <tbody>
            {searchResults.map((r, i) => (
              <tr key={i} onClick={() => handleTableClick(r.table, r.schema)} className="clickable">
                <td>{r.schema ?? '-'}</td>
                <td>{r.table}</td>
                <td>{r.column ?? '(table match)'}</td>
                <td>{r.dataType ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tableDetail && (
        <div className="detail-card">
          <h3>{tableDetail.schema ? `${tableDetail.schema}.` : ''}{tableDetail.name}</h3>
          {tableDetail.rowCountEstimate !== undefined && (
            <p className="muted">~{tableDetail.rowCountEstimate.toLocaleString()} rows</p>
          )}
          <table className="data-table">
            <thead>
              <tr><th>Column</th><th>Type</th><th>Nullable</th><th>PK</th><th>Default</th></tr>
            </thead>
            <tbody>
              {tableDetail.columns?.map((col: any) => (
                <tr key={col.name}>
                  <td>{col.name}</td>
                  <td>{col.dataType}</td>
                  <td>{col.nullable ? 'YES' : 'NO'}</td>
                  <td>{col.isPrimaryKey ? 'PK' : ''}</td>
                  <td className="muted">{col.defaultValue ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-sm" onClick={() => setTableDetail(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
