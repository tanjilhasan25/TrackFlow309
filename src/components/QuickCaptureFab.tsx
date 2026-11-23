import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTrackFlow } from '../context/TrackFlowContext';
import { BOUNDARIES } from '../utils/gtdLogic';
import { Button } from './ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/Dialog';
import { Input } from './ui/Input';

export function QuickCaptureFab() {
  const { captureInboxItem, permissions } = useTrackFlow();
  const [open, setOpen] = useState(false);
  const [thought, setThought] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thought.trim()) return;
    setSubmitting(true);
    try {
      await captureInboxItem(thought);
      setThought('');
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick capture to inbox"
        className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-40 inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-full bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-sm font-medium text-white shadow-lg transition-transform duration-150 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 cursor-pointer"
      >
        <Plus className="h-4 w-4" />
        <span>Quick Capture</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick Capture to Inbox</DialogTitle>
            <DialogDescription>
              Capture any thought, commitment, or task in one line. Nothing is processed until you clarify it.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                What is on your mind?
              </span>
              <Input
                autoFocus
                maxLength={BOUNDARIES.INBOX_CONTENT_MAX}
                placeholder="e.g. Send Q4 kickoff brief to Sarah..."
                value={thought}
                onChange={(e) => setThought(e.target.value)}
              />
            </label>
            {!permissions.canProcessInbox && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Note: You can capture thoughts anytime; switch to Individual or Collaborator role in Settings to process your personal Inbox.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!thought.trim() || submitting}>
                {submitting ? 'Capturing...' : 'Capture to Inbox'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
