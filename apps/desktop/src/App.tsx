import { useEffect, useMemo, useState } from 'react';
import * as api from './api';
import WorkspacePage from './pages/WorkspacePage';
import ProfilesPage from './pages/ProfilesPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import QuickstartPage from './pages/QuickstartPage';
import { getOpenAIKey } from './lib/secretStore';

type Page = 'workspace' | 'setup' | 'profiles' | 'history' | 'settings';
type ConnectionStatus = 'unknown' | 'ok' | 'error';

interface ProfileSummary {
  id: string;
  name: string;
  db_type: string;
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
const STALE_SCHEMA_MS = 24 * 60 * 60 * 1000;

interface SetupState {
  needsSetup: boolean;
  reason: string;
  schemaCapturedAt: string | null;
  schemaStale: boolean;
}

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
  const [setupState, setSetupState] = useState<SetupState>({
    needsSetup: true,
    reason: 'Complete setup to start running queries.',
    schemaCapturedAt: null,
    schemaStale: false,
  });
  const [setupChecked, setSetupChecked] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [refreshingSchema, setRefreshingSchema] = useState(false);

  const navItems: Array<{ id: Page; label: string; meta?: string | null }> = useMemo(
    () => [
      { id: 'setup', label: 'Setup', meta: setupState.needsSetup ? '1' : null },
      { id: 'workspace', label: 'Workspace' },
      { id: 'profiles', label: 'Profiles' },
      { id: 'history', label: 'History' },
      { id: 'settings', label: 'Settings' },
    ],
    [setupState.needsSetup],
  );
  const activeProfileType = useMemo(
    () => profiles.find((profile) => profile.name === activeProfile)?.db_type ?? null,
    [profiles, activeProfile],
  );

