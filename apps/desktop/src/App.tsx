import { useEffect, useMemo, useState } from 'react';
import * as api from './api';
import WorkspacePage from './pages/WorkspacePage';
import ProfilesPage from './pages/ProfilesPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';

type Page = 'workspace' | 'profiles' | 'history' | 'settings';
type ConnectionStatus = 'unknown' | 'ok' | 'error';

interface ProfileSummary {
  id: string;
  name: string;
}

interface WorkspaceDraft {
  question?: string;
  sql?: string;
}

export interface SafePolicySettings {
  maxRowsThreshold: number;
  maxCostThreshold: number;
  enforceLimit: boolean;
}

const DEFAULT_POLICY: SafePolicySettings = {
  maxRowsThreshold: 1_000_000,
  maxCostThreshold: 1_000_000,
  enforceLimit: true,
};

const POLICY_STORAGE_KEY = 'openquery.safe-policy.v1';

function loadStoredPolicy(): SafePolicySettings {
  try {
    const raw = localStorage.getItem(POLICY_STORAGE_KEY);
    if (!raw) return DEFAULT_POLICY;
    const parsed = JSON.parse(raw) as SafePolicySettings;
    if (
      typeof parsed.maxRowsThreshold !== 'number' ||
      typeof parsed.maxCostThreshold !== 'number' ||
      typeof parsed.enforceLimit !== 'boolean'
    ) {
      return DEFAULT_POLICY;
    }
    return parsed;
  } catch {
    return DEFAULT_POLICY;
  }
}

export default function App() {
  const [page, setPage] = useState<Page>('workspace');
  const [password, setPassword] = useState('');
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [powerEnabled, setPowerEnabled] = useState(false);
  const [topError, setTopError] = useState('');
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceDraft | null>(null);
  const [safePolicy, setSafePolicy] = useState<SafePolicySettings>(loadStoredPolicy());

  const navItems: Array<{ id: Page; label: string }> = useMemo(
    () => [
      { id: 'workspace', label: 'Workspace' },
      { id: 'profiles', label: 'Profiles' },
      { id: 'history', label: 'History' },
      { id: 'settings', label: 'Settings' },
    ],
    [],
  );

  useEffect(() => {
    localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(safePolicy));
  }, [safePolicy]);

  const syncProfileState = async (): Promise<void> => {
    try {
      const [allProfiles, active] = await Promise.all([
        api.profilesList(),
        api.profilesGetActive(),
      ]);
      const normalized = allProfiles.map((p: any) => ({ id: p.id as string, name: p.name as string }));
      setProfiles(normalized);
      setActiveProfile(active.name);
      setConnectionStatus('unknown');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTopError(msg);
    }
  };

  useEffect(() => {
    syncProfileState();
  }, []);

  useEffect(() => {
    const loadPower = async (): Promise<void> => {
      if (!activeProfile) {
        setPowerEnabled(false);
        return;
      }
      try {
        const power = await api.profileGetPower(activeProfile);
        setPowerEnabled(Boolean(power.allowWrite));
      } catch {
        setPowerEnabled(false);
      }
    };
    loadPower();
  }, [activeProfile]);

  const handleProfileSelect = async (name: string): Promise<void> => {
    if (!name) return;
    setTopError('');
    try {
      await api.profilesUse(name);
      setActiveProfile(name);
      setConnectionStatus('unknown');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTopError(msg);
    }
  };

  const testActiveConnection = async (): Promise<void> => {
    if (!activeProfile) {
      setTopError('No active profile selected.');
      return;
    }
    if (!password.trim()) {
      setTopError('Enter a session password to test the active profile.');
      return;
    }
    setTopError('');
    setConnectionStatus('unknown');
    try {
      const result = await api.profilesTest(activeProfile, password);
      setConnectionStatus(result.ok ? 'ok' : 'error');
      if (!result.ok) {
        setTopError(result.error || 'Connection test failed.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setConnectionStatus('error');
      setTopError(msg);
    }
  };

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-mark">
          <span className="brand-mark__logo">OQ</span>
          <div>
            <h1>OpenQuery</h1>
            <p>Desktop SQL Copilot</p>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={page === item.id ? 'nav-btn active' : 'nav-btn'}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="main-shell">
        <header className="top-bar">
          <div className="top-bar__left">
            <label className="field-inline">
              <span>Active Profile</span>
              <select
                value={activeProfile ?? ''}
                onChange={(e) => handleProfileSelect(e.target.value)}
              >
                <option value="">Select profile</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={testActiveConnection}>
              Test Connection
            </button>
          </div>

          <div className="top-bar__right">
            <label className="field-inline">
              <span>Session Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Required for DB actions"
              />
            </label>
            <span className={`status-pill status-${connectionStatus}`}>
              Connection: {connectionStatus === 'ok' ? 'Healthy' : connectionStatus === 'error' ? 'Failed' : 'Unknown'}
            </span>
            <span className={`status-pill mode-${powerEnabled ? 'power' : 'safe'}`}>
              Mode: {powerEnabled ? 'POWER' : 'SAFE'}
            </span>
          </div>
        </header>

        {topError && <div className="inline-error">{topError}</div>}

        <main className="main-content">
          {page === 'workspace' && (
            <WorkspacePage
              password={password}
              activeProfile={activeProfile}
              safePolicy={safePolicy}
              powerEnabled={powerEnabled}
              draft={workspaceDraft}
              onDraftConsumed={() => setWorkspaceDraft(null)}
              onNavigateProfiles={() => setPage('profiles')}
            />
          )}
          {page === 'profiles' && (
            <ProfilesPage
              password={password}
              activeProfile={activeProfile}
              onProfilesChanged={(nextProfiles, nextActive) => {
                setProfiles(nextProfiles);
                setActiveProfile(nextActive);
              }}
              onConnectionStatusChange={setConnectionStatus}
            />
          )}
          {page === 'history' && (
            <HistoryPage
              onOpenWorkspace={(draft) => {
                setWorkspaceDraft(draft);
                setPage('workspace');
              }}
            />
          )}
          {page === 'settings' && (
            <SettingsPage
              safePolicy={safePolicy}
              onSafePolicyChange={setSafePolicy}
            />
          )}
        </main>
      </section>
    </div>
  );
}
