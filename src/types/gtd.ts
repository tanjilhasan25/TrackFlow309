export type UserRole = 'individual' | 'collaborator' | 'admin';

export type ContextState = 'active' | 'hidden';
export type ProjectState = 'active' | 'hidden' | 'completed';
export type ActionStatus = 'active' | 'completed' | 'deferred';
export type InboxDisposition = 'pending' | 'action' | 'project' | 'someday' | 'trash';
export type ReviewType = 'personal' | 'team';

export interface UserPreferences {
  theme: 'light' | 'dark';
  dailyFocusLimit: number;
  alarmsEnabled: boolean;
  onboardingCompleted: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  workspaceId: string;
  preferences: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  adminId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  adminId: string;
  name: string;
  email: string;
  role: UserRole;
  inviteId: string;
  joinedAt: string;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  adminId: string;
  invitedEmail: string;
  role: 'collaborator';
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
}

export interface ContextItem {
  id: string;
  userId: string;
  workspaceId: string;
  memberIds: string[];
  name: string;
  position: number;
  state: ContextState;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectItem {
  id: string;
  userId: string;
  workspaceId: string;
  collaboratorIds: string[];
  name: string;
  description: string;
  state: ProjectState;
  defaultContextId: string;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ActionItem {
  id: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  projectCollaboratorIds: string[];
  contextId: string;
  description: string;
  status: ActionStatus;
  dueDate: string | null;
  deferredUntil: string | null;
  starred: boolean;
  priorityScore: number;
  tags: string[];
  notes: string;
  alarmTime: string | null;
  estimatedMinutes: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface InboxItem {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  processed: boolean;
  disposition: InboxDisposition;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRecord {
  id: string;
  userId: string;
  workspaceId: string;
  memberIds: string[];
  type: ReviewType;
  notes: string;
  completedAt: string;
}

export interface AiScheduleSuggestion {
  suggestedDueDate: string;
  suggestedTimeOfDay: string;
  estimatedMinutes: number;
  recommendedContextId: string;
  recommendedContextName: string;
  recommendAlarm: boolean;
  suggestedAlarmTime: string | null;
  priorityScore: number;
  rationale: string;
}

export interface AiWorkspaceRecommendation {
  title: string;
  impact: 'high' | 'medium' | 'low';
  actionHint: string;
}

export interface AiWorkspaceInsight {
  summary: string;
  recommendations: AiWorkspaceRecommendation[];
}
