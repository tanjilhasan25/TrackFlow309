import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Inbox,
  Crosshair,
  FolderKanban,
  ClipboardCheck,
  BarChart3,
  Settings,
  Sun,
  Moon,
  Menu,
  X,
  Bell,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { useTrackFlow } from '../context/TrackFlowContext';
import { QuickCaptureFab } from './QuickCaptureFab';
import { OnboardingWizard } from './OnboardingWizard';
import { AiChatDrawer } from './AiChatDrawer';
import { Button } from './ui/Button';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/focus', label: 'Focus', icon: Crosshair },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/review', label: 'Review', icon: ClipboardCheck },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const ROLE_LABELS: Record<string, string> = {
  individual: 'Individual User',
  collaborator: 'Team Collaborator',
  admin: 'Workspace Admin',
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const {
    mode,
    profile,
    activeWorkspace,
    inboxItems,
    theme,
    toggleTheme,
    dueAlarm,
    dismissAlarm,
    snoozeAlarm,
    completeAction,
    signOut,
    openAiChat,
  } = useTrackFlow();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  const unprocessedCount = inboxItems.filter((i) => !i.processed).length;

  const currentPageTitle =
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))?.label ?? 'TrackFlow';

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="space-y-6">
        <div className="px-2 pt-1">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            TrackFlow
          </span>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
            {activeWorkspace?.name ?? 'Personal Workspace'}
          </p>
        </div>

        <nav aria-label="Main navigation" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) =>
                  `flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
                  }`
                }
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.to === '/inbox' && unprocessedCount > 0 && (
                  <span className="text-xs font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                    {unprocessedCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
        <div className="flex items-center gap-2.5 px-2">
          <img
            src="/src/assets/images/avatar_workspace_lead_1795247628053.jpg"
            alt={profile?.name ?? 'User avatar'}
            referrerPolicy="no-referrer"
            className="h-8 w-8 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
              {profile?.name ?? 'User'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {ROLE_LABELS[profile?.role ?? 'individual']}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={signOut}
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 w-64 max-w-[80vw] bg-white dark:bg-slate-900 h-full border-r border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-3 top-3 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 sm:px-8 h-14">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {currentPageTitle}
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 shrink-0">
            <span className="hidden sm:inline whitespace-nowrap">
              {ROLE_LABELS[profile?.role ?? 'individual']}
            </span>
            {mode === 'demo' && (
              <>
                <span className="hidden sm:inline" aria-hidden="true">·</span>
                <span className="whitespace-nowrap">Preview Mode</span>
              </>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openAiChat()}
              aria-label="Open AI Assistant"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="hidden sm:inline">AI Assistant</span>
              <span className="sm:hidden">AI</span>
            </Button>
          </div>
        </header>

        {/* Active Alarm Notification Banner */}
        {dueAlarm && (
          <div className="border-b border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-4 sm:px-8 py-3">
            <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-sm text-amber-900 dark:text-amber-200">
                <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="font-medium">Alarm Due:</span>
                <span>{dueAlarm.description}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => snoozeAlarm(dueAlarm.actionId, 15)}>
                  Snooze 15m
                </Button>
                <Button size="sm" onClick={() => completeAction(dueAlarm.actionId)}>
                  Mark Complete
                </Button>
                <Button size="sm" variant="ghost" onClick={dismissAlarm}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 px-4 sm:px-8 py-6 max-w-6xl w-full mx-auto pb-28">
          {children}
        </main>
      </div>

      <QuickCaptureFab />
      <AiChatDrawer />
      <OnboardingWizard />
    </div>
  );
}
