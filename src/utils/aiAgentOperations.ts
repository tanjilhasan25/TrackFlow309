import type {
  ActionItem,
  ActionStatus,
  ContextItem,
  InboxItem,
  ProjectItem,
  ProjectState,
  ReviewType,
  UserProfile,
  UserRole,
} from '../types/gtd.ts';
import {
  BOUNDARIES,
  clampString,
  clampTags,
  findStalledProjects,
  getRolePermissions,
  normalizeToUtcIso,
  parseUtcMs,
  sortFocusActions,
} from './gtdLogic.ts';

// AI is STRICTLY PROPOSE-ONLY. It never returns 'execute'.
export type AiChatStage = 'answer' | 'clarify' | 'propose';

export type AiOperation =
  | {
      type: 'CAPTURE_INBOX';
      data: {
        content: string;
      };
    }
  | {
      type: 'CLARIFY_INBOX_ITEM';
      data: {
        itemId: string;
        disposition: 'trash' | 'someday' | 'action' | 'project';
        description?: string;
        contextId?: string;
        projectId?: string;
        projectName?: string;
        projectDescription?: string;
        firstActionDescription?: string;
        dueDate?: string | null;
        alarmTime?: string | null;
      };
    }
  | {
      type: 'CREATE_CONTEXT';
      data: {
        tempId?: string;
        name: string;
        sharedInWorkspace?: boolean;
      };
    }
  | {
      type: 'CREATE_PROJECT';
      data: {
        tempId?: string;
        name: string;
        description?: string;
        defaultContextId?: string;
        isShared?: boolean;
      };
    }
  | {
      type: 'TRANSITION_PROJECT_STATE';
      data: {
        projectId: string;
        nextState: ProjectState;
      };
    }
  | {
      type: 'DELETE_PROJECT';
      data: {
        projectId: string;
      };
    }
  | {
      type: 'CREATE_ACTION';
      data: {
        description: string;
        contextId: string;
        projectId?: string;
        dueDate?: string | null;
        deferredUntil?: string | null;
        alarmTime?: string | null;
        starred?: boolean;
        priorityScore?: number;
        estimatedMinutes?: number | null;
        tags?: string[];
        notes?: string;
        status?: 'active' | 'deferred';
      };
    }
  | {
      type: 'UPDATE_ACTION';
      data: {
        actionId: string;
        patch: Partial<{
          description: string;
          contextId: string;
          projectId: string;
          dueDate: string | null;
          deferredUntil: string | null;
          alarmTime: string | null;
          starred: boolean;
          priorityScore: number;
          estimatedMinutes: number | null;
          tags: string[];
          notes: string;
          status: ActionStatus;
        }>;
      };
    }
  | {
      type: 'COMPLETE_ACTION';
      data: {
        actionId: string;
      };
    }
  | {
      type: 'SET_ALARM';
      data: {
        actionId: string;
        alarmTime: string;
      };
    }
  | {
      type: 'COMPLETE_WEEKLY_REVIEW';
      data: {
        type: ReviewType;
        notes: string;
      };
    }
  | {
      type: 'INVITE_COLLABORATOR';
      data: {
        workspaceId?: string;
        invitedEmail: string;
      };
    };

export interface OperationPreview {
  opIndex: number;
  opType: AiOperation['type'];
  targetId?: string;
  label: string;
  changes: Array<{
    field: string;
    currentValue: string;
    proposedValue: string;
  }>;
}

export interface AiChatResponsePayload {
  stage: AiChatStage;
  assistantReply: string;
  clarificationQuestions: string[];
  proposedSummary: string[];
  previews?: OperationPreview[];
  operations: AiOperation[];
}

export interface WorkspaceSummaryMetrics {
  totalActions: number;
  activeActions: number;
  deferredActions: number;
  completedActions: number;
  overdueActions: number;
  dueWithin3HoursActions: number;
  starredActiveActions: number;
  stalledProjects: number;
  onHoldProjects: number;
  unprocessedInbox: number;
}

