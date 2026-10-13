import type { ReactNode } from 'react';
import { Logo } from '@/shared/ui/logo';

const LINKS = [
  { href: '/profile', label: 'Profile' },
  { href: '/account', label: 'Security' },
  { href: '/workspace', label: 'Workspace' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/projects', label: 'Projects' },
  { href: '/settings', label: 'Settings' },
];

/** Navigation shared by the signed-in pages. */
export function AppNav(): ReactNode {
  return (
    <nav aria-label="Account" className="border-b border-slate-200">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <a href="/tasks" aria-label="Shanflow home">
          <Logo />
        </a>
        <ul className="flex flex-wrap gap-4 text-sm font-medium">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="underline-offset-4 hover:underline">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
