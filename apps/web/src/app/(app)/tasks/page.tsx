import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TasksPage } from '@/features/task/presentation/tasks-page';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksRoute() {
  // useSearchParams (the prototype's ?variant=) needs a Suspense boundary.
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Suspense fallback={null}>
        <TasksPage />
      </Suspense>
    </main>
  );
}
