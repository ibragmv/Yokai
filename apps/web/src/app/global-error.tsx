'use client';

export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="state-screen">
          <div className="state-card">
            <p className="eyebrow">Global failure</p>
            <h1>Yokai is unavailable</h1>
            <p className="state-copy">
              A protected server-side operation failed. Sensitive details were intentionally hidden.
            </p>
            <button className="primary-button" onClick={reset} type="button">
              Retry application
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
