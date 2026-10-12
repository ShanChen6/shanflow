import type { Metadata } from 'next';
import { WorkspaceView } from '@/features/workspace/overview/workspace-view';

export const metadata: Metadata = { title: 'Workspace' };

export default function WorkspacePage() {
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <WorkspaceView />
    </main>
  );
}
