import { calculatePriorityScore } from '../utils/gtdLogic';
import type { ActionItem, ContextItem, InboxItem, ProjectItem } from '../types/gtd';
import type { DemoStoreState } from './demoSeed';
import { createDemoSeedState } from './demoSeed';

/**
 * Generates an exact deterministic 20-task test workload in UTC:
 * - 20 active tasks total
 * - 5 overdue tasks
 * - 4 tasks due within 3 hours
 * - 3 starred tasks
 * - 3 low-priority tasks (explicit low scores, no urgency)
 * - 2 tasks with conflicting identical deadlines (exact same dueDate)
 * - 2 tasks without due dates (dueDate: null)
 * - 1 task with an alarm that has already passed (alarmTime < now)
 * - Remaining active tasks make up exact 20 total with realistic names & distinct estimatedMinutes
 *
 * Also includes:
 * - 1 active project with active tasks
 * - 1 active project with 1 active task (so completing it flags Stalled)
 * - 1 On Hold ('hidden') project with 0 active actions (MUST NOT be flagged Stalled)
 * - 1 Completed project with 0 active actions (MUST NOT be flagged Stalled)
 */
export function createTwentyTaskTestWorkload(now: Date = new Date()): DemoStoreState {
  const base = createDemoSeedState();
  const baseMs = now.getTime();
  const isoAtOffsetMins = (mins: number) => new Date(baseMs + mins * 60_000).toISOString();
  const userId = base.profile.id;
  const wsId = base.profile.workspaceId;

  const contexts: ContextItem[] = base.contexts;
  const projects: ProjectItem[] = [
    {
      id: 'proj_q4_release',
      userId,
      workspaceId: base.workspaces[1]?.id ?? wsId,
      collaboratorIds: [userId, 'demo_collab_marcus', 'demo_collab_priya'],
      name: 'Q4 Product Launch',
      description: 'Coordinate final release checklist, security audit, and customer release notes.',
      state: 'active',
      defaultContextId: 'ctx_deep_work',
      isShared: true,
      createdAt: isoAtOffsetMins(-7200),
      updatedAt: isoAtOffsetMins(-60),
      completedAt: null,
    },
    {
      id: 'proj_single_step',
      userId,
      workspaceId: wsId,
      collaboratorIds: [userId],
      name: 'Board Compliance Filing',
      description: 'Submit annual statutory compliance filing package.',
      state: 'active',
      defaultContextId: 'ctx_computer',
      isShared: false,
      createdAt: isoAtOffsetMins(-6000),
      updatedAt: isoAtOffsetMins(-120),
      completedAt: null,
    },
    {
      id: 'proj_on_hold',
      userId,
      workspaceId: wsId,
      collaboratorIds: [userId],
      name: 'Office Lease Expansion (On Hold)',
      description: 'Paused until Q2 budget review — must NOT appear as stalled.',
      state: 'hidden',
      defaultContextId: 'ctx_errands',
      isShared: false,
      createdAt: isoAtOffsetMins(-9000),
      updatedAt: isoAtOffsetMins(-500),
      completedAt: null,
    },
    {
      id: 'proj_done',
      userId,
      workspaceId: wsId,
      collaboratorIds: [userId],
      name: 'Brand Guidelines Refresh',
      description: 'Already completed outcome.',
      state: 'completed',
      defaultContextId: 'ctx_computer',
      isShared: false,
      createdAt: isoAtOffsetMins(-12000),
      updatedAt: isoAtOffsetMins(-1000),
      completedAt: isoAtOffsetMins(-1000),
    },
  ];

  const makeItem = (spec: {
    id: string;
    description: string;
    contextId: string;
    projectId: string;
    dueOffsetMins: number | null;
    alarmOffsetMins?: number | null;
    starred?: boolean;
    priorityScoreOverride?: number;
    estimatedMinutes: number;
    createdOffsetMins: number;
    notes?: string;
    tags?: string[];
  }): ActionItem => {
    const dueDate = spec.dueOffsetMins !== null ? isoAtOffsetMins(spec.dueOffsetMins) : null;
    const alarmTime =
      spec.alarmOffsetMins !== undefined && spec.alarmOffsetMins !== null
        ? isoAtOffsetMins(spec.alarmOffsetMins)
        : null;
    const starred = Boolean(spec.starred);
    const computedScore = calculatePriorityScore(
      {
        starred,
        dueDate,
        deferredUntil: null,
        alarmTime,
        status: 'active',
      },
      now,
    );

    return {
      id: spec.id,
      userId,
      workspaceId: wsId,
      projectId: spec.projectId,
      projectCollaboratorIds:
        spec.projectId === 'proj_q4_release' ? [userId, 'demo_collab_marcus', 'demo_collab_priya'] : [userId],
      contextId: spec.contextId,
      description: spec.description,
      status: 'active',
      dueDate,
      deferredUntil: null,
      starred,
      priorityScore: spec.priorityScoreOverride ?? computedScore,
      tags: spec.tags ?? ['today'],
      notes: spec.notes ?? '',
      alarmTime,
      estimatedMinutes: spec.estimatedMinutes,
      createdAt: isoAtOffsetMins(spec.createdOffsetMins),
      updatedAt: isoAtOffsetMins(-30),
      completedAt: null,
    };
  };

  // Exact 20 active tasks breakdown:
  // [1..5] 5 overdue tasks (1 of which is also starred -> total starred = 3 below)
  // [6..9] 4 tasks due within 3 hours (<= 180 mins) (1 starred)
  // [10..11] 2 tasks with conflicting identical deadlines (+240 mins)
  // [12..13] 2 tasks without due dates (dueOffsetMins: null) (one includes a prompt injection test payload in notes/desc for safety audit? Keep realistic, test prompt injection via input, or normal clean descriptions)
  // [14] 1 task with an alarm that has already passed (-25 mins)
  // [15..17] 3 low-priority tasks (score 12..18, far future due date)
  // [18..20] 3 standard today tasks (including 1 starred, and 1 attached to proj_single_step)
  const actions: ActionItem[] = [
    // 5 Overdue
    makeItem({
      id: 't20_01',
      description: 'Submit signed vendor NDA before legal escalation',
      contextId: 'ctx_computer',
      projectId: 'proj_q4_release',
      dueOffsetMins: -180,
      alarmOffsetMins: 30,
      starred: true, // starred #1
      priorityScoreOverride: 100,
      estimatedMinutes: 25,
      createdOffsetMins: -3000,
      notes: 'Critical blocker for vendor API sandbox keys.',
    }),
    makeItem({
      id: 't20_02',
      description: 'Approve payroll reconciliation batch for October',
      contextId: 'ctx_computer',
      projectId: 'proj_single_step',
      dueOffsetMins: -120,
      priorityScoreOverride: 72,
      estimatedMinutes: 20,
      createdOffsetMins: -2900,
    }),
    makeItem({
      id: 't20_03',
      description: 'Send revised pricing deck to Acme procurement lead',
      contextId: 'ctx_calls',
      projectId: 'proj_q4_release',
      dueOffsetMins: -90,
      priorityScoreOverride: 68,
      estimatedMinutes: 35,
      createdOffsetMins: -2800,
    }),
    makeItem({
      id: 't20_04',
      description: 'Fix TLS certificate expiry alert on staging webhook',
      contextId: 'ctx_deep_work',
      projectId: 'proj_q4_release',
      dueOffsetMins: -60,
      priorityScoreOverride: 64,
      estimatedMinutes: 45,
      createdOffsetMins: -2700,
    }),
    makeItem({
      id: 't20_05',
      description: 'Reply to compliance auditor follow-up questions',
      contextId: 'ctx_computer',
      projectId: '',
      dueOffsetMins: -45,
      priorityScoreOverride: 61,
      estimatedMinutes: 15,
      createdOffsetMins: -2600,
    }),

    // 4 Due within 3 hours (+30m, +75m, +110m, +165m)
    makeItem({
      id: 't20_06',
      description: 'Finalize Q4 release announcement changelog',
      contextId: 'ctx_deep_work',
      projectId: 'proj_q4_release',
      dueOffsetMins: 30,
      alarmOffsetMins: 15,
      starred: true, // starred #2
      priorityScoreOverride: 92,
      estimatedMinutes: 40,
      createdOffsetMins: -2500,
    }),
    makeItem({
      id: 't20_07',
      description: 'Call logistics partner about Friday warehouse drop',
      contextId: 'ctx_calls',
      projectId: '',
      dueOffsetMins: 75,
      priorityScoreOverride: 56,
      estimatedMinutes: 12,
      createdOffsetMins: -2400,
    }),
    makeItem({
      id: 't20_08',
      description: 'Verify production database backup snapshot integrity',
      contextId: 'ctx_deep_work',
      projectId: 'proj_q4_release',
      dueOffsetMins: 110,
      priorityScoreOverride: 55,
      estimatedMinutes: 30,
      createdOffsetMins: -2300,
    }),
    makeItem({
      id: 't20_09',
      description: 'Review Marcus PR for accessibility keyboard traps',
      contextId: 'ctx_computer',
      projectId: 'proj_q4_release',
      dueOffsetMins: 165,
      priorityScoreOverride: 53,
      estimatedMinutes: 28,
      createdOffsetMins: -2200,
    }),

    // 2 Conflicting identical deadlines (+240 mins = 4 hours from now)
    makeItem({
      id: 't20_10',
      description: 'Host live product architecture sync with engineering',
      contextId: 'ctx_calls',
      projectId: 'proj_q4_release',
      dueOffsetMins: 240,
      alarmOffsetMins: 225,
      priorityScoreOverride: 58,
      estimatedMinutes: 50,
      createdOffsetMins: -2100,
      notes: 'Conflict window A at +4h UTC.',
    }),
    makeItem({
      id: 't20_11',
      description: 'Present quarterly budget forecast to finance panel',
      contextId: 'ctx_calls',
      projectId: '',
      dueOffsetMins: 240,
      alarmOffsetMins: 230,
      priorityScoreOverride: 58,
      estimatedMinutes: 55,
      createdOffsetMins: -2000,
      notes: 'Conflict window B at exact same +4h UTC slot.',
    }),

    // 1 Passed alarm (+300m due, -20m alarm already passed)
    makeItem({
      id: 't20_12',
      description: 'Pick up notarized incorporation papers from courier desk',
      contextId: 'ctx_errands',
      projectId: '',
      dueOffsetMins: 300,
      alarmOffsetMins: -20,
      priorityScoreOverride: 60,
      estimatedMinutes: 22,
      createdOffsetMins: -1900,
      notes: 'Passed alarm test case.',
    }),

    // 3 Remaining active today tasks (including Starred #3)
    makeItem({
      id: 't20_13',
      description: 'Confirm keynote slide deck animations with Priya',
      contextId: 'ctx_computer',
      projectId: 'proj_q4_release',
      dueOffsetMins: 360,
      starred: true, // starred #3
      priorityScoreOverride: 76,
      estimatedMinutes: 18,
      createdOffsetMins: -1800,
    }),
    makeItem({
      id: 't20_14',
      description: 'Draft onboarding email template for beta signups',
      contextId: 'ctx_deep_work',
      projectId: 'proj_q4_release',
      dueOffsetMins: 420,
      priorityScoreOverride: 49,
      estimatedMinutes: 33,
      createdOffsetMins: -1700,
    }),
    makeItem({
      id: 't20_15',
      description: 'Refill studio printer toner and label paper',
      contextId: 'ctx_errands',
      projectId: '',
      dueOffsetMins: 480,
      priorityScoreOverride: 42,
      estimatedMinutes: 14,
      createdOffsetMins: -1600,
    }),

    // 2 Tasks without due dates (dueDate: null)
    makeItem({
      id: 't20_16',
      description: 'Organize shared Figma archive folders by release quarter',
      contextId: 'ctx_computer',
      projectId: '',
      dueOffsetMins: null,
      priorityScoreOverride: 25,
      estimatedMinutes: 27,
      createdOffsetMins: -1500,
    }),
    makeItem({
      id: 't20_17',
      description: 'Research noise-canceling headset mics for support team',
      contextId: 'ctx_computer',
      projectId: '',
      dueOffsetMins: null,
      priorityScoreOverride: 24,
      estimatedMinutes: 16,
      createdOffsetMins: -1400,
    }),

    // 3 Low-priority tasks
    makeItem({
      id: 't20_18',
      description: 'Clean up deprecated feature flag comments in wiki',
      contextId: 'ctx_computer',
      projectId: '',
      dueOffsetMins: 7200,
      priorityScoreOverride: 15,
      estimatedMinutes: 10,
      createdOffsetMins: -1300,
    }),
    makeItem({
      id: 't20_19',
      description: 'Archive old conference swag vendor brochures',
      contextId: 'ctx_errands',
      projectId: '',
      dueOffsetMins: 8640,
      priorityScoreOverride: 12,
      estimatedMinutes: 8,
      createdOffsetMins: -1200,
    }),
    makeItem({
      id: 't20_20',
      description: 'Sort spare USB-C cables in studio storage drawer',
      contextId: 'ctx_errands',
      projectId: '',
      dueOffsetMins: 10080,
      priorityScoreOverride: 10,
      estimatedMinutes: 11,
      createdOffsetMins: -1100,
    }),
  ];

  const inboxItems: InboxItem[] = base.inboxItems;

  return {
    ...base,
    contexts,
    projects,
    actions,
    inboxItems,
  };
}

