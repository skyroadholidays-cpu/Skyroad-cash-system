import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="auth">
      <div className="auth-card">
        <h1>Not found</h1>
        <p className="muted">That page or record doesn&apos;t exist. It may have been deleted on another device.</p>
        <Link href="/" className="btn btn-primary" style={{ marginTop: 16 }}>Back to dashboard</Link>
      </div>
    </div>
  );
}
