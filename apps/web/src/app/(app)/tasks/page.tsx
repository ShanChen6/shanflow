import type { Metadata } from 'next';
import { TasksPage } from '@/features/task/presentation/tasks-page';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksRoute() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <TasksPage />
    </main>
  );
}
