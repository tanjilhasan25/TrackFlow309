import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { auth, db, googleProvider, handleFirestoreError, OperationType, testConnection } from '../lib/firebase';
import { createDemoSeedState, type DemoStoreState } from '../data/demoSeed';
import { createScaleWorkload, createTwentyTaskTestWorkload } from '../data/testWorkloads';
import {
  BOUNDARIES,
  calculatePriorityScore,
  clampString,
  clampTags,
  getRolePermissions,
  normalizeToUtcIso,
  type RolePermissions,
} from '../utils/gtdLogic';
import type {
  ActionItem,
  ActionStatus,
  ContextItem,
  ContextState,
  InboxDisposition,
  InboxItem,
  ProjectItem,
  ProjectState,
  ReviewRecord,
  ReviewType,
  UserProfile,
  UserRole,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
} from '../types/gtd';

const DEMO_STORAGE_KEY = 'trackflow_demo_state_v1';
const THEME_STORAGE_KEY = 'trackflow_theme_v1';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export interface DueAlarmNotice {
  actionId: string;
  description: string;
  alarmTime: string;
}

interface TrackFlowContextValue {
  mode: 'loading' | 'unauthenticated' | 'unverified' | 'firebase' | 'demo';
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  permissions: RolePermissions;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  members: WorkspaceMember[];
  pendingInvitesForMe: WorkspaceInvite[];
  sentInvites: WorkspaceInvite[];
  contexts: ContextItem[];
  projects: ProjectItem[];
  actions: ActionItem[];
  inboxItems: InboxItem[];
  reviews: ReviewRecord[];
  theme: 'light' | 'dark';
  dueAlarm: DueAlarmNotice | null;
  dismissAlarm: () => void;
  snoozeAlarm: (actionId: string, minutes?: number) => Promise<void>;
  toggleTheme: () => Promise<void>;

  // Auth
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshVerificationStatus: () => Promise<boolean>;
  enterDemoMode: (skipOnboarding?: boolean) => void;
  signOut: () => Promise<void>;

  // Role & Workspace switching
  switchRoleOrWorkspace: (role: UserRole, workspaceId?: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<string>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  inviteCollaborator: (workspaceId: string, email: string) => Promise<void>;
  revokeInvite: (workspaceId: string, inviteId: string) => Promise<void>;
  acceptInvite: (invite: WorkspaceInvite) => Promise<void>;
  updateProfileName: (name: string) => Promise<void>;
  completeOnboarding: () => Promise<void>;

  // Contexts
  createContext: (name: string, sharedInWorkspace?: boolean) => Promise<string>;
  toggleContextState: (contextId: string, state: ContextState) => Promise<void>;

  // Inbox (Feature 1)
  captureInboxItem: (content: string) => Promise<void>;
  clarifyInboxAsTrashOrSomeday: (itemId: string, disposition: 'trash' | 'someday') => Promise<void>;
  clarifyInboxAsAction: (params: {
    itemId: string;
    description: string;
    contextId: string;
    projectId?: string;
    dueDate?: string | null;
    alarmTime?: string | null;
  }) => Promise<void>;
  clarifyInboxAsNewProject: (params: {
    itemId: string;
    projectName: string;
    projectDescription: string;
    contextId: string;
    firstActionDescription: string;
    dueDate?: string | null;
    alarmTime?: string | null;
  }) => Promise<void>;

  // Actions (Feature 2 & 5)
  createAction: (params: {
    description: string;
    contextId: string;
    projectId?: string;
    projectCollaboratorIds?: string[];
    dueDate?: string | null;
    deferredUntil?: string | null;
    alarmTime?: string | null;
    notes?: string;
    tags?: string[];
    starred?: boolean;
    status?: ActionStatus;
    estimatedMinutes?: number | null;
    priorityScore?: number;
  }) => Promise<string>;
  updateAction: (actionId: string, patch: Partial<ActionItem>) => Promise<void>;
  completeAction: (actionId: string, idempotencyKey?: string) => Promise<boolean>;
  deleteAction: (actionId: string) => Promise<void>;

  // Projects (Feature 3)
  createProject: (params: {
    name: string;
    description: string;
    defaultContextId: string;
    isShared: boolean;
  }) => Promise<string>;
  updateProjectState: (projectId: string, nextState: ProjectState) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;

  // Weekly Review (Feature 4)
  completeWeeklyReview: (type: ReviewType, notes: string) => Promise<void>;

  // AI Assistant Drawer
  aiChatOpen: boolean;
  aiChatInitialPrompt: string;
  openAiChat: (initialPrompt?: string) => void;
  closeAiChat: () => void;
}

const TrackFlowContext = createContext<TrackFlowContextValue | null>(null);

export function useTrackFlow(): TrackFlowContextValue {
  const ctx = useContext(TrackFlowContext);
  if (!ctx) {
    throw new Error('useTrackFlow must be used inside TrackFlowProvider');
  }
  return ctx;
}

export function TrackFlowProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<'loading' | 'unauthenticated' | 'unverified' | 'firebase' | 'demo'>('loading');
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [demoState, setDemoState] = useState<DemoStoreState | null>(null);

