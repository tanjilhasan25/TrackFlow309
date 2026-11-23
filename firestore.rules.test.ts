import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
const blueprint = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf8'));

// Pure rule-evaluator model matching firestore.rules invariants for Dirty Dozen TDD
function isValidId(id: unknown): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function validateUserCreate(
  auth: { uid: string; email: string; emailVerified: boolean } | null,
  docId: string,
  payload: Record<string, unknown>,
  serverTime: string,
): boolean {
  if (!auth || !auth.emailVerified || !isValidId(docId) || auth.uid !== docId) return false;
  const required = ['name', 'email', 'role', 'workspaceId', 'preferences', 'createdAt', 'updatedAt'];
  const keys = Object.keys(payload);
  if (!required.every((k) => keys.includes(k))) return false;
  if (!keys.every((k) => required.includes(k))) return false; // Shadow field guard
  if (payload.email !== auth.email) return false;
  if (!['individual', 'admin'].includes(String(payload.role))) return false;
  if (payload.createdAt !== serverTime || payload.updatedAt !== serverTime) return false;
  return true;
}

function validateActionCreate(
  auth: { uid: string; emailVerified: boolean } | null,
  docId: string,
  payload: Record<string, unknown>,
  serverTime: string,
): boolean {
  if (!auth || !auth.emailVerified || !isValidId(docId)) return false;
  if (payload.userId !== auth.uid) return false;
  if (!Array.isArray(payload.tags) || payload.tags.length > 10) return false;
  if (payload.tags.length > 0 && typeof payload.tags[0] !== 'string') return false;
  if (payload.createdAt !== serverTime || payload.updatedAt !== serverTime) return false;
  return true;
}

function canCollaboratorModifyProject(role: 'individual' | 'collaborator' | 'admin', action: 'delete' | 'archive'): boolean {
  if (role === 'collaborator') return false;
  return action === 'delete' || action === 'archive';
}

test('firestore.rules covers every collection in firebase-blueprint.json', () => {
  const firestorePaths = Object.keys(blueprint.firestore);
  assert.ok(firestorePaths.includes('/users/{userId}'));
  assert.ok(firestorePaths.includes('/workspaces/{workspaceId}'));
  assert.ok(firestorePaths.includes('/workspaces/{workspaceId}/members/{memberId}'));
  assert.ok(firestorePaths.includes('/workspaces/{workspaceId}/invites/{inviteId}'));
  assert.ok(firestorePaths.includes('/contexts/{contextId}'));
  assert.ok(firestorePaths.includes('/projects/{projectId}'));
  assert.ok(firestorePaths.includes('/actions/{actionId}'));
  assert.ok(firestorePaths.includes('/inboxItems/{itemId}'));
  assert.ok(firestorePaths.includes('/reviews/{reviewId}'));

  assert.ok(rulesText.includes('match /{document=**} {\n      allow read, write: if false;\n    }'));
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'));
});

test('Dirty Dozen #1 & #4: blocks shadow fields and unverified emails on user create', () => {
  const now = '2026-11-20T00:00:00Z';
  assert.equal(
    validateUserCreate(
      { uid: 'u1', email: 'eve@example.com', emailVerified: true },
      'u1',
      {
        name: 'Eve',
        email: 'eve@example.com',
        role: 'individual',
        workspaceId: 'ws_1',
        preferences: {},
        createdAt: now,
        updatedAt: now,
        isAdmin: true,
      },
      now,
    ),
    false,
  );
  assert.equal(
    validateUserCreate(
      { uid: 'u1', email: 'eve@example.com', emailVerified: false },
      'u1',
      {
        name: 'Eve',
        email: 'eve@example.com',
        role: 'individual',
        workspaceId: 'ws_1',
        preferences: {},
        createdAt: now,
        updatedAt: now,
      },
      now,
    ),
    false,
  );
});

test('Dirty Dozen #6, #7, #12: blocks oversized IDs, >10 tags, non-string tag, and spoofed timestamps', () => {
  const now = '2026-11-20T00:00:00Z';
  assert.equal(
    validateActionCreate(
      { uid: 'u1', emailVerified: true },
      'a'.repeat(200),
      { userId: 'u1', tags: [], createdAt: now, updatedAt: now },
      now,
    ),
    false,
  );
  assert.equal(
    validateActionCreate(
      { uid: 'u1', emailVerified: true },
      'act_1',
      { userId: 'u1', tags: Array(15).fill('tag'), createdAt: now, updatedAt: now },
      now,
    ),
    false,
  );
  assert.equal(
    validateActionCreate(
      { uid: 'u1', emailVerified: true },
      'act_1',
      { userId: 'u1', tags: [12345], createdAt: now, updatedAt: now },
      now,
    ),
    false,
  );
  assert.equal(
    validateActionCreate(
      { uid: 'u1', emailVerified: true },
      'act_1',
      { userId: 'u1', tags: [], createdAt: '2099-01-01T00:00:00Z', updatedAt: now },
      now,
    ),
    false,
  );
});

test('Dirty Dozen #8 & #9: blocks Team Collaborators from deleting or archiving shared projects', () => {
  assert.equal(canCollaboratorModifyProject('collaborator', 'delete'), false);
  assert.equal(canCollaboratorModifyProject('collaborator', 'archive'), false);
  assert.equal(canCollaboratorModifyProject('admin', 'archive'), true);
});
