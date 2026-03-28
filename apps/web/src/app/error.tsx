'use client';

export default function RouteError({
  error,
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
        <p className="state-copy">{error.message || 'Unexpected application error.'}</p>
        <button className="primary-button" onClick={reset} type="button">
          Try again
        </button>
      </div>
    </main>
  );
}
