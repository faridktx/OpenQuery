import { useState } from 'react';
import ProfilesPage from './pages/ProfilesPage';
import SchemaPage from './pages/SchemaPage';
import AskPage from './pages/AskPage';
import HistoryPage from './pages/HistoryPage';

type Page = 'profiles' | 'schema' | 'ask' | 'history';

export default function App() {
  const [page, setPage] = useState<Page>('ask');
  const [password, setPassword] = useState('');

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-brand">OpenQuery</div>
        <button className={page === 'ask' ? 'active' : ''} onClick={() => setPage('ask')}>
          Ask
        </button>
        <button className={page === 'schema' ? 'active' : ''} onClick={() => setPage('schema')}>
          Schema
        </button>
        <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}>
          History
        </button>
        <button className={page === 'profiles' ? 'active' : ''} onClick={() => setPage('profiles')}>
          Profiles
        </button>
        <div className="sidebar-spacer" />
        <div className="sidebar-password">
          <label>Session Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="DB password"
          />
        </div>
      </nav>
      <main className="content">
        {page === 'profiles' && <ProfilesPage password={password} />}
        {page === 'schema' && <SchemaPage password={password} />}
        {page === 'ask' && <AskPage password={password} />}
        {page === 'history' && <HistoryPage />}
      </main>
    </div>
  );
}