export interface WorkspaceContextSnapshot {
  currentTimeIso: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    workspaceId: string;
  };
  summary: WorkspaceSummaryMetrics;
  pagination: {
    page: number;
    pageSize: number;
    returnedActions: number;
    totalOpenActions: number;
    hasMore: boolean;
  };
  contexts: Array<{
    id: string;
    name: string;
    state: ContextItem['state'];
  }>;
  projects: Array<{
    id: string;
    name: string;
    state: ProjectState;
    isShared: boolean;
    defaultContextId: string;
    activeActionCount: number;
    isStalled: boolean;
  }>;
  activeActions: Array<{
    id: string;
    description: string;
    contextId: string;
    projectId: string;
    status: ActionStatus;
    dueDate: string | null;
    deferredUntil: string | null;
    alarmTime: string | null;
    starred: boolean;
    priorityScore: number;
    estimatedMinutes: number | null;
  }>;
  unprocessedInbox: Array<{
    id: string;
    content: string;
    createdAt: string;
  }>;
}

export function buildWorkspaceSnapshot(params: {
  profile: UserProfile;
  workspaceId: string;
  contexts: ContextItem[];
  projects: ProjectItem[];
  actions: ActionItem[];
  inboxItems: InboxItem[];
  now?: Date;
  page?: number;
  pageSize?: number;
}): WorkspaceContextSnapshot {
  const {
    profile,
    workspaceId,
    contexts,
    projects,
    actions,
    inboxItems,
    now = new Date(),
    page = 0,
    pageSize = 25,
  } = params;

  const safePageSize = Math.max(1, Math.min(25, Math.floor(pageSize)));
  const safePage = Math.max(0, Math.floor(page));
  const nowMs = now.getTime();
  const threeHoursMs = nowMs + 3 * 60 * 60 * 1000;

  const activeCountByProject = new Map<string, number>();
  let activeCount = 0;
  let deferredCount = 0;
  let completedCount = 0;
  let overdueCount = 0;
  let dueWithin3HoursCount = 0;
  let starredActiveCount = 0;

  const openActions: ActionItem[] = [];
  for (const act of actions) {
    if (act.status === 'active') {
      activeCount++;
      openActions.push(act);
      if (act.projectId) {
        activeCountByProject.set(act.projectId, (activeCountByProject.get(act.projectId) ?? 0) + 1);
      }
      if (act.starred) starredActiveCount++;
      const dueMs = parseUtcMs(act.dueDate);
      if (dueMs !== null) {
        if (dueMs < nowMs) overdueCount++;
        else if (dueMs <= threeHoursMs) dueWithin3HoursCount++;
      }
    } else if (act.status === 'deferred') {
      deferredCount++;
      openActions.push(act);
    } else {
      completedCount++;
    }
  }

  // Deterministic sort BEFORE slicing so AI sees the true prioritized window
  const sortedOpen = sortFocusActions(openActions, now);
  const start = safePage * safePageSize;
  const pagedActions = sortedOpen.slice(start, start + safePageSize);
  const stalledList = findStalledProjects(projects, actions);
  const stalledIds = new Set(stalledList.map((p) => p.id));
  const pendingInbox = inboxItems.filter((i) => !i.processed);

  return {
    currentTimeIso: now.toISOString(),
    user: {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      workspaceId,
    },
    summary: {
      totalActions: actions.length,
      activeActions: activeCount,
      deferredActions: deferredCount,
      completedActions: completedCount,
      overdueActions: overdueCount,
      dueWithin3HoursActions: dueWithin3HoursCount,
      starredActiveActions: starredActiveCount,
      stalledProjects: stalledList.length,
      onHoldProjects: projects.filter((p) => p.state === 'hidden').length,
      unprocessedInbox: pendingInbox.length,
    },
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      returnedActions: pagedActions.length,
      totalOpenActions: sortedOpen.length,
      hasMore: start + safePageSize < sortedOpen.length,
    },
    contexts: contexts.slice(0, 30).map((c) => ({
      id: c.id,
      name: c.name,
      state: c.state,
    })),
    projects: projects.slice(0, 30).map((p) => ({
      id: p.id,
      name: p.name,
      state: p.state,
      isShared: p.isShared,
      defaultContextId: p.defaultContextId,
      activeActionCount: activeCountByProject.get(p.id) ?? 0,
      isStalled: stalledIds.has(p.id),
    })),
    activeActions: pagedActions.map((a) => ({
      id: a.id,
      description: a.description,
      contextId: a.contextId,
      projectId: a.projectId,
      status: a.status,
      dueDate: a.dueDate,
      deferredUntil: a.deferredUntil,
      alarmTime: a.alarmTime,
      starred: a.starred,
      priorityScore: a.priorityScore,
      estimatedMinutes: a.estimatedMinutes,
    })),
    unprocessedInbox: pendingInbox.slice(0, 20).map((i) => ({
      id: i.id,
      content: i.content,
      createdAt: i.createdAt,
    })),
  };
}

