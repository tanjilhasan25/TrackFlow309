import React, { useMemo, useState } from 'react';
import { Bell, CheckCircle2, Sparkles, Star, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useTrackFlow } from '../context/TrackFlowContext';
import { BOUNDARIES, formatLocalDateTime, getDueUrgency, sortFocusActions } from '../utils/gtdLogic';
import type { ActionItem } from '../types/gtd';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/Dialog';
import { Input } from '../components/ui/Input';
import { AiSuggestionModal } from '../components/AiSuggestionModal';

export function FocusPage() {
  const { contexts, projects, actions, completeAction, updateAction, createAction } = useTrackFlow();

  // Step 1: Select active Context (or "All")
  const [selectedContextId, setSelectedContextId] = useState<string>('all');
  const [page, setPage] = useState<number>(0);
  const PAGE_SIZE = 50;
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [alarmTarget, setAlarmTarget] = useState<ActionItem | null>(null);
  const [alarmInput, setAlarmInput] = useState('');
  const [aiTarget, setAiTarget] = useState<ActionItem | null>(null);

  // Step 4: Mandatory Project Follow-Up after completing a project action
  const [followUpProject, setFollowUpProject] = useState<{
    projectId: string;
    projectName: string;
    defaultContextId: string;
  } | null>(null);
  const [nextPhysicalAction, setNextPhysicalAction] = useState('');

  const activeContexts = useMemo(
    () => contexts.filter((c) => c.state === 'active'),
    [contexts],
  );

  // Step 2: Filter Active Next Actions by Context and sort by canonical comparator
  const visibleActions = useMemo(() => {
    const active = actions.filter((a) => a.status === 'active');
    const byContext =
      selectedContextId === 'all'
        ? active
        : active.filter((a) => a.contextId === selectedContextId);
    return sortFocusActions(byContext);
  }, [actions, selectedContextId]);

  const totalPages = Math.max(1, Math.ceil(visibleActions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedActions = useMemo(
    () => visibleActions.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [visibleActions, safePage],
  );

  const getContextName = (id: string) => contexts.find((c) => c.id === id)?.name ?? 'No context';
  const getProject = (id: string) => projects.find((p) => p.id === id);

  const handleMarkComplete = async (action: ActionItem) => {
    if (completingId === action.id) return;
    setCompletingId(action.id);
    try {
      const completed = await completeAction(action.id, `focus_${action.id}`);
      if (!completed) return;
      toast.success(`Completed "${action.description}"`);

      const proj = action.projectId ? getProject(action.projectId) : undefined;
      if (proj && proj.state === 'active') {
        setNextPhysicalAction('');
        setFollowUpProject({
          projectId: proj.id,
          projectName: proj.name,
          defaultContextId: proj.defaultContextId || action.contextId || activeContexts[0]?.id || '',
        });
      }
    } finally {
      setCompletingId(null);
    }
  };

  const handleSaveNextAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpProject || !nextPhysicalAction.trim()) return;
    await createAction({
      description: nextPhysicalAction,
      contextId: followUpProject.defaultContextId,
      projectId: followUpProject.projectId,
    });
    toast.success(`Added next physical action to "${followUpProject.projectName}"`);
    setFollowUpProject(null);
    setNextPhysicalAction('');
  };

  const handleSaveAlarm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alarmTarget) return;
    await updateAction(alarmTarget.id, { alarmTime: alarmInput || null });
    toast.success(alarmInput ? 'Alarm scheduled' : 'Alarm cleared');
    setAlarmTarget(null);
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Context Selector */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Step 1 · Choose your current Context
        </p>
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => {
              setSelectedContextId('all');
              setPage(0);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedContextId === 'all'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            All Contexts
          </button>
          {activeContexts.map((ctx) => (
            <button
              key={ctx.id}
              type="button"
              onClick={() => {
                setSelectedContextId(ctx.id);
                setPage(0);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedContextId === ctx.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {ctx.name}
            </button>
          ))}
        </div>
      </div>

      {/* Step 2 & 3: Sorted Active Next Actions List */}
      <Card>
        <CardHeader>
          <CardTitle>
            Focus Queue ({visibleActions.length})
          </CardTitle>
          <CardDescription>
            Active Next Actions sorted by priority score, due date, and starred flag.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {visibleActions.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No active actions in this context
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Switch context filters above or clarify new actions from your Inbox.
              </p>
            </div>
          ) : (
            <>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {pagedActions.map((action) => {
                const urgency = getDueUrgency(action.dueDate);
                const proj = action.projectId ? getProject(action.projectId) : undefined;
                return (
                  <div
                    key={action.id}
                    className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <button
                        type="button"
                        disabled={completingId === action.id}
                        onClick={() => handleMarkComplete(action)}
                        aria-label={`Mark complete: ${action.description}`}
                        className="mt-0.5 h-5 w-5 rounded-full border border-slate-300 dark:border-slate-600 hover:border-indigo-600 dark:hover:border-indigo-400 flex items-center justify-center text-transparent hover:text-indigo-600 transition-colors shrink-0 cursor-pointer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>

                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {action.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span>{getContextName(action.contextId)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{proj ? proj.name : 'Single Action'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">Priority {action.priorityScore}</span>
                          {action.dueDate && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span
                                className={`font-mono tabular-nums ${
                                  urgency === 'overdue'
                                    ? 'text-red-600 dark:text-red-400 font-medium'
                                    : urgency === 'soon'
                                    ? 'text-amber-600 dark:text-amber-400 font-medium'
                                    : ''
                                }`}
                              >
                                {urgency === 'overdue' ? 'Overdue ' : 'Due '}
                                {formatLocalDateTime(action.dueDate)}
                              </span>
                            </>
                          )}
                          {action.alarmTime && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-indigo-600 dark:text-indigo-400 font-mono tabular-nums">
                                Alarm {formatLocalDateTime(action.alarmTime)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 pl-8 sm:pl-0 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => updateAction(action.id, { starred: !action.starred })}
                        aria-label={action.starred ? `Unstar '${action.description}'` : `Star '${action.description}'`}
                      >
                        <Star
                          className={`h-4 w-4 ${
                            action.starred ? 'fill-amber-500 text-amber-500' : 'text-slate-400'
                          }`}
                        />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAlarmTarget(action);
                          setAlarmInput(
                            action.alarmTime ? formatLocalDateTime(action.alarmTime).replace(' ', 'T') : '',
                          );
                        }}
                      >
                        <Bell className="h-3.5 w-3.5" />
                        <span>Alarm</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setAiTarget(action)}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Get AI Suggestion</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-mono tabular-nums">
                  Page {safePage + 1} of {totalPages} ({visibleActions.length} total)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Set Alarm Dialog */}
      <Dialog open={Boolean(alarmTarget)} onOpenChange={(open) => !open && setAlarmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Alarm Reminder</DialogTitle>
            <DialogDescription>{alarmTarget?.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveAlarm} className="space-y-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Alarm Date & Time
              </span>
              <Input
                type="datetime-local"
                value={alarmInput}
                onChange={(e) => setAlarmInput(e.target.value)}
              />
            </label>
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  if (!alarmTarget) return;
                  await updateAction(alarmTarget.id, { alarmTime: null });
                  setAlarmTarget(null);
                  toast.success('Alarm removed');
                }}
              >
                Clear Alarm
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setAlarmTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save Alarm</Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Step 4: Mandatory Project Next Action Follow-Up Dialog */}
      <Dialog
        open={Boolean(followUpProject)}
        onOpenChange={(open) => {
          if (!open) setFollowUpProject(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Project Momentum Check</DialogTitle>
            <DialogDescription>
              You completed an action in <span className="font-medium text-slate-900 dark:text-slate-100">{followUpProject?.projectName}</span>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveNextAction} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                What is the very next physical action for this project?
              </span>
              <Input
                autoFocus
                maxLength={BOUNDARIES.ACTION_DESC_MAX}
                placeholder="e.g. Email finalized mockup link to Marcus"
                value={nextPhysicalAction}
                onChange={(e) => setNextPhysicalAction(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setFollowUpProject(null)}
              >
                Skip for now
              </Button>
              <Button type="submit" disabled={!nextPhysicalAction.trim()}>
                <span>Add Next Action</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AiSuggestionModal
        action={aiTarget}
        open={Boolean(aiTarget)}
        onOpenChange={(open) => {
          if (!open) setAiTarget(null);
        }}
      />
    </div>
  );
}
