import React, { useState } from 'react';
import { Eye, EyeOff, Plus, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTrackFlow } from '../context/TrackFlowContext';
import { BOUNDARIES } from '../utils/gtdLogic';
import type { UserRole } from '../types/gtd';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Switch } from '../components/ui/Switch';

export function SettingsPage() {
  const {
    mode,
    profile,
    permissions,
    theme,
    toggleTheme,
    workspaces,
    activeWorkspace,
    members,
    sentInvites,
    pendingInvitesForMe,
    contexts,
    updateProfileName,
    switchRoleOrWorkspace,
    createWorkspace,
    renameWorkspace,
    inviteCollaborator,
    revokeInvite,
    acceptInvite,
    createContext,
    toggleContextState,
  } = useTrackFlow();

  const [nameInput, setNameInput] = useState(profile?.name ?? '');
  const [newContextName, setNewContextName] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [renameWsInput, setRenameWsInput] = useState(activeWorkspace?.name ?? '');
  const [inviteEmail, setInviteEmail] = useState('');

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfileName(nameInput);
  };

  const handleCreateContext = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContextName.trim()) return;
    await createContext(newContextName, profile?.role === 'admin');
    setNewContextName('');
    toast.success('Context added');
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    await createWorkspace(newWorkspaceName);
    setNewWorkspaceName('');
    toast.success('Workspace created — you are Workspace Admin');
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspace || !inviteEmail.trim()) return;
    await inviteCollaborator(activeWorkspace.id, inviteEmail);
    setInviteEmail('');
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Profile & Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>Profile & Appearance</CardTitle>
          <CardDescription>Manage your display name and light/dark appearance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form onSubmit={handleSaveName} className="flex flex-col sm:flex-row gap-3 items-end">
            <label className="flex-1 w-full space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Display Name
              </span>
              <Input
                maxLength={BOUNDARIES.NAME_MAX}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
              />
            </label>
            <Button type="submit">Save Profile</Button>
          </form>

          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Dark Mode</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                High-contrast slate palette tuned for evening focus sessions.
              </p>
            </div>
            <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme} aria-label="Toggle dark mode" />
          </div>
        </CardContent>
      </Card>

      {/* Workspace & 3-Role Switcher */}
      <Card>
        <CardHeader>
          <CardTitle>Workspace & Role</CardTitle>
          <CardDescription>
            Active workspace: {activeWorkspace?.name ?? 'Personal'} · Email: {profile?.email}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Role Switcher */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Active Workspace Role
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {(
                [
                  { role: 'individual' as UserRole, label: 'Individual User', desc: 'Personal Inbox, Focus & Projects' },
                  { role: 'collaborator' as UserRole, label: 'Team Collaborator', desc: 'Shared actions & team progress' },
                  { role: 'admin' as UserRole, label: 'Workspace Admin', desc: 'Invites, Team Review & Insights' },
                ]
              ).map((item) => {
                const isActive = profile?.role === item.role;
                const isDisabledInFirebase =
                  mode === 'firebase' &&
                  ((item.role === 'admin' && activeWorkspace?.adminId !== profile?.id) ||
                    (item.role === 'collaborator' &&
                      !members.some((m) => m.userId === profile?.id && m.role === 'collaborator')));

                return (
                  <button
                    key={item.role}
                    type="button"
                    disabled={isDisabledInFirebase}
                    onClick={() => switchRoleOrWorkspace(item.role)}
                    className={`rounded-lg border p-3 text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      isActive
                        ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {item.label}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Switch between Workspaces */}
          {workspaces.length > 0 && (
            <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Your Workspaces
              </p>
              <div className="flex flex-wrap gap-2">
                {workspaces.map((ws) => (
                  <Button
                    key={ws.id}
                    size="sm"
                    variant={ws.id === activeWorkspace?.id ? 'default' : 'outline'}
                    onClick={() =>
                      switchRoleOrWorkspace(
                        ws.adminId === profile?.id
                          ? mode === 'demo' && ws.id.includes('personal')
                            ? 'individual'
                            : 'admin'
                          : 'collaborator',
                        ws.id,
                      )
                    }
                  >
                    {ws.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Create a New Workspace (becomes Workspace Admin) */}
          <form
            onSubmit={handleCreateWorkspace}
            className="flex flex-col sm:flex-row gap-2.5 border-t border-slate-100 dark:border-slate-800 pt-4"
          >
            <Input
              maxLength={BOUNDARIES.NAME_MAX}
              placeholder="Create a new shared Workspace..."
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={!newWorkspaceName.trim()}>
              <Plus className="h-4 w-4" />
              <span>Create Workspace</span>
            </Button>
          </form>

          {/* Pending Invites Received */}
          {pendingInvitesForMe.length > 0 && (
            <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Pending Invitations for {profile?.email}
              </p>
              {pendingInvitesForMe.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3"
                >
                  <span className="text-sm font-medium">{inv.workspaceName}</span>
                  <Button size="sm" onClick={() => acceptInvite(inv)}>
                    Accept & Join
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workspace Admin Controls: Rename & Invite Team Collaborators */}
      {permissions.canInviteCollaborators && activeWorkspace && (
        <Card>
          <CardHeader>
            <CardTitle>Team Collaborators & Invites</CardTitle>
            <CardDescription>
              Invite Team Collaborators into {activeWorkspace.name} (Workspace Admin only).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                renameWorkspace(activeWorkspace.id, renameWsInput);
              }}
              className="flex flex-col sm:flex-row gap-2.5"
            >
              <Input
                maxLength={BOUNDARIES.NAME_MAX}
                value={renameWsInput}
                onChange={(e) => setRenameWsInput(e.target.value)}
                aria-label="Workspace name"
              />
              <Button type="submit" variant="outline">
                Rename Workspace
              </Button>
            </form>

            <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2.5">
              <Input
                type="email"
                required
                placeholder="collaborator@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <Button type="submit" disabled={!inviteEmail.trim()}>
                <UserPlus className="h-4 w-4" />
                <span>Invite Collaborator</span>
              </Button>
            </form>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Members ({members.length})
              </p>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {members.map((m) => (
                  <div key={m.id} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">{m.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{m.email}</p>
                    </div>
                    <span className="text-xs capitalize text-slate-500 dark:text-slate-400">
                      {m.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {sentInvites.filter((i) => i.status === 'pending').length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Pending Invitations
                </p>
                {sentInvites
                  .filter((i) => i.status === 'pending')
                  .map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between text-sm py-1.5"
                    >
                      <span>{inv.invitedEmail}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revokeInvite(activeWorkspace.id, inv.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>Revoke</span>
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Contexts Manager */}
      <Card>
        <CardHeader>
          <CardTitle>GTD Contexts ({contexts.length})</CardTitle>
          <CardDescription>
            Organize Next Actions by tool, location, or energy (@Computer, @Calls, @Errands).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleCreateContext} className="flex gap-2.5">
            <Input
              maxLength={BOUNDARIES.CONTEXT_NAME_MAX}
              placeholder="e.g. @Office or @Phone"
              value={newContextName}
              onChange={(e) => setNewContextName(e.target.value)}
            />
            <Button type="submit" disabled={!newContextName.trim()}>
              <Plus className="h-4 w-4" />
              <span>Add Context</span>
            </Button>
          </form>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {contexts.map((ctx) => (
              <div key={ctx.id} className="py-2.5 flex items-center justify-between">
                <span
                  className={`text-sm font-medium ${
                    ctx.state === 'hidden'
                      ? 'text-slate-400 line-through'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {ctx.name}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    toggleContextState(ctx.id, ctx.state === 'active' ? 'hidden' : 'active')
                  }
                >
                  {ctx.state === 'active' ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5" />
                      <span>Hide</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      <span>Activate</span>
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
