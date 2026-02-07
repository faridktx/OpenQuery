import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';

interface HistoryItem {
  id: string;
  question: string;
  askedAt: string;
  status: string | null;
  rowCount: number | null;
  execMs: number | null;
  profileName: string;
  statementType: 'read' | 'write' | 'dangerous';
  sqlPreview: string;
  detail: any;
}

interface Props {
  onOpenWorkspace: (draft: { question?: string; sql?: string }) => void;
}

function classifySql(sql: string): 'read' | 'write' | 'dangerous' {
  const normalized = sql.trim().toUpperCase();
  if (
    normalized.startsWith('DROP') ||
    normalized.startsWith('TRUNCATE') ||
    normalized.startsWith('GRANT') ||
    normalized.startsWith('REVOKE')
  ) {
    return 'dangerous';
  }
  if (
    normalized.startsWith('INSERT') ||
    normalized.startsWith('UPDATE') ||
    normalized.startsWith('DELETE') ||
    normalized.startsWith('CREATE') ||
    normalized.startsWith('ALTER')
  ) {
    return 'write';
  }
  return 'read';
}

export default function HistoryPage({ onOpenWorkspace }: Props) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [search, setSearch] = useState('');
  const [profileFilter, setProfileFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'read' | 'write' | 'dangerous'>('all');
  const [timeFilter, setTimeFilter] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [rawHistory, rawProfiles] = await Promise.all([
        api.historyList(75),
        api.profilesList(),
      ]);
      const profileNameById = new Map((rawProfiles as any[]).map((p) => [p.id as string, p.name as string]));
      const withDetails = await Promise.all(
        (rawHistory as any[]).map(async (item) => {
          const detail = await api.historyShow(item.id);
          const sqlPreview =
            detail?.run?.rewrittenSql || detail?.generation?.generatedSql || '';
          return {
            id: item.id as string,
            question: item.question as string,
            askedAt: item.askedAt as string,
            status: (item.status ?? null) as string | null,
            rowCount: (item.rowCount ?? null) as number | null,
            execMs: (item.execMs ?? null) as number | null,
            profileName: profileNameById.get(detail?.query?.profileId as string) || 'unknown',
            statementType: classifySql(sqlPreview),
            sqlPreview,
            detail,
          } as HistoryItem;
        }),
      );
      setItems(withDetails);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const profileOptions = useMemo(
    () => ['all', ...Array.from(new Set(items.map((item) => item.profileName)))],
    [items],
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    return items.filter((item) => {
      const haystack = `${item.question} ${item.sqlPreview}`.toLowerCase();
      if (search.trim() && !haystack.includes(search.toLowerCase())) return false;
      if (profileFilter !== 'all' && item.profileName !== profileFilter) return false;
      if (typeFilter !== 'all' && item.statementType !== typeFilter) return false;
      if (timeFilter !== 'all') {
        const asked = new Date(item.askedAt).getTime();
        const maxAgeMs =
          timeFilter === '24h'
            ? 24 * 60 * 60 * 1000
            : timeFilter === '7d'
              ? 7 * 24 * 60 * 60 * 1000
              : 30 * 24 * 60 * 60 * 1000;
        if (!Number.isFinite(asked) || now - asked > maxAgeMs) return false;
      }
      return true;
    });
  }, [items, profileFilter, search, timeFilter, typeFilter]);

  const exportSelected = async (): Promise<void> => {
    if (!selected) return;
    try {
      const md = await api.historyExportMd(selected.id);
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openquery-history-${selected.id.slice(0, 8)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>History</h2>
        <p>Search and reopen prior asks and SQL runs.</p>
      </header>

      {error && <div className="inline-error">{error}</div>}

      <div className="card filters">
        <input
          type="text"
          placeholder="Search question or SQL"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
          {profileOptions.map((profileName) => (
            <option key={profileName} value={profileName}>
              {profileName === 'all' ? 'All profiles' : profileName}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="all">All statement types</option>
          <option value="read">Read</option>
          <option value="write">Write</option>
          <option value="dangerous">Dangerous</option>
        </select>
        <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value as typeof timeFilter)}>
          <option value="all">All time</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <p className="muted">No history matches your filters.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Profile</th>
                <th>Type</th>
                <th>Status</th>
                <th>Rows</th>
                <th>ms</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className={selected?.id === item.id ? 'row-active clickable' : 'clickable'}
                  onClick={() => setSelected(item)}
                >
                  <td>{item.question.length > 70 ? `${item.question.slice(0, 67)}...` : item.question}</td>
                  <td>{item.profileName}</td>
                  <td>{item.statementType}</td>
                  <td>{item.status ?? '-'}</td>
                  <td>{item.rowCount ?? '-'}</td>
                  <td>{item.execMs ?? '-'}</td>
                  <td>{item.askedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card">
          <div className="section-header">
            <h3>Selected Entry</h3>
            <div className="action-row">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  onOpenWorkspace({
                    question: selected.detail?.query?.question,
                    sql: selected.detail?.run?.rewrittenSql || selected.detail?.generation?.generatedSql,
                  })
                }
              >
                Open in Workspace
              </button>
              <button type="button" className="btn btn-secondary" onClick={exportSelected}>
                Export Markdown
              </button>
            </div>
          </div>
          <p><strong>Question:</strong> {selected.question}</p>
          <p><strong>Profile:</strong> {selected.profileName}</p>
          <p><strong>Statement Type:</strong> {selected.statementType}</p>
          <pre><code>{selected.sqlPreview || 'No SQL available'}</code></pre>
        </div>
      )}
    </section>
  );
}
