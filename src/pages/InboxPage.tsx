import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Inbox as InboxIcon, Plus, Trash2, Clock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useTrackFlow } from '../context/TrackFlowContext';
import { BOUNDARIES } from '../utils/gtdLogic';
import type { InboxItem } from '../types/gtd';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Input, Textarea } from '../components/ui/Input';

export function InboxPage() {
  const {
    permissions,
    inboxItems,
    contexts,
    projects,
    captureInboxItem,
    clarifyInboxAsTrashOrSomeday,
    clarifyInboxAsAction,
    clarifyInboxAsNewProject,
    switchRoleOrWorkspace,
    openAiChat,
  } = useTrackFlow();

  const [quickInput, setQuickInput] = useState('');
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);

  // Feature 1 sequential steps:
  // Step 1: Select item -> "Is this actionable?" (Yes / No / Someday)
  // Step 2: If Yes -> Choose "Single Next Action" or "New Project"
  // Step 3: Select Context, optional Due Date, optional Project, optional Alarm
  // Step 4: Confirm -> Item leaves Inbox
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [outcomeType, setOutcomeType] = useState<'action' | 'project'>('action');

  const [actionDesc, setActionDesc] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [contextId, setContextId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [alarmTime, setAlarmTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pendingItems = inboxItems.filter((i) => !i.processed);
  const activeContexts = contexts.filter((c) => c.state === 'active');
  const activeProjects = projects.filter((p) => p.state === 'active');

  const handleCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;
    await captureInboxItem(quickInput);
    setQuickInput('');
  };

  const openClarifyFlow = (item: InboxItem) => {
    setSelectedItem(item);
    setWizardStep(1);
    setOutcomeType('action');
    setActionDesc(item.content);
    setProjectName(item.content);
    setProjectDesc('');
    setContextId(activeContexts[0]?.id ?? '');
    setProjectId('');
    setDueDate('');
    setAlarmTime('');
  };

  const handleNotActionable = async (disposition: 'trash' | 'someday') => {
    if (!selectedItem) return;
    setSubmitting(true);
    try {
      await clarifyInboxAsTrashOrSomeday(selectedItem.id, disposition);
      toast.success(disposition === 'someday' ? 'Moved to Someday/Tickler' : 'Discarded from Inbox');
      setSelectedItem(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmClarify = async () => {
    if (!selectedItem || !contextId) return;
    setSubmitting(true);
    try {
      if (outcomeType === 'action') {
        await clarifyInboxAsAction({
          itemId: selectedItem.id,
          description: actionDesc || selectedItem.content,
          contextId,
          projectId: projectId || undefined,
          dueDate: dueDate || null,
          alarmTime: alarmTime || null,
        });
        toast.success('Clarified into Next Action');
      } else {
        await clarifyInboxAsNewProject({
          itemId: selectedItem.id,
          projectName: projectName || selectedItem.content,
          projectDescription: projectDesc,
          contextId,
          firstActionDescription: actionDesc || `First step for ${projectName || selectedItem.content}`,
          dueDate: dueDate || null,
          alarmTime: alarmTime || null,
        });
        toast.success('Created Project and Next Action');
      }
      setSelectedItem(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Quick Capture Bar */}
      <Card>
        <CardHeader>
          <CardTitle>Capture Thought</CardTitle>
          <CardDescription>
            Type any open loop and press Enter. Clarify each item step by step below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCapture} className="flex flex-col sm:flex-row gap-2.5">
            <Input
              maxLength={BOUNDARIES.INBOX_CONTENT_MAX}
              placeholder="Capture a thought, task, or reminder and press Enter..."
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              aria-label="Quick capture inbox input"
            />
            <Button type="submit" disabled={!quickInput.trim()}>
              <Plus className="h-4 w-4" />
              <span>Add to Inbox</span>
            </Button>
          </form>
        </CardContent>
      </Card>

      {!permissions.canProcessInbox && (
        <Card className="border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20">
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Smart Inbox Processing is enabled for Individual User and Team Collaborator roles.
            </p>
            <Button size="sm" variant="outline" onClick={() => switchRoleOrWorkspace('individual')}>
              Switch to Individual Role
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Split Layout: Inbox Queue + Sequential Clarify Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-5">
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Unprocessed Inbox ({pendingItems.length})</CardTitle>
              <CardDescription>Select one item to begin clarifying.</CardDescription>
            </div>
            {pendingItems.length > 0 && permissions.canProcessInbox && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openAiChat('আমার Inbox-এর বাকি আইটেমগুলো প্রসেস করে Context ও Project প্রস্তাব দাও')}
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Clarify with AI</span>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {pendingItems.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <InboxIcon className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Inbox Zero</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  All captured thoughts have been clarified into actions, projects, or deferred.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {pendingItems.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!permissions.canProcessInbox}
                      onClick={() => openClarifyFlow(item)}
                      className={`w-full text-left px-3 py-3 rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                        isSelected
                          ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-100'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <p className="text-sm font-medium">{item.content}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        Captured {item.createdAt.slice(0, 10)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Clarify & Organize</CardTitle>
            <CardDescription>
              Follow each step explicitly so nothing moves without your confirmation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedItem ? (
              <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                Select an item from your Inbox on the left to start the 4-step clarification workflow.
              </div>
            ) : (
              <div className="space-y-5">
                {/* Step Indicator */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <span className={wizardStep === 1 ? 'text-indigo-600 dark:text-indigo-400 font-semibold' : ''}>
                    01. Actionable?
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={wizardStep === 2 ? 'text-indigo-600 dark:text-indigo-400 font-semibold' : ''}>
                    02. Action or Project
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={wizardStep === 3 ? 'text-indigo-600 dark:text-indigo-400 font-semibold' : ''}>
                    03. Organize Details
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={wizardStep === 4 ? 'text-indigo-600 dark:text-indigo-400 font-semibold' : ''}>
                    04. Confirm
                  </span>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Selected Inbox Thought</p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {selectedItem.content}
                  </p>
                </div>

                {/* Step 2: Is this actionable? */}
                {wizardStep === 1 && (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Is this actionable?
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Button
                        type="button"
                        onClick={() => setWizardStep(2)}
                        className="justify-center"
                      >
                        <Check className="h-4 w-4" />
                        <span>Yes, Actionable</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={submitting}
                        onClick={() => handleNotActionable('someday')}
                      >
                        <Clock className="h-4 w-4" />
                        <span>Someday / Maybe</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={submitting}
                        onClick={() => handleNotActionable('trash')}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>No (Discard)</span>
                      </Button>
                    </div>
                  </div>
                )}

                {/* Step 3: Single Next Action or New Project */}
                {wizardStep === 2 && (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Does this require one physical action or a multi-step Project?
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setOutcomeType('action');
                          setWizardStep(3);
                        }}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-left hover:border-indigo-500 dark:hover:border-indigo-400 transition-colors cursor-pointer"
                      >
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Single Next Action
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          A standalone task or an action inside an existing project.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOutcomeType('project');
                          setWizardStep(3);
                        }}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-left hover:border-indigo-500 dark:hover:border-indigo-400 transition-colors cursor-pointer"
                      >
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          New Project
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Create a new Project along with its very first Next Action.
                        </p>
                      </button>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setWizardStep(1)}>
                      <ArrowLeft className="h-4 w-4" /> Back
                    </Button>
                  </div>
                )}

                {/* Step 4: Context, Optional Project, Due Date, Alarm */}
                {wizardStep === 3 && (
                  <div className="space-y-4">
                    {outcomeType === 'project' ? (
                      <>
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            New Project Name
                          </span>
                          <Input
                            maxLength={BOUNDARIES.PROJECT_NAME_MAX}
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            Project Outcome Description (Optional)
                          </span>
                          <Textarea
                            maxLength={BOUNDARIES.PROJECT_DESC_MAX}
                            value={projectDesc}
                            onChange={(e) => setProjectDesc(e.target.value)}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            First Physical Next Action
                          </span>
                          <Input
                            maxLength={BOUNDARIES.ACTION_DESC_MAX}
                            value={actionDesc}
                            onChange={(e) => setActionDesc(e.target.value)}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            Next Action Description
                          </span>
                          <Input
                            maxLength={BOUNDARIES.ACTION_DESC_MAX}
                            value={actionDesc}
                            onChange={(e) => setActionDesc(e.target.value)}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            Link to Project (Optional)
                          </span>
                          <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="flex min-h-10 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          >
                            <option value="">Standalone (No Project)</option>
                            {activeProjects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          Context *
                        </span>
                        <select
                          value={contextId}
                          onChange={(e) => setContextId(e.target.value)}
                          className="flex min-h-10 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
                          Due Date (Optional)
                        </span>
                        <Input
                          type="datetime-local"
                          value={dueDate}
                          onChange={(e) => setDueDate(e.target.value)}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          Alarm (Optional)
                        </span>
                        <Input
                          type="datetime-local"
                          value={alarmTime}
                          onChange={(e) => setAlarmTime(e.target.value)}
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setWizardStep(2)}>
                        <ArrowLeft className="h-4 w-4" /> Back
                      </Button>
                      <Button
                        type="button"
                        disabled={!contextId || !(outcomeType === 'project' ? projectName.trim() : actionDesc.trim())}
                        onClick={() => setWizardStep(4)}
                      >
                        <span>Review & Confirm</span>
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Step 5: Final User Confirmation */}
                {wizardStep === 4 && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-sm">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {outcomeType === 'project' ? `New Project: ${projectName}` : `Next Action: ${actionDesc}`}
                      </p>
                      {outcomeType === 'project' && (
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          First Action: {actionDesc || `First step for ${projectName}`}
                        </p>
                      )}
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Context: {contexts.find((c) => c.id === contextId)?.name ?? 'None'}
                        {projectId && outcomeType === 'action'
                          ? ` · Project: ${projects.find((p) => p.id === projectId)?.name ?? ''}`
                          : ''}
                        {dueDate ? ` · Due: ${dueDate.replace('T', ' ')}` : ''}
                        {alarmTime ? ` · Alarm: ${alarmTime.replace('T', ' ')}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setWizardStep(3)}>
                        <ArrowLeft className="h-4 w-4" /> Edit Details
                      </Button>
                      <Button type="button" disabled={submitting} onClick={handleConfirmClarify}>
                        <Check className="h-4 w-4" />
                        <span>{submitting ? 'Moving...' : 'Confirm & Move from Inbox'}</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
