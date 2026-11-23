import { isAfter } from 'date-fns';
import type {
  ActionItem,
  InboxItem,
  ProjectItem,
  UserRole,
} from '../types/gtd';

export const BOUNDARIES = {
  NAME_MAX: 100,
  CONTEXT_NAME_MAX: 60,
  PROJECT_NAME_MAX: 140,
  PROJECT_DESC_MAX: 1000,
  ACTION_DESC_MAX: 280,
  INBOX_CONTENT_MAX: 280,
  NOTES_MAX: 2000,
  TAGS_MAX_COUNT: 10,
  MEMBERS_MAX_COUNT: 25,
} as const;

/**
 * Parse an ISO/datetime string consistently as UTC milliseconds.
 * Strings lacking a timezone offset (e.g. "2026-11-22T10:00") are interpreted as UTC
 * on both server and client to ensure 100% deterministic ordering.
 */
export function parseUtcMs(input: string | Date | null | undefined): number | null {
  if (!input) return null;
  if (input instanceof Date) {
    const ms = input.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00.000Z`
    : hasTz
    ? trimmed
    : `${trimmed}Z`;
  const ms = Date.parse(candidate);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Normalize any valid date/datetime input into a canonical UTC ISO-8601 string ("...Z").
 */
export function normalizeToUtcIso(input: string | Date | null | undefined): string | null {
  if (!input) return null;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // If client passes datetime-local ("YYYY-MM-DDTHH:mm") without timezone, convert local browser input to UTC ISO.
    // Otherwise parse explicit timezone or UTC ISO accurately.
    const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    if (!hasTz && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
      const localDate = new Date(trimmed);
      if (!Number.isNaN(localDate.getTime())) {
        return localDate.toISOString();
      }
    }
  }
  const ms = parseUtcMs(input);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * Render a stored UTC ISO timestamp cleanly in the user's local timezone ("YYYY-MM-DD HH:mm").
 */
export function formatLocalDateTime(utcIso: string | null | undefined, includeTime = true): string {
  const ms = parseUtcMs(utcIso);
  if (ms === null) return '';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  if (!includeTime) return `${yyyy}-${mm}-${dd}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export interface RolePermissions {
  canProcessInbox: boolean;
  canCreatePersonalProjects: boolean;
  canManageSharedProjects: boolean;
  canDeleteProjects: boolean;
  canInviteCollaborators: boolean;
  canRunPersonalReview: boolean;
  canRunTeamReview: boolean;
  canViewTeamInsights: boolean;
  canActOnSharedProjects: boolean;
  canUseFocusAndAlarms: boolean;
}

export function getRolePermissions(role: UserRole): RolePermissions {
  switch (role) {
    case 'individual':
      return {
        canProcessInbox: true,
        canCreatePersonalProjects: true,
        canManageSharedProjects: false,
        canDeleteProjects: true,
        canInviteCollaborators: false,
        canRunPersonalReview: true,
        canRunTeamReview: false,
        canViewTeamInsights: false,
        canActOnSharedProjects: false,
        canUseFocusAndAlarms: true,
      };
    case 'collaborator':
      return {
        canProcessInbox: true,
        canCreatePersonalProjects: false,
        canManageSharedProjects: false,
        canDeleteProjects: false,
        canInviteCollaborators: false,
        canRunPersonalReview: false,
        canRunTeamReview: false,
        canViewTeamInsights: true,
        canActOnSharedProjects: true,
        canUseFocusAndAlarms: true,
      };
    case 'admin':
      return {
        canProcessInbox: false,
        canCreatePersonalProjects: true,
        canManageSharedProjects: true,
        canDeleteProjects: true,
        canInviteCollaborators: true,
        canRunPersonalReview: false,
        canRunTeamReview: true,
        canViewTeamInsights: true,
        canActOnSharedProjects: true,
        canUseFocusAndAlarms: true,
      };
  }
}

export function calculatePriorityScore(
  action: Pick<ActionItem, 'starred' | 'dueDate' | 'deferredUntil' | 'alarmTime' | 'status'>,
  now: Date = new Date(),
): number {
  if (action.status === 'completed') return 0;

  let score = 25;
  const nowMs = now.getTime();

  if (action.starred) {
    score += 30;
  }

  if (action.alarmTime) {
    score += 10;
  }

  const dueMs = parseUtcMs(action.dueDate);
  if (dueMs !== null) {
    const hoursLeft = (dueMs - nowMs) / (1000 * 60 * 60);
    if (hoursLeft < 0) {
      score += 35; // Overdue
    } else if (hoursLeft <= 24) {
      score += 28; // Due within 24h
    } else if (hoursLeft <= 72) {
      score += 16; // Due within 3 days
    } else {
      score += 5;
    }
  }

  const deferredMs = parseUtcMs(action.deferredUntil);
  if (deferredMs !== null && isAfter(new Date(deferredMs), now)) {
    score -= 25;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Deterministic canonical Focus Queue ordering:
 * 1. Priority Score (descending)
 * 2. Overdue (overdue first)
 * 3. Due Date (earliest UTC first; actions with dueDate before actions without)
 * 4. Alarm Time (earliest UTC first; actions with alarmTime before actions without)
 * 5. Starred (starred first)
 * 6. createdAt (earliest UTC first)
 * 7. id (ascending tiebreak)
 *
 * Uses O(N) precomputation so 1,000+ actions sort in <5ms.
 */
export function sortFocusActions(actions: ActionItem[], now: Date = new Date()): ActionItem[] {
  const nowMs = now.getTime();
  const decorated = actions.map((action) => {
    const score =
      typeof action.priorityScore === 'number' && action.priorityScore > 0
        ? action.priorityScore
        : calculatePriorityScore(action, now);
    const dueMs = parseUtcMs(action.dueDate);
    const alarmMs = parseUtcMs(action.alarmTime);
    const createdMs = parseUtcMs(action.createdAt) ?? 0;
    const isOverdue = dueMs !== null && dueMs < nowMs ? 1 : 0;

    return {
      action,
      score,
      isOverdue,
      dueMs,
      alarmMs,
      starred: action.starred ? 1 : 0,
      createdMs,
    };
  });

  decorated.sort((a, b) => {
    // 1. Priority Score (desc)
    if (b.score !== a.score) return b.score - a.score;
    // 2. Overdue (true before false)
    if (b.isOverdue !== a.isOverdue) return b.isOverdue - a.isOverdue;
    // 3. Due Date (earliest first; null last)
    if (a.dueMs !== null && b.dueMs !== null && a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
    if (a.dueMs !== null && b.dueMs === null) return -1;
    if (a.dueMs === null && b.dueMs !== null) return 1;
    // 4. Alarm Time (earliest first; null last)
    if (a.alarmMs !== null && b.alarmMs !== null && a.alarmMs !== b.alarmMs) return a.alarmMs - b.alarmMs;
    if (a.alarmMs !== null && b.alarmMs === null) return -1;
    if (a.alarmMs === null && b.alarmMs !== null) return 1;
    // 5. Starred (true before false)
    if (b.starred !== a.starred) return b.starred - a.starred;
    // 6. createdAt (earliest first)
    if (a.createdMs !== b.createdMs) return a.createdMs - b.createdMs;
    // 7. Deterministic id tiebreak
    return a.action.id.localeCompare(b.action.id);
  });

  return decorated.map((item) => item.action);
}

/**
 * Hard Rule: A project is Stalled ONLY if state === 'active' AND activeActionCount === 0.
 * On Hold ('hidden') and 'completed' projects are NEVER labeled stalled.
 */
export function findStalledProjects(projects: ProjectItem[], actions: ActionItem[]): ProjectItem[] {
  const activeCountByProject = new Map<string, number>();
  for (const action of actions) {
    if (action.status === 'active' && action.projectId) {
      activeCountByProject.set(action.projectId, (activeCountByProject.get(action.projectId) ?? 0) + 1);
    }
  }

  return projects.filter(
    (project) => project.state === 'active' && (activeCountByProject.get(project.id) ?? 0) === 0,
  );
}

export interface WeeklyReviewBuckets {
  overdueActions: ActionItem[];
  stalledProjects: ProjectItem[];
  ticklerArrivingSoon: ActionItem[];
  openLoops: InboxItem[];
}

export function partitionWeeklyReview(
  actions: ActionItem[],
  projects: ProjectItem[],
  inboxItems: InboxItem[],
  now: Date = new Date(),
): WeeklyReviewBuckets {
  const nowMs = now.getTime();
  const soonWindowMs = nowMs + 7 * 24 * 60 * 60 * 1000;

  const overdueActions = actions.filter((action) => {
    if (action.status !== 'active') return false;
    const dueMs = parseUtcMs(action.dueDate);
    return dueMs !== null && dueMs < nowMs;
  });

  const stalledProjects = findStalledProjects(projects, actions);

  const ticklerArrivingSoon = actions.filter((action) => {
    if (action.status !== 'deferred') return false;
    const ticklerMs = parseUtcMs(action.deferredUntil);
    return ticklerMs !== null && ticklerMs <= soonWindowMs;
  });

  const openLoops = inboxItems.filter((item) => !item.processed);

  return {
    overdueActions,
    stalledProjects,
    ticklerArrivingSoon,
    openLoops,
  };
}

export function getDueUrgency(
  dueDate: string | null,
  now: Date = new Date(),
): 'overdue' | 'soon' | 'upcoming' | 'none' {
  const dueMs = parseUtcMs(dueDate);
  if (dueMs === null) return 'none';
  const hoursLeft = (dueMs - now.getTime()) / (1000 * 60 * 60);
  if (hoursLeft < 0) return 'overdue';
  if (hoursLeft <= 48) return 'soon';
  return 'upcoming';
}

export function clampString(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

export function clampTags(tags: string[]): string[] {
  return tags
    .map((t) => t.trim().slice(0, 32))
    .filter((t) => t.length > 0)
    .slice(0, BOUNDARIES.TAGS_MAX_COUNT);
}
