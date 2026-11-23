import React, { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTrackFlow } from '../context/TrackFlowContext';
import { findStalledProjects, partitionWeeklyReview } from '../utils/gtdLogic';
import type { AiWorkspaceInsight } from '../types/gtd';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';

export function InsightsPage() {
  const { profile, permissions, actions, projects, contexts, inboxItems, reviews, members } =
    useTrackFlow();
  const [loadingAi, setLoadingAi] = useState(false);
  const [insight, setInsight] = useState<AiWorkspaceInsight | null>(null);
  const [aiError, setAiError] = useState('');

  const metrics = useMemo(() => {
    const active = actions.filter((a) => a.status === 'active');
    const completed = actions.filter((a) => a.status === 'completed');
    const deferred = actions.filter((a) => a.status === 'deferred');
    const stalled = findStalledProjects(projects, actions);
    const buckets = partitionWeeklyReview(actions, projects, inboxItems);

    const byContext = contexts
      .filter((c) => c.state === 'active')
      .map((ctx) => ({
        name: ctx.name,
        activeCount: active.filter((a) => a.contextId === ctx.id).length,
        completedCount: completed.filter((a) => a.contextId === ctx.id).length,
      }));

    return {
      activeCount: active.length,
      completedCount: completed.length,
      deferredCount: deferred.length,
      overdueCount: buckets.overdueActions.length,
      stalledCount: stalled.length,
      unprocessedInboxCount: buckets.openLoops.length,
      activeProjectsCount: projects.filter((p) => p.state === 'active').length,
      sharedProjectsCount: projects.filter((p) => p.isShared).length,
      teamMembersCount: members.length,
      lastReviewAt: reviews[0]?.completedAt ?? null,
      byContext,
    };
  }, [actions, projects, contexts, inboxItems, members.length, reviews]);

  const handleGenerateInsights = async () => {
    setLoadingAi(true);
    setAiError('');
    try {
      const res = await fetch('/api/ai/workspace-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics }),
      });
      const data = await res.json();
      if (!res.ok || !data.insight) {
        throw new Error(data.error || 'Failed to generate workspace insights.');
      }
      setInsight(data.insight as AiWorkspaceInsight);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to reach AI advisor.');
    } finally {
      setLoadingAi(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Summary Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Completed Actions</p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {metrics.completedCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Overdue Actions</p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400">
              {metrics.overdueCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Active Projects</p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {metrics.activeProjectsCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Workspace Collaborators</p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {metrics.teamMembersCount}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Context Workload Breakdown */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Context Distribution</CardTitle>
            <CardDescription>Active vs. completed workload across contexts.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.byContext.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
                No active contexts configured yet.
              </p>
            ) : (
              <div className="space-y-3">
                {metrics.byContext.map((row) => {
                  const total = Math.max(1, row.activeCount + row.completedCount);
                  const pct = Math.round((row.completedCount / total) * 100);
                  return (
                    <div key={row.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {row.name}
                        </span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {row.activeCount} active · {row.completedCount} done
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 dark:bg-indigo-400 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Workspace Recommendations (Admin Only Action) */}
        <Card className="lg:col-span-7">
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>AI Workspace Recommendations</CardTitle>
              <CardDescription>
                {profile?.role === 'admin'
                  ? 'Generate Gemini recommendations for bottlenecks, stalled projects, and team cadence.'
                  : 'Available to Workspace Admins to optimize shared team throughput.'}
              </CardDescription>
            </div>
            {permissions.canManageSharedProjects && (
              <Button size="sm" onClick={handleGenerateInsights} disabled={loadingAi}>
                <Sparkles className="h-3.5 w-3.5" />
                <span>{loadingAi ? 'Analyzing...' : 'Generate Insights'}</span>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {aiError && (
              <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 mb-4">
                {aiError}
              </div>
            )}

            {insight ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {insight.summary}
                </p>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {insight.recommendations.map((rec, idx) => (
                    <div key={idx} className="py-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {rec.title}
                        </p>
                        <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400 capitalize">
                          {rec.impact} impact
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{rec.actionHint}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                {permissions.canManageSharedProjects
                  ? 'Click "Generate Insights" to analyze workspace momentum with Gemini.'
                  : 'Switch to Workspace Admin in Settings to generate AI workspace recommendations.'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