export interface ValidationStateRef {
  userId: string;
  role: UserRole;
  workspaceId: string;
  contexts: ContextItem[];
  projects: ProjectItem[];
  actions: ActionItem[];
  inboxItems: InboxItem[];
}

const COLLABORATOR_PATCH_KEYS = new Set([
  'status',
  'starred',
  'priorityScore',
  'alarmTime',
  'dueDate',
  'contextId',
]);

export function validateAndFilterOperations(
  operations: AiOperation[],
  state: ValidationStateRef,
): { validOps: AiOperation[]; blockedReasons: string[] } {
  const perms = getRolePermissions(state.role);
  const validOps: AiOperation[] = [];
  const blockedReasons: string[] = [];

  const knownContextIds = new Set(state.contexts.map((c) => c.id));
  const knownProjectIds = new Set(state.projects.map((p) => p.id));
  const actionMap = new Map(state.actions.map((a) => [a.id, a]));
  const pendingInboxIds = new Set(state.inboxItems.filter((i) => !i.processed).map((i) => i.id));
  const fallbackContextId = state.contexts.find((c) => c.state === 'active')?.id ?? state.contexts[0]?.id ?? '';

  for (const op of operations) {
    switch (op.type) {
      case 'CAPTURE_INBOX': {
        const content = clampString(op.data.content || '', BOUNDARIES.INBOX_CONTENT_MAX);
        if (!content) {
          blockedReasons.push('Skipped empty Inbox capture.');
          break;
        }
        validOps.push({ type: 'CAPTURE_INBOX', data: { content } });
        break;
      }

      case 'CLARIFY_INBOX_ITEM': {
        if (!perms.canProcessInbox) {
          blockedReasons.push(`Role '${state.role}' cannot process personal Inbox items.`);
          break;
        }
        if (!pendingInboxIds.has(op.data.itemId)) {
          blockedReasons.push(`Inbox item '${op.data.itemId}' was not found or is already processed.`);
          break;
        }
        if (op.data.disposition === 'project' && !perms.canCreatePersonalProjects) {
          blockedReasons.push(`Role '${state.role}' cannot create new Projects during Inbox clarification.`);
          break;
        }
        const resolvedCtx =
          op.data.contextId && knownContextIds.has(op.data.contextId) ? op.data.contextId : fallbackContextId;
        const resolvedProj =
          op.data.projectId && knownProjectIds.has(op.data.projectId) ? op.data.projectId : '';
        validOps.push({
          type: 'CLARIFY_INBOX_ITEM',
          data: {
            ...op.data,
            contextId: resolvedCtx,
            projectId: resolvedProj,
            dueDate: normalizeToUtcIso(op.data.dueDate),
            alarmTime: normalizeToUtcIso(op.data.alarmTime),
            description: op.data.description ? clampString(op.data.description, BOUNDARIES.ACTION_DESC_MAX) : undefined,
            projectName: op.data.projectName ? clampString(op.data.projectName, BOUNDARIES.PROJECT_NAME_MAX) : undefined,
            projectDescription: op.data.projectDescription
              ? clampString(op.data.projectDescription, BOUNDARIES.PROJECT_DESC_MAX)
              : undefined,
            firstActionDescription: op.data.firstActionDescription
              ? clampString(op.data.firstActionDescription, BOUNDARIES.ACTION_DESC_MAX)
              : undefined,
          },
        });
        break;
      }

      case 'CREATE_CONTEXT': {
        const name = clampString(op.data.name || '', BOUNDARIES.CONTEXT_NAME_MAX);
        if (!name) {
          blockedReasons.push('Skipped Context creation with empty name.');
          break;
        }
        const formattedName = name.startsWith('@') ? name : `@${name}`;
        if (op.data.tempId) {
          knownContextIds.add(op.data.tempId);
        }
        validOps.push({
          type: 'CREATE_CONTEXT',
          data: {
            tempId: op.data.tempId,
            name: formattedName,
            sharedInWorkspace: Boolean(op.data.sharedInWorkspace && state.role === 'admin'),
          },
        });
        break;
      }

      case 'CREATE_PROJECT': {
        const wantsShared = Boolean(op.data.isShared);
        if (wantsShared && !perms.canManageSharedProjects) {
          blockedReasons.push(`Role '${state.role}' cannot create shared workspace projects.`);
          break;
        }
        if (!wantsShared && !perms.canCreatePersonalProjects) {
          blockedReasons.push(`Role '${state.role}' cannot create personal projects.`);
          break;
        }
        const name = clampString(op.data.name || '', BOUNDARIES.PROJECT_NAME_MAX);
        if (!name) {
          blockedReasons.push('Skipped Project creation with empty name.');
          break;
        }
        if (op.data.tempId) {
          knownProjectIds.add(op.data.tempId);
        }
        const defaultCtx =
          op.data.defaultContextId && knownContextIds.has(op.data.defaultContextId)
            ? op.data.defaultContextId
            : fallbackContextId;
        validOps.push({
          type: 'CREATE_PROJECT',
          data: {
            tempId: op.data.tempId,
            name,
            description: clampString(op.data.description || '', BOUNDARIES.PROJECT_DESC_MAX),
            defaultContextId: defaultCtx,
            isShared: wantsShared,
          },
        });
        break;
      }

      case 'TRANSITION_PROJECT_STATE': {
        const proj = state.projects.find((p) => p.id === op.data.projectId);
        if (!proj) {
          blockedReasons.push(`Project '${op.data.projectId}' was not found.`);
          break;
        }
        if (state.role === 'collaborator') {
          blockedReasons.push(`Role 'collaborator' cannot change project lifecycle states.`);
          break;
        }
        if (proj.isShared && !perms.canManageSharedProjects) {
          blockedReasons.push(`Role '${state.role}' cannot change the state of shared project '${proj.name}'.`);
          break;
        }
        if (!proj.isShared && proj.userId !== state.userId && state.role !== 'admin') {
          blockedReasons.push(`Cannot modify project '${proj.name}' owned by another user.`);
          break;
        }
        validOps.push(op);
        break;
      }

      case 'DELETE_PROJECT': {
        const proj = state.projects.find((p) => p.id === op.data.projectId);
        if (!proj) {
          blockedReasons.push(`Project '${op.data.projectId}' was not found.`);
          break;
        }
        if (!perms.canDeleteProjects) {
          blockedReasons.push(`Role '${state.role}' cannot delete projects.`);
          break;
        }
        if (proj.isShared && !perms.canManageSharedProjects) {
          blockedReasons.push(`Role '${state.role}' cannot delete shared project '${proj.name}'.`);
          break;
        }
        if (!proj.isShared && proj.userId !== state.userId && state.role !== 'admin') {
          blockedReasons.push(`Cannot delete project '${proj.name}' owned by another user.`);
          break;
        }
        validOps.push(op);
        break;
      }

      case 'CREATE_ACTION': {
        const description = clampString(op.data.description || '', BOUNDARIES.ACTION_DESC_MAX);
        if (!description) {
          blockedReasons.push('Skipped Action creation with empty description.');
          break;
        }
        const contextId =
          op.data.contextId && knownContextIds.has(op.data.contextId) ? op.data.contextId : fallbackContextId;
        if (!contextId) {
          blockedReasons.push('No active Context available for creating an Action.');
          break;
        }
        const projectId =
          op.data.projectId && knownProjectIds.has(op.data.projectId) ? op.data.projectId : '';
        validOps.push({
          type: 'CREATE_ACTION',
          data: {
            ...op.data,
            description,
            contextId,
            projectId,
            dueDate: normalizeToUtcIso(op.data.dueDate),
            deferredUntil: normalizeToUtcIso(op.data.deferredUntil),
            alarmTime: normalizeToUtcIso(op.data.alarmTime),
            tags: op.data.tags ? clampTags(op.data.tags) : [],
            notes: op.data.notes ? clampString(op.data.notes, BOUNDARIES.NOTES_MAX) : '',
            estimatedMinutes:
              typeof op.data.estimatedMinutes === 'number' && op.data.estimatedMinutes >= 1 && op.data.estimatedMinutes <= 1440
                ? Math.round(op.data.estimatedMinutes)
                : null,
            priorityScore:
              typeof op.data.priorityScore === 'number'
                ? Math.min(100, Math.max(0, Math.round(op.data.priorityScore)))
                : undefined,
          },
        });
        break;
      }

      case 'UPDATE_ACTION': {
        const act = actionMap.get(op.data.actionId);
        if (!act) {
          blockedReasons.push(`Action '${op.data.actionId}' was not found.`);
          break;
        }
        const isCollaboratorOnShared =
          state.role === 'collaborator' && act.userId !== state.userId;
        if (
          isCollaboratorOnShared &&
          !act.projectCollaboratorIds.includes(state.userId)
        ) {
          blockedReasons.push(`Role 'collaborator' does not belong to action '${act.description}'.`);
          break;
        }

        const cleanPatch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(op.data.patch ?? {})) {
          if (v === undefined) continue;
          if (isCollaboratorOnShared && !COLLABORATOR_PATCH_KEYS.has(k)) {
            continue;
          }
          if (k === 'description' && typeof v === 'string') {
            cleanPatch[k] = clampString(v, BOUNDARIES.ACTION_DESC_MAX);
          } else if (k === 'notes' && typeof v === 'string') {
            cleanPatch[k] = clampString(v, BOUNDARIES.NOTES_MAX);
          } else if (k === 'tags' && Array.isArray(v)) {
            cleanPatch[k] = clampTags(v as string[]);
          } else if (k === 'contextId' && typeof v === 'string' && !knownContextIds.has(v)) {
            continue;
          } else if (k === 'projectId' && typeof v === 'string' && v !== '' && !knownProjectIds.has(v)) {
            continue;
          } else if (k === 'dueDate' || k === 'deferredUntil' || k === 'alarmTime') {
            cleanPatch[k] = v === null ? null : normalizeToUtcIso(typeof v === 'string' ? v : null);
          } else if (k === 'priorityScore' && typeof v === 'number') {
            cleanPatch[k] = Math.min(100, Math.max(0, Math.round(v)));
          } else {
            cleanPatch[k] = v;
          }
        }
        if (Object.keys(cleanPatch).length === 0) {
          blockedReasons.push(`No editable fields permitted on action '${act.description}' for role '${state.role}'.`);
          break;
        }
        validOps.push({
          type: 'UPDATE_ACTION',
          data: {
            actionId: op.data.actionId,
            patch: cleanPatch as AiOperation extends { type: 'UPDATE_ACTION'; data: { patch: infer P } } ? P : never,
          },
        });
        break;
      }

      case 'COMPLETE_ACTION': {
        const act = actionMap.get(op.data.actionId);
        if (!act) {
          blockedReasons.push(`Action '${op.data.actionId}' was not found.`);
          break;
        }
        if (
          act.userId !== state.userId &&
          !act.projectCollaboratorIds.includes(state.userId) &&
          state.role !== 'admin'
        ) {
          blockedReasons.push(`Role '${state.role}' cannot complete action '${act.description}'.`);
          break;
        }
        validOps.push(op);
        break;
      }

      case 'SET_ALARM': {
        const act = actionMap.get(op.data.actionId);
        if (!act) {
          blockedReasons.push(`Action '${op.data.actionId}' was not found.`);
          break;
        }
        if (
          act.userId !== state.userId &&
          !act.projectCollaboratorIds.includes(state.userId) &&
          state.role !== 'admin'
        ) {
          blockedReasons.push(`Role '${state.role}' cannot set alarm on '${act.description}'.`);
          break;
        }
        const alarmTime = normalizeToUtcIso(op.data.alarmTime);
        if (!alarmTime) {
          blockedReasons.push('Valid UTC alarm time is required.');
          break;
        }
        validOps.push({ type: 'SET_ALARM', data: { actionId: op.data.actionId, alarmTime } });
        break;
      }

      case 'COMPLETE_WEEKLY_REVIEW': {
        const reviewType = op.data.type;
        if (reviewType === 'personal' && !perms.canRunPersonalReview) {
          blockedReasons.push(`Role '${state.role}' cannot record a personal Weekly Review.`);
          break;
        }
        if (reviewType === 'team' && !perms.canRunTeamReview) {
          blockedReasons.push(`Role '${state.role}' cannot record a team Weekly Review.`);
          break;
        }
        const notes = clampString(op.data.notes || 'Weekly review completed.', BOUNDARIES.NOTES_MAX);
        validOps.push({ type: 'COMPLETE_WEEKLY_REVIEW', data: { type: reviewType, notes } });
        break;
      }

      case 'INVITE_COLLABORATOR': {
        if (!perms.canInviteCollaborators) {
          blockedReasons.push(`Role '${state.role}' cannot invite workspace collaborators.`);
          break;
        }
        const invitedEmail = (op.data.invitedEmail || '').trim().toLowerCase().slice(0, 254);
        if (!invitedEmail.includes('@')) {
          blockedReasons.push(`Invalid collaborator email '${op.data.invitedEmail}'.`);
          break;
        }
        validOps.push({
          type: 'INVITE_COLLABORATOR',
          data: {
            workspaceId: op.data.workspaceId || state.workspaceId,
            invitedEmail,
          },
        });
        break;
      }
    }
  }

  return { validOps, blockedReasons };
}

