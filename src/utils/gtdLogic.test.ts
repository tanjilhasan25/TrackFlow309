import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePriorityScore,
  sortFocusActions,
  findStalledProjects,
  partitionWeeklyReview,
  getRolePermissions,
  getDueUrgency,
} from './gtdLogic';
import type { ActionItem, InboxItem, ProjectItem } from '../types/gtd';

const NOW = new Date('2026-11-20T12:00:00.000Z');

function makeAction(overrides: Partial<ActionItem>): ActionItem {
  return {
    id: 'act_1',
    userId: 'u_1',
    workspaceId: 'ws_1',
    projectId: '',
    projectCollaboratorIds: [],
    contextId: 'ctx_1',
    description: 'Sample action',
    status: 'active',
    dueDate: null,
    deferredUntil: null,
    starred: false,
    priorityScore: 25,
    tags: [],
    notes: '',
    alarmTime: null,
    estimatedMinutes: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectItem>): ProjectItem {
  return {
    id: 'proj_1',
    userId: 'u_1',
    workspaceId: 'ws_1',
    collaboratorIds: [],
    name: 'Project Alpha',
    description: 'Desc',
    state: 'active',
    defaultContextId: 'ctx_1',
    isShared: false,
    createdAt: '2026-11-15T10:00:00.000Z',
    updatedAt: '2026-11-15T10:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

test('calculatePriorityScore boosts starred, overdue, and alarmed actions', () => {
  const overdueStarred = makeAction({
    starred: true,
    dueDate: '2026-11-19T10:00:00.000Z',
    alarmTime: '2026-11-20T14:00:00.000Z',
  });
  const plain = makeAction({ id: 'act_2' });
  const deferredFuture = makeAction({ id: 'act_3', deferredUntil: '2026-11-25T10:00:00.000Z' });

  assert.equal(calculatePriorityScore(overdueStarred, NOW), 100);
  assert.equal(calculatePriorityScore(plain, NOW), 25);
  assert.equal(calculatePriorityScore(deferredFuture, NOW), 0);
});

test('sortFocusActions places highest priority and overdue items first', () => {
  const a1 = makeAction({ id: 'low', priorityScore: 20 });
  const a2 = makeAction({ id: 'high', starred: true, dueDate: '2026-11-19T09:00:00.000Z', priorityScore: 90 });
  const a3 = makeAction({ id: 'mid', dueDate: '2026-11-21T09:00:00.000Z', priorityScore: 53 });

  const sorted = sortFocusActions([a1, a3, a2], NOW);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['high', 'mid', 'low'],
  );
});

test('findStalledProjects detects active projects with zero active actions', () => {
  const projects = [
    makeProject({ id: 'p_active', state: 'active' }),
    makeProject({ id: 'p_stalled', state: 'active' }),
    makeProject({ id: 'p_hidden', state: 'hidden' }),
  ];
  const actions = [
    makeAction({ id: 'a1', projectId: 'p_active', status: 'active' }),
    makeAction({ id: 'a2', projectId: 'p_stalled', status: 'completed' }),
  ];

  const stalled = findStalledProjects(projects, actions);
  assert.deepEqual(
    stalled.map((p) => p.id),
    ['p_stalled'],
  );
});

test('partitionWeeklyReview separates overdue, stalled, tickler, and open loops', () => {
  const projects = [makeProject({ id: 'p_stalled', state: 'active' })];
  const actions = [
    makeAction({ id: 'a_overdue', status: 'active', dueDate: '2026-11-18T00:00:00.000Z' }),
    makeAction({ id: 'a_tickler', status: 'deferred', deferredUntil: '2026-11-23T09:00:00.000Z' }),
    makeAction({ id: 'a_far', status: 'deferred', deferredUntil: '2026-12-25T09:00:00.000Z' }),
  ];
  const inbox: InboxItem[] = [
    {
      id: 'inb_1',
      userId: 'u_1',
      workspaceId: 'ws_1',
      content: 'Unprocessed thought',
      processed: false,
      disposition: 'pending',
      createdAt: '2026-11-20T09:00:00.000Z',
      updatedAt: '2026-11-20T09:00:00.000Z',
    },
    {
      id: 'inb_2',
      userId: 'u_1',
      workspaceId: 'ws_1',
      content: 'Done thought',
      processed: true,
      disposition: 'action',
      createdAt: '2026-11-19T09:00:00.000Z',
      updatedAt: '2026-11-19T09:00:00.000Z',
    },
  ];

  const buckets = partitionWeeklyReview(actions, projects, inbox, NOW);
  assert.deepEqual(buckets.overdueActions.map((a) => a.id), ['a_overdue']);
  assert.deepEqual(buckets.stalledProjects.map((p) => p.id), ['p_stalled']);
  assert.deepEqual(buckets.ticklerArrivingSoon.map((a) => a.id), ['a_tickler']);
  assert.deepEqual(buckets.openLoops.map((i) => i.id), ['inb_1']);
});

test('getRolePermissions enforces strict 3-role boundaries', () => {
  const individual = getRolePermissions('individual');
  const collaborator = getRolePermissions('collaborator');
  const admin = getRolePermissions('admin');

  assert.equal(individual.canProcessInbox, true);
  assert.equal(individual.canRunTeamReview, false);

  assert.equal(collaborator.canProcessInbox, true);
  assert.equal(collaborator.canDeleteProjects, false);
  assert.equal(collaborator.canInviteCollaborators, false);

  assert.equal(admin.canInviteCollaborators, true);
  assert.equal(admin.canRunTeamReview, true);
  assert.equal(admin.canManageSharedProjects, true);
});

test('getDueUrgency classifies overdue, soon, upcoming, and none', () => {
  assert.equal(getDueUrgency('2026-11-19T12:00:00.000Z', NOW), 'overdue');
  assert.equal(getDueUrgency('2026-11-21T12:00:00.000Z', NOW), 'soon');
  assert.equal(getDueUrgency('2026-11-28T12:00:00.000Z', NOW), 'upcoming');
  assert.equal(getDueUrgency(null, NOW), 'none');
});

test('sortFocusActions follows exact PriorityScore -> Overdue -> DueDate -> Alarm -> Starred -> createdAt precedence', () => {
  const overdueEqualScore = makeAction({
    id: 'a_overdue',
    priorityScore: 60,
    dueDate: '2026-11-20T11:00:00.000Z',
  });
  const futureSameScore = makeAction({
    id: 'b_future_early',
    priorityScore: 60,
    dueDate: '2026-11-20T14:00:00.000Z',
    starred: true,
  });
  const sameDueEarlyAlarm = makeAction({
    id: 'c_same_due_alarm',
    priorityScore: 60,
    dueDate: '2026-11-20T14:00:00.000Z',
    alarmTime: '2026-11-20T13:00:00.000Z',
    starred: false,
  });
  const noDueStarred = makeAction({
    id: 'd_nodue_starred',
    priorityScore: 60,
    dueDate: null,
    starred: true,
    createdAt: '2026-11-19T10:00:00.000Z',
  });
  const noDueUnstarred = makeAction({
    id: 'e_nodue_plain',
    priorityScore: 60,
    dueDate: null,
    starred: false,
    createdAt: '2026-11-18T10:00:00.000Z',
  });

  const sorted = sortFocusActions(
    [noDueUnstarred, futureSameScore, noDueStarred, sameDueEarlyAlarm, overdueEqualScore],
    NOW,
  );
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['a_overdue', 'c_same_due_alarm', 'b_future_early', 'd_nodue_starred', 'e_nodue_plain'],
  );
});

test('findStalledProjects never marks On Hold (hidden) or completed projects as stalled', () => {
  const projects = [
    makeProject({ id: 'p_active_empty', state: 'active' }),
    makeProject({ id: 'p_on_hold_empty', state: 'hidden' }),
    makeProject({ id: 'p_completed_empty', state: 'completed' }),
  ];
  const stalled = findStalledProjects(projects, []);
  assert.deepEqual(
    stalled.map((p) => p.id),
    ['p_active_empty'],
  );
});

