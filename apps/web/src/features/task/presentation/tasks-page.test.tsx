import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '@/features/auth/shared/session-store';
import { installFakeTaskApi, makeTask, ME, OTHER, PROJECT, WS, type FakeApi } from '@/test-support/fake-task-api';
import { TasksPage } from './tasks-page';

let api: FakeApi;
/** jsdom has no layout: say whether the screen counts as wide (the board is the default there). */
const screenIsWide = (matches: boolean) => vi.stubGlobal('matchMedia', () => ({ matches }));
const start = (options: Parameters<typeof installFakeTaskApi>[0] = {}) => {
  api = installFakeTaskApi(options);
  return render(<TasksPage />);
};
const column = (name: string) => screen.getByRole('region', { name });
const cardOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement;
const titlesIn = (name: string) =>
  within(column(name))
    .queryAllByRole('listitem')
    .map((li) => within(li).getByRole('heading').textContent);
const requests = (pattern: RegExp) => api.requests.filter((r) => pattern.test(r.line));

beforeEach(() => {
  window.localStorage.clear();
  screenIsWide(true);
  setSession({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user: { id: ME, email: 'me@example.invalid', displayName: 'Me', emailVerified: true } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearSession();
});

describe('the board', () => {
  it('shows one column per status with the Inbox tasks in rank order', async () => {
    start({
      tasks: [
        makeTask({ title: 'Second', position: '2048' }),
        makeTask({ title: 'First', position: '1024' }),
        makeTask({ title: 'Started', status: 'IN_PROGRESS' }),
        makeTask({ title: 'Finished', status: 'DONE' }),
        makeTask({ title: 'In a project', projectId: PROJECT }),
      ],
    });
    expect(await screen.findByText('First')).toBeTruthy();
    expect(titlesIn('To do')).toEqual(['First', 'Second']);
    expect(titlesIn('In progress')).toEqual(['Started']);
    expect(titlesIn('Done')).toEqual(['Finished']);
    expect(titlesIn('Cancelled')).toEqual([]);
    expect(screen.queryByText('In a project')).toBeNull(); // another scope
  });

  it('switches to a project and shows only its tasks', async () => {
    start({ tasks: [makeTask({ title: 'Inbox one' }), makeTask({ title: 'Project one', projectId: PROJECT })] });
    await screen.findByText('Inbox one');
    await userEvent.selectOptions(screen.getByLabelText('Project'), PROJECT);
    expect(await screen.findByText('Project one')).toBeTruthy();
    expect(screen.queryByText('Inbox one')).toBeNull();
    expect(requests(/tasks\?projectId=/).map((r) => r.line.match(/projectId=([^&]+)/)![1])).toEqual(['inbox', PROJECT]);
  });

  it('shows priority, an overdue deadline and the assignee on a card', async () => {
    start({ tasks: [makeTask({ title: 'Urgent', priority: 'URGENT', dueAt: '2020-01-01T00:00:00.000Z', assigneeId: OTHER })] });
    const card = within(await screen.findByText('Urgent').then(() => cardOf('Urgent')));
    expect(card.getByText('Urgent priority')).toBeTruthy();
    expect(card.getByText(/Overdue/)).toBeTruthy();
    expect(card.getByText('Olive', { selector: 'span' })).toBeTruthy(); // the label on the card, not the menu option
  });

  it('shows a friendly error when the board cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<TasksPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('creating', () => {
  it('adds a task to the end of To do in the current scope', async () => {
    start({ tasks: [makeTask({ title: 'Existing' })] });
    await screen.findByText('Existing');
    await userEvent.type(screen.getByLabelText('New task title'), 'Buy milk');
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText('Buy milk')).toBeTruthy();
    expect(titlesIn('To do')).toEqual(['Existing', 'Buy milk']);
    expect(requests(/^POST .*\/tasks$/)[0]!.body).toEqual({ title: 'Buy milk', projectId: null });
    expect((screen.getByLabelText('New task title') as HTMLInputElement).value).toBe('');
  });

  it('creates inside the selected project', async () => {
    start();
    await userEvent.selectOptions(await screen.findByLabelText('Project'), PROJECT);
    await userEvent.type(screen.getByLabelText('New task title'), 'In project');
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
    await screen.findByText('In project');
    expect(requests(/^POST .*\/tasks$/)[0]!.body).toEqual({ title: 'In project', projectId: PROJECT });
  });

  it('refuses an empty title without calling the server', async () => {
    start();
    await userEvent.click(await screen.findByRole('button', { name: 'Add task' }));
    expect(await screen.findByText(/title/i)).toBeTruthy();
    expect(requests(/^POST/)).toHaveLength(0);
  });
});

describe('changing a task', () => {
  it('moves a card to another column with the status menu, in one request', async () => {
    start({ tasks: [makeTask({ title: 'Work' })] });
    await screen.findByText('Work');
    await userEvent.selectOptions(within(cardOf('Work')).getByLabelText('Status of Work'), 'DONE');
    await waitFor(() => expect(titlesIn('Done')).toEqual(['Work']));
    expect(titlesIn('To do')).toEqual([]);
    expect(requests(/\/move$/)[0]!.body).toEqual({ version: 1, status: 'DONE' });
  });

  it('moves a card up and down inside its column by naming a neighbour', async () => {
    const [a, b, c] = [makeTask({ title: 'A', position: '1024' }), makeTask({ title: 'B', position: '2048' }), makeTask({ title: 'C', position: '3072' })];
    start({ tasks: [a, b, c] });
    await screen.findByText('B');
    await userEvent.click(within(cardOf('B')).getByRole('button', { name: 'Move up' }));
    await waitFor(() => expect(titlesIn('To do')).toEqual(['B', 'A', 'C']));
    expect(requests(/\/move$/)[0]!.body).toEqual({ version: 1, beforeId: a.id });

    await userEvent.click(within(cardOf('B')).getByRole('button', { name: 'Move down' }));
    await waitFor(() => expect(titlesIn('To do')).toEqual(['A', 'B', 'C']));
    expect(requests(/\/move$/)[1]!.body).toEqual({ version: 2, afterId: a.id });
  });

  it('cannot move the first card up or the last card down', async () => {
    start({ tasks: [makeTask({ title: 'A', position: '1024' }), makeTask({ title: 'B', position: '2048' })] });
    await screen.findByText('A');
    expect((within(cardOf('A')).getByRole('button', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(cardOf('B')).getByRole('button', { name: 'Move down' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits the title, priority and deadline with the version it saw', async () => {
    start({ tasks: [makeTask({ title: 'Old' })] });
    await screen.findByText('Old');
    await userEvent.click(within(cardOf('Old')).getByRole('button', { name: 'Edit' }));
    const title = screen.getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'New title');
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'HIGH');
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '2030-01-02T03:04' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('New title')).toBeTruthy();
    const body = requests(/^PATCH/)[0]!.body as { version: number; title: string; priority: string; dueAt: string };
    expect(body).toMatchObject({ version: 1, title: 'New title', priority: 'HIGH' });
    expect(new Date(body.dueAt).getFullYear()).toBe(2030);
  });

  it('clears a deadline by emptying the field', async () => {
    start({ tasks: [makeTask({ title: 'Due', dueAt: '2030-01-02T03:04:00.000Z' })] });
    await screen.findByText('Due');
    await userEvent.click(within(cardOf('Due')).getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(requests(/^PATCH/)).toHaveLength(1));
    expect(requests(/^PATCH/)[0]!.body).toMatchObject({ dueAt: null });
  });

  it('does not call the server when nothing in the editor changed', async () => {
    start({ tasks: [makeTask({ title: 'Same' })] });
    await screen.findByText('Same');
    await userEvent.click(within(cardOf('Same')).getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(requests(/^PATCH/)).toHaveLength(0);
    expect(screen.queryByLabelText('Title')).toBeNull(); // the editor closed
  });

  it('assigns and unassigns with the assignee menu', async () => {
    start({ tasks: [makeTask({ title: 'Share' })] });
    await screen.findByText('Share');
    await userEvent.selectOptions(within(cardOf('Share')).getByLabelText('Assignee of Share'), OTHER);
    await waitFor(() => expect(within(cardOf('Share')).getByText('Olive', { selector: 'span' })).toBeTruthy());
    expect(requests(/\/assignee$/)[0]!.body).toEqual({ assigneeId: OTHER, version: 1 });
    await userEvent.selectOptions(within(cardOf('Share')).getByLabelText('Assignee of Share'), '');
    await waitFor(() => expect(requests(/\/assignee$/)).toHaveLength(2));
    expect(requests(/\/assignee$/)[1]!.body).toEqual({ assigneeId: null, version: 2 });
  });

  it('offers a plain member only themselves (and nobody) as assignee', async () => {
    start({ role: 'MEMBER', tasks: [makeTask({ title: 'Mine?' })] });
    await screen.findByText('Mine?');
    const menu = within(cardOf('Mine?')).getByLabelText('Assignee of Mine?');
    const usable = within(menu)
      .getAllByRole('option')
      .filter((option) => !(option as HTMLOptionElement).disabled)
      .map((option) => option.textContent);
    expect(usable).toEqual(['Unassigned', 'Me']);
  });
});

describe('deleting and restoring', () => {
  it('deletes softly and lists the task in the trash, where it can be restored', async () => {
    start({ tasks: [makeTask({ title: 'Gone' }), makeTask({ title: 'Stays' })] });
    await screen.findByText('Gone');
    await userEvent.click(within(cardOf('Gone')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Gone')).toBeNull());
    expect(requests(/^DELETE .*\?version=1$/)).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Trash' }));
    expect(await screen.findByText('Gone')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.queryByText('Gone')).toBeNull()); // left the trash
    expect(requests(/\/restore$/)[0]!.body).toEqual({ version: 2 });

    await userEvent.click(screen.getByRole('button', { name: 'Back to tasks' }));
    expect(await screen.findByText('Gone')).toBeTruthy();
    expect(titlesIn('To do')).toEqual(['Stays', 'Gone']);
  });

  it('says so when the trash is empty', async () => {
    start();
    await userEvent.click(await screen.findByRole('button', { name: 'Trash' }));
    expect(await screen.findByText(/trash is empty/i)).toBeTruthy();
  });
});

describe('when something goes wrong', () => {
  it('explains a conflict and reloads the board with the latest data', async () => {
    start({ tasks: [makeTask({ title: 'Contested' })] });
    await screen.findByText('Contested');
    api.failNext(/\/move$/, 409, 'TASK_VERSION_CONFLICT');
    const loadsBefore = requests(/tasks\?projectId=/).length;
    await userEvent.selectOptions(within(cardOf('Contested')).getByLabelText('Status of Contested'), 'DONE');
    expect(await screen.findByText(/Someone else changed this task/)).toBeTruthy();
    await waitFor(() => expect(requests(/tasks\?projectId=/).length).toBe(loadsBefore + 1));
    expect(titlesIn('To do')).toEqual(['Contested']); // nothing moved on screen
  });

  it('explains a refused change without reloading', async () => {
    start({ tasks: [makeTask({ title: 'Frozen' })] });
    await screen.findByText('Frozen');
    api.failNext(/\/move$/, 409, 'PROJECT_ARCHIVED');
    const loadsBefore = requests(/tasks\?projectId=/).length;
    await userEvent.selectOptions(within(cardOf('Frozen')).getByLabelText('Status of Frozen'), 'DONE');
    expect(await screen.findByText(/archived/i)).toBeTruthy();
    expect(requests(/tasks\?projectId=/).length).toBe(loadsBefore);
  });
});

describe('dragging a card', () => {
  const drag = (title: string, column: HTMLElement, dropAt: number) => {
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(k: string, v: string) {
        this.data[k] = v;
      },
      getData(k: string) {
        return this.data[k] ?? '';
      },
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.dragStart(cardOf(title), { dataTransfer });
    fireEvent.dragOver(column, { dataTransfer, clientY: dropAt });
    fireEvent.drop(column, { dataTransfer, clientY: dropAt });
  };

  it('drops into another column and asks for exactly that status, at the end of the column', async () => {
    start({ tasks: [makeTask({ title: 'Card' })] });
    await screen.findByText('Card');
    drag('Card', column('In progress'), 0);
    await waitFor(() => expect(titlesIn('In progress')).toEqual(['Card']));
    expect(requests(/\/move$/)[0]!.body).toEqual({ version: 1, status: 'IN_PROGRESS' });
  });

  it('ignores a drop of something that is not a card of this board', async () => {
    start({ tasks: [makeTask({ title: 'Card' })] });
    await screen.findByText('Card');
    const dataTransfer = { getData: () => 'not-a-task-id', setData: () => undefined, effectAllowed: '', dropEffect: '' };
    fireEvent.drop(column('Done'), { dataTransfer });
    expect(requests(/\/move$/)).toHaveLength(0);
  });
});

describe('choosing a view', () => {
  const pick = (name: string) => userEvent.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name }));

  it('starts on the board and can switch to the list and to focus, keeping the same tasks', async () => {
    start({ tasks: [makeTask({ title: 'Alpha', priority: 'URGENT' }), makeTask({ title: 'Beta', status: 'DONE' })] });
    await screen.findByText('Alpha');
    expect(screen.getByRole('button', { name: 'Board', pressed: true })).toBeTruthy();

    await pick('List');
    expect(screen.getByRole('checkbox', { name: 'Complete Beta' })).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();

    await pick('Focus');
    expect(screen.getByRole('region', { name: 'Up next' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Details' })).getByRole('heading', { name: 'Alpha' })).toBeTruthy();
    expect(requests(/tasks\?projectId=/)).toHaveLength(1); // switching views never reloads
  });

  it('starts on the list on a narrow screen', async () => {
    screenIsWide(false);
    start({ tasks: [makeTask({ title: 'Alpha' })] });
    await screen.findByText('Alpha');
    expect(screen.getByRole('button', { name: 'List', pressed: true })).toBeTruthy();
  });

  it('remembers the choice for next time', async () => {
    start({ tasks: [makeTask({ title: 'Alpha' })] });
    await screen.findByText('Alpha');
    await pick('Focus');
    cleanup();
    vi.unstubAllGlobals();
    screenIsWide(true);
    start({ tasks: [makeTask({ title: 'Alpha' })] });
    await screen.findByRole('region', { name: 'Up next' });
    expect(screen.getByRole('button', { name: 'Focus', pressed: true })).toBeTruthy();
  });

  it('completes a task from the list with its checkbox, and reopens it', async () => {
    start({ tasks: [makeTask({ title: 'Check me' })] });
    await screen.findByText('Check me');
    await pick('List');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Check me' }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Complete Check me' }) as HTMLInputElement).checked).toBe(true));
    expect(requests(/\/move$/)[0]!.body).toEqual({ version: 1, status: 'DONE' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Check me' }));
    await waitFor(() => expect(requests(/\/move$/)).toHaveLength(2));
    expect(requests(/\/move$/)[1]!.body).toEqual({ version: 2, status: 'TODO' });
  });

  it('puts the most pressing task first in focus and finishes it with one button', async () => {
    start({
      tasks: [
        makeTask({ title: 'Later', priority: 'LOW' }),
        makeTask({ title: 'Overdue', priority: 'LOW', dueAt: '2020-01-01T00:00:00.000Z' }),
        makeTask({ title: 'Urgent', priority: 'URGENT' }),
      ],
    });
    await screen.findByText('Later');
    await pick('Focus');
    const order = within(screen.getByRole('region', { name: 'Up next' }))
      .getAllByRole('listitem')
      .map((li) => within(li).getByText(/^(Later|Overdue|Urgent)$/).textContent);
    expect(order).toEqual(['Overdue', 'Urgent', 'Later']); // overdue first, then priority
    await userEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
    await waitFor(() => expect(requests(/\/move$/)).toHaveLength(1));
    expect(requests(/\/move$/)[0]!.body).toMatchObject({ status: 'DONE' });
  });

  it('hides the view switch while the trash is open', async () => {
    start();
    await userEvent.click(await screen.findByRole('button', { name: 'Trash' }));
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back to tasks' }));
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
  });
});