export function buildOperationPreviews(
  operations: AiOperation[],
  lookup: {
    contexts: ContextItem[];
    projects: ProjectItem[];
    actions: ActionItem[];
    inboxItems: InboxItem[];
  },
): OperationPreview[] {
  const actionMap = new Map(lookup.actions.map((a) => [a.id, a]));
  const projectMap = new Map(lookup.projects.map((p) => [p.id, p]));
  const ctxMap = new Map(lookup.contexts.map((c) => [c.id, c]));
  const inboxMap = new Map(lookup.inboxItems.map((i) => [i.id, i]));
  const tempNames = new Map<string, string>();

  return operations.map((op, opIndex) => {
    const label = describeOperation(op, { ...lookup, pendingTempNames: tempNames });
    const changes: OperationPreview['changes'] = [];
    let targetId: string | undefined;

    switch (op.type) {
      case 'UPDATE_ACTION': {
        targetId = op.data.actionId;
        const current = actionMap.get(op.data.actionId);
        if (current) {
          for (const [k, v] of Object.entries(op.data.patch)) {
            const curRaw = current[k as keyof ActionItem];
            const formatVal = (val: unknown) => {
              if (val === null || val === undefined || val === '') return 'None';
              if (k === 'contextId' && typeof val === 'string') return ctxMap.get(val)?.name ?? val;
              if (k === 'projectId' && typeof val === 'string') return projectMap.get(val)?.name ?? val;
              return String(val);
            };
            changes.push({
              field: k,
              currentValue: formatVal(curRaw),
              proposedValue: formatVal(v),
            });
          }
        }
        break;
      }
      case 'COMPLETE_ACTION': {
        targetId = op.data.actionId;
        const current = actionMap.get(op.data.actionId);
        changes.push({
          field: 'status',
          currentValue: current?.status ?? 'active',
          proposedValue: 'completed',
        });
        break;
      }
      case 'SET_ALARM': {
        targetId = op.data.actionId;
        const current = actionMap.get(op.data.actionId);
        changes.push({
          field: 'alarmTime',
          currentValue: current?.alarmTime ?? 'None',
          proposedValue: op.data.alarmTime,
        });
        break;
      }
      case 'TRANSITION_PROJECT_STATE': {
        targetId = op.data.projectId;
        const current = projectMap.get(op.data.projectId);
        changes.push({
          field: 'state',
          currentValue: current?.state ?? 'active',
          proposedValue: op.data.nextState,
        });
        break;
      }
      case 'DELETE_PROJECT': {
        targetId = op.data.projectId;
        const current = projectMap.get(op.data.projectId);
        changes.push({
          field: 'project',
          currentValue: current ? `${current.name} (${current.state})` : op.data.projectId,
          proposedValue: 'Deleted',
        });
        break;
      }
      case 'CLARIFY_INBOX_ITEM': {
        targetId = op.data.itemId;
        const current = inboxMap.get(op.data.itemId);
        changes.push({
          field: 'disposition',
          currentValue: current?.disposition ?? 'pending',
          proposedValue: op.data.disposition,
        });
        break;
      }
      default: {
        changes.push({
          field: 'operation',
          currentValue: 'Not created',
          proposedValue: label,
        });
      }
    }

    return {
      opIndex,
      opType: op.type,
      targetId,
      label,
      changes,
    };
  });
}