/**
 * Generates N tasks (default 1,200) for scale & performance benchmarking.
 */
export function createScaleWorkload(count = 1200, now: Date = new Date()): DemoStoreState {
  const base = createTwentyTaskTestWorkload(now);
  const baseMs = now.getTime();
  const userId = base.profile.id;
  const wsId = base.profile.workspaceId;
  const ctxIds = ['ctx_computer', 'ctx_deep_work', 'ctx_calls', 'ctx_errands'];

  const generated: ActionItem[] = [...base.actions];
  for (let i = base.actions.length; i < count; i++) {
    const offsetMins = ((i % 96) - 24) * 60;
    const dueDate = i % 7 === 0 ? null : new Date(baseMs + offsetMins * 60_000).toISOString();
    const alarmTime = i % 9 === 0 ? new Date(baseMs + ((i % 48) + 1) * 30 * 60_000).toISOString() : null;
    const starred = i % 15 === 0;
    const createdAt = new Date(baseMs - (count - i) * 60_000).toISOString();
    const score = calculatePriorityScore(
      { starred, dueDate, deferredUntil: null, alarmTime, status: 'active' },
      now,
    );
    generated.push({
      id: `scale_act_${String(i + 1).padStart(4, '0')}`,
      userId,
      workspaceId: wsId,
      projectId: i % 3 === 0 ? 'proj_q4_release' : '',
      projectCollaboratorIds: i % 3 === 0 ? [userId, 'demo_collab_marcus'] : [userId],
      contextId: ctxIds[i % ctxIds.length],
      description: `Scale Task #${i + 1}: Execute scheduled workflow checkpoint`,
      status: 'active',
      dueDate,
      deferredUntil: null,
      starred,
      priorityScore: score,
      tags: ['scale'],
      notes: '',
      alarmTime,
      estimatedMinutes: 10 + (i % 50),
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
    });
  }

  return {
    ...base,
    actions: generated,
  };
}
