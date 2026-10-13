import type { ReactNode } from 'react';
import { RequireAuth } from '@/features/auth/shared/require-auth';
import { ThemeSync } from '@/features/user/settings/theme-sync';
import { AppNav } from './app-nav';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <ThemeSync />
      <AppNav />
      {children}
    </RequireAuth>
  );
}
