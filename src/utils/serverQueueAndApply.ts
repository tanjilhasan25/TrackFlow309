import crypto from 'node:crypto';
import type { ActionItem, ContextItem, InboxItem, ProjectItem, UserRole } from '../types/gtd';
import {
  calculatePriorityScore,
  normalizeToUtcIso,
  parseUtcMs,
  sortFocusActions,
} from './gtdLogic';
import {
  buildOperationPreviews,
  type AiChatResponsePayload,
  type AiOperation,
  type OperationPreview,
  type WorkspaceContextSnapshot,
  validateAndFilterOperations,
} from './aiAgentOperations';

export interface VerifiedFirebaseClaims {
  uid: string;
  email: string;
  emailVerified: boolean;
  issuer: string;
  audience: string;
}

interface CertCache {
  certs: Record<string, string>;
  expiresAtMs: number;
}

let cachedGoogleCerts: CertCache | null = null;

async function fetchGoogleSecureTokenCerts(nowMs = Date.now()): Promise<Record<string, string>> {
  if (cachedGoogleCerts && nowMs < cachedGoogleCerts.expiresAtMs) {
    return cachedGoogleCerts.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
  );
  if (!resp.ok) {
    throw new Error(`Unable to fetch Google SecureToken certificates (${resp.status}).`);
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const certs = (await resp.json()) as Record<string, string>;
  cachedGoogleCerts = {
    certs,
    expiresAtMs: nowMs + Math.max(60, maxAgeSec) * 1000,
  };
  return certs;
}

function decodeBase64Url(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const mod = padded.length % 4;
  const normalized = mod === 0 ? padded : padded + '='.repeat(4 - mod);
  return Buffer.from(normalized, 'base64');
}

/**
 * Cryptographically verifies a Firebase Auth ID token (RS256 JWT) against Google's
 * public SecureToken x509 certificates without requiring IAM / firebase-admin DB access.
 */
export async function verifyFirebaseIdToken(
  token: string,
  expectedProjectId: string,
  options?: {
    certsOverride?: Record<string, string>;
    nowSec?: number;
  },
): Promise<VerifiedFirebaseClaims> {
  const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
  const parts = cleanToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    email?: string;
    email_verified?: boolean;
    exp?: number;
    iat?: number;
    auth_time?: number;
  };

  try {
    header = JSON.parse(decodeBase64Url(headerB64).toString('utf8'));
    payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf8'));
  } catch {
    throw new Error('Unable to parse Firebase ID token segments.');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid Firebase ID token algorithm or key ID.');
  }

  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;

  if (payload.aud !== expectedProjectId) {
    throw new Error('Firebase ID token audience mismatch.');
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error('Firebase ID token issuer mismatch.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Firebase ID token missing valid subject.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Firebase ID token issued-at timestamp is invalid.');
  }
  if (payload.email_verified !== true) {
    throw new Error('Firebase user email is not verified.');
  }

  const certs = options?.certsOverride ?? (await fetchGoogleSecureTokenCerts(nowSec * 1000));
  const pem = certs[header.kid];
  if (!pem) {
    throw new Error('Unknown Firebase ID token signing key.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signature = decodeBase64Url(sigB64);

  if (!verifier.verify(pem, signature)) {
    throw new Error('Firebase ID token cryptographic signature is invalid.');
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    emailVerified: true,
    issuer: payload.iss,
    audience: payload.aud,
  };
}

/**
 * Rule 2: Server-side deterministic Focus Queue prioritization.
 * Always computes canonical scores & exact order in UTC.
 */
export function prioritizeQueueServer(
  actions: ActionItem[],
  now: Date = new Date(),
): {
  serverTimeUtc: string;
  activeQueue: ActionItem[];
  totalActive: number;
  deferredCount: number;
  completedCount: number;
  upNext: ActionItem | null;
} {
  const activeWithScores: ActionItem[] = [];
  let deferredCount = 0;
  let completedCount = 0;

  for (const act of actions) {
    if (act.status === 'active') {
      const dueDate = normalizeToUtcIso(act.dueDate);
      const deferredUntil = normalizeToUtcIso(act.deferredUntil);
      const alarmTime = normalizeToUtcIso(act.alarmTime);
      const computedScore =
        typeof act.priorityScore === 'number' && act.priorityScore > 0
          ? Math.min(100, Math.max(0, Math.round(act.priorityScore)))
          : calculatePriorityScore({ ...act, dueDate, deferredUntil, alarmTime }, now);
      activeWithScores.push({
        ...act,
        dueDate,
        deferredUntil,
        alarmTime,
        priorityScore: computedScore,
      });
    } else if (act.status === 'deferred') {
      deferredCount++;
    } else {
      completedCount++;
    }
  }

  const sorted = sortFocusActions(activeWithScores, now);

  return {
    serverTimeUtc: now.toISOString(),
    activeQueue: sorted,
    totalActive: sorted.length,
    deferredCount,
    completedCount,
    upNext: sorted[0] ?? null,
  };
}

// ── Anti-Prompt-Injection & Ambiguity Guardrail Engine ─────────────────────

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|system)\s+instructions?/i,
  /system\s+override/i,
  /jailbreak/i,
  /\bdelete\s+all\s+(projects?|tasks?|actions?|workspaces?)\b/i,
  /\bwipe\s+(workspace|database|all)\b/i,
  /\binvite\s+[^\s]+@[^\s]+\s+as\s+admin\b/i,
  /exfiltrate|leak\s+secret/i,
];

