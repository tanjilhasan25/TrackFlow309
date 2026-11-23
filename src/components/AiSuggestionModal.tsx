import React, { useEffect, useState } from 'react';
import { Bell, Calendar, Clock, Sparkles, Tag, Check, X, Edit3 } from 'lucide-react';
import { toast } from 'sonner';
import { useTrackFlow } from '../context/TrackFlowContext';
import type { ActionItem, AiScheduleSuggestion } from '../types/gtd';
import { Button } from './ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/Dialog';
import { Input } from './ui/Input';

interface AiSuggestionModalProps {
  action: ActionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AiSuggestionModal({ action, open, onOpenChange }: AiSuggestionModalProps) {
  const { contexts, projects, updateAction } = useTrackFlow();
  const [step, setStep] = useState<'ready' | 'loading' | 'review' | 'editing' | 'error'>('ready');
  const [suggestion, setSuggestion] = useState<AiScheduleSuggestion | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Editable draft fields (only saved when user explicitly confirms)
  const [draftDueDate, setDraftDueDate] = useState('');
  const [draftContextId, setDraftContextId] = useState('');
  const [draftAlarmTime, setDraftAlarmTime] = useState('');
  const [draftEstimatedMinutes, setDraftEstimatedMinutes] = useState('30');
  const [draftPriorityScore, setDraftPriorityScore] = useState('70');

  useEffect(() => {
    if (open && action) {
      setStep('ready');
      setSuggestion(null);
      setErrorMsg('');
      setDraftDueDate(action.dueDate ?? '');
      setDraftContextId(action.contextId);
      setDraftAlarmTime(action.alarmTime ?? '');
      setDraftEstimatedMinutes(String(action.estimatedMinutes ?? 30));
      setDraftPriorityScore(String(action.priorityScore ?? 50));
    }
  }, [open, action]);

  if (!action) return null;

  const activeContexts = contexts.filter((c) => c.state === 'active');
  const currentContext = contexts.find((c) => c.id === action.contextId);
  const parentProject = projects.find((p) => p.id === action.projectId);

  const handleRequestSuggestion = async () => {
    setStep('loading');
    setErrorMsg('');
    try {
      const response = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: action.description,
          notes: action.notes,
          projectName: parentProject?.name ?? 'Standalone',
          currentContextName: currentContext?.name ?? 'None',
          dueDate: action.dueDate ?? 'None',
          contexts: activeContexts.map((c) => ({ id: c.id, name: c.name })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.suggestion) {
        throw new Error(data.error || 'Unable to fetch AI scheduling recommendation.');
      }

      const s = data.suggestion as AiScheduleSuggestion;
      const validContext = activeContexts.find((c) => c.id === s.recommendedContextId) ?? currentContext ?? activeContexts[0];

      setSuggestion(s);
      setDraftDueDate(s.suggestedDueDate ? s.suggestedDueDate.slice(0, 16) : '');
      setDraftContextId(validContext?.id ?? action.contextId);
      setDraftAlarmTime(s.recommendAlarm && s.suggestedAlarmTime ? s.suggestedAlarmTime.slice(0, 16) : '');
      setDraftEstimatedMinutes(String(s.estimatedMinutes || 30));
      setDraftPriorityScore(String(Math.min(100, Math.max(0, s.priorityScore || 60))));
      setStep('review');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI service unavailable.');
      setStep('error');
    }
  };

  const handleConfirmApply = async () => {
    await updateAction(action.id, {
      dueDate: draftDueDate || null,
      contextId: draftContextId || action.contextId,
      alarmTime: draftAlarmTime || null,
      estimatedMinutes: Number(draftEstimatedMinutes) || null,
      priorityScore: Math.min(100, Math.max(0, Number(draftPriorityScore) || action.priorityScore)),
    });
    toast.success('Schedule, context, and alarm updated');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI Scheduling Assistant</DialogTitle>
          <DialogDescription>
            Review AI recommendations before any due date, context, or alarm is changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{action.description}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {currentContext?.name ?? 'No context'} · {parentProject?.name ?? 'Single Action'}
            </p>
          </div>

          {step === 'ready' && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Request a Gemini scheduling suggestion for the best time window, estimated duration, recommended Context, and alarm trigger.
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleRequestSuggestion}>
                  <Sparkles className="h-4 w-4" />
                  Get AI Suggestion
                </Button>
              </div>
            </div>
          )}

          {step === 'loading' && (
            <div className="py-8 text-center space-y-2">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Analyzing workload, context fit, and time window...
              </p>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
                {errorMsg}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                You can configure the schedule manually below or retry once your Gemini API key is active in Secrets.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button variant="secondary" onClick={() => setStep('editing')}>
                  Edit Manually
                </Button>
              </div>
            </div>
          )}

          {step === 'review' && suggestion && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-0.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" /> Best Time
                    </span>
                    <p className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                      {suggestion.suggestedTimeOfDay || draftDueDate || 'Flexible'}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" /> Est. Duration
                    </span>
                    <p className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                      {draftEstimatedMinutes} min
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5" /> Recommended Context
                    </span>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {contexts.find((c) => c.id === draftContextId)?.name ?? suggestion.recommendedContextName}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Bell className="h-3.5 w-3.5" /> Alarm
                    </span>
                    <p className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                      {draftAlarmTime ? draftAlarmTime.replace('T', ' ') : 'No alarm needed'}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800 pt-2.5 leading-relaxed">
                  {suggestion.rationale}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  <X className="h-4 w-4" />
                  Reject
                </Button>
                <Button variant="outline" onClick={() => setStep('editing')}>
                  <Edit3 className="h-4 w-4" />
                  Edit
                </Button>
                <Button onClick={handleConfirmApply}>
                  <Check className="h-4 w-4" />
                  Accept & Apply
                </Button>
              </div>
            </div>
          )}

          {step === 'editing' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span>Due Date & Time</span>
                  <Input
                    type="datetime-local"
                    value={draftDueDate}
                    onChange={(e) => setDraftDueDate(e.target.value)}
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span>Context</span>
                  <select
                    value={draftContextId}
                    onChange={(e) => setDraftContextId(e.target.value)}
                    className="flex min-h-10 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {activeContexts.map((ctx) => (
                      <option key={ctx.id} value={ctx.id}>
                        {ctx.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span>Alarm Reminder</span>
                  <Input
                    type="datetime-local"
                    value={draftAlarmTime}
                    onChange={(e) => setDraftAlarmTime(e.target.value)}
                  />
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span>Duration (minutes)</span>
                  <Input
                    type="number"
                    min={5}
                    max={480}
                    value={draftEstimatedMinutes}
                    onChange={(e) => setDraftEstimatedMinutes(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleConfirmApply}>
                  <Check className="h-4 w-4" />
                  Confirm Schedule Update
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
