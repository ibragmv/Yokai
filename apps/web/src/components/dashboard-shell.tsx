'use client';

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
} from 'react';

import { runSandboxAction, saveSettingsAction } from '@/app/actions';
import { logoutAdminAction } from '@/app/login/actions';
import { YokaiLogo } from '@/components/yokai-logo';
import type {
  CommandRecord,
  DashboardActionResult,
  DashboardPayload,
  SandboxRecord,
  SessionRecord,
  SettingsFormValues,
  UsageSnapshot,
} from '@/lib/types';
import { formatRelativeDate } from '@/lib/utils';

type Section = 'overview' | 'activity' | 'settings';
type RuntimeFact = {
  label: string;
  value: string;
};

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

function formatBytes(value: number | null) {
  if (typeof value !== 'number') {
    return 'No sample';
  }

  if (value < 1024) {
    return `${value.toLocaleString()} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024).toLocaleString()} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTokenCount(value: number | null) {
  return typeof value === 'number' ? value.toLocaleString() : 'No tokens';
}

function formatCpu(value: number | null) {
  return typeof value === 'number' ? `${value.toLocaleString()} ms` : 'No sample';
}

function formatRuntimeSample(
  liveValue: number | null | undefined,
  lastValue: number | null | undefined,
  sandboxStatus: SandboxRecord['status'] | undefined,
  formatter: (value: number | null) => string,
) {
  if (typeof liveValue === 'number') {
    return formatter(liveValue);
  }

  if (typeof lastValue === 'number') {
    return `${formatter(lastValue)} (last sample)`;
  }

  return sandboxStatus === 'running' ? 'Available after stop' : formatter(null);
}

function formatUsageValue(snapshot: UsageSnapshot) {
  const rawValue =
    snapshot.source === 'ai-gateway'
      ? (snapshot.creditsRemaining ?? snapshot.creditsUsed ?? 0)
      : (snapshot.cpuMs ?? 0);

  return rawValue.toLocaleString();
}

function formatSnapshotLabel(snapshotId: string | null | undefined) {
  if (!snapshotId) {
    return 'None';
  }

  if (snapshotId.length <= 16) {
    return snapshotId;
  }

  return `${snapshotId.slice(0, 8)}…${snapshotId.slice(-6)}`;
}

function formatGatewayLabel(url: string | null | undefined) {
  if (!url) {
    return 'Not available';
  }

  return url.replace(/^https?:\/\//, '');
}

function getSnapshotWindowMs(timeoutSeconds: number) {
  const timeoutMs = Math.max(timeoutSeconds, 60) * 1000;
  return Math.min(300_000, Math.max(90_000, Math.floor(timeoutMs * 0.3)));
}

function parseSectionHash(hash: string): Section | null {
  const value = hash.replace(/^#/, '');
  return value === 'overview' || value === 'activity' || value === 'settings' ? value : null;
}

function OverviewSection({
  gatewayUrl,
  runtimeFacts,
  usage,
}: {
  gatewayUrl: string | null;
  runtimeFacts: RuntimeFact[];
  usage: UsageSnapshot[];
}) {
  return (
    <section
      aria-labelledby="tab-overview"
      className="content-grid"
      id="panel-overview"
      role="tabpanel"
    >
      <article className="surface-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Runtime</p>
            <h2>Sandbox Envelope</h2>
          </div>
        </div>

        <dl className="data-grid">
          {runtimeFacts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>

        {gatewayUrl ? (
          <a className="inline-link" href={gatewayUrl} rel="noreferrer" target="_blank">
            Open Gateway
          </a>
        ) : null}
      </article>

      <article className="surface-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Usage</p>
            <h2>Recent Samples</h2>
          </div>
        </div>

        <div className="stack-list">
          {usage.length ? (
            usage.slice(0, 6).map((snapshot) => (
              <div className="stack-row" key={`${snapshot.source}-${snapshot.recordedAt}`}>
                <div className="stack-primary">
                  <strong>{snapshot.source === 'ai-gateway' ? 'AI Gateway' : 'Sandbox'}</strong>
                  <p>{formatRelativeDate(snapshot.recordedAt)}</p>
                </div>
                <div className="stack-row-meta">
                  <strong>{formatUsageValue(snapshot)}</strong>
                  <p>
                    {snapshot.source === 'ai-gateway'
                      ? 'credits remaining'
                      : `${formatBytes(snapshot.networkBytes)} network`}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-copy">No usage snapshots have been recorded yet.</p>
          )}
        </div>
      </article>
    </section>
  );
}

function ActivitySection({
  commands,
  sessions,
}: {
  commands: CommandRecord[];
  sessions: SessionRecord[];
}) {
  return (
    <section
      aria-labelledby="tab-activity"
      className="content-grid activity-grid"
      id="panel-activity"
      role="tabpanel"
    >
      <article className="surface-card session-panel">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Sessions</p>
            <h2>Tracked Agents</h2>
          </div>
          <span className="panel-note">{sessions.length.toLocaleString()} total</span>
        </div>

        <div className="section-scroll">
          <div className="stack-list">
            {sessions.length ? (
              sessions.map((session) => (
                <div className="stack-row" key={session.sessionKey}>
                  <div className="stack-primary">
                    <strong className="mono">{session.sessionKey}</strong>
                    <p>
                      Agent {session.agentId} • {formatRelativeDate(session.updatedAt)}
                    </p>
                  </div>
                  <div className="stack-row-meta">
                    <strong>{session.model ?? 'Unknown model'}</strong>
                    <p>{formatTokenCount(session.totalTokens)} total</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-copy">Run a sync to load the latest session list.</p>
            )}
          </div>
        </div>
      </article>

      <article className="surface-card command-panel">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Commands</p>
            <h2>Runtime Output</h2>
          </div>
          <span className="panel-note">{commands.length.toLocaleString()} entries</span>
        </div>

        <div className="section-scroll">
          <div className="command-list">
            {commands.length ? (
              commands.map((command) => (
                <article className="command-card" key={command.cmdId}>
                  <div className="command-header">
                    <div className="stack-primary">
                      <strong className="mono command-line">
                        {command.command} {command.args.join(' ')}
                      </strong>
                      <p className="command-timestamp">{formatRelativeDate(command.startedAt)}</p>
                    </div>
                    <span className={`status-pill status-${command.status}`}>{command.status}</span>
                  </div>

                  {command.stdout ? <pre className="terminal-output">{command.stdout}</pre> : null}
                  {command.stderr ? (
                    <pre className="terminal-output terminal-error">{command.stderr}</pre>
                  ) : null}

                  <div className="footer-meta">
                    <span>Exit code: {command.exitCode ?? 'running'}</span>
                  </div>
                </article>
              ))
            ) : (
              <p className="empty-copy">Tracked commands appear after the next action.</p>
            )}
          </div>
        </div>
      </article>
    </section>
  );
}

function SettingsSection({
  data,
  draft,
  isDirty,
  isPending,
  setDraft,
  submitSettings,
}: {
  data: DashboardPayload;
  draft: SettingsFormValues;
  isDirty: boolean;
  isPending: boolean;
  setDraft: Dispatch<SetStateAction<SettingsFormValues>>;
  submitSettings: () => void;
}) {
  return (
    <section
      aria-labelledby="tab-settings"
      className="settings-layout"
      id="panel-settings"
      role="tabpanel"
    >
      <article className="surface-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Access & Runtime</p>
            <h2>Control Room Settings</h2>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Gateway Name</span>
            <input
              autoComplete="off"
              name="displayName"
              onChange={(event) =>
                setDraft((current) => ({ ...current, displayName: event.target.value }))
              }
              placeholder="Yokai Control Room…"
              value={draft.displayName}
            />
          </label>

          <label className="field">
            <span>Allowed User IDs</span>
            <input
              autoComplete="off"
              name="allowedUserIds"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  allowedUserIds: event.target.value,
                }))
              }
              placeholder="123, 456…"
              spellCheck={false}
              value={draft.allowedUserIds}
            />
          </label>

          <label className="field">
            <span>Allowed Group IDs</span>
            <input
              autoComplete="off"
              name="allowedGroupIds"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  allowedGroupIds: event.target.value,
                }))
              }
              placeholder="-100123, -100456…"
              spellCheck={false}
              value={draft.allowedGroupIds}
            />
          </label>

          <label className="field">
            <span>Sandbox Timeout (Seconds)</span>
            <input
              inputMode="numeric"
              min={60}
              name="timeoutSeconds"
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
              name="autoRecreateSandbox"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  autoRecreateSandbox: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>Auto recreate the sandbox before TTL expires</span>
          </label>

          <label className="checkbox-field">
            <input
              checked={draft.requireMention}
              name="requireMention"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  requireMention: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>Require mentions inside allowlisted groups</span>
          </label>
        </div>
      </article>

      <article className="surface-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Gateway & Credentials</p>
            <h2>Secrets and Routing</h2>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Default Model</span>
            <input
              autoComplete="off"
              list="available-models"
              name="defaultModel"
              onChange={(event) =>
                setDraft((current) => ({ ...current, defaultModel: event.target.value }))
              }
              placeholder="vercel-ai-gateway/anthropic/…"
              spellCheck={false}
              value={draft.defaultModel}
            />
            <datalist id="available-models">
              {data.availableModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span>Telegram Bot Token</span>
            <input
              autoComplete="off"
              name="telegramBotToken"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  telegramBotToken: event.target.value,
                }))
              }
              placeholder="Leave masked value to keep current token…"
              spellCheck={false}
              type="password"
              value={draft.telegramBotToken}
            />
          </label>

          <label className="field">
            <span>Vercel AI Gateway API Key</span>
            <input
              autoComplete="off"
              name="aiGatewayApiKey"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  aiGatewayApiKey: event.target.value,
                }))
              }
              placeholder="Leave masked value to keep current key…"
              spellCheck={false}
              type="password"
              value={draft.aiGatewayApiKey}
            />
          </label>

          <label className="field">
            <span>Vercel API Token</span>
            <input
              autoComplete="off"
              name="vercelApiToken"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  vercelApiToken: event.target.value,
                }))
              }
              placeholder="Leave masked value to keep current token…"
              spellCheck={false}
              type="password"
              value={draft.vercelApiToken}
            />
          </label>

          <label className="field">
            <span>Project ID</span>
            <input
              autoComplete="off"
              name="vercelProjectId"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  vercelProjectId: event.target.value,
                }))
              }
              placeholder="prj_…"
              spellCheck={false}
              value={draft.vercelProjectId}
            />
          </label>

          <label className="field">
            <span>Team ID</span>
            <input
              autoComplete="off"
              name="vercelTeamId"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  vercelTeamId: event.target.value,
                }))
              }
              placeholder="team_…"
              spellCheck={false}
              value={draft.vercelTeamId}
            />
          </label>
        </div>

        <div className="settings-footer">
          <div>
            <strong>{isDirty ? 'Unsaved changes' : 'Settings saved'}</strong>
            <p>
              Last saved {formatRelativeDate(data.settings.updatedAt)}. Secrets remain masked in the
              UI and encrypted at rest.
            </p>
          </div>
          <button
            className="primary-button"
            disabled={isPending}
            onClick={submitSettings}
            type="button"
          >
            {isPending ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </article>
    </section>
  );
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
  const isRunning = data.sandbox?.status === 'running';
  const savedTimeoutSeconds = data.settings.timeoutSeconds;
  const nextSnapshotAt =
    isRunning && data.sandbox?.expiresAt
      ? data.sandbox.expiresAt - getSnapshotWindowMs(savedTimeoutSeconds)
      : null;
  const activeLease = data.operationLease;

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
    const initialSection = parseSectionHash(window.location.hash);
    if (initialSection) {
      setSection(initialSection);
    }

    const onHashChange = () => {
      const nextSection = parseSectionHash(window.location.hash);
      if (nextSection) {
        setSection(nextSection);
      }
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const nextHash = `#${section}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  }, [section]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshLiveData();
      }
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [refreshLiveData]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  function handleResult(result: DashboardActionResult, preserveDraft = false) {
    applyPayload(result.payload, { preserveDraft });
    setNotice(result.message);
  }

  function refreshDashboard() {
    startTransition(() => {
      void (async () => {
        try {
          await readDashboard(isDirty);
          setNotice('Live snapshot refreshed.');
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

  const summaryCards = [
    {
      label: 'Runtime State',
      value: data.sandbox?.status ?? 'idle',
      detail: data.sandbox?.sandboxId ?? 'No sandbox yet',
    },
    {
      label: 'Tracked Sessions',
      value: String(data.sessions.length),
      detail: data.sessions[0] ? formatRelativeDate(data.sessions[0].updatedAt) : 'No session data',
    },
    {
      label: 'Stored Snapshot',
      value: formatSnapshotLabel(data.storedSnapshot?.snapshotId),
      detail: formatRelativeDate(data.storedSnapshot?.updatedAt ?? null),
    },
    {
      label: 'Next Recovery Window',
      value: formatRelativeDate(nextSnapshotAt),
      detail: `${Math.max(savedTimeoutSeconds, 60).toLocaleString()} second TTL`,
    },
  ];
  const latestSandboxUsage = data.usage.find(
    (snapshot) =>
      snapshot.source === 'sandbox' &&
      (typeof snapshot.cpuMs === 'number' || typeof snapshot.networkBytes === 'number'),
  );

  const runtimeFacts: RuntimeFact[] = [
    {
      label: 'Gateway URL',
      value: data.sandbox?.gatewayUrl ?? 'Not running',
    },
    {
      label: 'OpenClaw Version',
      value: data.sandbox?.openClawVersion ?? 'Unknown',
    },
    {
      label: 'Restore Source',
      value: formatSnapshotLabel(data.sandbox?.sourceSnapshotId),
    },
    {
      label: 'Network',
      value: formatRuntimeSample(
        data.sandbox?.networkBytes,
        latestSandboxUsage?.networkBytes,
        data.sandbox?.status,
        formatBytes,
      ),
    },
    {
      label: 'CPU',
      value: formatRuntimeSample(
        data.sandbox?.activeCpuUsageMs,
        latestSandboxUsage?.cpuMs,
        data.sandbox?.status,
        formatCpu,
      ),
    },
    {
      label: 'Last Sync',
      value: formatRelativeDate(data.sandbox?.updatedAt ?? null),
    },
  ];

  return (
    <main className="dashboard-page">
      <a className="skip-link" href="#dashboard-content">
        Skip to dashboard content
      </a>

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

            <div className="hero-content">
              <p className="eyebrow">Single sandbox orchestration</p>
              <h1>{data.settings.displayName}</h1>
              <p className="hero-text">
                Watch the live OpenClaw runtime, recent agents, and the latest recovery snapshot
                from one control room.
              </p>
            </div>

            <dl className="hero-facts">
              <div>
                <dt>Allowlist</dt>
                <dd>
                  {allowlistedUsers} users • {allowlistedGroups} groups
                </dd>
              </div>
              <div>
                <dt>Gateway</dt>
                <dd>{formatGatewayLabel(data.sandbox?.gatewayUrl)}</dd>
              </div>
              <div>
                <dt>Lease</dt>
                <dd>
                  {activeLease
                    ? `${activeLease.type} until ${formatRelativeDate(activeLease.expiresAt)}`
                    : 'No background lock'}
                </dd>
              </div>
            </dl>
          </div>

          <aside className="hero-side">
            <div className="status-card">
              <p className="status-label">Current Sandbox</p>
              <strong className="status-linkish mono">
                {data.sandbox?.sandboxId ?? 'No sandbox allocated'}
              </strong>

              <div className="status-copy">
                {isRunning ? (
                  <>
                    <p>
                      Auto rollover {data.settings.autoRecreateSandbox ? 'enabled' : 'disabled'}.
                    </p>
                    <p>Next recovery window {formatRelativeDate(nextSnapshotAt)}.</p>
                  </>
                ) : (
                  <p>Start a sandbox to restore from the latest stored snapshot when available.</p>
                )}
              </div>

              <div className="status-meta">
                <div>
                  <span>Stored Snapshot</span>
                  <strong>{formatSnapshotLabel(data.storedSnapshot?.snapshotId)}</strong>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>{formatRelativeDate(data.sandbox?.updatedAt ?? null)}</strong>
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
                disabled={isPending || !data.sandbox}
                onClick={() => executeSandboxAction('sync')}
                type="button"
              >
                Sync Sessions
              </button>
              <button
                className={isRunning ? 'secondary-button' : 'primary-button'}
                disabled={isPending}
                onClick={() => executeSandboxAction(isRunning ? 'stop' : 'start')}
                type="button"
              >
                {isRunning ? 'Stop Sandbox' : 'Start Sandbox'}
              </button>
              <form action={logoutAdminAction}>
                <button className="ghost-link" type="submit">
                  Sign Out
                </button>
              </form>
            </div>
          </aside>
        </header>

        <nav aria-label="Dashboard sections" className="section-nav">
          {(Object.keys(SECTION_LABELS) as Section[]).map((item) => (
            <button
              aria-controls={`panel-${item}`}
              aria-selected={section === item}
              className="segment"
              data-active={section === item}
              id={`tab-${item}`}
              key={item}
              onClick={() => setSection(item)}
              role="tab"
              type="button"
            >
              {SECTION_LABELS[item]}
            </button>
          ))}

          <div className="toolbar-meta">
            <span>{isPending ? 'Working…' : 'Auto refresh every 15 seconds'}</span>
            <span>{isDirty ? 'Local edits stay in place until save' : 'Settings are in sync'}</span>
          </div>
        </nav>

        {notice ? (
          <output aria-live="polite" className="notice-banner">
            {notice}
          </output>
        ) : null}

        {data.sandbox?.errorMessage ? (
          <div className="alert-banner" role="alert">
            {data.sandbox.errorMessage}
          </div>
        ) : null}

        <div className="stat-grid">
          {summaryCards.map((card) => (
            <article className="stat-panel" key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </article>
          ))}
        </div>

        <div className="section-stack" id="dashboard-content">
          {section === 'overview' ? (
            <OverviewSection
              gatewayUrl={data.sandbox?.gatewayUrl ?? null}
              runtimeFacts={runtimeFacts}
              usage={data.usage}
            />
          ) : null}

          {section === 'activity' ? (
            <ActivitySection commands={data.commands} sessions={data.sessions} />
          ) : null}

          {section === 'settings' ? (
            <SettingsSection
              data={data}
              draft={draft}
              isDirty={isDirty}
              isPending={isPending}
              setDraft={setDraft}
              submitSettings={submitSettings}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}