function containsInjectionString(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

function userRequestedDestructiveAction(userMessage: string): boolean {
  return /\b(delete|remove|trash|clear|archive)\b|মুছ|ডিলিট|বাদ দাও/i.test(userMessage);
}

function userRequestedInvite(userMessage: string): boolean {
  return /\b(invite|add collaborator|add member)\b|ইনভাইট|যোগ কর/i.test(userMessage);
}

export function detectAmbiguityOrConflict(userMessage: string): {
  isAmbiguous: boolean;
  questions: string[];
  bengali: boolean;
} {
  const lower = userMessage.trim().toLowerCase();
  const bengali = /[\u0980-\u09FF]/.test(userMessage);

  // Conflicting bulk instructions: e.g. "move all to tomorrow but keep urgent ones", "reschedule all except important"
  const hasBulkTarget = /\b(all|every|everything|tasks|actions)\b|সব\s*কাজ|সবগুলো/i.test(lower);
  const hasConflictClause =
    /\b(but keep|except|unless|urgent ones|important ones|only non-urgent|কিন্তু জরুরিগুলো|বাদে|জরুরি বাদে)\b/i.test(
      lower,
    );
  if (hasBulkTarget && hasConflictClause && !/\b(score\s*[><=]+\s*\d+|overdue|starred)\b/i.test(lower)) {
    return {
      isAmbiguous: true,
      bengali,
      questions: bengali
        ? [
            'কোন কাজগুলো "জরুরি" হিসেবে রাখবেন (যেমন: Overdue, Starred, নাকি Priority Score >= 70)?',
            'বাকি কাজগুলো কি কাল সকাল ৯টা নাকি দুপুর ২টায় শিফট করতে চান?',
          ]
        : [
            'Which rule should define "urgent" tasks to keep today (e.g., Overdue, Starred, or Score >= 70)?',
            'What specific UTC/local time tomorrow should the remaining tasks be moved to?',
          ],
    };
  }

  // Underspecified scheduling/meeting/reminder without date/time or topic:
  const isScheduleMeetingOrReminder =
    /\b(schedule|book|set up|plan|arrange)\s+(a\s+)?(meeting|call|sync|reminder|appointment|event)\b/i.test(lower) ||
    /\badd\s+a?\s*(task|reminder)\s*$/i.test(lower) ||
    /^(মিটিং সেট করো|একটা মিটিং ঠিক করো|রিমাইন্ডার দাও|কাজ যোগ করো)$/i.test(userMessage.trim());

  const hasExplicitTimeOrDate =
    /\b(\d{1,2}(:\d{2})?\s*(am|pm)|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|next week)\b/i.test(
      lower,
    ) || /(আজ|কাল|আগামীকাল|সোম|মঙ্গল|বুধ|বৃহস্পতি|শুক্র|শনি|রবি|\d+[:.]\d+|সকাল|দুপুর|বিকাল|রাত)/.test(userMessage);

  if (isScheduleMeetingOrReminder && !hasExplicitTimeOrDate) {
    return {
      isAmbiguous: true,
      bengali,
      questions: bengali
        ? [
            'মিটিং বা রিমাইন্ডারটির তারিখ এবং সময় (যেমন: কাল সকাল ১০:৩০) কত হবে?',
            'এটি কোন প্রজেক্ট বা কনটেক্সটের (@Calls / @Computer) সাথে যুক্ত করবেন?',
          ]
        : [
            'What date and exact time should this be scheduled for (e.g., tomorrow at 10:00 AM)?',
            'Which Context (e.g., @Calls, @Computer) or Project should it belong to?',
          ],
    };
  }

  return { isAmbiguous: false, bengali, questions: [] };
}

/**
 * Enforces AI Hard Rules 1 & 6 post-generation:
 * - Strictly PROPOSE-ONLY (never returns stage: 'execute').
 * - Strips/blocks any operations triggered via prompt injection inside untrusted data.
 * - Forces ambiguous or conflicting requests to stage: 'clarify' with operations: [].
 * - Attaches deterministic Before -> After previews on mutation proposals.
 */
export function guardAiChatResponse(params: {
  userMessage: string;
  rawResponse: {
    stage?: string;
    assistantReply?: string;
    clarificationQuestions?: string[];
    proposedSummary?: string[];
    operations?: AiOperation[];
  };
  workspaceContext: WorkspaceContextSnapshot;
  lookupState?: {
    contexts: ContextItem[];
    projects: ProjectItem[];
    actions: ActionItem[];
    inboxItems: InboxItem[];
  };
}): AiChatResponsePayload {
  const { userMessage, rawResponse, workspaceContext, lookupState } = params;
  const ops = Array.isArray(rawResponse.operations) ? rawResponse.operations : [];
  const bengali = /[\u0980-\u09FF]/.test(userMessage);

  // 1. Check ambiguity/conflicts BEFORE allowing AI-guessed mutations
  const ambiguity = detectAmbiguityOrConflict(userMessage);
  if (ambiguity.isAmbiguous) {
    return {
      stage: 'clarify',
      assistantReply: bengali
        ? 'আপনার অনুরোধটি সঠিকভাবে সম্পন্ন করতে নিচের তথ্যগুলো পরিষ্কার করা প্রয়োজন (কোনো অনুমান বা পরিবর্তন করা হয়নি):'
        : 'I need a quick clarification before proposing any changes (nothing was guessed or modified):',
      clarificationQuestions:
        Array.isArray(rawResponse.clarificationQuestions) && rawResponse.clarificationQuestions.length > 0
          ? rawResponse.clarificationQuestions.slice(0, 3)
          : ambiguity.questions,
      proposedSummary: [],
      previews: [],
      operations: [],
    };
  }

  // 2. Check Prompt Injection inside untrusted workspace data
  const untrustedTexts = [
    ...workspaceContext.activeActions.map((a) => a.description),
    ...workspaceContext.projects.map((p) => p.name),
    ...workspaceContext.unprocessedInbox.map((i) => i.content),
  ];
  const hasInjectionInWorkspace = untrustedTexts.some((t) => containsInjectionString(t));

  let filteredOps = ops;
  let injectionBlockedNotice = '';

  if (hasInjectionInWorkspace) {
    const allowedDelete = userRequestedDestructiveAction(userMessage);
    const allowedInvite = userRequestedInvite(userMessage);

    const safeOps: AiOperation[] = [];
    for (const op of ops) {
      if (op.type === 'DELETE_PROJECT' && !allowedDelete) {
        injectionBlockedNotice = 'Blocked unrequested DELETE_PROJECT triggered by untrusted workspace content.';
        continue;
      }
      if (op.type === 'INVITE_COLLABORATOR' && !allowedInvite) {
        injectionBlockedNotice = 'Blocked unrequested INVITE_COLLABORATOR triggered by untrusted workspace content.';
        continue;
      }
      if (op.type === 'COMPLETE_ACTION' && !allowedDelete && !/\b(complete|done|finish|mark)\b|শেষ|কমপ্লিট/i.test(userMessage)) {
        injectionBlockedNotice = 'Blocked unrequested COMPLETE_ACTION triggered by untrusted workspace content.';
        continue;
      }
      if (
        (op.type === 'CREATE_ACTION' && containsInjectionString(op.data.description)) ||
        (op.type === 'CAPTURE_INBOX' && containsInjectionString(op.data.content))
      ) {
        injectionBlockedNotice = 'Blocked suspicious instruction payload inside proposed operation.';
        continue;
      }
      safeOps.push(op);
    }
    filteredOps = safeOps;
  }

  // Also never allow AI-emitted bulk deletes unless explicitly requested by user
  if (!userRequestedDestructiveAction(userMessage)) {
    const deleteCount = filteredOps.filter((o) => o.type === 'DELETE_PROJECT').length;
    if (deleteCount > 0) {
      filteredOps = filteredOps.filter((o) => o.type !== 'DELETE_PROJECT');
      injectionBlockedNotice =
        injectionBlockedNotice || 'Blocked unrequested project deletion from AI output.';
    }
  }

  // 3. Enforce strict propose-only stage (never 'execute')
  let stage: AiChatResponsePayload['stage'];
  if (rawResponse.stage === 'clarify' && filteredOps.length === 0) {
    stage = 'clarify';
  } else if (filteredOps.length > 0) {
    stage = 'propose';
  } else {
    stage = 'answer';
  }

  // 4. Build Current -> Proposed Previews when lookupState is available (or synthesized from snapshot)
  const previewSource = lookupState ?? {
    contexts: workspaceContext.contexts.map((c, idx) => ({
      ...c,
      userId: workspaceContext.user.id,
      workspaceId: workspaceContext.user.workspaceId,
      memberIds: [workspaceContext.user.id],
      position: idx,
      createdAt: workspaceContext.currentTimeIso,
      updatedAt: workspaceContext.currentTimeIso,
    })),
    projects: workspaceContext.projects.map((p) => ({
      ...p,
      userId: workspaceContext.user.id,
      workspaceId: workspaceContext.user.workspaceId,
      collaboratorIds: [workspaceContext.user.id],
      description: '',
      createdAt: workspaceContext.currentTimeIso,
      updatedAt: workspaceContext.currentTimeIso,
      completedAt: null,
    })),
    actions: workspaceContext.activeActions.map((a) => ({
      ...a,
      userId: workspaceContext.user.id,
      workspaceId: workspaceContext.user.workspaceId,
      projectCollaboratorIds: [workspaceContext.user.id],
      tags: [],
      notes: '',
      createdAt: workspaceContext.currentTimeIso,
      updatedAt: workspaceContext.currentTimeIso,
      completedAt: null,
    })),
    inboxItems: workspaceContext.unprocessedInbox.map((i) => ({
      ...i,
      userId: workspaceContext.user.id,
      workspaceId: workspaceContext.user.workspaceId,
      processed: false,
      disposition: 'pending' as const,
      updatedAt: i.createdAt,
    })),
  };

  const previews: OperationPreview[] =
    filteredOps.length > 0 ? buildOperationPreviews(filteredOps, previewSource) : [];

  const assistantReply = injectionBlockedNotice
    ? `${rawResponse.assistantReply || 'Analyzed your workspace.'} (Security guard: ${injectionBlockedNotice})`
    : rawResponse.assistantReply || 'I prepared the next step for your workspace.';

  return {
    stage,
    assistantReply,
    clarificationQuestions: Array.isArray(rawResponse.clarificationQuestions)
      ? rawResponse.clarificationQuestions.slice(0, 4)
      : [],
    proposedSummary:
      Array.isArray(rawResponse.proposedSummary) && rawResponse.proposedSummary.length > 0
        ? rawResponse.proposedSummary
        : previews.map((p) => p.label),
    previews,
    operations: filteredOps,
  };
}

// ── Idempotency Ledger & Unified Apply Endpoint Core ───────────────────────

export interface ApplyActionsResult {
  applied: boolean;
  deduplicated: boolean;
  idempotencyKey: string;
  serverTimeUtc: string;
  validOps: AiOperation[];
  blockedReasons: string[];
  previews: OperationPreview[];
  skippedAlreadyCompletedIds: string[];
}

export class IdempotencyLedger {
  private readonly entries = new Map<string, { createdAtMs: number; result: ApplyActionsResult }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries = 1000, ttlMs = 30 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  private compositeKey(userId: string, idempotencyKey: string): string {
    return `${userId}::${idempotencyKey}`;
  }

  get(userId: string, idempotencyKey: string, nowMs = Date.now()): ApplyActionsResult | null {
    const key = this.compositeKey(userId, idempotencyKey);
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (nowMs - hit.createdAtMs > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return hit.result;
  }

  set(userId: string, idempotencyKey: string, result: ApplyActionsResult, nowMs = Date.now()): void {
    const key = this.compositeKey(userId, idempotencyKey);
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) this.entries.delete(oldestKey);
    }
    this.entries.set(key, { createdAtMs: nowMs, result });
  }
}