  useEffect(() => {
    localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(safePolicy));
  }, [safePolicy]);

  const evaluateSetupState = async (
    nextProfiles: ProfileSummary[],
    nextActive: string | null,
    autoRoute: boolean,
  ): Promise<void> => {
    let next: SetupState = {
      needsSetup: false,
      reason: '',
      schemaCapturedAt: null,
      schemaStale: false,
    };
    if (nextProfiles.length === 0) {
      next = {
        needsSetup: true,
        reason: 'No profile yet. Create a connection in Setup to get started.',
        schemaCapturedAt: null,
        schemaStale: false,
      };
    } else if (!nextActive) {
      next = {
        needsSetup: true,
        reason: 'No active profile selected. Choose one in Setup.',
        schemaCapturedAt: null,
        schemaStale: false,
      };
    } else {
      try {
        const snapshot = await api.schemaGetSnapshot();
        const hasTables = Array.isArray(snapshot?.tables) && snapshot.tables.length > 0;
        const capturedAtRaw = typeof snapshot?.capturedAt === 'string' ? snapshot.capturedAt : null;
        const capturedAtMs = capturedAtRaw ? Date.parse(capturedAtRaw) : Number.NaN;
        const stale = !Number.isFinite(capturedAtMs) || Date.now() - capturedAtMs > STALE_SCHEMA_MS;
        next = {
          needsSetup: !hasTables || stale,
          reason: !hasTables
            ? 'Schema snapshot is missing. Refresh schema in Setup.'
            : 'Schema snapshot is stale. Refresh schema in Setup before running queries.',
          schemaCapturedAt: capturedAtRaw,
          schemaStale: stale,
        };
      } catch {
        next = {
          needsSetup: true,
          reason: 'Schema snapshot is unavailable. Refresh schema in Setup.',
          schemaCapturedAt: null,
          schemaStale: false,
        };
      }
    }
    setSetupState(next);
    if (autoRoute && next.needsSetup) {
      setPage('setup');
    }
  };

  const syncProfileState = async (autoRoute: boolean): Promise<void> => {
    try {
      const [allProfiles, active] = await Promise.all([
        api.profilesList(),
        api.profilesGetActive(),
      ]);
      const typed = allProfiles.map((p: any) => ({
        id: p.id as string,
        name: p.name as string,
        db_type: (p.db_type as string) || 'postgres',
      }));
      setProfiles(typed);
      setActiveProfile(active.name);
      setConnectionStatus('unknown');
      await evaluateSetupState(typed, active.name, autoRoute);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTopError(msg);
    } finally {
      if (autoRoute) {
        setSetupChecked(true);
      }
    }
  };

  useEffect(() => {
    void syncProfileState(true);
  }, []);

  useEffect(() => {
    const refreshAiStatus = async (): Promise<void> => {
      try {
        const [stored, settings] = await Promise.all([getOpenAIKey(), api.settingsStatus()]);
        setAiReady(Boolean(stored) || Boolean(settings.openAiKeySet));
      } catch {
        setAiReady(false);
      }
    };
    void refreshAiStatus();
  }, [page]);

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
      await evaluateSetupState(profiles, name, false);
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
    const profileType = profiles.find((p) => p.name === activeProfile)?.db_type ?? 'postgres';
    const resolvedPassword = profileType === 'sqlite' ? '' : password.trim();
    if (profileType !== 'sqlite' && !resolvedPassword) {
      setTopError('Enter a session password to test the active profile.');
      return;
    }
    setTopError('');
    setConnectionStatus('unknown');
    try {
      const result = await api.profilesTest(activeProfile, resolvedPassword);
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

  const refreshActiveSchema = async (): Promise<void> => {
    if (!activeProfile) {
      setTopError('Select an active profile first.');
      return;
    }
    const profileType = profiles.find((p) => p.name === activeProfile)?.db_type ?? 'postgres';
    const resolvedPassword = profileType === 'sqlite' ? '' : password.trim();
    if (profileType !== 'sqlite' && !resolvedPassword) {
      setTopError('Enter session password, then click Refresh schema.');
      return;
    }
    setRefreshingSchema(true);
    setTopError('');
    try {
      await api.schemaRefresh(resolvedPassword, activeProfile);
      await evaluateSetupState(profiles, activeProfile, false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTopError(msg);
    } finally {
      setRefreshingSchema(false);
    }
  };

  const schemaStateLabel = setupState.needsSetup
    ? setupState.schemaStale
      ? 'Schema stale'
      : 'Schema missing'
    : 'Schema ready';

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-mark">
          <img
            src="/openquerylogo-rounded.png"
            alt="OpenQuery logo"
            className="brand-mark__logo"
          />
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
              <span>{item.label}</span>
              {item.meta && <span className="nav-btn__meta">{item.meta}</span>}
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
            <div className="top-status">
              <span className={`status-pill status-${connectionStatus}`}>
                <span className="status-dot" />
                {connectionStatus === 'ok' ? 'Connected' : connectionStatus === 'error' ? 'Connection failed' : 'Connection unknown'}
              </span>
              <span className={`status-pill ${setupState.needsSetup ? 'status-schema-warn' : 'status-schema-ok'}`}>
                {schemaStateLabel}
              </span>
              <span className={`status-pill ${aiReady ? 'status-ai-ok' : 'status-ai-warn'}`}>
                {aiReady ? 'AI key ready' : 'AI key missing'}
              </span>
            </div>
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
            <span className={`status-pill mode-${powerEnabled ? 'power' : 'safe'}`}>
              Mode: {powerEnabled ? 'POWER' : 'SAFE'}
            </span>
            <div className="top-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={refreshActiveSchema}
                disabled={refreshingSchema}
              >
                {refreshingSchema ? 'Refreshing...' : 'Refresh schema'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setWorkspaceDraft(null);
                  setPage('workspace');
                }}
              >
                New query
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setHelpOpen((prev) => !prev)}
                aria-expanded={helpOpen}
                aria-controls="global-help-panel"
              >
                Help
              </button>
            </div>
          </div>
        </header>

        {topError && <div className="inline-error">{topError}</div>}
        {setupChecked && setupState.needsSetup && (
          <div className="inline-warning">
            <strong>Complete setup to start running queries.</strong>
            <p>{setupState.reason}</p>
            {setupState.schemaCapturedAt && (
              <p className="muted">
                Last schema refresh: {setupState.schemaCapturedAt}
                {setupState.schemaStale ? ' (stale)' : ''}
              </p>
            )}
          </div>
        )}

        <main className="main-content">
          <div className="main-content-inner">
            {page === 'workspace' && (
              <WorkspacePage
                password={password}
                activeProfile={activeProfile}
                activeProfileType={activeProfileType}
                safePolicy={safePolicy}
                powerEnabled={powerEnabled}
                draft={workspaceDraft}
                onDraftConsumed={() => setWorkspaceDraft(null)}
                onNavigateSetup={() => setPage('setup')}
                onNavigateSettings={() => setPage('settings')}
              />
            )}
            {page === 'setup' && (
              <QuickstartPage
                password={password}
                activeProfile={activeProfile}
                profiles={profiles}
                setupState={setupState}
                onReloadProfileState={() => syncProfileState(false)}
                onNavigate={setPage}
              />
            )}
            {page === 'profiles' && (
              <ProfilesPage
                password={password}
                activeProfile={activeProfile}
                onProfilesChanged={(nextProfiles, nextActive) => {
                  setProfiles(nextProfiles);
                  setActiveProfile(nextActive);
                  void evaluateSetupState(nextProfiles, nextActive, false);
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
          </div>
        </main>
      </section>

      {helpOpen && (
        <aside id="global-help-panel" className="help-panel" role="dialog" aria-label="OpenQuery help">
          <div className="section-header">
            <h3>Quick Help</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHelpOpen(false)}>
              Close
            </button>
          </div>
          <ol className="checklist">
            <li>Open Setup and choose a demo mode or connect Postgres.</li>
            <li>Refresh schema so Ask and guardrails understand your tables.</li>
            <li>Run Ask (AI) or SQL, then review Policy + Explain before execute.</li>
            <li>Use History to reopen and export prior queries.</li>
          </ol>
          <h4>Status meanings</h4>
          <ul className="checklist">
            <li><strong>Connected:</strong> DB profile responds to a test query.</li>
            <li><strong>Schema stale:</strong> refresh schema before relying on Ask output.</li>
            <li><strong>AI key missing:</strong> SQL tab still works; Ask needs key in Settings.</li>
          </ul>
        </aside>
      )}
    </div>
  );
}
