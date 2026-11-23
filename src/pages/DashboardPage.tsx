import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, format, parseISO } from 'date-fns';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  SkipForward,
  Sparkles,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTrackFlow } from '../context/TrackFlowContext';
import { findStalledProjects, formatLocalDateTime, getDueUrgency, sortFocusActions } from '../utils/gtdLogic';
import type { ActionItem } from '../types/gtd';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { AiSuggestionModal } from '../components/AiSuggestionModal';

export function DashboardPage() {
  const {
    profile,
    actions,
    projects,
    contexts,
    inboxItems,
    reviews,
    pendingInvitesForMe,
    acceptInvite,
    completeAction,
    updateAction,
    openAiChat,
  } = useTrackFlow();

  const [aiAction, setAiAction] = useState<ActionItem | null>(null);
  const [focusViewMode, setFocusViewMode] = useState<'single' | 'list'>('single');
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const activeActions = useMemo(() => actions.filter((a) => a.status === 'active'), [actions]);
  const sortedAllFocus = useMemo(() => sortFocusActions(activeActions), [activeActions]);
  const sortedFocusList = useMemo(() => sortedAllFocus.slice(0, 6), [sortedAllFocus]);

  const currentFocusAction = useMemo(() => {
    if (sortedAllFocus.length === 0) return null;
    const skippedSet = new Set(skippedIds);
    return sortedAllFocus.find((a) => !skippedSet.has(a.id)) ?? sortedAllFocus[0];
  }, [sortedAllFocus, skippedIds]);

  const currentPosition = useMemo(() => {
    if (!currentFocusAction) return 0;
    const idx = sortedAllFocus.findIndex((a) => a.id === currentFocusAction.id);
    return idx >= 0 ? idx + 1 : 1;
  }, [sortedAllFocus, currentFocusAction]);

  const upcomingAlarms = useMemo(
    () =>
      activeActions
        .filter((a) => Boolean(a.alarmTime))
        .sort((a, b) => (a.alarmTime ?? '').localeCompare(b.alarmTime ?? ''))
        .slice(0, 5),
    [activeActions],
  );
  const stalledProjects = useMemo(() => findStalledProjects(projects, actions), [projects, actions]);
  const unprocessedInboxCount = useMemo(
    () => inboxItems.filter((item) => !item.processed).length,
    [inboxItems],
  );
  const lastReview = reviews[0] ?? null;

  const getContextName = (id: string) => contexts.find((c) => c.id === id)?.name ?? 'No context';
  const getProjectName = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Single Action';

  const handleCompleteAndNext = async (action: ActionItem) => {
    if (completingId === action.id) return;
    setCompletingId(action.id);
    try {
      const completed = await completeAction(action.id, `dash_${action.id}`);
      if (!completed) return;
      setSkippedIds((prev) => prev.filter((id) => id !== action.id));
      const remainingCount = sortedAllFocus.length - 1;
      toast.success(
        remainingCount > 0
          ? `Completed "${action.description}" — loading next task (${remainingCount} remaining)`
          : `Completed "${action.description}" — queue clear!`,
      );
    } finally {
      setCompletingId(null);
    }
  };

  const handleSkipCurrent = (actionId: string) => {
    setSkippedIds((prev) => {
      const remainingUnSkipped = sortedAllFocus.filter((a) => a.id !== actionId && !prev.includes(a.id));
      if (remainingUnSkipped.length === 0) {
        return [actionId];
      }
      return [...prev, actionId];
    });
  };

  const handleDeferTomorrow = async (action: ActionItem) => {
    const tomorrowIso = addDays(new Date(), 1).toISOString();
    await updateAction(action.id, {
      status: 'deferred',
      deferredUntil: tomorrowIso,
    });
    setSkippedIds((prev) => prev.filter((id) => id !== action.id));
    toast.success(`Deferred "${action.description}" to tomorrow`);
  };

  return (
    <div className="space-y-6">
      {/* Pending Workspace Invitations */}
      {pendingInvitesForMe.length > 0 && (
        <Card className="border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20">
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Workspace Invitation: {pendingInvitesForMe[0].workspaceName}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                You have been invited to join as a Team Collaborator.
              </p>
            </div>
            <Button size="sm" onClick={() => acceptInvite(pendingInvitesForMe[0])}>
              Accept Invitation
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Greeting & Quick Stats */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </p>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Welcome back, {profile?.name?.split(' ')[0] ?? 'there'}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => openAiChat()}>
            <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>Automate with AI</span>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/inbox">Process Inbox ({unprocessedInboxCount})</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/focus">Open Focus Mode</Link>
          </Button>
        </div>
      </div>

      {/* 4-column Quick Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Active Next Actions</p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {activeActions.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Inbox Pending</p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {unprocessedInboxCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Stalled Projects</p>
            <p
              className={`font-mono text-2xl font-semibold tabular-nums ${
                stalledProjects.length > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {stalledProjects.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Last Weekly Review</p>
            <p className="font-mono text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100 pt-1.5">
              {lastReview ? format(parseISO(lastReview.completedAt), 'MMM d, yyyy') : 'Not yet completed'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main 2-column Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Focus (2/3 width) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Today’s Focus</CardTitle>
              <CardDescription>
                {focusViewMode === 'single'
                  ? 'Work calmly on 1 priority task at a time; finishing brings the next.'
                  : 'Top active actions sorted by AI priority score, due date, and starred status.'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 self-start sm:self-center">
              <div
                role="tablist"
                aria-label="Focus display mode"
                className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={focusViewMode === 'single'}
                  onClick={() => setFocusViewMode('single')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    focusViewMode === 'single'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  One-by-One
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={focusViewMode === 'list'}
                  onClick={() => setFocusViewMode('list')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    focusViewMode === 'list'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  List ({sortedAllFocus.length})
                </button>
              </div>
              <Link
                to="/focus"
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
              >
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {sortedAllFocus.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No active next actions right now. Process your Inbox or ask AI Assistant to plan your next step.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/inbox">Go to Inbox</Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => openAiChat('আমার আজকের কাজ প্ল্যান করতে সাহায্য করো')}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Ask AI Assistant</span>
                  </Button>
                </div>
              </div>
            ) : focusViewMode === 'single' && currentFocusAction ? (
              (() => {
                const urgency = getDueUrgency(currentFocusAction.dueDate);
                const remaining = Math.max(0, sortedAllFocus.length - 1);
                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-5 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono tabular-nums font-medium text-indigo-600 dark:text-indigo-400">
                        Up Next · #{currentPosition} of {sortedAllFocus.length}
                      </span>
                      <span className="font-mono tabular-nums">
                        {remaining === 0
                          ? 'Final active task'
                          : `${remaining} more waiting in queue`}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                        {currentFocusAction.description}
                      </h4>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>{getContextName(currentFocusAction.contextId)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{getProjectName(currentFocusAction.projectId)}</span>
                        {currentFocusAction.dueDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span
                              className={`tabular-nums ${
                                urgency === 'overdue'
                                  ? 'text-red-600 dark:text-red-400 font-medium'
                                  : urgency === 'soon'
                                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                                  : ''
                              }`}
                            >
                              {urgency === 'overdue' ? 'Overdue: ' : 'Due: '}
                              {formatLocalDateTime(currentFocusAction.dueDate)}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          Score {currentFocusAction.priorityScore}
                        </span>
                      </div>
                      {currentFocusAction.notes && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 pt-1">
                          {currentFocusAction.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={completingId === currentFocusAction.id}
                          onClick={() => handleCompleteAndNext(currentFocusAction)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Complete & Next</span>
                        </Button>
                        {sortedAllFocus.length > 1 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleSkipCurrent(currentFocusAction.id)}
                          >
                            <SkipForward className="h-3.5 w-3.5" />
                            <span>Skip for now</span>
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeferTomorrow(currentFocusAction)}
                        >
                          <Clock className="h-3.5 w-3.5" />
                          <span>Later (Tomorrow)</span>
                        </Button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateAction(currentFocusAction.id, {
                              starred: !currentFocusAction.starred,
                            })
                          }
                          aria-label={
                            currentFocusAction.starred
                              ? `Unstar '${currentFocusAction.description}'`
                              : `Star '${currentFocusAction.description}'`
                          }
                          className={`p-2 rounded-lg transition-colors cursor-pointer ${
                            currentFocusAction.starred
                              ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                              : 'text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Star
                            className={`h-4 w-4 ${currentFocusAction.starred ? 'fill-current' : ''}`}
                          />
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setAiAction(currentFocusAction)}
                          aria-label={`Get AI suggestion for '${currentFocusAction.description}'`}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Schedule</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            openAiChat(
                              `আমার ${sortedAllFocus.length}টি সক্রিয় কাজের মধ্যে "${currentFocusAction.description}" আগে করা উচিত নাকি কোনগুলো কালকের জন্য সরানো ভালো হবে?`,
                            )
                          }
                        >
                          <span>Ask AI</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedFocusList.map((action) => {
                  const urgency = getDueUrgency(action.dueDate);
                  return (
                    <div
                      key={action.id}
                      className="py-3.5 flex items-start justify-between gap-3 group"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => completeAction(action.id)}
                          aria-label={`Complete '${action.description}'`}
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
                            <span>{getProjectName(action.projectId)}</span>
                            {action.dueDate && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span
                                  className={`tabular-nums ${
                                    urgency === 'overdue'
                                      ? 'text-red-600 dark:text-red-400 font-medium'
                                      : urgency === 'soon'
                                      ? 'text-amber-600 dark:text-amber-400 font-medium'
                                      : ''
                                  }`}
                                >
                                  {urgency === 'overdue' ? 'Overdue: ' : 'Due: '}
                                  {formatLocalDateTime(action.dueDate)}
                                </span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">Score {action.priorityScore}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateAction(action.id, { starred: !action.starred })}
                          aria-label={action.starred ? `Unstar '${action.description}'` : `Star '${action.description}'`}
                          className={`p-2 rounded-lg transition-colors cursor-pointer ${
                            action.starred
                              ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                              : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Star className={`h-4 w-4 ${action.starred ? 'fill-current' : ''}`} />
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setAiAction(action)}
                          aria-label={`Get AI suggestion for '${action.description}'`}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Upcoming Alarms + Stalled Notice */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Alarms</CardTitle>
              <CardDescription>Reminders you explicitly scheduled.</CardDescription>
            </CardHeader>
            <CardContent>
              {upcomingAlarms.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
                  No alarms scheduled. Set one inside Focus Mode or via AI Scheduling.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {upcomingAlarms.map((act) => (
                    <div key={act.id} className="py-3 space-y-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {act.description}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-mono tabular-nums">
                        <Bell className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        <span>{formatLocalDateTime(act.alarmTime)}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Weekly Review & Health</CardTitle>
              <CardDescription>Keep projects unblocked and open loops zeroed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {stalledProjects.length > 0 && (
                <div className="rounded-lg bg-amber-500/10 dark:bg-amber-500/15 p-3 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
                    <p className="font-medium">
                      {stalledProjects.length} Stalled Project{stalledProjects.length > 1 ? 's' : ''}
                    </p>
                    <p>Active projects without a physical next action need attention.</p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Last review
                </span>
                <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                  {lastReview ? format(parseISO(lastReview.completedAt), 'MMM d, yyyy') : 'Never'}
                </span>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link to="/review">
                  <span>Start Weekly Review</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

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