export interface ApplyActionsInput {
  confirmed?: boolean;
  idempotencyKey?: string;
  operations?: AiOperation[];
  state?: {
    userId: string;
    role: UserRole;
    workspaceId: string;
    contexts: ContextItem[];
    projects: ProjectItem[];
    actions: ActionItem[];
    inboxItems: InboxItem[];
  };
}

export function validateAndApplyActions(
  input: ApplyActionsInput,
  ledger: IdempotencyLedger,
  verifiedClaims?: VerifiedFirebaseClaims | null,
  now: Date = new Date(),
): { status: number; error?: string; result?: ApplyActionsResult } {
  if (input.confirmed !== true) {
    return {
      status: 400,
      error: 'Explicit user confirmation (confirmed: true) is required before mutating workspace state.',
    };
  }

  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 160) {
    return {
      status: 400,
      error: 'A valid idempotencyKey is required for action execution.',
    };
  }

  const state = input.state;
  if (!state || !state.userId || !state.role || !state.workspaceId) {
    return {
      status: 400,
      error: 'Valid workspace state metadata (userId, role, workspaceId) is required.',
    };
  }

  // If authenticated via Firebase ID token, enforce UID alignment
  if (verifiedClaims && verifiedClaims.uid !== state.userId) {
    return {
      status: 403,
      error: 'Authenticated user UID does not match target workspace state userId.',
    };
  }

  const ops = Array.isArray(input.operations) ? input.operations : [];
  if (ops.length === 0) {
    return {
      status: 400,
      error: 'At least one operation is required.',
    };
  }

  // Rule 4: Idempotency check (same userId + idempotencyKey cannot apply twice)
  const existing = ledger.get(state.userId, idempotencyKey, now.getTime());
  if (existing) {
    return {
      status: 200,
      result: {
        ...existing,
        deduplicated: true,
      },
    };
  }

  // Rule 7 & Rule 3: Validate schema, RBAC, and normalize timestamps to UTC
  const { validOps, blockedReasons } = validateAndFilterOperations(ops, state);

  // Idempotent COMPLETE_ACTION guard: skip tasks already completed so they cannot be completed twice
  const actionMap = new Map(state.actions.map((a) => [a.id, a]));
  const skippedAlreadyCompletedIds: string[] = [];
  const dedupedOps: AiOperation[] = [];
  const seenCompleteIds = new Set<string>();

  for (const op of validOps) {
    if (op.type === 'COMPLETE_ACTION') {
      const target = actionMap.get(op.data.actionId);
      if (target?.status === 'completed' || seenCompleteIds.has(op.data.actionId)) {
        skippedAlreadyCompletedIds.push(op.data.actionId);
        continue;
      }
      seenCompleteIds.add(op.data.actionId);
    }
    // Canonical UTC check & computed priority score on CREATE_ACTION
    if (op.type === 'CREATE_ACTION') {
      const dueUtc = normalizeToUtcIso(op.data.dueDate);
      const deferUtc = normalizeToUtcIso(op.data.deferredUntil);
      const alarmUtc = normalizeToUtcIso(op.data.alarmTime);
      const status = op.data.status ?? (deferUtc && (parseUtcMs(deferUtc) ?? 0) > now.getTime() ? 'deferred' : 'active');
      const serverScore =
        typeof op.data.priorityScore === 'number'
          ? op.data.priorityScore
          : calculatePriorityScore(
              {
                starred: Boolean(op.data.starred),
                dueDate: dueUtc,
                deferredUntil: deferUtc,
                alarmTime: alarmUtc,
                status,
              },
              now,
            );
      dedupedOps.push({
        type: 'CREATE_ACTION',
        data: {
          ...op.data,
          dueDate: dueUtc,
          deferredUntil: deferUtc,
          alarmTime: alarmUtc,
          status,
          priorityScore: serverScore,
        },
      });
      continue;
    }
    dedupedOps.push(op);
  }

  const previews = buildOperationPreviews(dedupedOps, {
    contexts: state.contexts,
    projects: state.projects,
    actions: state.actions,
    inboxItems: state.inboxItems,
  });

  const result: ApplyActionsResult = {
    applied: dedupedOps.length > 0,
    deduplicated: false,
    idempotencyKey,
    serverTimeUtc: now.toISOString(),
    validOps: dedupedOps,
    blockedReasons,
    previews,
    skippedAlreadyCompletedIds,
  };

  ledger.set(state.userId, idempotencyKey, result, now.getTime());
  return { status: 200, result };
}
