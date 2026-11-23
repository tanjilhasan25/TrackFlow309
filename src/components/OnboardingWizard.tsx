import React, { useState } from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { useTrackFlow } from '../context/TrackFlowContext';
import { BOUNDARIES } from '../utils/gtdLogic';
import { Button } from './ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/Dialog';
import { Input, Textarea } from './ui/Input';

export function OnboardingWizard() {
  const { profile, contexts, projects, createContext, createProject, createAction, completeOnboarding } = useTrackFlow();
  const [step, setStep] = useState<1 | 2>(1);
  const [contextName, setContextName] = useState('@Computer');
  const [createdContextId, setCreatedContextId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [firstAction, setFirstAction] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!profile || profile.preferences.onboardingCompleted) return null;
  if (contexts.length > 0 && projects.length > 0) return null;

  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contextName.trim()) return;
    setSubmitting(true);
    try {
      const ctxId = await createContext(contextName);
      setCreatedContextId(ctxId);
      setStep(2);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    setSubmitting(true);
    try {
      const ctxId = createdContextId || contexts[0]?.id || '';
      const projId = await createProject({
        name: projectName,
        description: projectDesc,
        defaultContextId: ctxId,
        isShared: false,
      });
      if (firstAction.trim() && ctxId) {
        await createAction({
          description: firstAction,
          contextId: ctxId,
          projectId: projId,
        });
      }
      await completeOnboarding();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to TrackFlow</DialogTitle>
          <DialogDescription>
            Set up your first GTD Context and first Project in two quick steps.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
          <span className={step === 1 ? 'text-indigo-600 dark:text-indigo-400' : 'text-emerald-600 dark:text-emerald-400'}>
            01. First Context
          </span>
          <span aria-hidden="true">·</span>
          <span className={step === 2 ? 'text-indigo-600 dark:text-indigo-400' : ''}>
            02. First Project
          </span>
        </div>

        {step === 1 ? (
          <form onSubmit={handleStep1} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Where or with what tool do you work first?
              </span>
              <Input
                maxLength={BOUNDARIES.CONTEXT_NAME_MAX}
                value={contextName}
                onChange={(e) => setContextName(e.target.value)}
                placeholder="@Computer, @Calls, @Office..."
                required
              />
            </label>
            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="ghost" onClick={completeOnboarding}>
                Skip setup
              </Button>
              <Button type="submit" disabled={!contextName.trim() || submitting}>
                <span>Next: First Project</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleStep2} className="space-y-3.5">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                First Project Name
              </span>
              <Input
                maxLength={BOUNDARIES.PROJECT_NAME_MAX}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Launch Portfolio Website"
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Outcome Description
              </span>
              <Textarea
                maxLength={BOUNDARIES.PROJECT_DESC_MAX}
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                placeholder="What does done look like?"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Very First Physical Next Action (Optional)
              </span>
              <Input
                maxLength={BOUNDARIES.ACTION_DESC_MAX}
                value={firstAction}
                onChange={(e) => setFirstAction(e.target.value)}
                placeholder="e.g. Sketch homepage wireframe"
              />
            </label>
            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="ghost" onClick={completeOnboarding}>
                Skip setup
              </Button>
              <Button type="submit" disabled={!projectName.trim() || submitting}>
                <CheckCircle2 className="h-4 w-4" />
                <span>Enter Workspace</span>
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
