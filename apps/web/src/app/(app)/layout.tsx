import type { ReactNode } from 'react';
import { RequireAuth } from '@/features/auth/shared/require-auth';
import { AppNav } from './app-nav';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppNav />
      {children}
    </RequireAuth>
  );
}
