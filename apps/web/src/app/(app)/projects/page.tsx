import type { Metadata } from 'next';
import { ProjectsView } from '@/features/project/list/projects-view';

export const metadata: Metadata = { title: 'Projects' };

export default function ProjectsPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <ProjectsView />
    </main>
  );
}
