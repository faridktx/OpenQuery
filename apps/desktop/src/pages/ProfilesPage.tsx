import { useEffect, useState } from 'react';
import * as api from '../api';

interface ProfileState {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
}

interface PowerState {
  allowWrite: boolean;
  allowDangerous: boolean;
  confirmPhrase: string | null;
}

interface Props {
  password: string;
  activeProfile: string | null;
  onProfilesChanged: (profiles: Array<{ id: string; name: string }>, active: string | null) => void;
  onConnectionStatusChange: (status: 'unknown' | 'ok' | 'error') => void;
}

const CONNECTION_HELP_RE = /(ECONNREFUSED|could not connect|connect ECONNREFUSED|timeout)/i;

export default function ProfilesPage({
  password,
  activeProfile,
  onProfilesChanged,
  onConnectionStatusChange,
}: Props) {
  const [profiles, setProfiles] = useState<ProfileState[]>([]);
  const [powerByName, setPowerByName] = useState<Record<string, PowerState>>({});
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [rememberPw, setRememberPw] = useState(true);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    host: '127.0.0.1',
    port: '5432',
    database: 'openquery_test',
    user: 'openquery',
    ssl: false,
  });

  const load = async (): Promise<void> => {
    try {
      const [list, active] = await Promise.all([api.profilesList(), api.profilesGetActive()]);
      setProfiles(list as ProfileState[]);
      onProfilesChanged(
        (list as ProfileState[]).map((p) => ({ id: p.id, name: p.name })),
        active.name,
      );
      const powerEntries = await Promise.all(
        (list as ProfileState[]).map(async (p) => {
          try {
            const power = await api.profileGetPower(p.name);
            return [p.name, power] as const;
          } catch {
            return [
              p.name,
              { allowWrite: false, allowDangerous: false, confirmPhrase: null } as PowerState,
            ] as const;
          }
        }),
      );
      setPowerByName(Object.fromEntries(powerEntries));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resolvePassword = async (profileId: string): Promise<string | null> => {
    if (password.trim()) return password;
    const stored = await api.keychainGet(profileId);
    return stored;
  };

  const handleAdd = async (): Promise<void> => {
    setError('');
    setStatus('');
    if (!form.name.trim()) {
      setError('Profile name is required.');
      return;
    }
    try {
      const profile = await api.profilesAdd({
        name: form.name.trim(),
        db_type: 'postgres',
        host: form.host.trim(),
        port: Number(form.port),
        database: form.database.trim(),
        user: form.user.trim(),
        ssl: form.ssl,
      });
      if (rememberPw && password.trim()) {
        await api.keychainSet(profile.id, password);
      }
      setStatus(`Profile "${form.name}" created.`);
      setShowAdd(false);
      setForm({
        name: '',
        host: '127.0.0.1',
        port: '5432',
        database: 'openquery_test',
        user: 'openquery',
        ssl: false,
      });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const handleSetActive = async (name: string): Promise<void> => {
    setError('');
    setStatus('');
    try {
      await api.profilesUse(name);
      setStatus(`Active profile set to "${name}".`);
      onConnectionStatusChange('unknown');
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const handleRemove = async (name: string, id: string): Promise<void> => {
    if (!window.confirm(`Remove profile "${name}"?`)) return;
    setError('');
    setStatus('');
    try {
      await api.profilesRemove(name);
      await api.keychainDelete(id);
      onConnectionStatusChange('unknown');
      setStatus(`Profile "${name}" removed.`);
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const handleTest = async (profile: ProfileState): Promise<void> => {
    setError('');
    setStatus('');
    setLoadingName(profile.name);
    try {
      const resolved = await resolvePassword(profile.id);
      if (!resolved) {
        setError('No password found. Enter a session password or save one in keychain.');
        onConnectionStatusChange('error');
        return;
      }
      const result = await api.profilesTest(profile.name, resolved);
      if (result.ok) {
        onConnectionStatusChange('ok');
        setStatus(`Connection successful: ${result.serverVersion ?? 'server reachable'}`);
      } else {
        onConnectionStatusChange('error');
        const message = result.error || 'Connection failed.';
        if (CONNECTION_HELP_RE.test(message)) {
          setError(`${message}\nTip: Start Docker Desktop, then click Test.`);
        } else {
          setError(message);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onConnectionStatusChange('error');
      setError(CONNECTION_HELP_RE.test(msg) ? `${msg}\nTip: Start Docker Desktop, then click Test.` : msg);
    } finally {
      setLoadingName(null);
    }
  };

  const handleRefreshSchema = async (profile: ProfileState): Promise<void> => {
    setError('');
    setStatus('');
    setLoadingName(profile.name);
    try {
      const resolved = await resolvePassword(profile.id);
      if (!resolved) {
        setError('No password found. Enter a session password or save one in keychain.');
        return;
      }
      await api.schemaRefresh(resolved, profile.name);
      setStatus(`Schema snapshot refreshed for "${profile.name}".`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoadingName(null);
    }
  };

  const handleTogglePower = async (
    profileName: string,
    field: 'allowWrite' | 'allowDangerous',
    value: boolean,
  ): Promise<void> => {
    setError('');
    setStatus('');
    try {
      const update: {
        allowWrite?: boolean;
        allowDangerous?: boolean;
      } = {};
      update[field] = value;
      if (field === 'allowWrite' && !value) {
        update.allowDangerous = false;
      }
      await api.profileUpdatePower(profileName, update);
      const power = await api.profileGetPower(profileName);
      setPowerByName((prev) => ({ ...prev, [profileName]: power }));
      setStatus(`POWER settings updated for "${profileName}".`);
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>Profiles</h2>
        <p>Create and validate database connections before running queries.</p>
      </header>

      {error && <div className="inline-error preserve-lines">{error}</div>}
      {status && <div className="inline-success">{status}</div>}

      {profiles.length === 0 ? (
        <div className="empty-card">
          <h3>No profiles yet</h3>
          <p>Add a PostgreSQL profile to start schema exploration and query generation.</p>
          <button type="button" className="btn" onClick={() => setShowAdd(true)}>
            Create Profile
          </button>
        </div>
      ) : (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Host</th>
                <th>Database</th>
                <th>User</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className={p.name === activeProfile ? 'row-active' : ''}>
                  <td>
                    {p.name}
                    {p.name === activeProfile && <span className="badge">active</span>}
                  </td>
                  <td>{p.host}:{p.port}</td>
                  <td>{p.database}</td>
                  <td>{p.user}</td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleSetActive(p.name)}
                      disabled={p.name === activeProfile}
                    >
                      Set Active
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleTest(p)}
                      disabled={loadingName === p.name}
                    >
                      {loadingName === p.name ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleRefreshSchema(p)}
                      disabled={loadingName === p.name}
                    >
                      Refresh Schema
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleRemove(p.name, p.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeProfile && powerByName[activeProfile] && (
        <div className="card">
          <h3>POWER Mode</h3>
          <p className="muted">
            Write operations require preview plus typed confirmation. Keep this disabled unless needed.
          </p>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={powerByName[activeProfile].allowWrite}
              onChange={(e) => handleTogglePower(activeProfile, 'allowWrite', e.target.checked)}
            />
            <span>Enable write operations</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={powerByName[activeProfile].allowDangerous}
              disabled={!powerByName[activeProfile].allowWrite}
              onChange={(e) => handleTogglePower(activeProfile, 'allowDangerous', e.target.checked)}
            />
            <span>Allow dangerous operations (DROP/TRUNCATE)</span>
          </label>
        </div>
      )}

      <div className="card">
        <div className="section-header">
          <h3>{showAdd ? 'New Profile' : 'Onboarding'}</h3>
          {!showAdd && (
            <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(true)}>
              Add Profile
            </button>
          )}
        </div>
        {showAdd && (
          <div className="form-grid">
            <label>
              <span>Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <label>
              <span>Host</span>
              <input
                type="text"
                value={form.host}
                onChange={(e) => setForm((prev) => ({ ...prev, host: e.target.value }))}
              />
            </label>
            <label>
              <span>Port</span>
              <input
                type="text"
                value={form.port}
                onChange={(e) => setForm((prev) => ({ ...prev, port: e.target.value }))}
              />
            </label>
            <label>
              <span>Database</span>
              <input
                type="text"
                value={form.database}
                onChange={(e) => setForm((prev) => ({ ...prev, database: e.target.value }))}
              />
            </label>
            <label>
              <span>User</span>
              <input
                type="text"
                value={form.user}
                onChange={(e) => setForm((prev) => ({ ...prev, user: e.target.value }))}
              />
            </label>
            <label className="toggle-row compact">
              <input
                type="checkbox"
                checked={form.ssl}
                onChange={(e) => setForm((prev) => ({ ...prev, ssl: e.target.checked }))}
              />
              <span>Use SSL</span>
            </label>
            <label className="toggle-row compact">
              <input
                type="checkbox"
                checked={rememberPw}
                onChange={(e) => setRememberPw(e.target.checked)}
              />
              <span>Save session password in keychain</span>
            </label>
            <div className="action-row">
              <button type="button" className="btn" onClick={handleAdd}>
                Save Profile
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
