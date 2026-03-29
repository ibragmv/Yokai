'use client';

import { useEffect, useEffectEvent, useState, useTransition } from 'react';

import { runSandboxAction, saveSettingsAction } from '@/app/actions';
import { logoutAdminAction } from '@/app/login/actions';
import { YokaiLogo } from '@/components/yokai-logo';
import type {
  DashboardActionResult,
  DashboardPayload,
  SettingsFormValues,
  UsageSnapshot,
} from '@/lib/types';
import { formatRelativeDate } from '@/lib/utils';

type Section = 'overview' | 'activity' | 'settings';

const SECTION_LABELS: Record<Section, string> = {
  overview: 'Overview',
  activity: 'Activity',
  settings: 'Settings',
};

function createFormValues(payload: DashboardPayload): SettingsFormValues {
  return {
    displayName: payload.settings.displayName,
    telegramBotToken: payload.settings.telegramBotToken,
    aiGatewayApiKey: payload.settings.aiGatewayApiKey,
    vercelApiToken: payload.settings.vercelApiToken,
    vercelProjectId: payload.settings.vercelProjectId,
    vercelTeamId: payload.settings.vercelTeamId,
    allowedUserIds: payload.settings.allowedUserIds,
    allowedGroupIds: payload.settings.allowedGroupIds,
    requireMention: payload.settings.requireMention,
    autoRecreateSandbox: payload.settings.autoRecreateSandbox,
    timeoutSeconds: payload.settings.timeoutSeconds,
    defaultModel: payload.settings.defaultModel,
  };
}

function isSameForm(left: SettingsFormValues, right: SettingsFormValues) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function countCsvValues(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean).length;
}

function formatUsageValue(snapshot: UsageSnapshot) {
  if (snapshot.source === 'ai-gateway') {
    return snapshot.creditsRemaining ?? snapshot.creditsUsed ?? 0;
  }

  return snapshot.cpuMs ?? 0;
}

