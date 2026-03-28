'use client';

import { useState, useTransition } from 'react';

import type { DashboardPayload, SettingsFormValues } from '@/lib/types';
import { formatRelativeDate } from '@/lib/utils';

type Section = 'overview' | 'sessions' | 'calls' | 'settings';
type SettingsSection = 'telegram' | 'models' | 'security';

export function DashboardShell({ initialData }: { initialData: DashboardPayload }) {
  const [data, setData] = useState(initialData);
  const [section, setSection] = useState<Section>('overview');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('telegram');
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<SettingsFormValues>({
    displayName: data.settings.displayName,
    telegramBotToken: data.settings.telegramBotToken,
    aiGatewayApiKey: data.settings.aiGatewayApiKey,
    vercelApiToken: data.settings.vercelApiToken,
    vercelProjectId: data.settings.vercelProjectId,
    vercelTeamId: data.settings.vercelTeamId,
    allowedUserIds: data.settings.allowedUserIds,
    allowedGroupIds: data.settings.allowedGroupIds,
    requireMention: data.settings.requireMention,
    timeoutSeconds: data.settings.timeoutSeconds,
    defaultModel: data.settings.defaultModel,
  });

  async function refresh() {
    startTransition(() => {
      void (async () => {
        const response = await fetch('/api/overview', { cache: 'no-store' });
        const payload: DashboardPayload = await response.json();
        setData(payload);
        setMessage('Dashboard synced.');
      })();
    });
  }

  async function runSandboxAction(action: 'start' | 'stop' | 'sync') {
    startTransition(() => {
      void (async () => {
        const response = await fetch('/api/sandbox', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action }),
        });
        const payload: DashboardPayload = await response.json();
        setData(payload);
        setMessage(`Sandbox action completed: ${action}.`);
      })();
    });
  }

  async function saveSettings() {
    startTransition(() => {
      void (async () => {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(form),
        });
        const payload: DashboardPayload = await response.json();
        setData(payload);
        setMessage('Settings saved.');
      })();
    });
  }

  const stats = [
    {
      label: 'Sandbox',
      value: data.sandbox?.status ?? 'idle',
    },
    {
      label: 'Allowed IDs',
      value: form.allowedUserIds.split(',').filter(Boolean).length.toString(),
    },
    {
      label: 'Sessions',
      value: data.sessions.length.toString(),
    },
    {
      label: 'Calls logged',
      value: data.commands.length.toString(),
    },
  ];

  return (
    <div className="page-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div>Yokai</div>
        </div>

        <nav className="nav">
          {(['overview', 'sessions', 'calls', 'settings'] as const).map((item) => (
            <button
              data-active={section === item}
              key={item}
              onClick={() => setSection(item)}
              type="button"
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>

        <div className="panel panel-body">
          <div className="muted">OpenClaw</div>
          <div style={{ marginTop: 8, fontSize: '1.1rem' }}>{data.settings.displayName}</div>
          <div className="status-line" style={{ marginTop: 10 }}>
            <span className="pill" data-status={data.sandbox?.status ?? 'starting'}>
              {data.sandbox?.status ?? 'idle'}
            </span>
          </div>
        </div>
      </aside>

      <main className="main">
        <section className="hero">
          <div>
            <h1>OpenClaw control plane</h1>
            <p>
              Run the official OpenClaw gateway inside Vercel Sandbox, lock Telegram access to an
              explicit allowlist, and keep sessions, usage, and command activity visible from a
              single dashboard.
            </p>
          </div>

          <div className="hero-actions">
            <button className="button-ghost" onClick={() => refresh()} type="button">
              Refresh
            </button>
            <button className="button" onClick={() => runSandboxAction('start')} type="button">
              Start sandbox
            </button>
          </div>
        </section>

        {message ? <div className="notice">{message}</div> : null}

        {section === 'overview' ? (
          <>
            <section className="grid overview-grid">
              {stats.map((stat) => (
                <article className="panel stat-card" key={stat.label}>
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </article>
              ))}
            </section>

            <section className="layout-grid">
              <article className="panel">
                <div className="panel-header">
                  <h2>Runtime</h2>
                  <span
                    className="pill"
                    data-status={data.sandbox?.status === 'running' ? 'running' : 'starting'}
                  >
                    {data.sandbox?.status ?? 'idle'}
                  </span>
                </div>
                <div className="panel-body stack">
                  <div className="list-row">
                    <div>
                      <div>Gateway URL</div>
                      <div className="muted mono">{data.sandbox?.gatewayUrl ?? 'Not running'}</div>
                    </div>
                    <div>
                      <div className="muted">OpenClaw</div>
                      <div>{data.sandbox?.openClawVersion ?? 'Unknown'}</div>
                    </div>
                  </div>
                  <div className="list-row">
                    <div>
                      <div>CPU usage</div>
                      <div className="muted">
                        {data.sandbox?.activeCpuUsageMs
                          ? `${data.sandbox.activeCpuUsageMs} ms`
                          : 'No data'}
                      </div>
                    </div>
                    <div>
                      <div>Network</div>
                      <div className="muted">
                        {data.sandbox?.networkBytes
                          ? `${Math.round(data.sandbox.networkBytes / 1024)} KB`
                          : 'No data'}
                      </div>
                    </div>
                  </div>
                  <div className="footer-row">
                    <div className="muted">
                      Updated {data.sandbox ? formatRelativeDate(data.sandbox.updatedAt) : 'Never'}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        className="button-ghost"
                        onClick={() => runSandboxAction('sync')}
                        type="button"
                      >
                        Sync state
                      </button>
                      <button
                        className="button-ghost"
                        onClick={() => runSandboxAction('stop')}
                        type="button"
                      >
                        Stop
                      </button>
                    </div>
                  </div>
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h2>Latest Usage</h2>
                </div>
                <div className="panel-body stack">
                  {data.usage.length ? (
                    data.usage.map((snapshot) => (
                      <div className="list-row" key={`${snapshot.source}-${snapshot.recordedAt}`}>
                        <div>
                          <div>{snapshot.source}</div>
                          <div className="muted">{formatRelativeDate(snapshot.recordedAt)}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div>{snapshot.creditsRemaining ?? snapshot.cpuMs ?? 0}</div>
                          <div className="muted">
                            {snapshot.source === 'ai-gateway' ? 'credits left' : 'cpu ms'}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="muted">No usage snapshots yet.</div>
                  )}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {section === 'sessions' ? (
          <article className="panel">
            <div className="panel-header">
              <h2>Sessions</h2>
            </div>
            <div className="panel-body stack">
              {data.sessions.length ? (
                data.sessions.map((session) => (
                  <div className="list-row" key={session.sessionKey}>
                    <div>
                      <div className="mono">{session.sessionKey}</div>
                      <div className="muted">Agent {session.agentId}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div>{session.model ?? 'Unknown model'}</div>
                      <div className="muted">
                        {session.totalTokens ? `${session.totalTokens} tokens` : 'No token data'}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="muted">No sessions synced from OpenClaw yet.</div>
              )}
            </div>
          </article>
        ) : null}

        {section === 'calls' ? (
          <article className="panel">
            <div className="panel-header">
              <h2>Command log</h2>
            </div>
            <div className="panel-body stack">
              {data.commands.map((command) => (
                <div className="list-row" key={command.cmdId}>
                  <div>
                    <div className="mono">
                      {command.command} {command.args.join(' ')}
                    </div>
                    <div className="muted">{formatRelativeDate(command.startedAt)}</div>
                    {command.stdout ? (
                      <div className="muted mono" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                        {command.stdout}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="pill" data-status={command.status}>
                      {command.status}
                    </span>
                    <div className="muted" style={{ marginTop: 8 }}>
                      exit {command.exitCode ?? '…'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ) : null}

        {section === 'settings' ? (
          <article className="panel">
            <div className="settings-tabs">
              {(['telegram', 'models', 'security'] as const).map((item) => (
                <button
                  data-active={settingsSection === item}
                  key={item}
                  onClick={() => setSettingsSection(item)}
                  type="button"
                >
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>

            <div className="panel-body">
              <div className="form-grid">
                {settingsSection === 'telegram' ? (
                  <>
                    <div className="field">
                      <label htmlFor="displayName">Gateway name</label>
                      <input
                        id="displayName"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, displayName: event.target.value }))
                        }
                        value={form.displayName}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="telegramBotToken">Telegram bot token</label>
                      <input
                        id="telegramBotToken"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            telegramBotToken: event.target.value,
                          }))
                        }
                        value={form.telegramBotToken}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="allowedUserIds">Allowed user IDs</label>
                      <input
                        id="allowedUserIds"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            allowedUserIds: event.target.value,
                          }))
                        }
                        value={form.allowedUserIds}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="allowedGroupIds">Allowed group IDs</label>
                      <input
                        id="allowedGroupIds"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            allowedGroupIds: event.target.value,
                          }))
                        }
                        value={form.allowedGroupIds}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="timeoutSeconds">Sandbox timeout (seconds)</label>
                      <input
                        id="timeoutSeconds"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            timeoutSeconds: Number(event.target.value) || current.timeoutSeconds,
                          }))
                        }
                        type="number"
                        value={form.timeoutSeconds}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="requireMention">Require mention</label>
                      <div className="checkbox-row">
                        <input
                          checked={form.requireMention}
                          id="requireMention"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              requireMention: event.target.checked,
                            }))
                          }
                          type="checkbox"
                        />
                        <span className="muted">Enforce mention for allowed groups.</span>
                      </div>
                    </div>
                  </>
                ) : null}

                {settingsSection === 'models' ? (
                  <>
                    <div className="field full">
                      <label htmlFor="defaultModel">Default OpenClaw model</label>
                      <input
                        id="defaultModel"
                        list="available-models"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            defaultModel: event.target.value,
                          }))
                        }
                        value={form.defaultModel}
                      />
                      <datalist id="available-models">
                        {data.availableModels.map((model) => (
                          <option key={model} value={model} />
                        ))}
                      </datalist>
                    </div>
                    <div className="field full">
                      <label htmlFor="aiGatewayApiKey">Vercel AI Gateway API key</label>
                      <input
                        id="aiGatewayApiKey"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            aiGatewayApiKey: event.target.value,
                          }))
                        }
                        value={form.aiGatewayApiKey}
                      />
                    </div>
                  </>
                ) : null}

                {settingsSection === 'security' ? (
                  <>
                    <div className="field">
                      <label htmlFor="vercelApiToken">Vercel API token</label>
                      <input
                        id="vercelApiToken"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            vercelApiToken: event.target.value,
                          }))
                        }
                        value={form.vercelApiToken}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="vercelProjectId">Vercel project ID</label>
                      <input
                        id="vercelProjectId"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            vercelProjectId: event.target.value,
                          }))
                        }
                        value={form.vercelProjectId}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="vercelTeamId">Vercel team ID</label>
                      <input
                        id="vercelTeamId"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            vercelTeamId: event.target.value,
                          }))
                        }
                        value={form.vercelTeamId}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="gatewayAuthToken">Gateway auth token</label>
                      <input
                        disabled
                        id="gatewayAuthToken"
                        value={data.settings.gatewayAuthToken}
                      />
                    </div>
                  </>
                ) : null}
              </div>

              <div className="footer-row">
                <div className="muted">
                  Saved{' '}
                  {data.settings.updatedAt ? formatRelativeDate(data.settings.updatedAt) : 'Never'}
                </div>
                <button
                  className="button"
                  disabled={isPending}
                  onClick={() => saveSettings()}
                  type="button"
                >
                  {isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </article>
        ) : null}
      </main>
    </div>
  );
}
