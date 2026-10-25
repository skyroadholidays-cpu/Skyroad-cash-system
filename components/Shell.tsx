'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { href: '/transactions', label: 'Transactions', icon: 'M4 6h16M4 12h16M4 18h10' },
  { href: '/bookings', label: 'Bookings', icon: 'M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 3v4M16 3v4' },
  { href: '/collect', label: 'To Collect', icon: 'M12 3v12M7 10l5 5 5-5M4 21h16' },
  { href: '/pay', label: 'To Pay', icon: 'M12 15V3M7 8l5-5 5 5M4 21h16' },
  { href: '/cash', label: 'Cash & Locker', icon: 'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
  { href: '/reports', label: 'Reports', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { href: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
];

export function Logo({ small }: { small?: boolean }) {
  return (
    <span className={`logo${small ? ' logo-sm' : ''}`}>
      <svg viewBox="0 0 40 40" width={small ? 28 : 34} height={small ? 28 : 34} aria-hidden="true">
        <rect width="40" height="40" rx="10" fill="var(--brand)" />
        <circle cx="27" cy="13" r="5" fill="var(--sun)" />
        <path d="M8 32 L17 18 L20 22 L24 16 L32 32 Z" fill="#fff" opacity=".18" />
        <path d="M18 34 C 19 26, 21 22, 26 19" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M23 34 C 23.5 28, 25 24, 28 21" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeDasharray="2 2.4" opacity=".8" />
      </svg>
      <span className="logo-text">
        <strong>Skyroad</strong>
        <span>Holidays · Cash</span>
      </span>
    </span>
  );
}

export function Shell({ children, username, logout }: { children: ReactNode; username: string; logout: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <div className={`shell${open ? ' nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <Link href="/" className="sidebar-brand"><Logo /></Link>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`nav-link${active(n.href) ? ' active' : ''}`}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon} /></svg>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <span className="avatar">{username.slice(0, 1).toUpperCase()}</span>
            <span>{username}</span>
          </div>
          <form action={logout}>
            <button className="btn btn-link" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="menu-btn" type="button" aria-label="Open menu" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="topbar-logo"><Logo small /></span>
          <form action="/search" className="search" role="search">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input name="q" type="search" placeholder="Search client, booking, supplier, txn ID…" aria-label="Search" />
          </form>
          <Link href="/transactions/new" className="btn btn-primary btn-new">
            <span aria-hidden>+</span><span className="hide-sm"> New entry</span>
          </Link>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
