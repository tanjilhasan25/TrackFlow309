import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { TrackFlowProvider, useTrackFlow } from './context/TrackFlowContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLayout } from './components/AppLayout';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { InboxPage } from './pages/InboxPage';
import { FocusPage } from './pages/FocusPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { WeeklyReviewPage } from './pages/WeeklyReviewPage';
import { InsightsPage } from './pages/InsightsPage';
import { SettingsPage } from './pages/SettingsPage';

function AppRoutes() {
  const { mode, profile } = useTrackFlow();

  if (mode === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading TrackFlow...</p>
        </div>
      </div>
    );
  }

  if (mode === 'unauthenticated' || mode === 'unverified') {
    return <AuthPage />;
  }

  if (mode === 'firebase' && !profile) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Syncing workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/focus" element={<FocusPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/review" element={<WeeklyReviewPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TrackFlowProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster position="bottom-left" richColors />
        </BrowserRouter>
      </TrackFlowProvider>
    </ErrorBoundary>
  );
}
