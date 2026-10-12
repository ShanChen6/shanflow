import type { ReactNode } from 'react';

const LINKS = [
  { href: '/profile', label: 'Profile' },
  { href: '/account', label: 'Security' },
];

/** Navigation shared by the signed-in pages. */
export function AppNav(): ReactNode {
  return (
    <nav aria-label="Account" className="border-b border-slate-200">
      <ul className="mx-auto flex max-w-md gap-4 px-6 py-3 text-sm font-medium">
        {LINKS.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="underline-offset-4 hover:underline">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
