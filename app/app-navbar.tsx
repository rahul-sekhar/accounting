'use client';

import Link from 'next/link';
import { WalletCards } from 'lucide-react';

export default function AppNavbar({
  active,
  navigationLocked = false,
}: {
  active: 'transactions' | 'accounts' | 'categories' | 'monthly';
  navigationLocked?: boolean;
}) {
  const links = [
    { id: 'transactions', label: 'Transactions', href: '/' },
    { id: 'monthly', label: 'Monthly expenses', href: '/?view=monthly' },
    { id: 'accounts', label: 'Accounts', href: '/accounts' },
    { id: 'categories', label: 'Categories', href: '/categories' },
  ];
  return (
    <header className="topbar">
      <Link
        className="brand"
        href="/"
        aria-disabled={navigationLocked}
        onClick={(event) => {
          if (navigationLocked) event.preventDefault();
        }}
      >
        <WalletCards size={26} /> account<span>view</span>
      </Link>
      <div className="top-right">
        <nav className="app-nav" aria-label="Main navigation">
          {links.map((link) => (
            <Link
              key={link.id}
              className="text-button"
              href={link.href}
              aria-current={active === link.id ? 'page' : undefined}
              aria-disabled={navigationLocked}
              onClick={(event) => {
                if (navigationLocked) event.preventDefault();
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {/* oxlint-disable-next-line next/no-html-link-for-pages -- auth requires a top-level navigation */}
        <a
          className="signout"
          href="/cdn-cgi/access/logout"
          target="_top"
        >
          Sign out
        </a>
      </div>
    </header>
  );
}
