import { addDays, subDays } from 'date-fns';
import type {
  ActionItem,
  ContextItem,
  InboxItem,
  ProjectItem,
  ReviewRecord,
  UserProfile,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
} from '../types/gtd';

export interface DemoStoreState {
  profile: UserProfile;
  workspaces: Workspace[];
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  contexts: ContextItem[];
  projects: ProjectItem[];
  actions: ActionItem[];
  inboxItems: InboxItem[];
  reviews: ReviewRecord[];
}

export function createDemoSeedState(): DemoStoreState {
  const now = new Date();
  const isoNow = now.toISOString();
  const yesterday = subDays(now, 1).toISOString();
  const twoDaysAgo = subDays(now, 2).toISOString();
  const fiveDaysAgo = subDays(now, 5).toISOString();
  const tomorrow = addDays(now, 1).toISOString();
  const inThreeDays = addDays(now, 3).toISOString();
  const upcomingAlarm = new Date(now.getTime() + 45 * 60 * 1000).toISOString();

  const demoUserId = 'demo_user_elena';
  const personalWsId = 'ws_demo_personal';
  const teamWsId = 'ws_demo_studio';

  const profile: UserProfile = {
    id: demoUserId,
    name: 'Elena Vance',
    email: 'elena.vance@trackflow.app',
    role: 'individual',
    workspaceId: personalWsId,
    preferences: {
      theme: 'light',
      dailyFocusLimit: 5,
      alarmsEnabled: true,
      onboardingCompleted: true,
    },
    createdAt: fiveDaysAgo,
    updatedAt: isoNow,
  };

  const workspaces: Workspace[] = [
    {
      id: personalWsId,
      name: 'Personal Flow',
      adminId: demoUserId,
      memberIds: [demoUserId],
      createdAt: fiveDaysAgo,
      updatedAt: isoNow,
    },
    {
      id: teamWsId,
      name: 'Northstar Product Team',
      adminId: demoUserId,
      memberIds: [demoUserId, 'demo_collab_marcus', 'demo_collab_priya'],
      createdAt: fiveDaysAgo,
      updatedAt: isoNow,
    },
  ];

  const members: WorkspaceMember[] = [
    {
      id: demoUserId,
      workspaceId: teamWsId,
      userId: demoUserId,
      adminId: demoUserId,
      name: 'Elena Vance',
      email: 'elena.vance@trackflow.app',
      role: 'admin',
      inviteId: '',
      joinedAt: fiveDaysAgo,
    },
    {
      id: 'demo_collab_marcus',
      workspaceId: teamWsId,
      userId: 'demo_collab_marcus',
      adminId: demoUserId,
      name: 'Marcus Chen',
      email: 'marcus.chen@northstar.io',
      role: 'collaborator',
      inviteId: 'inv_marcus',
      joinedAt: twoDaysAgo,
    },
    {
      id: 'demo_collab_priya',
      workspaceId: teamWsId,
      userId: 'demo_collab_priya',
      adminId: demoUserId,
      name: 'Priya Patel',
      email: 'priya.patel@northstar.io',
      role: 'collaborator',
      inviteId: 'inv_priya',
      joinedAt: yesterday,
    },
  ];

  const invites: WorkspaceInvite[] = [
    {
      id: 'inv_pending_sam',
      workspaceId: teamWsId,
      workspaceName: 'Northstar Product Team',
      adminId: demoUserId,
      invitedEmail: 'sam.rivera@northstar.io',
      role: 'collaborator',
      status: 'pending',
      createdAt: yesterday,
    },
  ];

  const contexts: ContextItem[] = [
    {
      id: 'ctx_computer',
      userId: demoUserId,
      workspaceId: personalWsId,
      memberIds: [demoUserId, 'demo_collab_marcus', 'demo_collab_priya'],
      name: '@Computer',
      position: 0,
      state: 'active',
      createdAt: fiveDaysAgo,
      updatedAt: fiveDaysAgo,
    },
    {
      id: 'ctx_deep_work',
      userId: demoUserId,
      workspaceId: personalWsId,
      memberIds: [demoUserId, 'demo_collab_marcus', 'demo_collab_priya'],
      name: '@Deep Work',
      position: 1,
      state: 'active',
      createdAt: fiveDaysAgo,
      updatedAt: fiveDaysAgo,
    },
    {
      id: 'ctx_calls',
      userId: demoUserId,
      workspaceId: personalWsId,
      memberIds: [demoUserId, 'demo_collab_marcus', 'demo_collab_priya'],
      name: '@Calls',
      position: 2,
      state: 'active',
      createdAt: fiveDaysAgo,
      updatedAt: fiveDaysAgo,
    },
    {
      id: 'ctx_errands',
      userId: demoUserId,
      workspaceId: personalWsId,
      memberIds: [demoUserId],
      name: '@Errands',
      position: 3,
      state: 'active',
      createdAt: fiveDaysAgo,
      updatedAt: fiveDaysAgo,
    },
  ];

  const projects: ProjectItem[] = [
    {
      id: 'proj_q4_release',
      userId: demoUserId,
      workspaceId: teamWsId,
      collaboratorIds: [demoUserId, 'demo_collab_marcus', 'demo_collab_priya'],
      name: 'Q4 Design System Audit',
      description: 'Consolidate typography tokens, accessibility contrast checks, and component docs across web views.',
      state: 'active',
      defaultContextId: 'ctx_deep_work',
      isShared: true,
      createdAt: fiveDaysAgo,
      updatedAt: yesterday,
      completedAt: null,
    },
    {
      id: 'proj_client_retainer',
      userId: demoUserId,
      workspaceId: personalWsId,
      collaboratorIds: [demoUserId],
      name: 'Annual Studio Tax Prep',
      description: 'Gather receipts, reconcile Q3 invoices, and send summary package to accountant.',
      state: 'active',
      defaultContextId: 'ctx_computer',
      isShared: false,
      createdAt: fiveDaysAgo,
      updatedAt: twoDaysAgo,
      completedAt: null,
    },
    {
      id: 'proj_home_studio',
      userId: demoUserId,
      workspaceId: personalWsId,
      collaboratorIds: [demoUserId],
      name: 'Acoustic Desk Setup',
      description: 'Mount monitor arm and install felt wall panels in home office.',
      state: 'active',
      defaultContextId: 'ctx_errands',
      isShared: false,
      createdAt: fiveDaysAgo,
      updatedAt: fiveDaysAgo,
      completedAt: null,
    },
  ];

  const actions: ActionItem[] = [
    {
      id: 'act_1',
      userId: demoUserId,
      workspaceId: teamWsId,
      projectId: 'proj_q4_release',
      projectCollaboratorIds: [demoUserId, 'demo_collab_marcus', 'demo_collab_priya'],
      contextId: 'ctx_deep_work',
      description: 'Review contrast ratios for dark mode surface tokens',
      status: 'active',
      dueDate: tomorrow,
      deferredUntil: null,
      starred: true,
      priorityScore: 88,
      tags: ['design', 'a11y'],
      notes: 'Verify 4.5:1 body text contrast across slate-900 and slate-950 panels.',
      alarmTime: upcomingAlarm,
      estimatedMinutes: 35,
      createdAt: twoDaysAgo,
      updatedAt: yesterday,
      completedAt: null,
    },
    {
      id: 'act_2',
      userId: demoUserId,
      workspaceId: personalWsId,
      projectId: 'proj_client_retainer',
      projectCollaboratorIds: [demoUserId],
      contextId: 'ctx_computer',
      description: 'Export October Stripe & invoice ledger CSV for accountant',
      status: 'active',
      dueDate: yesterday,
      deferredUntil: null,
      starred: true,
      priorityScore: 95,
      tags: ['finance'],
      notes: 'Overdue from yesterday — prioritize before 4 PM.',
      alarmTime: null,
      estimatedMinutes: 20,
      createdAt: fiveDaysAgo,
      updatedAt: yesterday,
      completedAt: null,
    },
    {
      id: 'act_3',
      userId: demoUserId,
      workspaceId: teamWsId,
      projectId: 'proj_q4_release',
      projectCollaboratorIds: [demoUserId, 'demo_collab_marcus', 'demo_collab_priya'],
      contextId: 'ctx_calls',
      description: 'Call Marcus to align on weekly component handoff checklist',
      status: 'active',
      dueDate: inThreeDays,
      deferredUntil: null,
      starred: false,
      priorityScore: 52,
      tags: ['sync'],
      notes: 'Confirm release freeze date.',
      alarmTime: null,
      estimatedMinutes: 15,
      createdAt: yesterday,
      updatedAt: yesterday,
      completedAt: null,
    },
    {
      id: 'act_4',
      userId: demoUserId,
      workspaceId: personalWsId,
      projectId: 'proj_client_retainer',
      projectCollaboratorIds: [demoUserId],
      contextId: 'ctx_computer',
      description: 'Confirm quarterly filing receipt with CPA office',
      status: 'deferred',
      dueDate: null,
      deferredUntil: inThreeDays,
      starred: false,
      priorityScore: 20,
      tags: ['tickler'],
      notes: 'Deferred until bank statement posts.',
      alarmTime: null,
      estimatedMinutes: 10,
      createdAt: twoDaysAgo,
      updatedAt: yesterday,
      completedAt: null,
    },
    {
      id: 'act_5',
      userId: demoUserId,
      workspaceId: teamWsId,
      projectId: 'proj_q4_release',
      projectCollaboratorIds: [demoUserId, 'demo_collab_marcus', 'demo_collab_priya'],
      contextId: 'ctx_computer',
      description: 'Audit legacy button padding across settings modals',
      status: 'completed',
      dueDate: twoDaysAgo,
      deferredUntil: null,
      starred: false,
      priorityScore: 0,
      tags: ['ui'],
      notes: 'Completed during Tuesday sprint.',
      alarmTime: null,
      estimatedMinutes: 25,
      createdAt: fiveDaysAgo,
      updatedAt: twoDaysAgo,
      completedAt: twoDaysAgo,
    },
  ];

  // Note: proj_home_studio intentionally has 0 active actions so Stalled Projects detection works out of the box!

  const inboxItems: InboxItem[] = [
    {
      id: 'inb_1',
      userId: demoUserId,
      workspaceId: personalWsId,
      content: 'Draft onboarding checklist for new design collaborators',
      processed: false,
      disposition: 'pending',
      createdAt: yesterday,
      updatedAt: yesterday,
    },
    {
      id: 'inb_2',
      userId: demoUserId,
      workspaceId: personalWsId,
      content: 'Order ergonomic keyboard wrist rest for desk',
      processed: false,
      disposition: 'pending',
      createdAt: isoNow,
      updatedAt: isoNow,
    },
  ];

  const reviews: ReviewRecord[] = [
    {
      id: 'rev_1',
      userId: demoUserId,
      workspaceId: personalWsId,
      memberIds: [demoUserId],
      type: 'personal',
      notes: 'Cleared 14 open loops and aligned next week around the Q4 Design System Audit.',
      completedAt: fiveDaysAgo,
    },
  ];

  return {
    profile,
    workspaces,
    members,
    invites,
    contexts,
    projects,
    actions,
    inboxItems,
    reviews,
  };
}
