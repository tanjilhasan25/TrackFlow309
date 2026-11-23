import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { auth } from '../lib/firebase';
import { useTrackFlow } from '../context/TrackFlowContext';
import {
  buildOperationPreviews,
  buildWorkspaceSnapshot,
  describeOperation,
  isShortConfirmationText,
  validateAndFilterOperations,
  type AiChatResponsePayload,
  type AiOperation,
  type OperationPreview,
} from '../utils/aiAgentOperations';
import { Button } from './ui/Button';

interface ChatMessageEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  clarificationQuestions?: string[];
  operations?: AiOperation[];
  previews?: OperationPreview[];
  blockedReasons?: string[];
  proposalState?: 'pending' | 'applied' | 'discarded';
  appliedCount?: number;
  stalledFollowUpProject?: string | null;
  errorText?: string;
  retryPrompt?: string;
}

const ROLE_LABELS: Record<string, string> = {
  individual: 'Individual User',
  collaborator: 'Team Collaborator',
  admin: 'Workspace Admin',
};

export function AiChatDrawer() {
  const {
    mode,
    profile,
    activeWorkspace,
    permissions,
    contexts,
    projects,
    actions,
    inboxItems,
    aiChatOpen,
    aiChatInitialPrompt,
    closeAiChat,
    captureInboxItem,
    clarifyInboxAsTrashOrSomeday,
    clarifyInboxAsAction,
    clarifyInboxAsNewProject,
    createContext,
    createProject,
    updateProjectState,
    deleteProject,
    createAction,
    updateAction,
    completeAction,
    completeWeeklyReview,
    inviteCollaborator,
  } = useTrackFlow();

  const [messages, setMessages] = useState<ChatMessageEntry[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [executingMsgId, setExecutingMsgId] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (aiChatOpen) {
      if (aiChatInitialPrompt) {
        setInput(aiChatInitialPrompt);
      }
      const t = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [aiChatOpen, aiChatInitialPrompt]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, sending]);

  useEffect(() => {
    if (!aiChatOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAiChat();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aiChatOpen, closeAiChat]);

  const activeActionsCount = useMemo(
    () => actions.filter((a) => a.status === 'active').length,
    [actions],
  );
  const unprocessedCount = useMemo(
    () => inboxItems.filter((i) => !i.processed).length,
    [inboxItems],
  );

  const starterPrompts = useMemo(() => {
    const list: string[] = [];
    if (unprocessedCount > 0 && permissions.canProcessInbox) {
      list.push('আমার Inbox প্রসেস করো এবং সঠিক Context ও Project সাজিয়ে প্রস্তাব দাও');
    }
    list.push('আজকের সব কাজের মধ্য থেকে এখন করার জন্য শুধু ১টা সেরা কাজ বেছে দাও');
    list.push('কাল সকাল ১০টায় Sarah-কে কল করার রিমাইন্ডার ও অ্যালার্ম সেট করো');
    if (permissions.canCreatePersonalProjects) {
      list.push('Create project Q4 Launch with 2 next actions and due dates');
    }
    if (permissions.canInviteCollaborators) {
      list.push('Run a team Weekly Review summary for our workspace');
    }
    return list;
  }, [unprocessedCount, permissions]);

  const executeOperationsBatch = useCallback(
    async (msgId: string, operations: AiOperation[]) => {
      if (!profile || operations.length === 0 || executingMsgId) return;
      setExecutingMsgId(msgId);
      const tempContextIds = new Map<string, string>();
      const tempProjectIds = new Map<string, { id: string; collaboratorIds: string[] }>();
      let executedCount = 0;
      let stalledProjectName: string | null = null;

      try {
        // Hard Rule 1 & 7: Always validate confirmation, RBAC, UTC & idempotency via unified server /api/actions/apply gate first.
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (mode === 'firebase' && auth.currentUser) {
          const token = await auth.currentUser.getIdToken();
          headers.Authorization = `Bearer ${token}`;
        }

        const applyResp = await fetch('/api/actions/apply', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            confirmed: true,
            idempotencyKey: msgId,
            authMode: mode === 'firebase' ? 'firebase' : 'demo',
            operations,
            state: {
              userId: profile.id,
              role: profile.role,
              workspaceId: activeWorkspace?.id || profile.workspaceId,
              contexts,
              projects,
              actions,
              inboxItems,
            },
          }),
        });

        const applyData = await applyResp.json();
        if (!applyResp.ok) {
          throw new Error(applyData.error || 'Server rejected action confirmation.');
        }

        if (applyData.deduplicated) {
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, proposalState: 'applied' as const } : m)),
          );
          toast.info('This proposed plan was already applied.');
          return;
        }

        const verifiedOps: AiOperation[] = Array.isArray(applyData.validOps) ? applyData.validOps : [];
        if (verifiedOps.length === 0) {
          const notice =
            Array.isArray(applyData.blockedReasons) && applyData.blockedReasons.length > 0
              ? applyData.blockedReasons[0]
              : 'No remaining valid operations to apply.';
          toast.info(notice);
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, proposalState: 'applied' as const, appliedCount: 0 } : m)),
          );
          return;
        }

        for (const op of verifiedOps) {
          switch (op.type) {
            case 'CAPTURE_INBOX': {
              await captureInboxItem(op.data.content);
              executedCount++;
              break;
            }
            case 'CLARIFY_INBOX_ITEM': {
              const resolvedCtx =
                (op.data.contextId && tempContextIds.get(op.data.contextId)) ||
                op.data.contextId ||
                contexts.find((c) => c.state === 'active')?.id ||
                contexts[0]?.id ||
                '';
              const resolvedProj =
                (op.data.projectId && tempProjectIds.get(op.data.projectId)?.id) ||
                op.data.projectId ||
                '';

              if (op.data.disposition === 'trash' || op.data.disposition === 'someday') {
                await clarifyInboxAsTrashOrSomeday(op.data.itemId, op.data.disposition);
              } else if (op.data.disposition === 'project') {
                await clarifyInboxAsNewProject({
                  itemId: op.data.itemId,
                  projectName: op.data.projectName || 'New Project',
                  projectDescription: op.data.projectDescription || '',
                  contextId: resolvedCtx,
                  firstActionDescription: op.data.firstActionDescription || 'Define first physical step',
                  dueDate: op.data.dueDate ?? null,
                  alarmTime: op.data.alarmTime ?? null,
                });
              } else {
                await clarifyInboxAsAction({
                  itemId: op.data.itemId,
                  description: op.data.description || 'Follow up',
                  contextId: resolvedCtx,
                  projectId: resolvedProj,
                  dueDate: op.data.dueDate ?? null,
                  alarmTime: op.data.alarmTime ?? null,
                });
              }
              executedCount++;
              break;
            }
            case 'CREATE_CONTEXT': {
              const newId = await createContext(op.data.name, Boolean(op.data.sharedInWorkspace));
              if (op.data.tempId) {
                tempContextIds.set(op.data.tempId, newId);
              }
              executedCount++;
              break;
            }
            case 'CREATE_PROJECT': {
              const defaultContextId =
                (op.data.defaultContextId && tempContextIds.get(op.data.defaultContextId)) ||
                op.data.defaultContextId ||
                contexts.find((c) => c.state === 'active')?.id ||
                contexts[0]?.id ||
                '';
              const isShared = Boolean(op.data.isShared);
              const newProjId = await createProject({
                name: op.data.name,
                description: op.data.description || '',
                defaultContextId,
                isShared,
              });
              const collaboratorIds =
                isShared && activeWorkspace ? activeWorkspace.memberIds.slice(0, 25) : [profile.id];
              if (op.data.tempId) {
                tempProjectIds.set(op.data.tempId, { id: newProjId, collaboratorIds });
              }
              executedCount++;
              break;
            }
            case 'TRANSITION_PROJECT_STATE': {
              await updateProjectState(op.data.projectId, op.data.nextState);
              executedCount++;
              break;
            }
            case 'DELETE_PROJECT': {
              await deleteProject(op.data.projectId);
              executedCount++;
              break;
            }
            case 'CREATE_ACTION': {
              const resolvedCtx =
                tempContextIds.get(op.data.contextId) ||
                op.data.contextId ||
                contexts.find((c) => c.state === 'active')?.id ||
                contexts[0]?.id ||
                '';
              const tempProj = op.data.projectId ? tempProjectIds.get(op.data.projectId) : undefined;
              const resolvedProjId = tempProj?.id || op.data.projectId || '';
              await createAction({
                description: op.data.description,
                contextId: resolvedCtx,
                projectId: resolvedProjId,
                projectCollaboratorIds: tempProj?.collaboratorIds,
                dueDate: op.data.dueDate ?? null,
                deferredUntil: op.data.deferredUntil ?? null,
                alarmTime: op.data.alarmTime ?? null,
                starred: Boolean(op.data.starred),
                priorityScore: op.data.priorityScore,
                estimatedMinutes: op.data.estimatedMinutes ?? null,
                tags: op.data.tags ?? [],
                notes: op.data.notes ?? '',
                status: op.data.status ?? 'active',
              });
              executedCount++;
              break;
            }
            case 'UPDATE_ACTION': {
              const patch = { ...op.data.patch };
              if (patch.contextId && tempContextIds.has(patch.contextId)) {
                patch.contextId = tempContextIds.get(patch.contextId);
              }
              if (patch.projectId && tempProjectIds.has(patch.projectId)) {
                patch.projectId = tempProjectIds.get(patch.projectId)?.id;
              }
              await updateAction(op.data.actionId, patch);
              executedCount++;
              break;
            }
            case 'COMPLETE_ACTION': {
              const targetAction = actions.find((a) => a.id === op.data.actionId);
              const didComplete = await completeAction(op.data.actionId, `${msgId}:${op.data.actionId}`);
              if (didComplete && targetAction?.projectId) {
                const parentProj = projects.find((p) => p.id === targetAction.projectId && p.state === 'active');
                const remainingActive = actions.filter(
                  (a) =>
                    a.projectId === targetAction.projectId &&
                    a.status === 'active' &&
                    a.id !== op.data.actionId,
                );
                if (parentProj && remainingActive.length === 0) {
                  stalledProjectName = parentProj.name;
                }
              }
              executedCount++;
              break;
            }
            case 'SET_ALARM': {
              await updateAction(op.data.actionId, { alarmTime: op.data.alarmTime });
              executedCount++;
              break;
            }
            case 'COMPLETE_WEEKLY_REVIEW': {
              await completeWeeklyReview(op.data.type, op.data.notes);
              executedCount++;
              break;
            }
            case 'INVITE_COLLABORATOR': {
              await inviteCollaborator(
                op.data.workspaceId || activeWorkspace?.id || profile.workspaceId,
                op.data.invitedEmail,
              );
              executedCount++;
              break;
            }
          }
        }

        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  proposalState: 'applied' as const,
                  appliedCount: executedCount,
                  stalledFollowUpProject: stalledProjectName,
                }
              : m,
          );
          if (stalledProjectName) {
            updated.push({
              id: `asst_stall_${Date.now()}`,
              role: 'assistant',
              text: `Action completed! "${stalledProjectName}" now has 0 remaining active next actions. Would you like to add the next physical step so it doesn't stall?`,
            });
          }
          return updated;
        });

        toast.success(`Applied ${executedCount} AI update${executedCount === 1 ? '' : 's'} to TrackFlow`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to execute some operations.';
        toast.error(msg);
      } finally {
        setExecutingMsgId(null);
      }
    },
    [
      mode,
      executingMsgId,
      profile,
      activeWorkspace,
      contexts,
      projects,
      actions,
      inboxItems,
      captureInboxItem,
      clarifyInboxAsTrashOrSomeday,
      clarifyInboxAsAction,
      clarifyInboxAsNewProject,
      createContext,
      createProject,
      updateProjectState,
      deleteProject,
      createAction,
      updateAction,
      completeAction,
      completeWeeklyReview,
      inviteCollaborator,
    ],
  );

  const handleDiscardProposal = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, proposalState: 'discarded' } : m)),
    );
  };

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const trimmed = (overrideText ?? input).trim();
      if (!trimmed || !profile || sending) return;

      const userEntry: ChatMessageEntry = {
        id: `usr_${Date.now()}`,
        role: 'user',
        text: trimmed,
      };
      if (!overrideText) {
        setInput('');
      }

      // If there's an unapplied pending proposal and user typed a short confirmation ("yes" / "হ্যাঁ" / "করে দাও")
      const latestPending = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.proposalState === 'pending' && (m.operations?.length ?? 0) > 0);

      if (latestPending && isShortConfirmationText(trimmed)) {
        setMessages((prev) => [...prev, userEntry]);
        await executeOperationsBatch(latestPending.id, latestPending.operations ?? []);
        return;
      }

      const nextHistory = [...messages, userEntry];
      setMessages(nextHistory);
      setSending(true);

      try {
        const snapshot = buildWorkspaceSnapshot({
          profile,
          workspaceId: activeWorkspace?.id || profile.workspaceId,
          contexts,
          projects,
          actions,
          inboxItems,
        });

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 45000);
        let res: Response;
        try {
          res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              messages: nextHistory.map((m) => ({ role: m.role, text: m.text })),
              workspaceContext: snapshot,
            }),
          });
        } finally {
          window.clearTimeout(timeoutId);
        }

        const data = await res.json();
        if (!res.ok || !data.response) {
          throw new Error(data.error || 'AI Assistant could not process your request.');
        }

        const payload = data.response as AiChatResponsePayload;
        const { validOps, blockedReasons } = validateAndFilterOperations(payload.operations ?? [], {
          userId: profile.id,
          role: profile.role,
          workspaceId: activeWorkspace?.id || profile.workspaceId,
          contexts,
          projects,
          actions,
          inboxItems,
        });

        const previews = buildOperationPreviews(validOps, {
          contexts,
          projects,
          actions,
          inboxItems,
        });

        // Hard Rule 1: AI is strictly PROPOSE-ONLY. Always stay in 'pending' until explicit user confirmation.
        const assistantId = `asst_${Date.now()}`;
        const assistantEntry: ChatMessageEntry = {
          id: assistantId,
          role: 'assistant',
          text: payload.assistantReply,
          clarificationQuestions: payload.clarificationQuestions,
          operations: validOps,
          previews,
          blockedReasons,
          proposalState: validOps.length > 0 ? 'pending' : undefined,
        };

        setMessages((prev) => [...prev, assistantEntry]);
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        const errorText = isAbort
          ? 'Gemini AI request timed out. Please try again.'
          : err instanceof Error
          ? err.message
          : 'Unable to reach AI Assistant.';
        setMessages((prev) => [
          ...prev,
          {
            id: `asst_err_${Date.now()}`,
            role: 'assistant',
            text: '',
            errorText,
            retryPrompt: trimmed,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [
      input,
      profile,
      sending,
      messages,
      activeWorkspace,
      contexts,
      projects,
      actions,
      inboxItems,
      executeOperationsBatch,
    ],
  );

  if (!aiChatOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="TrackFlow AI Assistant">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/45"
        onClick={closeAiChat}
      />

      {/* Slide-Over Panel */}
      <aside className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                TrackFlow AI Assistant
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums truncate">
              {ROLE_LABELS[profile?.role ?? 'individual']} · {activeActionsCount} active · {unprocessedCount} inbox pending
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {messages.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setMessages([])}
                aria-label="Reset conversation"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset</span>
              </Button>
            )}
            <button
              type="button"
              onClick={closeAiChat}
              aria-label="Close AI Assistant"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Message List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-5 py-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Run your GTD workflow by chatting naturally
                </p>
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Write in Bengali or English. The assistant will propose exact TrackFlow actions, projects, contexts, alarms, or reviews and wait for your confirmation before applying anything.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Try a quick prompt
                </p>
                <div className="space-y-2">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => sendMessage(prompt)}
                      className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30 px-3.5 py-2.5 text-xs text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const tempNames = new Map<string, string>();
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  {msg.errorText ? (
                    <div className="w-full rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300 flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="font-medium">Could not reach TrackFlow AI</p>
                          <p>{msg.errorText}</p>
                        </div>
                      </div>
                      {msg.retryPrompt && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={sending}
                          onClick={() => sendMessage(msg.retryPrompt)}
                        >
                          Retry
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`max-w-[90%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                          : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                      }`}
                    >
                      {msg.text}
                    </div>
                  )}

                  {/* Clarifying Questions */}
                  {msg.role === 'assistant' && msg.clarificationQuestions && msg.clarificationQuestions.length > 0 && (
                    <div className="w-full space-y-1.5 pl-1">
                      {msg.clarificationQuestions.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setInput(q)}
                          className="block w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Blocked Role Notices */}
                  {msg.role === 'assistant' && msg.blockedReasons && msg.blockedReasons.length > 0 && (
                    <div className="w-full rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                      <p className="font-medium">Restricted by current role ({ROLE_LABELS[profile?.role ?? 'individual']}):</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {msg.blockedReasons.map((reason, idx) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Proposed Operations Review Card */}
                  {msg.role === 'assistant' && msg.operations && msg.operations.length > 0 && (
                    <div className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          Proposed Actions ({msg.operations.length})
                        </p>
                        {msg.proposalState === 'applied' && (
                          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            Applied
                          </span>
                        )}
                        {msg.proposalState === 'discarded' && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Discarded
                          </span>
                        )}
                      </div>

                      <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                        {msg.operations.map((op, idx) => {
                          const preview = msg.previews?.[idx];
                          return (
                            <li key={idx} className="space-y-1">
                              <div className="flex items-start gap-2">
                                <span className="font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                                  {idx + 1}.
                                </span>
                                <span>
                                  {describeOperation(op, {
                                    contexts,
                                    projects,
                                    actions,
                                    inboxItems,
                                    pendingTempNames: tempNames,
                                  })}
                                </span>
                              </div>
                              {preview &&
                                preview.changes.some((c) => c.field !== 'operation') && (
                                  <div className="pl-5 space-y-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                    {preview.changes.map((c, cIdx) => (
                                      <div key={cIdx}>
                                        {c.field}: {c.currentValue} → {c.proposedValue}
                                      </div>
                                    ))}
                                  </div>
                                )}
                            </li>
                          );
                        })}
                      </ul>

                      {msg.proposalState === 'pending' && (
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={executingMsgId === msg.id}
                            onClick={() => handleDiscardProposal(msg.id)}
                          >
                            Discard
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={executingMsgId === msg.id}
                            onClick={() => executeOperationsBatch(msg.id, msg.operations ?? [])}
                          >
                            {executingMsgId === msg.id ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Applying...</span>
                              </>
                            ) : (
                              <>
                                <Check className="h-3.5 w-3.5" />
                                <span>Confirm &amp; Apply</span>
                              </>
                            )}
                          </Button>
                        </div>
                      )}

                      {msg.proposalState === 'applied' && (
                        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 dark:border-slate-800 pt-2.5 text-xs">
                          <Link
                            to="/focus"
                            onClick={closeAiChat}
                            className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            <span>View Focus</span>
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                          <Link
                            to="/projects"
                            onClick={closeAiChat}
                            className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            <span>View Projects</span>
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                          <Link
                            to="/inbox"
                            onClick={closeAiChat}
                            className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            <span>View Inbox</span>
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {sending && (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
              <span>Preparing GTD plan...</span>
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-2.5 bg-white dark:bg-slate-900"
        >
          <label className="block">
            <span className="sr-only">Message TrackFlow AI</span>
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Write a task, project, alarm, or question (Bangla or English)..."
              className="w-full resize-none rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Enter to send · Self-service confirmation
            </span>
            <Button type="submit" size="sm" disabled={!input.trim() || sending}>
              <Send className="h-3.5 w-3.5" />
              <span>Send</span>
            </Button>
          </div>
        </form>
      </aside>
    </div>
  );
}