export function describeOperation(
  op: AiOperation,
  lookup: {
    contexts: ContextItem[];
    projects: ProjectItem[];
    actions: ActionItem[];
    inboxItems: InboxItem[];
    pendingTempNames?: Map<string, string>;
  },
): string {
  const ctxName = (id?: string) =>
    (id && (lookup.pendingTempNames?.get(id) ?? lookup.contexts.find((c) => c.id === id)?.name)) || '';
  const projName = (id?: string) =>
    (id && (lookup.pendingTempNames?.get(id) ?? lookup.projects.find((p) => p.id === id)?.name)) || '';
  const actDesc = (id: string) => lookup.actions.find((a) => a.id === id)?.description ?? id;
  const inboxText = (id: string) => lookup.inboxItems.find((i) => i.id === id)?.content ?? id;

  switch (op.type) {
    case 'CAPTURE_INBOX':
      return `Capture to Inbox: "${op.data.content}"`;
    case 'CLARIFY_INBOX_ITEM':
      if (op.data.disposition === 'trash' || op.data.disposition === 'someday') {
        return `Clarify Inbox "${inboxText(op.data.itemId)}" as ${op.data.disposition}`;
      }
      if (op.data.disposition === 'project') {
        return `Convert Inbox to Project "${op.data.projectName}" + first action "${op.data.firstActionDescription}"`;
      }
      return `Convert Inbox to Action "${op.data.description}" (${ctxName(op.data.contextId) || 'Default context'})`;
    case 'CREATE_CONTEXT':
      if (op.data.tempId) {
        lookup.pendingTempNames?.set(op.data.tempId, op.data.name);
      }
      return `Create Context: ${op.data.name}`;
    case 'CREATE_PROJECT':
      if (op.data.tempId) {
        lookup.pendingTempNames?.set(op.data.tempId, op.data.name);
      }
      return `Create ${op.data.isShared ? 'Shared ' : ''}Project: "${op.data.name}"`;
    case 'TRANSITION_PROJECT_STATE':
      return `Set Project "${projName(op.data.projectId) || op.data.projectId}" to ${op.data.nextState}`;
    case 'DELETE_PROJECT':
      return `Delete Project "${projName(op.data.projectId) || op.data.projectId}"`;
    case 'CREATE_ACTION': {
      const meta: string[] = [];
      const c = ctxName(op.data.contextId);
      if (c) meta.push(c);
      const p = projName(op.data.projectId);
      if (p) meta.push(p);
      if (op.data.dueDate) meta.push(`Due ${op.data.dueDate.replace('T', ' ').slice(0, 16)} UTC`);
      if (op.data.alarmTime) meta.push(`Alarm ${op.data.alarmTime.replace('T', ' ').slice(0, 16)} UTC`);
      return `Create Action: "${op.data.description}"${meta.length ? ` (${meta.join(' · ')})` : ''}`;
    }
    case 'UPDATE_ACTION':
      return `Update Action "${actDesc(op.data.actionId)}"`;
    case 'COMPLETE_ACTION':
      return `Complete Action "${actDesc(op.data.actionId)}"`;
    case 'SET_ALARM':
      return `Set Alarm on "${actDesc(op.data.actionId)}" for ${op.data.alarmTime.replace('T', ' ').slice(0, 16)} UTC`;
    case 'COMPLETE_WEEKLY_REVIEW':
      return `Record ${op.data.type} Weekly Review`;
    case 'INVITE_COLLABORATOR':
      return `Invite Collaborator: ${op.data.invitedEmail}`;
  }
}

export function isShortConfirmationText(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[!.?,।]+$/g, '');
  const confirmations = new Set([
    'yes',
    'y',
    'ok',
    'okay',
    'sure',
    'confirm',
    'confirmed',
    'apply',
    'do it',
    'go ahead',
    'proceed',
    'হ্যাঁ',
    'হ্যা',
    'জি',
    'ঠিক আছে',
    'করে দাও',
    'করে দিন',
    'দাও',
    'অ্যাপ্রুভ',
    'হবে',
  ]);
  return confirmations.has(normalized);
}
