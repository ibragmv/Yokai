'use client';

export default function RouteError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="state-screen">
      <div className="state-card">
        <p className="eyebrow">Runtime issue</p>
        <h1>Dashboard crashed</h1>
        <p className="state-copy">
          A protected server-side operation failed. Sensitive details were intentionally hidden.
        </p>
        <button className="primary-button" onClick={reset} type="button">
          Try again
        </button>
      </div>
    </main>
  );
}
