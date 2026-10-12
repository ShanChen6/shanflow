import type { ReactNode } from 'react';
import { RequireAuth } from '@/features/auth/shared/require-auth';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
