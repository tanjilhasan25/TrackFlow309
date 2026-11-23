import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceSnapshot,
  describeOperation,
  isShortConfirmationText,
  validateAndFilterOperations,
  type AiOperation,
} from './aiAgentOperations';
import type { ActionItem, ContextItem, InboxItem, ProjectItem, UserProfile } from '../types/gtd';

const baseProfile: UserProfile = {
  id: 'u_1',
  name: 'Tanbir',
  email: 'tanbir@example.com',
  role: 'individual',
  workspaceId: 'ws_1',
  preferences: { theme: 'light', dailyFocusLimit: 5, alarmsEnabled: true, onboardingCompleted: true },
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

const baseContexts: ContextItem[] = [
  {
    id: 'ctx_calls',
    userId: 'u_1',
    workspaceId: 'ws_1',
    memberIds: ['u_1'],
    name: '@Calls',
    position: 0,
    state: 'active',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
];

const baseProjects: ProjectItem[] = [
  {
    id: 'proj_personal',
    userId: 'u_1',
    workspaceId: 'ws_1',
    collaboratorIds: ['u_1'],
    name: 'Personal Goal',
    description: '',
    state: 'active',
    defaultContextId: 'ctx_calls',
    isShared: false,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    completedAt: null,
  },
  {
    id: 'proj_shared',
    userId: 'u_admin',
    workspaceId: 'ws_1',
    collaboratorIds: ['u_admin', 'u_1'],
    name: 'Team Launch',
    description: '',
    state: 'active',
    defaultContextId: 'ctx_calls',
    isShared: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    completedAt: null,
  },
];

const baseActions: ActionItem[] = [
  {
    id: 'act_shared_other',
    userId: 'u_admin',
    workspaceId: 'ws_1',
    projectId: 'proj_shared',
    projectCollaboratorIds: ['u_admin', 'u_1'],
    contextId: 'ctx_calls',
    description: 'Call client',
    status: 'active',
    dueDate: null,
    deferredUntil: null,
    starred: false,
    priorityScore: 50,
    tags: [],
    notes: '',
    alarmTime: null,
    estimatedMinutes: 15,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    completedAt: null,
  },
];

const baseInbox: InboxItem[] = [
  {
    id: 'inb_1',
    userId: 'u_1',
    workspaceId: 'ws_1',
    content: 'Book dentist',
    processed: false,
    disposition: 'pending',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
];

test('buildWorkspaceSnapshot computes summary metrics, sorted page <= 25, and filters processed inbox', () => {
  const snapshot = buildWorkspaceSnapshot({
    profile: baseProfile,
    workspaceId: 'ws_1',
    contexts: baseContexts,
    projects: baseProjects,
    actions: baseActions,
    inboxItems: [
      ...baseInbox,
      { ...baseInbox[0], id: 'inb_2', processed: true, disposition: 'trash' },
    ],
    now: new Date('2026-11-21T07:00:00Z'),
  });

  assert.equal(snapshot.unprocessedInbox.length, 1);
  assert.equal(snapshot.summary.activeActions, 1);
  assert.equal(snapshot.pagination.pageSize, 25);
  assert.equal(snapshot.projects.find((p) => p.id === 'proj_shared')?.activeActionCount, 1);
  assert.equal(snapshot.projects.find((p) => p.id === 'proj_personal')?.activeActionCount, 0);
});

test('validateAndFilterOperations allows tempId linking across context, project, and action', () => {
  const ops: AiOperation[] = [
    { type: 'CREATE_CONTEXT', data: { tempId: 'tmp_ctx_1', name: 'Errands' } },
    { type: 'CREATE_PROJECT', data: { tempId: 'tmp_proj_1', name: 'Q4 Launch', defaultContextId: 'tmp_ctx_1', isShared: false } },
    { type: 'CREATE_ACTION', data: { description: 'Buy domain', contextId: 'tmp_ctx_1', projectId: 'tmp_proj_1' } },
  ];

  const { validOps, blockedReasons } = validateAndFilterOperations(ops, {
    userId: 'u_1',
    role: 'individual',
    workspaceId: 'ws_1',
    contexts: baseContexts,
    projects: baseProjects,
    actions: baseActions,
    inboxItems: baseInbox,
  });

  assert.equal(blockedReasons.length, 0);
  assert.equal(validOps.length, 3);
  assert.equal((validOps[0] as Extract<AiOperation, { type: 'CREATE_CONTEXT' }>).data.name, '@Errands');
  assert.equal((validOps[2] as Extract<AiOperation, { type: 'CREATE_ACTION' }>).data.projectId, 'tmp_proj_1');

  const tempNames = new Map<string, string>();
  const labels = validOps.map((op) =>
    describeOperation(op, {
      contexts: baseContexts,
      projects: baseProjects,
      actions: baseActions,
      inboxItems: baseInbox,
      pendingTempNames: tempNames,
    }),
  );
  assert.match(labels[2], /@Errands/);
  assert.match(labels[2], /Q4 Launch/);
});

test('validateAndFilterOperations enforces collaborator restrictions & UTC timestamps', () => {
  const ops: AiOperation[] = [
    { type: 'CREATE_PROJECT', data: { name: 'Blocked', isShared: false } },
    { type: 'INVITE_COLLABORATOR', data: { invitedEmail: 'bob@example.com' } },
    {
      type: 'UPDATE_ACTION',
      data: {
        actionId: 'act_shared_other',
        patch: { description: 'Hacked title', starred: true, alarmTime: '2026-11-22T10:00:00Z' },
      },
    },
  ];

  const { validOps, blockedReasons } = validateAndFilterOperations(ops, {
    userId: 'u_1',
    role: 'collaborator',
    workspaceId: 'ws_1',
    contexts: baseContexts,
    projects: baseProjects,
    actions: baseActions,
    inboxItems: baseInbox,
  });

  assert.equal(blockedReasons.length, 2);
  assert.equal(validOps.length, 1);
  const updateOp = validOps[0] as Extract<AiOperation, { type: 'UPDATE_ACTION' }>;
  assert.equal(updateOp.data.patch.description, undefined);
  assert.equal(updateOp.data.patch.starred, true);
  assert.equal(updateOp.data.patch.alarmTime, '2026-11-22T10:00:00.000Z');
});

test('validateAndFilterOperations enforces admin vs individual review & inbox rules', () => {
  const ops: AiOperation[] = [
    { type: 'CLARIFY_INBOX_ITEM', data: { itemId: 'inb_1', disposition: 'trash' } },
    { type: 'COMPLETE_WEEKLY_REVIEW', data: { type: 'personal', notes: 'Done' } },
    { type: 'COMPLETE_WEEKLY_REVIEW', data: { type: 'team', notes: 'Team aligned' } },
    { type: 'INVITE_COLLABORATOR', data: { invitedEmail: 'teammate@example.com' } },
  ];

  const { validOps, blockedReasons } = validateAndFilterOperations(ops, {
    userId: 'u_admin',
    role: 'admin',
    workspaceId: 'ws_1',
    contexts: baseContexts,
    projects: baseProjects,
    actions: baseActions,
    inboxItems: baseInbox,
  });

  assert.equal(blockedReasons.length, 2);
  assert.equal(validOps.length, 2);
  assert.equal(validOps[0].type, 'COMPLETE_WEEKLY_REVIEW');
  assert.equal(validOps[1].type, 'INVITE_COLLABORATOR');
});

test('isShortConfirmationText recognizes English and Bengali confirmations', () => {
  assert.equal(isShortConfirmationText('yes'), true);
  assert.equal(isShortConfirmationText('হ্যাঁ'), true);
  assert.equal(isShortConfirmationText('করে দাও!'), true);
  assert.equal(isShortConfirmationText('Create project Q4 Launch'), false);
});