function formatBytes(value: number | null) {
  if (typeof value !== 'number') {
    return 'No network sample';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSnapshotLabel(snapshotId: string | null | undefined) {
  if (!snapshotId) {
    return 'No snapshot';
  }

  if (snapshotId.length <= 16) {
    return snapshotId;
  }

  return `${snapshotId.slice(0, 8)}…${snapshotId.slice(-6)}`;
}

function formatRestoreSourceLabel(snapshotId: string | null | undefined) {
  if (!snapshotId) {
    return 'Clean boot';
  }

  return formatSnapshotLabel(snapshotId);
}

function formatGatewayLabel(url: string | null | undefined) {
  if (!url) {
    return 'Sandbox gateway appears here after boot.';
  }

  return url.replace(/^https?:\/\//, '');
}

export function DashboardShell({ initialData }: { initialData: DashboardPayload }) {
  const [data, setData] = useState(initialData);
  const [draft, setDraft] = useState(() => createFormValues(initialData));
  const [section, setSection] = useState<Section>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const savedFormValues = createFormValues(data);
  const isDirty = !isSameForm(draft, savedFormValues);
  const allowlistedUsers = countCsvValues(draft.allowedUserIds);
  const allowlistedGroups = countCsvValues(draft.allowedGroupIds);

  function applyPayload(payload: DashboardPayload, options?: { preserveDraft?: boolean }) {
    setData(payload);

    if (!options?.preserveDraft) {
      setDraft(createFormValues(payload));
    }
  }

  async function readDashboard(preserveDraft: boolean) {
    const response = await fetch('/api/overview', {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh dashboard (${response.status})`);
    }

    const payload = (await response.json()) as DashboardPayload;
    applyPayload(payload, { preserveDraft });
    return payload;
  }

  const refreshLiveData = useEffectEvent(async () => {
    try {
      await readDashboard(isDirty);
    } catch {}
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshLiveData();
      }
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [refreshLiveData]);

  function handleResult(result: DashboardActionResult, preserveDraft = false) {
    applyPayload(result.payload, { preserveDraft });
    setNotice(result.message);
  }

  function refreshDashboard() {
    startTransition(() => {
      void (async () => {
        try {
          const payload = await readDashboard(isDirty);
          setNotice(`Live snapshot updated at ${formatRelativeDate(payload.settings.updatedAt)}.`);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'Failed to refresh dashboard.');
        }
      })();
    });
  }

  function submitSettings() {
    startTransition(() => {
      void (async () => {
        try {
          const result = await saveSettingsAction(draft);
          handleResult(result);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'Failed to save settings.');
        }
      })();
    });
  }

  function executeSandboxAction(action: 'start' | 'stop' | 'sync') {
    startTransition(() => {
      void (async () => {
        try {
          const result = await runSandboxAction(action);
          handleResult(result, action === 'sync' && isDirty);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'Sandbox action failed.');
        }
      })();
    });
  }

  const heroFacts = [
    {
      label: 'Restore source',
      value: formatRestoreSourceLabel(data.sandbox?.sourceSnapshotId),
    },
    {
      label: 'Stored snapshot',
      value: formatSnapshotLabel(data.storedSnapshot?.snapshotId),
    },
    {
      label: 'Allowlist',
      value: `${allowlistedUsers} users / ${allowlistedGroups} groups`,
    },
    {
      label: 'Sandbox TTL',
      value: `${Math.max(draft.timeoutSeconds, 60)}s`,
    },
    {
      label: 'Last sync',
      value: formatRelativeDate(data.sandbox?.updatedAt ?? null),
    },
  ];

  const stats = [
    {
      label: 'Runtime state',
      value: data.sandbox?.status ?? 'idle',
      detail: data.sandbox?.runtime ?? 'No sandbox yet',
    },
    {
      label: 'Tracked sessions',
      value: String(data.sessions.length),
      detail: data.sessions[0] ? formatRelativeDate(data.sessions[0].updatedAt) : 'No session data',
    },
    {
      label: 'Recent commands',
      value: String(data.commands.length),
      detail: data.commands[0] ? formatRelativeDate(data.commands[0].startedAt) : 'No command log',
    },
    {
      label: 'Gateway model',
      value: draft.defaultModel.split('/').at(-1) ?? draft.defaultModel,
      detail: draft.requireMention ? 'Mention required in groups' : 'Messages accepted directly',
    },
  ];

  const runtimeDetails = [
    {
      label: 'Gateway URL',
      value: data.sandbox?.gatewayUrl ?? 'Not running',
    },
    {
      label: 'OpenClaw version',
      value: data.sandbox?.openClawVersion ?? 'Unknown version',
    },
    {
      label: 'Snapshot restore',
      value: formatRestoreSourceLabel(data.sandbox?.sourceSnapshotId),
    },
    {
      label: 'Stored snapshot',
      value: formatSnapshotLabel(data.storedSnapshot?.snapshotId),
    },
    {
      label: 'Expires',
      value: formatRelativeDate(data.sandbox?.expiresAt ?? null),
    },
    {
      label: 'CPU usage',
      value:
        typeof data.sandbox?.activeCpuUsageMs === 'number'
          ? `${data.sandbox.activeCpuUsageMs} ms`
          : 'No CPU sample',
    },
    {
      label: 'Network traffic',
      value: formatBytes(data.sandbox?.networkBytes ?? null),
    },
  ];

  return (
    <main className="dashboard-page">
      <div className="dashboard-backdrop" />

      <section className="dashboard-frame">
        <header className="hero-panel">
          <div className="hero-copy">
            <div className="hero-topline">
              <YokaiLogo className="hero-brand" subtitle="Sandbox control room" />
              <span className={`status-pill status-${data.sandbox?.status ?? 'idle'}`}>
                {data.sandbox?.status ?? 'idle'}
              </span>
            </div>

            <p className="eyebrow">OpenClaw sandbox operations</p>
            <h1>{data.settings.displayName}</h1>
            <p className="hero-text">
              Live control room for restore, rollover, gateway health, session telemetry, and the
              command trail behind every sandbox transition.
            </p>

            <div className="hero-highlights">
              {heroFacts.map((fact) => (
                <div className="hero-chip" key={fact.label}>
                  <span>{fact.label}</span>
                  <strong>{fact.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-side">
            <div className="status-card">
              <span className="status-label">Gateway endpoint</span>
              {data.sandbox?.gatewayUrl ? (
                <a
                  className="status-link"
                  href={data.sandbox.gatewayUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {formatGatewayLabel(data.sandbox.gatewayUrl)}
                </a>
              ) : (
                <p className="status-copy">{formatGatewayLabel(data.sandbox?.gatewayUrl)}</p>
              )}

              <div className="status-meta">
                <div>
                  <span>Sandbox ID</span>
                  <strong className="mono">{data.sandbox?.sandboxId ?? 'Not started'}</strong>
                </div>
                <div>
                  <span>Last snapshot</span>
                  <strong>
                    {formatRelativeDate(
                      data.storedSnapshot?.updatedAt ?? data.sandbox?.lastSnapshotAt ?? null,
                    )}
                  </strong>
                </div>
              </div>
            </div>

            <div className="action-row">
              <button
                className="secondary-button"
                disabled={isPending}
                onClick={refreshDashboard}
                type="button"
              >
                Refresh
              </button>
              <button
                className="secondary-button"
                disabled={isPending}
                onClick={() => executeSandboxAction('sync')}
                type="button"
              >
                Sync
              </button>
              <button
                className="primary-button"
                disabled={isPending}
                onClick={() => executeSandboxAction('start')}
                type="button"
              >
                Start sandbox
              </button>
              <form action={logoutAdminAction}>
                <button className="ghost-link" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>

        <div className="toolbar">
          <div className="segmented-control" aria-label="Dashboard sections" role="tablist">
            {(Object.keys(SECTION_LABELS) as Section[]).map((item) => (
              <button
                aria-selected={section === item}
                className="segment"
                data-active={section === item}
                key={item}
                onClick={() => setSection(item)}
                role="tab"
                type="button"
              >
                {SECTION_LABELS[item]}
              </button>
            ))}
          </div>

          <div className="toolbar-meta">
            <span>{isPending ? 'Working…' : 'Auto-refresh every 15s'}</span>
            <span>{isDirty ? 'Local edits preserved until save' : 'Settings in sync'}</span>
          </div>
        </div>

        {notice ? <div className="notice-banner">{notice}</div> : null}

        {section === 'overview' ? (
          <>
            <section className="stat-grid">
              {stats.map((stat) => (
                <article className="stat-panel" key={stat.label}>
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                  <small>{stat.detail}</small>
                </article>
              ))}
            </section>

            <section className="content-grid">
              <article className="surface-card runtime-card">
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">Runtime</p>
                    <h2>Sandbox envelope</h2>
                  </div>
                  <button
                    className="ghost-link"
                    disabled={isPending || !data.sandbox}
                    onClick={() => executeSandboxAction('stop')}
                    type="button"
                  >
                    Stop runtime
                  </button>
                </div>

                <dl className="data-grid">
                  {runtimeDetails.map((detail) => (
                    <div key={detail.label}>
                      <dt>{detail.label}</dt>
                      <dd>{detail.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="footer-meta">
                  <span>
                    Last sandbox update: {formatRelativeDate(data.sandbox?.updatedAt ?? null)}
                  </span>
                  {data.sandbox?.errorMessage ? <span>{data.sandbox.errorMessage}</span> : null}
                </div>
              </article>

              <article className="surface-card">
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">Usage</p>
                    <h2>Recent snapshots</h2>
                  </div>
                </div>

                <div className="stack-list">
                  {data.usage.length ? (
                    data.usage.slice(0, 6).map((snapshot) => (
                      <div className="stack-row" key={`${snapshot.source}-${snapshot.recordedAt}`}>
                        <div>
                          <strong>{snapshot.source}</strong>
                          <p>{formatRelativeDate(snapshot.recordedAt)}</p>
                        </div>
                        <div className="stack-row-meta">
                          <strong>{formatUsageValue(snapshot)}</strong>
                          <p>{snapshot.source === 'ai-gateway' ? 'credits left' : 'cpu ms'}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">No usage snapshots have been recorded yet.</p>
                  )}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {section === 'activity' ? (
          <section className="content-grid">
            <article className="surface-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Sessions</p>
                  <h2>Active and recent agents</h2>
                </div>
              </div>

              <div className="stack-list">
                {data.sessions.length ? (
                  data.sessions.map((session) => (
                    <div className="stack-row" key={session.sessionKey}>
                      <div>
                        <strong className="mono">{session.sessionKey}</strong>
                        <p>Agent {session.agentId}</p>
                      </div>
                      <div className="stack-row-meta">
                        <strong>{session.model ?? 'Unknown model'}</strong>
                        <p>
                          {typeof session.totalTokens === 'number'
                            ? `${session.totalTokens} total tokens`
                            : 'No token metrics'}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">Session history appears here after the next sync.</p>
                )}
              </div>
            </article>

            <article className="surface-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Command log</p>
                  <h2>Sandbox output</h2>
                </div>
              </div>

              <div className="command-list">
                {data.commands.length ? (
                  data.commands.map((command) => (
                    <article className="command-card" key={command.cmdId}>
                      <div className="command-header">
                        <div>
                          <strong className="mono">
                            {command.command} {command.args.join(' ')}
                          </strong>
                          <p>{formatRelativeDate(command.startedAt)}</p>
                        </div>
                        <span className={`status-pill status-${command.status}`}>
                          {command.status}
                        </span>
                      </div>

                      {command.stdout ? (
                        <pre className="terminal-output">{command.stdout}</pre>
                      ) : null}
                      {command.stderr ? (
                        <pre className="terminal-output terminal-error">{command.stderr}</pre>
                      ) : null}

                      <div className="footer-meta">
                        <span>Exit code: {command.exitCode ?? 'running'}</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-copy">
                    Tracked commands will appear here after the next action.
                  </p>
                )}
              </div>
            </article>
          </section>
        ) : null}

        {section === 'settings' ? (
          <section className="settings-layout">
            <article className="surface-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Access</p>
                  <h2>Telegram and runtime policy</h2>
                </div>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>Gateway name</span>
                  <input
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, displayName: event.target.value }))
                    }
                    value={draft.displayName}
                  />
                </label>

                <label className="field">
                  <span>Telegram bot token</span>
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        telegramBotToken: event.target.value,
                      }))
                    }
                    spellCheck={false}
                    type="password"
                    value={draft.telegramBotToken}
                  />
                </label>

                <label className="field">
                  <span>Allowed user IDs</span>
                  <input
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        allowedUserIds: event.target.value,
                      }))
                    }
                    value={draft.allowedUserIds}
                  />
                </label>

                <label className="field">
                  <span>Allowed group IDs</span>
                  <input
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        allowedGroupIds: event.target.value,
                      }))
                    }
                    value={draft.allowedGroupIds}
                  />
                </label>

                <label className="field">
                  <span>Sandbox timeout (seconds)</span>
                  <input
                    min={60}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        timeoutSeconds: Number(event.target.value) || current.timeoutSeconds,
                      }))
                    }
                    type="number"
                    value={draft.timeoutSeconds}
                  />
                </label>

                <label className="checkbox-field">
                  <input
                    checked={draft.autoRecreateSandbox}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        autoRecreateSandbox: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Auto recreate sandbox before TTL expires</span>
                </label>

                <label className="checkbox-field">
                  <input
                    checked={draft.requireMention}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        requireMention: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Require mentions in allowlisted groups</span>
                </label>
              </div>
            </article>

            <article className="surface-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Models and credentials</p>
                  <h2>Gateway configuration</h2>
                </div>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>Default model</span>
                  <input
                    list="available-models"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, defaultModel: event.target.value }))
                    }
                    value={draft.defaultModel}
                  />
                  <datalist id="available-models">
                    {data.availableModels.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>

                <label className="field">
                  <span>Vercel AI Gateway API key</span>
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        aiGatewayApiKey: event.target.value,
                      }))
                    }
                    spellCheck={false}
                    type="password"
                    value={draft.aiGatewayApiKey}
                  />
                </label>

                <label className="field">
                  <span>Vercel API token</span>
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        vercelApiToken: event.target.value,
                      }))
                    }
                    spellCheck={false}
                    type="password"
                    value={draft.vercelApiToken}
                  />
                </label>

                <label className="field">
                  <span>Project ID</span>
                  <input
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        vercelProjectId: event.target.value,
                      }))
                    }
                    value={draft.vercelProjectId}
                  />
                </label>

                <label className="field">
                  <span>Team ID</span>
                  <input
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        vercelTeamId: event.target.value,
                      }))
                    }
                    value={draft.vercelTeamId}
                  />
                </label>

                <label className="field">
                  <span>Gateway auth token</span>
                  <input
                    autoComplete="off"
                    disabled
                    type="password"
                    value={data.settings.gatewayAuthToken}
                  />
                </label>
              </div>

              <div className="settings-footer">
                <div>
                  <strong>{isDirty ? 'Unsaved changes' : 'Everything saved'}</strong>
                  <p>
                    Last saved {formatRelativeDate(data.settings.updatedAt)}. Secrets stay masked in
                    the UI and encrypted at rest.
                  </p>
                </div>
                <button
                  className="primary-button"
                  disabled={isPending}
                  onClick={submitSettings}
                  type="button"
                >
                  {isPending ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            </article>
          </section>
        ) : null}
      </section>
    </main>
  );
}
