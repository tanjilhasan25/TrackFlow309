import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Check, CheckCircle2, Lock, Play, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useTrackFlow } from '../context/TrackFlowContext';
import { BOUNDARIES, formatLocalDateTime, partitionWeeklyReview } from '../utils/gtdLogic';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Textarea } from '../components/ui/Input';

const REVIEW_STEPS = [
  { id: 1, title: 'Overdue Actions', subtitle: 'Reschedule or complete overdue items.' },
  { id: 2, title: 'Stalled Projects', subtitle: 'Add next actions or hide/complete stalled projects.' },
  { id: 3, title: 'Tickler Arriving Soon', subtitle: 'Review deferred items surfacing in the next 7 days.' },
  { id: 4, title: 'Open Loops & Inbox', subtitle: 'Acknowledge remaining unprocessed inbox thoughts.' },
  { id: 5, title: 'Review Notes & Complete', subtitle: 'Record a reflection note and log the review.' },
] as const;

export function WeeklyReviewPage() {
  const {
    profile,
    permissions,
    actions,
    projects,
    inboxItems,
    reviews,
    completeAction,
    updateAction,
    createAction,
    contexts,
    completeWeeklyReview,
    switchRoleOrWorkspace,
  } = useTrackFlow();

  const [inProgress, setInProgress] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [reviewNotes, setReviewNotes] = useState('');
  const [quickProjectAction, setQuickProjectAction] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const buckets = useMemo(
    () => partitionWeeklyReview(actions, projects, inboxItems),
    [actions, projects, inboxItems],
  );

  const canRunReview = permissions.canRunPersonalReview || permissions.canRunTeamReview;
  const reviewType = profile?.role === 'admin' ? 'team' : 'personal';

  const handleStart = () => {
    setInProgress(true);
    setCurrentStep(1);
    setCompletedSteps(new Set());
    setReviewNotes('');
  };

  const completeCurrentSection = () => {
    setCompletedSteps((prev) => new Set(prev).add(currentStep));
    setCurrentStep((prev) => Math.min(5, prev + 1));
  };

  const handleFinishReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewNotes.trim()) {
      toast.error('Please write a brief review reflection note before completing.');
      return;
    }
    setSubmitting(true);
    try {
      await completeWeeklyReview(reviewType, reviewNotes);
      setInProgress(false);
      setCurrentStep(1);
      setCompletedSteps(new Set());
      setReviewNotes('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddStalledAction = async (projectId: string, defaultContextId: string) => {
    const desc = (quickProjectAction[projectId] ?? '').trim();
    if (!desc) return;
    const ctxId = defaultContextId || contexts.find((c) => c.state === 'active')?.id || '';
    await createAction({ description: desc, contextId: ctxId, projectId });
    setQuickProjectAction((prev) => ({ ...prev, [projectId]: '' }));
    toast.success('Next action added to stalled project');
  };

  return (
    <div className="space-y-6">
      {!canRunReview && (
        <Card className="border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Team Weekly Review is run by Workspace Admins, and Personal Weekly Review is available in Individual User role.
            </p>
            <Button size="sm" variant="outline" onClick={() => switchRoleOrWorkspace('individual')}>
              Switch to Individual Role
            </Button>
          </CardContent>
        </Card>
      )}

      {!inProgress ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle>
                Guided {reviewType === 'team' ? 'Team' : 'Personal'} Weekly Review
              </CardTitle>
              <CardDescription>
                Walk through four locked sequential checkpoints—Overdue, Stalled Projects, Tickler Items, and Open Loops—then record your review note.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="font-mono text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">
                    {buckets.overdueActions.length}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Overdue</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="font-mono text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {buckets.stalledProjects.length}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Stalled</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {buckets.ticklerArrivingSoon.length}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Tickler Soon</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {buckets.openLoops.length}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Open Loops</p>
                </div>
              </div>

              <Button disabled={!canRunReview} onClick={handleStart}>
                <Play className="h-4 w-4" />
                <span>Start Weekly Review</span>
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle>Past Reviews ({reviews.length})</CardTitle>
              <CardDescription>Recorded personal and team review log.</CardDescription>
            </CardHeader>
            <CardContent>
              {reviews.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-6">
                  No weekly reviews completed yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reviews.slice(0, 6).map((rev) => (
                    <div key={rev.id} className="py-3 space-y-1">
                      <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {format(parseISO(rev.completedAt), 'MMM d, yyyy')} · {rev.type} review
                      </p>
                      <p className="text-sm text-slate-800 dark:text-slate-200">{rev.notes}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sequential Stepper Sidebar (Cannot skip forward) */}
          <Card className="lg:col-span-4 h-fit">
            <CardHeader>
              <CardTitle>Review Sequence</CardTitle>
              <CardDescription>Each section unlocks sequentially.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {REVIEW_STEPS.map((s) => {
                const isDone = completedSteps.has(s.id);
                const isCurrent = currentStep === s.id;
                const isLocked = !isDone && !isCurrent;
                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border px-3 py-2.5 flex items-center justify-between gap-2 ${
                      isCurrent
                        ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        0{s.id}. {s.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{s.subtitle}</p>
                    </div>
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : isLocked ? (
                      <Lock className="h-4 w-4 text-slate-400 shrink-0" />
                    ) : null}
                  </div>
                );
              })}
              <Button variant="ghost" size="sm" className="w-full mt-2" onClick={() => setInProgress(false)}>
                Exit Review
              </Button>
            </CardContent>
          </Card>

          {/* Active Section Processor */}
          <Card className="lg:col-span-8">
            <CardHeader>
              <CardTitle>
                Step {currentStep}: {REVIEW_STEPS[currentStep - 1].title}
              </CardTitle>
              <CardDescription>{REVIEW_STEPS[currentStep - 1].subtitle}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {currentStep === 1 && (
                <>
                  {buckets.overdueActions.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
                      Zero overdue actions. You are caught up.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {buckets.overdueActions.map((act) => (
                        <div key={act.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {act.description}
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-400 font-mono tabular-nums">
                              Due {formatLocalDateTime(act.dueDate)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                updateAction(act.id, {
                                  dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
                                })
                              }
                            >
                              Defer +2d
                            </Button>
                            <Button size="sm" onClick={() => completeAction(act.id)}>
                              Complete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button onClick={completeCurrentSection}>
                      <span>Confirm Overdue Reviewed</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}

              {currentStep === 2 && (
                <>
                  {buckets.stalledProjects.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
                      Every active project has at least one next physical action.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {buckets.stalledProjects.map((proj) => (
                        <div
                          key={proj.id}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5"
                        >
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {proj.name}
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Add next physical action..."
                              value={quickProjectAction[proj.id] ?? ''}
                              onChange={(e) =>
                                setQuickProjectAction((prev) => ({ ...prev, [proj.id]: e.target.value }))
                              }
                              className="flex-1 min-h-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 text-sm"
                            />
                            <Button
                              size="sm"
                              onClick={() => handleAddStalledAction(proj.id, proj.defaultContextId)}
                            >
                              Add Action
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button onClick={completeCurrentSection}>
                      <span>Confirm Stalled Projects Reviewed</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}

              {currentStep === 3 && (
                <>
                  {buckets.ticklerArrivingSoon.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
                      No deferred / tickler items surfacing in the next 7 days.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {buckets.ticklerArrivingSoon.map((act) => (
                        <div key={act.id} className="py-3 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              {act.description}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              Tickler: {formatLocalDateTime(act.deferredUntil)}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateAction(act.id, { status: 'active', deferredUntil: null })
                            }
                          >
                            Activate Now
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button onClick={completeCurrentSection}>
                      <span>Confirm Tickler Items Reviewed</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}

              {currentStep === 4 && (
                <>
                  {buckets.openLoops.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
                      Your Inbox has zero open loops remaining.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        You have {buckets.openLoops.length} unprocessed Inbox item(s) waiting in your Inbox:
                      </p>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {buckets.openLoops.map((item) => (
                          <div key={item.id} className="py-2.5 text-sm text-slate-800 dark:text-slate-200">
                            {item.content}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button onClick={completeCurrentSection}>
                      <span>Confirm Open Loops Checked</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}

              {currentStep === 5 && (
                <form onSubmit={handleFinishReview} className="space-y-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Weekly Review Summary Note *
                    </span>
                    <Textarea
                      required
                      maxLength={BOUNDARIES.NOTES_MAX}
                      placeholder="Key wins from this week, top priorities for next week..."
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                    />
                  </label>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={!reviewNotes.trim() || submitting}>
                      <Check className="h-4 w-4" />
                      <span>{submitting ? 'Saving...' : 'Complete Weekly Review'}</span>
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
