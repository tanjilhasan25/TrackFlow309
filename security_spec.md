# TrackFlow Firestore Security Specification

## 1. Data Invariants
1. **Identity Integrity**: Every user-owned document (`inboxItems`, personal `contexts`, `projects`, `actions`, `reviews`) must enforce `userId == request.auth.uid` on creation and preserve `userId` immutably on update.
2. **Role & Workspace Authority**:
   - Only the Workspace Admin (`workspace.adminId == request.auth.uid`) can create invites, remove members, archive/complete shared projects, or write `team` weekly reviews.
   - Team Collaborators cannot delete projects, alter workspace settings, or self-promote their role to `admin`.
   - `users/{userId}` contains PII (`email`) and is readable only by the owner (`request.auth.uid == userId`) or the bootstrapped System Admin.
3. **Referential & Structural Boundaries**:
   - Every string enforces explicit `.size()` upper bounds matching `firebase-blueprint.json`.
   - Every bounded array (`tags <= 10`, `collaboratorIds <= 25`, `memberIds <= 25`) checks size and first-element type.
   - Server timestamps (`request.time`) are required on `createdAt`, `updatedAt`, and `completedAt`.
4. **Terminal State Locking**:
   - Processed `inboxItems` (`processed == true`) cannot be reverted to `processed == false`.
   - Completed `reviews` are immutable audit logs (no client updates or deletes).
   - Completed `projects` (`state == 'completed'`) cannot be modified by collaborators.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on User Create**: `{ name: "Eve", email: "eve@x.com", role: "individual", workspaceId: "ws1", preferences: {}, createdAt: SERVER_TIME, updatedAt: SERVER_TIME, isAdmin: true }` -> **REJECT** (`hasOnly` blocks `isAdmin`).
2. **Self-Role Escalation on User Update**: Updating `users/{uid}` with `{ role: "admin" }` when existing `role == "collaborator"` and user is not workspace admin -> **REJECT**.
3. **PII Blanket Read**: User B attempting `get(/users/userA)` -> **REJECT**.
4. **Unverified Email Spoofing**: User with `email_verified: false` attempting invite acceptance or write -> **REJECT**.
5. **Cross-User Inbox Spoof**: User B creating `inboxItems/{id}` with `userId: "userA"` -> **REJECT**.
6. **Oversized Document ID Poisoning**: Creating `actions/${'a'.repeat(300)}` -> **REJECT** (`isValidId` max 128 chars).
7. **Unbounded Array / Type Poisoning**: Creating `actions/{id}` with 15 tags or `tags: [12345]` -> **REJECT**.
8. **Collaborator Deleting Shared Project**: Collaborator issuing `delete` on `projects/{sharedId}` -> **REJECT**.
9. **Collaborator Archiving Shared Project**: Collaborator updating `state: "completed"` on `projects/{sharedId}` -> **REJECT**.
10. **Non-Admin Creating Team Review**: Individual/Collaborator creating `reviews/{id}` with `type: "team"` -> **REJECT**.
11. **Reverting Processed Inbox Item**: Updating `inboxItems/{id}` from `processed: true` back to `processed: false` -> **REJECT**.
12. **Client Timestamp Spoofing**: Creating an action with `createdAt: Timestamp(2099-01-01)` instead of `request.time` -> **REJECT**.