  // Live Firestore states
  const [fbProfile, setFbProfile] = useState<UserProfile | null>(null);
  const [fbWorkspaces, setFbWorkspaces] = useState<Workspace[]>([]);
  const [fbMembers, setFbMembers] = useState<WorkspaceMember[]>([]);
  const [fbPendingInvites, setFbPendingInvites] = useState<WorkspaceInvite[]>([]);
  const [fbSentInvites, setFbSentInvites] = useState<WorkspaceInvite[]>([]);
  const [fbContexts, setFbContexts] = useState<ContextItem[]>([]);
  const [fbOwnedProjects, setFbOwnedProjects] = useState<ProjectItem[]>([]);
  const [fbSharedProjects, setFbSharedProjects] = useState<ProjectItem[]>([]);
  const [fbOwnedActions, setFbOwnedActions] = useState<ActionItem[]>([]);
  const [fbSharedActions, setFbSharedActions] = useState<ActionItem[]>([]);
  const [fbInboxItems, setFbInboxItems] = useState<InboxItem[]>([]);
  const [fbReviewsOwned, setFbReviewsOwned] = useState<ReviewRecord[]>([]);
  const [fbReviewsMember, setFbReviewsMember] = useState<ReviewRecord[]>([]);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return 'light';
  });

  const [dueAlarm, setDueAlarm] = useState<DueAlarmNotice | null>(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatInitialPrompt, setAiChatInitialPrompt] = useState('');
  const notifiedAlarmsRef = useRef<Set<string>>(new Set());
  const inFlightCompletionsRef = useRef<Set<string>>(new Set());
  const usedCompletionKeysRef = useRef<Set<string>>(new Set());

  const openAiChat = useCallback((initialPrompt = '') => {
    setAiChatInitialPrompt(initialPrompt);
    setAiChatOpen(true);
  }, []);

  const closeAiChat = useCallback(() => {
    setAiChatOpen(false);
  }, []);

  // Sync theme to <html> class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // Startup connection validation
  useEffect(() => {
    testConnection();
  }, []);

  const enterDemoMode = useCallback((skipOnboarding = false) => {
    let next: DemoStoreState;
    try {
      const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        next = JSON.parse(raw) as DemoStoreState;
      } else {
        next = createDemoSeedState();
      }
    } catch {
      next = createDemoSeedState();
    }
    if (skipOnboarding) {
      next = {
        ...next,
        profile: {
          ...next.profile,
          preferences: {
            ...next.profile.preferences,
            onboardingCompleted: true,
          },
        },
      };
    }
    setDemoState(next);
    setMode('demo');
  }, []);

  const persistDemo = useCallback((updater: (prev: DemoStoreState) => DemoStoreState) => {
    setDemoState((prev) => {
      if (!prev) return prev;
      const updated = updater(prev);
      try {
        window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage quota errors
      }
      return updated;
    });
  }, []);

  // Provision initial Firestore profile + personal workspace for newly verified Firebase user
  const ensureFirebaseUserBootstrapped = useCallback(async (user: FirebaseUser) => {
    const userRef = doc(db, 'users', user.uid);
    let snap;
    try {
      snap = await getDoc(userRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
    }
    if (snap.exists()) return;

    const personalWsId = `ws_${user.uid.slice(0, 12)}`;
    const displayName = clampString(user.displayName || user.email?.split('@')[0] || 'TrackFlow User', BOUNDARIES.NAME_MAX);
    const email = user.email || '';

    const batch = writeBatch(db);
    batch.set(doc(db, 'workspaces', personalWsId), {
      name: 'Personal Workspace',
      adminId: user.uid,
      memberIds: [user.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'workspaces', personalWsId, 'members', user.uid), {
      workspaceId: personalWsId,
      userId: user.uid,
      adminId: user.uid,
      name: displayName,
      email,
      role: 'individual',
      inviteId: '',
      joinedAt: serverTimestamp(),
    });
    batch.set(userRef, {
      name: displayName,
      email,
      role: 'individual',
      workspaceId: personalWsId,
      preferences: {
        theme,
        dailyFocusLimit: 5,
        alarmsEnabled: true,
        onboardingCompleted: false,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const starterContexts = ['@Computer', '@Deep Work', '@Calls', '@Errands'];
    starterContexts.forEach((ctxName, idx) => {
      const ctxId = `ctx_${user.uid.slice(0, 8)}_${idx}`;
      batch.set(doc(db, 'contexts', ctxId), {
        userId: user.uid,
        workspaceId: personalWsId,
        memberIds: [user.uid],
        name: ctxName,
        position: idx,
        state: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    }
  }, [theme]);

  // Listen to Firebase Auth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const workload = params.get('workload');
      if (workload === '20') {
        const seeded = createTwentyTaskTestWorkload();
        try {
          window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(seeded));
        } catch {
          // ignore storage quota errors
        }
        setDemoState(seeded);
        setMode('demo');
        return;
      }
      if (workload === '1200') {
        const seeded = createScaleWorkload(1200);
        try {
          window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(seeded));
        } catch {
          // ignore storage quota errors
        }
        setDemoState(seeded);
        setMode('demo');
        return;
      }
      enterDemoMode(true);
      return;
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setMode((prev) => (prev === 'demo' ? 'demo' : 'unauthenticated'));
        return;
      }
      if (!user.emailVerified) {
        setMode('unverified');
        return;
      }
      try {
        await ensureFirebaseUserBootstrapped(user);
        setMode('firebase');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to initialize your workspace.';
        toast.error(msg);
        setMode('unauthenticated');
      }
    });

    return () => unsub();
  }, [ensureFirebaseUserBootstrapped, enterDemoMode]);

  // Attach real-time Firestore listeners when in authenticated 'firebase' mode
  useEffect(() => {
    if (mode !== 'firebase' || !firebaseUser) return;
    const uid = firebaseUser.uid;
    const email = firebaseUser.email ?? '';

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data();
            const prof: UserProfile = {
              id: snap.id,
              name: d.name,
              email: d.email,
              role: d.role,
              workspaceId: d.workspaceId,
              preferences: d.preferences,
              createdAt: toIsoString(d.createdAt),
              updatedAt: toIsoString(d.updatedAt),
            };
            setFbProfile(prof);
            if (d.preferences?.theme === 'dark' || d.preferences?.theme === 'light') {
              setTheme(d.preferences.theme);
            }
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`),
      ),
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'workspaces'), where('memberIds', 'array-contains', uid)),
        (snap) => {
          setFbWorkspaces(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                name: d.name,
                adminId: d.adminId,
                memberIds: d.memberIds ?? [],
                createdAt: toIsoString(d.createdAt),
                updatedAt: toIsoString(d.updatedAt),
              };
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'workspaces'),
      ),
    );

    if (email) {
      unsubs.push(
        onSnapshot(
          query(collectionGroup(db, 'invites'), where('invitedEmail', '==', email)),
          (snap) => {
            setFbPendingInvites(
              snap.docs
                .map((docSnap) => {
                  const d = docSnap.data();
                  return {
                    id: docSnap.id,
                    workspaceId: d.workspaceId,
                    workspaceName: d.workspaceName,
                    adminId: d.adminId,
                    invitedEmail: d.invitedEmail,
                    role: d.role,
                    status: d.status,
                    createdAt: toIsoString(d.createdAt),
                  } as WorkspaceInvite;
                })
                .filter((inv) => inv.status === 'pending'),
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'invites'),
        ),
      );
    }

    unsubs.push(
      onSnapshot(
        query(collection(db, 'contexts'), where('memberIds', 'array-contains', uid)),
        (snap) => {
          const list = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              userId: d.userId,
              workspaceId: d.workspaceId,
              memberIds: d.memberIds ?? [],
              name: d.name,
              position: d.position ?? 0,
              state: d.state,
              createdAt: toIsoString(d.createdAt),
              updatedAt: toIsoString(d.updatedAt),
            } as ContextItem;
          });
          list.sort((a, b) => a.position - b.position);
          setFbContexts(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'contexts'),
      ),
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'projects'), where('userId', '==', uid)),
        (snap) => {
          setFbOwnedProjects(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                userId: d.userId,
                workspaceId: d.workspaceId,
                collaboratorIds: d.collaboratorIds ?? [],
                name: d.name,
                description: d.description ?? '',
                state: d.state,
                defaultContextId: d.defaultContextId ?? '',
                isShared: Boolean(d.isShared),
                createdAt: toIsoString(d.createdAt),
                updatedAt: toIsoString(d.updatedAt),
                completedAt: d.completedAt ? toIsoString(d.completedAt) : null,
              };
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'projects(owned)'),
      ),
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'projects'), where('collaboratorIds', 'array-contains', uid)),
        (snap) => {
          setFbSharedProjects(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                userId: d.userId,
                workspaceId: d.workspaceId,
                collaboratorIds: d.collaboratorIds ?? [],
                name: d.name,
                description: d.description ?? '',
                state: d.state,
                defaultContextId: d.defaultContextId ?? '',
                isShared: Boolean(d.isShared),
                createdAt: toIsoString(d.createdAt),
                updatedAt: toIsoString(d.updatedAt),
                completedAt: d.completedAt ? toIsoString(d.completedAt) : null,
              };
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'projects(shared)'),
      ),
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'actions'), where('userId', '==', uid)),
        (snap) => {
          setFbOwnedActions(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                userId: d.userId,
                workspaceId: d.workspaceId,
                projectId: d.projectId ?? '',
                projectCollaboratorIds: d.projectCollaboratorIds ?? [],
                contextId: d.contextId ?? '',
                description: d.description,
                status: d.status,
                dueDate: d.dueDate ?? null,
                deferredUntil: d.deferredUntil ?? null,
                starred: Boolean(d.starred),
                priorityScore: Number(d.priorityScore ?? 25),
                tags: d.tags ?? [],
                notes: d.notes ?? '',
                alarmTime: d.alarmTime ?? null,
                estimatedMinutes: d.estimatedMinutes ?? null,
                createdAt: toIsoString(d.createdAt),
                updatedAt: toIsoString(d.updatedAt),
                completedAt: d.completedAt ? toIsoString(d.completedAt) : null,
              };
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'actions(owned)'),
      ),
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'actions'), where('projectCollaboratorIds', 'array-contains', uid)),
        (snap) => {
          setFbSharedActions(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                userId: d.userId,
                workspaceId: d.workspaceId,
                projectId: d.projectId ?? '',
                projectCollaboratorIds: d.projectCollaboratorIds ?? [],
                contextId: d.contextId ?? '',
                description: d.description,
                status: d.status,
                dueDate: d.dueDate ?? null,
                deferredUntil: d.deferredUntil ?? null,
                starred: Boolean(d.starred),
                priorityScore: Number(d.priorityScore ?? 25),
                tags: d.tags ?? [],
                notes: d.notes ?? '',
                alarmTime: d.alarmTime ?? null,
                estimatedMinutes: d.estimatedMinutes ?? null,
                createdAt: toIsoString(d.createdAt),
                updatedAt: toIsoString(d.updatedAt),
                completedAt: d.completedAt ? toIsoString(d.completedAt) : null,
              };
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'actions(shared)'),
      ),
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'inboxItems'), where('userId', '==', uid)),
        (snap) => {
          setFbInboxItems(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                userId: d.userId,
                workspaceId: d.workspaceId,
                content: d.content,
                processed: Boolean(d.processed),
                disposition: d.disposition,
                createdAt: toIsoString(d.createdAt),
                updatedAt: toIsoString(d.updatedAt),
              };
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'inboxItems'),
      ),
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'reviews'), where('userId', '==', uid)),
        (snap) => {
          setFbReviewsOwned(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                userId: d.userId,
                workspaceId: d.workspaceId,
                memberIds: d.memberIds ?? [],
                type: d.type,
                notes: d.notes,
                completedAt: toIsoString(d.completedAt),
              };
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'reviews(owned)'),
      ),
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'reviews'), where('memberIds', 'array-contains', uid)),
        (snap) => {
          setFbReviewsMember(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                userId: d.userId,
                workspaceId: d.workspaceId,
                memberIds: d.memberIds ?? [],
                type: d.type,
                notes: d.notes,
                completedAt: toIsoString(d.completedAt),
              };
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'reviews(member)'),
      ),
    );

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [mode, firebaseUser]);

  // Listen to active workspace's members & sent invites when admin
  const activeWsId = mode === 'demo' ? demoState?.profile.workspaceId : fbProfile?.workspaceId;
  useEffect(() => {
    if (mode !== 'firebase' || !firebaseUser || !activeWsId) return;
    const uid = firebaseUser.uid;
    const activeWs = fbWorkspaces.find((w) => w.id === activeWsId);
    const isAdminOfWs = activeWs?.adminId === uid;

    const unsubs: Array<() => void> = [];
    const membersQuery = isAdminOfWs
      ? query(collection(db, 'workspaces', activeWsId, 'members'), where('adminId', '==', uid))
      : query(collection(db, 'workspaces', activeWsId, 'members'), where('userId', '==', uid));

    unsubs.push(
      onSnapshot(
        membersQuery,
        (snap) => {
          setFbMembers(
            snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                workspaceId: d.workspaceId,
                userId: d.userId,
                adminId: d.adminId,
                name: d.name,
                email: d.email,
                role: d.role,
                inviteId: d.inviteId ?? '',
                joinedAt: toIsoString(d.joinedAt),
              };
            }),
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `workspaces/${activeWsId}/members`),
      ),
    );

    if (isAdminOfWs) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'workspaces', activeWsId, 'invites'), where('adminId', '==', uid)),
          (snap) => {
            setFbSentInvites(
              snap.docs.map((docSnap) => {
                const d = docSnap.data();
                return {
                  id: docSnap.id,
                  workspaceId: d.workspaceId,
                  workspaceName: d.workspaceName,
                  adminId: d.adminId,
                  invitedEmail: d.invitedEmail,
                  role: d.role,
                  status: d.status,
                  createdAt: toIsoString(d.createdAt),
                };
              }),
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `workspaces/${activeWsId}/invites`),
        ),
      );
    } else {
      setFbSentInvites([]);
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [mode, firebaseUser, activeWsId, fbWorkspaces]);

  // Unified selectors across Demo & Firebase
  const profile = mode === 'demo' ? demoState?.profile ?? null : fbProfile;
  const workspaces = mode === 'demo' ? demoState?.workspaces ?? [] : fbWorkspaces;
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === profile?.workspaceId) ?? workspaces[0] ?? null,
    [workspaces, profile?.workspaceId],
  );
  const members = useMemo(() => {
    const all = mode === 'demo' ? demoState?.members ?? [] : fbMembers;
    return all.filter((m) => !activeWorkspace || m.workspaceId === activeWorkspace.id);
  }, [mode, demoState?.members, fbMembers, activeWorkspace]);

  const pendingInvitesForMe = useMemo(() => {
    if (mode === 'demo') return [];
    return fbPendingInvites;
  }, [mode, fbPendingInvites]);

  const sentInvites = useMemo(() => {
    const all = mode === 'demo' ? demoState?.invites ?? [] : fbSentInvites;
    return all.filter((i) => !activeWorkspace || i.workspaceId === activeWorkspace.id);
  }, [mode, demoState?.invites, fbSentInvites, activeWorkspace]);

  const contexts = mode === 'demo' ? demoState?.contexts ?? [] : fbContexts;

  const projects = useMemo(() => {
    if (mode === 'demo') return demoState?.projects ?? [];
    const map = new Map<string, ProjectItem>();
    for (const p of fbOwnedProjects) map.set(p.id, p);
    for (const p of fbSharedProjects) map.set(p.id, p);
    return Array.from(map.values());
  }, [mode, demoState?.projects, fbOwnedProjects, fbSharedProjects]);

  const actions = useMemo(() => {
    if (mode === 'demo') return demoState?.actions ?? [];
    const map = new Map<string, ActionItem>();
    for (const a of fbOwnedActions) map.set(a.id, a);
    for (const a of fbSharedActions) map.set(a.id, a);
    return Array.from(map.values());
  }, [mode, demoState?.actions, fbOwnedActions, fbSharedActions]);

  const inboxItems = mode === 'demo' ? demoState?.inboxItems ?? [] : fbInboxItems;

  const reviews = useMemo(() => {
    if (mode === 'demo') return demoState?.reviews ?? [];
    const map = new Map<string, ReviewRecord>();
    for (const r of fbReviewsOwned) map.set(r.id, r);
    for (const r of fbReviewsMember) map.set(r.id, r);
    return Array.from(map.values()).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }, [mode, demoState?.reviews, fbReviewsOwned, fbReviewsMember]);

  const permissions = useMemo(
    () => getRolePermissions(profile?.role ?? 'individual'),
    [profile?.role],
  );

  // Alarm Watcher
  useEffect(() => {
    if (!profile?.preferences.alarmsEnabled) return;
    const checkAlarms = () => {
      const nowMs = Date.now();
      for (const act of actions) {
        if (act.status !== 'active' || !act.alarmTime) continue;
        const alarmMs = new Date(act.alarmTime).getTime();
        if (Number.isNaN(alarmMs)) continue;
        const key = `${act.id}:${act.alarmTime}`;
        if (alarmMs <= nowMs && nowMs - alarmMs <= 60 * 60 * 1000 && !notifiedAlarmsRef.current.has(key)) {
          notifiedAlarmsRef.current.add(key);
          setDueAlarm({
            actionId: act.id,
            description: act.description,
            alarmTime: act.alarmTime,
          });
          toast.info(`Reminder: ${act.description}`);
          break;
        }
      }
    };
    checkAlarms();
    const timer = window.setInterval(checkAlarms, 30000);
    return () => window.clearInterval(timer);
  }, [actions, profile?.preferences.alarmsEnabled]);

  const dismissAlarm = useCallback(() => setDueAlarm(null), []);

  // Auth Actions
  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (!cred.user.emailVerified) {
      setMode('unverified');
    }
  }, []);

  const registerWithEmail = useCallback(async (name: string, email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: clampString(name, BOUNDARIES.NAME_MAX) });
    await sendEmailVerification(cred.user);
    setMode('unverified');
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
    toast.success('Verification email sent. Check your inbox.');
  }, []);

  const refreshVerificationStatus = useCallback(async () => {
    if (!auth.currentUser) return false;
    await reload(auth.currentUser);
    if (auth.currentUser.emailVerified) {
      await ensureFirebaseUserBootstrapped(auth.currentUser);
      setMode('firebase');
      return true;
    }
    toast.error('Email is not verified yet.');
    return false;
  }, [ensureFirebaseUserBootstrapped]);

  const signOut = useCallback(async () => {
    if (mode === 'demo') {
      setDemoState(null);
      setMode(firebaseUser ? (firebaseUser.emailVerified ? 'firebase' : 'unverified') : 'unauthenticated');
      return;
    }
    await firebaseSignOut(auth);
    setFbProfile(null);
    setMode('unauthenticated');
  }, [mode, firebaseUser]);

  // Preferences & Theme
  const toggleTheme = useCallback(async () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    if (!profile) return;
    if (mode === 'demo') {
      persistDemo((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          preferences: { ...prev.profile.preferences, theme: nextTheme },
          updatedAt: new Date().toISOString(),
        },
      }));
    } else if (mode === 'firebase') {
      try {
        await updateDoc(doc(db, 'users', profile.id), {
          preferences: { ...profile.preferences, theme: nextTheme },
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${profile.id}`);
      }
    }
  }, [theme, profile, mode, persistDemo]);

  const updateProfileName = useCallback(
    async (name: string) => {
      if (!profile) return;
      const clean = clampString(name, BOUNDARIES.NAME_MAX);
      if (!clean) return;
      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          profile: { ...prev.profile, name: clean, updatedAt: new Date().toISOString() },
        }));
        toast.success('Profile updated');
      } else {
        try {
          await updateDoc(doc(db, 'users', profile.id), {
            name: clean,
            updatedAt: serverTimestamp(),
          });
          toast.success('Profile updated');
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `users/${profile.id}`);
        }
      }
    },
    [profile, mode, persistDemo],
  );

  const completeOnboarding = useCallback(async () => {
    if (!profile) return;
    if (mode === 'demo') {
      persistDemo((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          preferences: { ...prev.profile.preferences, onboardingCompleted: true },
          updatedAt: new Date().toISOString(),
        },
      }));
    } else {
      try {
        await updateDoc(doc(db, 'users', profile.id), {
          preferences: { ...profile.preferences, onboardingCompleted: true },
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${profile.id}`);
      }
    }
  }, [profile, mode, persistDemo]);

  const switchRoleOrWorkspace = useCallback(
    async (role: UserRole, workspaceId?: string) => {
      if (!profile) return;
      const targetWsId = workspaceId ?? profile.workspaceId;
      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          profile: {
            ...prev.profile,
            role,
            workspaceId: targetWsId,
            updatedAt: new Date().toISOString(),
          },
        }));
        toast.success(`Switched to ${role === 'admin' ? 'Workspace Admin' : role === 'collaborator' ? 'Team Collaborator' : 'Individual User'}`);
      } else {
        try {
          await updateDoc(doc(db, 'users', profile.id), {
            role,
            workspaceId: targetWsId,
            updatedAt: serverTimestamp(),
          });
          toast.success('Workspace & role updated');
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `users/${profile.id}`);
        }
      }
    },
    [profile, mode, persistDemo],
  );

  const createWorkspace = useCallback(
    async (name: string) => {
      if (!profile) throw new Error('Not signed in');
      const cleanName = clampString(name, BOUNDARIES.NAME_MAX);
      const wsId = makeId('ws');
      const nowIso = new Date().toISOString();

      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          workspaces: [
            ...prev.workspaces,
            { id: wsId, name: cleanName, adminId: profile.id, memberIds: [profile.id], createdAt: nowIso, updatedAt: nowIso },
          ],
          members: [
            ...prev.members,
            {
              id: profile.id,
              workspaceId: wsId,
              userId: profile.id,
              adminId: profile.id,
              name: profile.name,
              email: profile.email,
              role: 'admin',
              inviteId: '',
              joinedAt: nowIso,
            },
          ],
          profile: { ...prev.profile, role: 'admin', workspaceId: wsId, updatedAt: nowIso },
        }));
        return wsId;
      }

      const batch = writeBatch(db);
      batch.set(doc(db, 'workspaces', wsId), {
        name: cleanName,
        adminId: profile.id,
        memberIds: [profile.id],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'workspaces', wsId, 'members', profile.id), {
        workspaceId: wsId,
        userId: profile.id,
        adminId: profile.id,
        name: profile.name,
        email: profile.email,
        role: 'admin',
        inviteId: '',
        joinedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', profile.id), {
        role: 'admin',
        workspaceId: wsId,
        updatedAt: serverTimestamp(),
      });
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `workspaces/${wsId}`);
      }
      return wsId;
    },
    [profile, mode, persistDemo],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      const cleanName = clampString(name, BOUNDARIES.NAME_MAX);
      if (!cleanName) return;
      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          workspaces: prev.workspaces.map((w) => (w.id === workspaceId ? { ...w, name: cleanName } : w)),
        }));
        toast.success('Workspace renamed');
      } else {
        try {
          await updateDoc(doc(db, 'workspaces', workspaceId), {
            name: cleanName,
            updatedAt: serverTimestamp(),
          });
          toast.success('Workspace renamed');
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `workspaces/${workspaceId}`);
        }
      }
    },
    [mode, persistDemo],
  );

  const inviteCollaborator = useCallback(
    async (workspaceId: string, email: string) => {
      if (!profile) return;
      const cleanEmail = email.trim().toLowerCase();
      const ws = workspaces.find((w) => w.id === workspaceId);
      if (!ws) return;
      const inviteId = makeId('inv');
      const nowIso = new Date().toISOString();

      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          invites: [
            ...prev.invites,
            {
              id: inviteId,
              workspaceId,
              workspaceName: ws.name,
              adminId: profile.id,
              invitedEmail: cleanEmail,
              role: 'collaborator',
              status: 'pending',
              createdAt: nowIso,
            },
          ],
        }));
        toast.success(`Invitation created for ${cleanEmail}`);
      } else {
        try {
          await setDoc(doc(db, 'workspaces', workspaceId, 'invites', inviteId), {
            workspaceId,
            workspaceName: ws.name,
            adminId: profile.id,
            invitedEmail: cleanEmail,
            role: 'collaborator',
            status: 'pending',
            createdAt: serverTimestamp(),
          });
          toast.success(`Invitation sent to ${cleanEmail}`);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `workspaces/${workspaceId}/invites/${inviteId}`);
        }
      }
    },
    [profile, workspaces, mode, persistDemo],
  );

  const revokeInvite = useCallback(
    async (workspaceId: string, inviteId: string) => {
      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          invites: prev.invites.map((i) => (i.id === inviteId ? { ...i, status: 'revoked' } : i)),
        }));
        toast.success('Invitation revoked');
      } else {
        try {
          await updateDoc(doc(db, 'workspaces', workspaceId, 'invites', inviteId), {
            status: 'revoked',
          });
          toast.success('Invitation revoked');
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `workspaces/${workspaceId}/invites/${inviteId}`);
        }
      }
    },
    [mode, persistDemo],
  );

  const acceptInvite = useCallback(
    async (invite: WorkspaceInvite) => {
      if (!profile || mode !== 'firebase') return;
      const wsRef = doc(db, 'workspaces', invite.workspaceId);
      const wsSnap = await getDoc(wsRef);
      if (!wsSnap.exists()) {
        toast.error('Workspace no longer exists.');
        return;
      }
      const currentMembers: string[] = wsSnap.data().memberIds ?? [];
      const nextMembers = currentMembers.includes(profile.id) ? currentMembers : [...currentMembers, profile.id].slice(0, 25);

      const batch = writeBatch(db);
      batch.set(doc(db, 'workspaces', invite.workspaceId, 'members', profile.id), {
        workspaceId: invite.workspaceId,
        userId: profile.id,
        adminId: invite.adminId,
        name: profile.name,
        email: profile.email,
        role: 'collaborator',
        inviteId: invite.id,
        joinedAt: serverTimestamp(),
      });
      batch.update(wsRef, {
        memberIds: nextMembers,
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'workspaces', invite.workspaceId, 'invites', invite.id), {
        status: 'accepted',
      });
      batch.update(doc(db, 'users', profile.id), {
        role: 'collaborator',
        workspaceId: invite.workspaceId,
        updatedAt: serverTimestamp(),
      });

      try {
        await batch.commit();
        toast.success(`Joined ${invite.workspaceName} as Team Collaborator`);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `workspaces/${invite.workspaceId}/invites/${invite.id}`);
      }
    },
    [profile, mode],
  );

  // Contexts
  const createContext = useCallback(
    async (name: string, sharedInWorkspace = false) => {
      if (!profile) throw new Error('Not signed in');
      const cleanName = clampString(name, BOUNDARIES.CONTEXT_NAME_MAX);
      const formatted = cleanName.startsWith('@') ? cleanName : `@${cleanName}`;
      const ctxId = makeId('ctx');
      const wsId = activeWorkspace?.id || profile.workspaceId;
      const memberIds =
        sharedInWorkspace && activeWorkspace && activeWorkspace.adminId === profile.id
          ? activeWorkspace.memberIds.slice(0, BOUNDARIES.MEMBERS_MAX_COUNT)
          : [profile.id];
      const nowIso = new Date().toISOString();

      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          contexts: [
            ...prev.contexts,
            {
              id: ctxId,
              userId: profile.id,
              workspaceId: wsId,
              memberIds,
              name: formatted,
              position: prev.contexts.length,
              state: 'active',
              createdAt: nowIso,
              updatedAt: nowIso,
            },
          ],
        }));
        return ctxId;
      }

      try {
        await setDoc(doc(db, 'contexts', ctxId), {
          userId: profile.id,
          workspaceId: wsId,
          memberIds,
          name: formatted,
          position: contexts.length,
          state: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `contexts/${ctxId}`);
      }
      return ctxId;
    },
    [profile, activeWorkspace, contexts.length, mode, persistDemo],
  );

  const toggleContextState = useCallback(
    async (contextId: string, state: ContextState) => {
      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          contexts: prev.contexts.map((c) => (c.id === contextId ? { ...c, state, updatedAt: new Date().toISOString() } : c)),
        }));
      } else {
        try {
          await updateDoc(doc(db, 'contexts', contextId), {
            state,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `contexts/${contextId}`);
        }
      }
    },
    [mode, persistDemo],
  );

  // Actions
  const createAction = useCallback(
    async (params: {
      description: string;
      contextId: string;
      projectId?: string;
      projectCollaboratorIds?: string[];
      dueDate?: string | null;
      deferredUntil?: string | null;
      alarmTime?: string | null;
      notes?: string;
      tags?: string[];
      starred?: boolean;
      status?: ActionStatus;
      estimatedMinutes?: number | null;
      priorityScore?: number;
    }) => {
      if (!profile) throw new Error('Not signed in');
      const actId = makeId('act');
      const nowIso = new Date().toISOString();
      const project = params.projectId ? projects.find((p) => p.id === params.projectId) : undefined;
      const resolvedProjectId = project?.id ?? params.projectId ?? '';
      const wsId = project?.workspaceId || activeWorkspace?.id || profile.workspaceId;
      const projectCollaboratorIds = resolvedProjectId
        ? (project?.collaboratorIds ?? params.projectCollaboratorIds ?? [profile.id]).slice(0, BOUNDARIES.MEMBERS_MAX_COUNT)
        : [];
      const normalizedDue = normalizeToUtcIso(params.dueDate);
      const normalizedDefer = normalizeToUtcIso(params.deferredUntil);
      const normalizedAlarm = normalizeToUtcIso(params.alarmTime);
      const status: ActionStatus = params.status ?? (normalizedDefer ? 'deferred' : 'active');
      const starred = Boolean(params.starred);
      const computedScore = calculatePriorityScore({
        starred,
        dueDate: normalizedDue,
        deferredUntil: normalizedDefer,
        alarmTime: normalizedAlarm,
        status,
      });
      const priorityScore =
        typeof params.priorityScore === 'number'
          ? Math.min(100, Math.max(0, Math.round(params.priorityScore)))
          : computedScore;

      const newAction: ActionItem = {
        id: actId,
        userId: profile.id,
        workspaceId: wsId,
        projectId: resolvedProjectId,
        projectCollaboratorIds,
        contextId: params.contextId,
        description: clampString(params.description, BOUNDARIES.ACTION_DESC_MAX),
        status,
        dueDate: normalizedDue,
        deferredUntil: normalizedDefer,
        starred,
        priorityScore,
        tags: clampTags(params.tags ?? []),
        notes: clampString(params.notes ?? '', BOUNDARIES.NOTES_MAX),
        alarmTime: normalizedAlarm,
        estimatedMinutes: params.estimatedMinutes ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
        completedAt: null,
      };

      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          actions: [newAction, ...prev.actions],
        }));
        return actId;
      }

      try {
        await setDoc(doc(db, 'actions', actId), {
          userId: profile.id,
          workspaceId: wsId,
          projectId: newAction.projectId,
          projectCollaboratorIds,
          contextId: newAction.contextId,
          description: newAction.description,
          status: newAction.status,
          dueDate: newAction.dueDate,
          deferredUntil: newAction.deferredUntil,
          starred: newAction.starred,
          priorityScore: newAction.priorityScore,
          tags: newAction.tags,
          notes: newAction.notes,
          alarmTime: newAction.alarmTime,
          estimatedMinutes: newAction.estimatedMinutes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          completedAt: null,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `actions/${actId}`);
      }
      return actId;
    },
    [profile, projects, activeWorkspace, mode, persistDemo],
  );

  const updateAction = useCallback(
    async (actionId: string, patch: Partial<ActionItem>) => {
      const existing = actions.find((a) => a.id === actionId);
      if (!existing) return;
      const normalizedPatch: Partial<ActionItem> = { ...patch };
      if ('dueDate' in patch) normalizedPatch.dueDate = normalizeToUtcIso(patch.dueDate);
      if ('deferredUntil' in patch) normalizedPatch.deferredUntil = normalizeToUtcIso(patch.deferredUntil);
      if ('alarmTime' in patch) normalizedPatch.alarmTime = normalizeToUtcIso(patch.alarmTime);

      const merged = { ...existing, ...normalizedPatch };
      const priorityScore =
        normalizedPatch.priorityScore !== undefined
          ? normalizedPatch.priorityScore
          : calculatePriorityScore(merged);

      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          actions: prev.actions.map((a) =>
            a.id === actionId
              ? { ...a, ...normalizedPatch, priorityScore, updatedAt: new Date().toISOString() }
              : a,
          ),
        }));
      } else {
        const updatePayload: Record<string, unknown> = {
          ...normalizedPatch,
          priorityScore,
          updatedAt: serverTimestamp(),
        };
        delete updatePayload.id;
        delete updatePayload.userId;
        delete updatePayload.workspaceId;
        delete updatePayload.createdAt;
        if (typeof updatePayload.description === 'string') {
          updatePayload.description = clampString(updatePayload.description, BOUNDARIES.ACTION_DESC_MAX);
        }
        if (typeof updatePayload.notes === 'string') {
          updatePayload.notes = clampString(updatePayload.notes, BOUNDARIES.NOTES_MAX);
        }
        if (Array.isArray(updatePayload.tags)) {
          updatePayload.tags = clampTags(updatePayload.tags as string[]);
        }
        try {
          await updateDoc(doc(db, 'actions', actionId), updatePayload);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `actions/${actionId}`);
        }
      }
    },
    [actions, mode, persistDemo],
  );

  const completeAction = useCallback(
    async (actionId: string, idempotencyKey?: string): Promise<boolean> => {
      const target = actions.find((a) => a.id === actionId);
      if (!target || target.status === 'completed') {
        return false;
      }
      if (inFlightCompletionsRef.current.has(actionId)) {
        return false;
      }
      if (idempotencyKey && usedCompletionKeysRef.current.has(idempotencyKey)) {
        return false;
      }

      inFlightCompletionsRef.current.add(actionId);
      if (idempotencyKey) {
        usedCompletionKeysRef.current.add(idempotencyKey);
      }

      try {
        const nowIso = new Date().toISOString();
        if (mode === 'demo') {
          let didComplete = false;
          persistDemo((prev) => ({
            ...prev,
            actions: prev.actions.map((a) => {
              if (a.id !== actionId || a.status === 'completed') return a;
              didComplete = true;
              return { ...a, status: 'completed', priorityScore: 0, completedAt: nowIso, updatedAt: nowIso };
            }),
          }));
          if (!didComplete) {
            return false;
          }
        } else {
          try {
            await updateDoc(doc(db, 'actions', actionId), {
              status: 'completed',
              priorityScore: 0,
              completedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `actions/${actionId}`);
          }
        }
        if (dueAlarm?.actionId === actionId) {
          setDueAlarm(null);
        }
        return true;
      } finally {
        inFlightCompletionsRef.current.delete(actionId);
      }
    },
    [actions, mode, persistDemo, dueAlarm],
  );

  const snoozeAlarm = useCallback(
    async (actionId: string, minutes = 15) => {
      const snoozeTime = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      await updateAction(actionId, { alarmTime: snoozeTime });
      setDueAlarm(null);
      toast.success(`Alarm snoozed for ${minutes} minutes`);
    },
    [updateAction],
  );

  const deleteAction = useCallback(
    async (actionId: string) => {
      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          actions: prev.actions.filter((a) => a.id !== actionId),
        }));
      } else {
        try {
          await deleteDoc(doc(db, 'actions', actionId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `actions/${actionId}`);
        }
      }
    },
    [mode, persistDemo],
  );

  // Projects (Feature 3)
  const createProject = useCallback(
    async (params: {
      name: string;
      description: string;
      defaultContextId: string;
      isShared: boolean;
    }) => {
      if (!profile) throw new Error('Not signed in');
      const projId = makeId('proj');
      const nowIso = new Date().toISOString();
      const wsId = activeWorkspace?.id || profile.workspaceId;
      const collaboratorIds =
        params.isShared && activeWorkspace
          ? activeWorkspace.memberIds.slice(0, BOUNDARIES.MEMBERS_MAX_COUNT)
          : [profile.id];

      const newProj: ProjectItem = {
        id: projId,
        userId: profile.id,
        workspaceId: wsId,
        collaboratorIds,
        name: clampString(params.name, BOUNDARIES.PROJECT_NAME_MAX),
        description: clampString(params.description, BOUNDARIES.PROJECT_DESC_MAX),
        state: 'active',
        defaultContextId: params.defaultContextId,
        isShared: params.isShared,
        createdAt: nowIso,
        updatedAt: nowIso,
        completedAt: null,
      };

      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          projects: [newProj, ...prev.projects],
        }));
        return projId;
      }

      try {
        await setDoc(doc(db, 'projects', projId), {
          userId: profile.id,
          workspaceId: wsId,
          collaboratorIds,
          name: newProj.name,
          description: newProj.description,
          state: 'active',
          defaultContextId: newProj.defaultContextId,
          isShared: newProj.isShared,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          completedAt: null,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `projects/${projId}`);
      }
      return projId;
    },
    [profile, activeWorkspace, mode, persistDemo],
  );

  const updateProjectState = useCallback(
    async (projectId: string, nextState: ProjectState) => {
      const nowIso = new Date().toISOString();
      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          projects: prev.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  state: nextState,
                  completedAt: nextState === 'completed' ? nowIso : null,
                  updatedAt: nowIso,
                }
              : p,
          ),
        }));
      } else {
        try {
          await updateDoc(doc(db, 'projects', projectId), {
            state: nextState,
            completedAt: nextState === 'completed' ? serverTimestamp() : null,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
        }
      }
    },
    [mode, persistDemo],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          projects: prev.projects.filter((p) => p.id !== projectId),
        }));
      } else {
        try {
          await deleteDoc(doc(db, 'projects', projectId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `projects/${projectId}`);
        }
      }
    },
    [mode, persistDemo],
  );

  // Inbox (Feature 1)
  const captureInboxItem = useCallback(
    async (content: string) => {
      if (!profile) return;
      const clean = clampString(content, BOUNDARIES.INBOX_CONTENT_MAX);
      if (!clean) return;
      const itemId = makeId('inb');
      const nowIso = new Date().toISOString();
      const wsId = activeWorkspace?.id || profile.workspaceId;

      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          inboxItems: [
            {
              id: itemId,
              userId: profile.id,
              workspaceId: wsId,
              content: clean,
              processed: false,
              disposition: 'pending',
              createdAt: nowIso,
              updatedAt: nowIso,
            },
            ...prev.inboxItems,
          ],
        }));
      } else {
        try {
          await setDoc(doc(db, 'inboxItems', itemId), {
            userId: profile.id,
            workspaceId: wsId,
            content: clean,
            processed: false,
            disposition: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `inboxItems/${itemId}`);
        }
      }
      toast.success('Captured to Inbox');
    },
    [profile, activeWorkspace, mode, persistDemo],
  );

  const markInboxProcessed = useCallback(
    async (itemId: string, disposition: InboxDisposition) => {
      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          inboxItems: prev.inboxItems.map((i) =>
            i.id === itemId
              ? { ...i, processed: true, disposition, updatedAt: new Date().toISOString() }
              : i,
          ),
        }));
      } else {
        try {
          await updateDoc(doc(db, 'inboxItems', itemId), {
            processed: true,
            disposition,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `inboxItems/${itemId}`);
        }
      }
    },
    [mode, persistDemo],
  );

  const clarifyInboxAsTrashOrSomeday = useCallback(
    async (itemId: string, disposition: 'trash' | 'someday') => {
      if (disposition === 'someday') {
        const item = inboxItems.find((i) => i.id === itemId);
        const fallbackCtx = contexts.find((c) => c.state === 'active')?.id ?? '';
        if (item && fallbackCtx) {
          await createAction({
            description: item.content,
            contextId: fallbackCtx,
            status: 'deferred',
            deferredUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          });
        }
      }
      await markInboxProcessed(itemId, disposition);
    },
    [inboxItems, contexts, createAction, markInboxProcessed],
  );

  const clarifyInboxAsAction = useCallback(
    async (params: {
      itemId: string;
      description: string;
      contextId: string;
      projectId?: string;
      dueDate?: string | null;
      alarmTime?: string | null;
    }) => {
      await createAction({
        description: params.description,
        contextId: params.contextId,
        projectId: params.projectId,
        dueDate: params.dueDate,
        alarmTime: params.alarmTime,
      });
      await markInboxProcessed(params.itemId, 'action');
    },
    [createAction, markInboxProcessed],
  );

  const clarifyInboxAsNewProject = useCallback(
    async (params: {
      itemId: string;
      projectName: string;
      projectDescription: string;
      contextId: string;
      firstActionDescription: string;
      dueDate?: string | null;
      alarmTime?: string | null;
    }) => {
      const projId = await createProject({
        name: params.projectName,
        description: params.projectDescription,
        defaultContextId: params.contextId,
        isShared: false,
      });
      await createAction({
        description: params.firstActionDescription,
        contextId: params.contextId,
        projectId: projId,
        dueDate: params.dueDate,
        alarmTime: params.alarmTime,
      });
      await markInboxProcessed(params.itemId, 'project');
    },
    [createProject, createAction, markInboxProcessed],
  );

  // Weekly Review (Feature 4)
  const completeWeeklyReview = useCallback(
    async (type: ReviewType, notes: string) => {
      if (!profile) return;
      const revId = makeId('rev');
      const nowIso = new Date().toISOString();
      const wsId = activeWorkspace?.id || profile.workspaceId;
      const memberIds =
        type === 'team' && activeWorkspace
          ? activeWorkspace.memberIds.slice(0, BOUNDARIES.MEMBERS_MAX_COUNT)
          : [profile.id];
      const cleanNotes = clampString(notes, BOUNDARIES.NOTES_MAX) || 'Weekly review completed.';

      if (mode === 'demo') {
        persistDemo((prev) => ({
          ...prev,
          reviews: [
            {
              id: revId,
              userId: profile.id,
              workspaceId: wsId,
              memberIds,
              type,
              notes: cleanNotes,
              completedAt: nowIso,
            },
            ...prev.reviews,
          ],
        }));
      } else {
        try {
          await setDoc(doc(db, 'reviews', revId), {
            userId: profile.id,
            workspaceId: wsId,
            memberIds,
            type,
            notes: cleanNotes,
            completedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `reviews/${revId}`);
        }
      }
      toast.success('Weekly Review recorded');
    },
    [profile, activeWorkspace, mode, persistDemo],
  );

  const value: TrackFlowContextValue = {
    mode,
    firebaseUser,
    profile,
    permissions,
    workspaces,
    activeWorkspace,
    members,
    pendingInvitesForMe,
    sentInvites,
    contexts,
    projects,
    actions,
    inboxItems,
    reviews,
    theme,
    dueAlarm,
    dismissAlarm,
    snoozeAlarm,
    toggleTheme,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    resendVerificationEmail,
    refreshVerificationStatus,
    enterDemoMode,
    signOut,
    switchRoleOrWorkspace,
    createWorkspace,
    renameWorkspace,
    inviteCollaborator,
    revokeInvite,
    acceptInvite,
    updateProfileName,
    completeOnboarding,
    createContext,
    toggleContextState,
    captureInboxItem,
    clarifyInboxAsTrashOrSomeday,
    clarifyInboxAsAction,
    clarifyInboxAsNewProject,
    createAction,
    updateAction,
    completeAction,
    deleteAction,
    createProject,
    updateProjectState,
    deleteProject,
    completeWeeklyReview,
    aiChatOpen,
    aiChatInitialPrompt,
    openAiChat,
    closeAiChat,
  };

  return <TrackFlowContext.Provider value={value}>{children}</TrackFlowContext.Provider>;
}
