'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <h1>Couldn&apos;t load this page</h1>
        <p className="muted">
          This is usually a brief connection problem with the database. Your saved records are safe – nothing was changed.
        </p>
        {error.digest && <p className="muted small">Reference: {error.digest}</p>}
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => reset()}>Try again</button>
      </div>
    </div>
  );
}
