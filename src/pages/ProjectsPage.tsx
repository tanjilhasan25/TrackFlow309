import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  EyeOff,
  FolderPlus,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTrackFlow } from '../context/TrackFlowContext';
import { BOUNDARIES, findStalledProjects, formatLocalDateTime } from '../utils/gtdLogic';
import type { ActionItem, ProjectItem, ProjectState } from '../types/gtd';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/Dialog';
import { Input, Textarea } from '../components/ui/Input';
import { Switch } from '../components/ui/Switch';
import { AiSuggestionModal } from '../components/AiSuggestionModal';

export function ProjectsPage() {
  const {
    profile,
    permissions,
    contexts,
    projects,
    actions,
    createProject,
    createAction,
    completeAction,
    updateProjectState,
    deleteProject,
  } = useTrackFlow();

  const [stateFilter, setStateFilter] = useState<'all' | ProjectState>('active');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Step 1: New Project Form
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [defaultCtxId, setDefaultCtxId] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [firstActionText, setFirstActionText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Inline Add Next Action inside Selected Project
  const [newActionText, setNewActionText] = useState('');
  const [newActionDue, setNewActionDue] = useState('');

  // Step 3: Confirmation Dialog for State Transitions (Active -> Hidden -> Completed)
  const [confirmTransition, setConfirmTransition] = useState<{
    project: ProjectItem;
    nextState: ProjectState;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectItem | null>(null);
  const [aiAction, setAiAction] = useState<ActionItem | null>(null);

  const activeContexts = useMemo(
    () => contexts.filter((c) => c.state === 'active'),
    [contexts],
  );

  const stalledProjects = useMemo(() => findStalledProjects(projects, actions), [projects, actions]);
  const stalledIds = useMemo(() => new Set(stalledProjects.map((p) => p.id)), [stalledProjects]);

  const filteredProjects = useMemo(() => {
    if (stateFilter === 'all') return projects;
    return projects.filter((p) => p.state === stateFilter);
  }, [projects, stateFilter]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? filteredProjects[0] ?? null,
    [projects, selectedProjectId, filteredProjects],
  );

  const projectActions = useMemo(() => {
    if (!selectedProject) return [];
    return actions.filter((a) => a.projectId === selectedProject.id);
  }, [actions, selectedProject]);

  const activeProjectActions = projectActions.filter((a) => a.status === 'active');
  const completedProjectActions = projectActions.filter((a) => a.status === 'completed');

  const canCreateProject = permissions.canCreatePersonalProjects || permissions.canManageSharedProjects;

  const canModifySelectedProjectState = (proj: ProjectItem) => {
    if (profile?.role === 'collaborator') return false;
    if (proj.isShared) return permissions.canManageSharedProjects;
    return proj.userId === profile?.id || permissions.canCreatePersonalProjects;
  };

  const canDeleteSelectedProject = (proj: ProjectItem) => {
    if (!permissions.canDeleteProjects) return false;
    if (proj.isShared) return permissions.canManageSharedProjects;
    return proj.userId === profile?.id;
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projName.trim()) return;
    setSubmitting(true);
    try {
      const ctxId = defaultCtxId || activeContexts[0]?.id || '';
      const createdId = await createProject({
        name: projName,
        description: projDesc,
        defaultContextId: ctxId,
        isShared: permissions.canManageSharedProjects ? isShared : false,
      });

      if (firstActionText.trim() && ctxId) {
        await createAction({
          description: firstActionText,
          contextId: ctxId,
          projectId: createdId,
        });
      }

      toast.success('Project created');
      setSelectedProjectId(createdId);
      setProjName('');
      setProjDesc('');
      setFirstActionText('');
      setIsShared(false);
      setCreateModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddActionToProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !newActionText.trim()) return;
    const ctxId = selectedProject.defaultContextId || activeContexts[0]?.id || '';
    if (!ctxId) {
      toast.error('Please create an active Context in Settings first.');
      return;
    }
    await createAction({
      description: newActionText,
      contextId: ctxId,
      projectId: selectedProject.id,
      dueDate: newActionDue || null,
    });
    setNewActionText('');
    setNewActionDue('');
    toast.success('Next Action added to project');
  };

  const handleConfirmStateChange = async () => {
    if (!confirmTransition) return;
    await updateProjectState(confirmTransition.project.id, confirmTransition.nextState);
    toast.success(`Project marked as ${confirmTransition.nextState}`);
    setConfirmTransition(null);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    await deleteProject(confirmDelete.id);
    toast.success('Project deleted');
    setConfirmDelete(null);
    setSelectedProjectId(null);
  };

  return (
    <div className="space-y-6">
      {/* Header Controls & State Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          {(['active', 'hidden', 'completed', 'all'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStateFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                stateFilter === tab
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {tab === 'hidden' ? 'On Hold' : tab}
            </button>
          ))}
        </div>

        {canCreateProject && (
          <Button
            onClick={() => {
              setDefaultCtxId(activeContexts[0]?.id ?? '');
              setCreateModalOpen(true);
            }}
          >
            <FolderPlus className="h-4 w-4" />
            <span>New Project</span>
          </Button>
        )}
      </div>

      {/* Step 4: Stalled Projects Alert Bar */}
      {stalledProjects.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                {stalledProjects.length} Stalled Project{stalledProjects.length > 1 ? 's' : ''} (0 Active Next Actions)
              </span>
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Select a stalled project below to either add a new physical Next Action or hide/complete the project.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {stalledProjects.map((sp) => (
                <Button
                  key={sp.id}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setStateFilter('active');
                    setSelectedProjectId(sp.id);
                  }}
                >
                  Fix: {sp.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Split Layout: Project List + Selected Project Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Projects ({filteredProjects.length})</CardTitle>
            <CardDescription>
              {profile?.role === 'collaborator'
                ? 'Shared projects you collaborate on. You can add and complete actions.'
                : 'Manage outcomes, next actions, and lifecycle states.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredProjects.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No {stateFilter === 'all' ? '' : stateFilter} projects found.
                </p>
                {canCreateProject && (
                  <Button size="sm" variant="outline" onClick={() => setCreateModalOpen(true)}>
                    Create First Project
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredProjects.map((proj) => {
                  const isStalled = stalledIds.has(proj.id);
                  const activeCount = actions.filter(
                    (a) => a.projectId === proj.id && a.status === 'active',
                  ).length;
                  const isSelected = selectedProject?.id === proj.id;

                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => setSelectedProjectId(proj.id)}
                      className={`w-full text-left px-3 py-3.5 rounded-lg transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-950 dark:text-indigo-100'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold truncate">{proj.name}</span>
                        <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                          {activeCount} active
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="capitalize">{proj.state === 'hidden' ? 'On Hold' : proj.state}</span>
                        {proj.isShared && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" /> Shared
                            </span>
                          </>
                        )}
                        {isStalled && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              Stalled
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          {!selectedProject ? (
            <CardContent className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
              Select a project on the left to inspect its actions and lifecycle controls.
            </CardContent>
          ) : (
            <>
              <CardHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{selectedProject.name}</CardTitle>
                    <CardDescription>
                      {selectedProject.description || 'No project description provided.'}
                    </CardDescription>
                    <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
                      State:{' '}
                      <span className="capitalize font-medium">
                        {selectedProject.state === 'hidden' ? 'On Hold' : selectedProject.state}
                      </span>
                      {' · '}
                      Default Context:{' '}
                      {contexts.find((c) => c.id === selectedProject.defaultContextId)?.name ?? 'None'}
                      {selectedProject.isShared ? ' · Shared Team Project' : ' · Personal Project'}
                    </p>
                  </div>

                  {/* Step 3: Lifecycle State Transition Buttons */}
                  {canModifySelectedProjectState(selectedProject) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {selectedProject.state === 'active' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setConfirmTransition({ project: selectedProject, nextState: 'hidden' })
                            }
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                            <span>Put On Hold</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setConfirmTransition({ project: selectedProject, nextState: 'completed' })
                            }
                          >
                            <Archive className="h-3.5 w-3.5" />
                            <span>Complete</span>
                          </Button>
                        </>
                      )}
                      {selectedProject.state === 'hidden' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setConfirmTransition({ project: selectedProject, nextState: 'active' })
                            }
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Reactivate</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setConfirmTransition({ project: selectedProject, nextState: 'completed' })
                            }
                          >
                            <Archive className="h-3.5 w-3.5" />
                            <span>Complete</span>
                          </Button>
                        </>
                      )}
                      {selectedProject.state === 'completed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setConfirmTransition({ project: selectedProject, nextState: 'active' })
                          }
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Reopen</span>
                        </Button>
                      )}
                      {canDeleteSelectedProject(selectedProject) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete project ${selectedProject.name}`}
                          onClick={() => setConfirmDelete(selectedProject)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent className="pt-5 space-y-5">
                {stalledIds.has(selectedProject.id) && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
                    This project is stalled because it has zero active next actions. Add at least one physical Next Action below or hide/complete the project.
                  </div>
                )}

                {/* Step 2: Add Next Action inside Project */}
                {selectedProject.state !== 'completed' && (
                  <form onSubmit={handleAddActionToProject} className="flex flex-col sm:flex-row gap-2">
                    <Input
                      maxLength={BOUNDARIES.ACTION_DESC_MAX}
                      placeholder="Add a Next Action inside this project..."
                      value={newActionText}
                      onChange={(e) => setNewActionText(e.target.value)}
                    />
                    <Input
                      type="datetime-local"
                      aria-label="Due date for new project action"
                      className="sm:w-44"
                      value={newActionDue}
                      onChange={(e) => setNewActionDue(e.target.value)}
                    />
                    <Button type="submit" disabled={!newActionText.trim()}>
                      <Plus className="h-4 w-4" />
                      <span>Add Action</span>
                    </Button>
                  </form>
                )}

                {/* Active Actions */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Active Next Actions ({activeProjectActions.length})
                  </h4>
                  {activeProjectActions.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">No active actions in this project.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {activeProjectActions.map((act) => (
                        <div key={act.id} className="py-2.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await completeAction(act.id, `proj_${act.id}`);
                                if (ok) toast.success('Action completed');
                              }}
                              aria-label={`Complete '${act.description}'`}
                              className="h-5 w-5 rounded-full border border-slate-300 dark:border-slate-600 hover:border-indigo-600 flex items-center justify-center text-transparent hover:text-indigo-600 shrink-0 cursor-pointer"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </button>
                            <div className="min-w-0">
                              <p className="text-sm text-slate-900 dark:text-slate-100 truncate">
                                {act.description}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {contexts.find((c) => c.id === act.contextId)?.name ?? 'No context'}
                                {act.dueDate ? ` · Due ${formatLocalDateTime(act.dueDate)}` : ''}
                              </p>
                            </div>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => setAiAction(act)}>
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>AI Schedule</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Completed Actions */}
                {completedProjectActions.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Completed ({completedProjectActions.length})
                    </h4>
                    <div className="space-y-1.5">
                      {completedProjectActions.map((act) => (
                        <p
                          key={act.id}
                          className="text-xs text-slate-400 dark:text-slate-500 line-through"
                        >
                          {act.description}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>

      {/* Create Project Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Define the outcome, default context, and your first physical next action.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-3.5">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Project Name *
              </span>
              <Input
                required
                maxLength={BOUNDARIES.PROJECT_NAME_MAX}
                placeholder="e.g. Launch Customer Portal"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Description
              </span>
              <Textarea
                maxLength={BOUNDARIES.PROJECT_DESC_MAX}
                placeholder="Desired outcome and scope..."
                value={projDesc}
                onChange={(e) => setProjDesc(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Default Context
              </span>
              <select
                value={defaultCtxId}
                onChange={(e) => setDefaultCtxId(e.target.value)}
                className="flex min-h-10 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              >
                {activeContexts.map((ctx) => (
                  <option key={ctx.id} value={ctx.id}>
                    {ctx.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                First Physical Next Action (Recommended)
              </span>
              <Input
                maxLength={BOUNDARIES.ACTION_DESC_MAX}
                placeholder="e.g. Draft requirements doc"
                value={firstActionText}
                onChange={(e) => setFirstActionText(e.target.value)}
              />
            </label>
            {permissions.canManageSharedProjects && (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div>
                  <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    Share with Workspace Team
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Allows Team Collaborators to add and complete actions.
                  </p>
                </div>
                <Switch checked={isShared} onCheckedChange={setIsShared} />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!projName.trim() || submitting}>
                {submitting ? 'Creating...' : 'Create Project'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Step 3: Confirmation Dialog for State Change */}
      <Dialog
        open={Boolean(confirmTransition)}
        onOpenChange={(open) => !open && setConfirmTransition(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Project State Change</DialogTitle>
            <DialogDescription>
              Move <span className="font-medium text-slate-900 dark:text-slate-100">{confirmTransition?.project.name}</span> from{' '}
              <span className="capitalize">{confirmTransition?.project.state}</span> to{' '}
              <span className="capitalize font-medium">{confirmTransition?.nextState}</span>?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmTransition(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmStateChange}>
              Confirm Transition
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-medium">{confirmDelete?.name}</span>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete Project
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AiSuggestionModal
        action={aiAction}
        open={Boolean(aiAction)}
        onOpenChange={(open) => {
          if (!open) setAiAction(null);
        }}
      />
    </div>
  );
}
