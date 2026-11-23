import React, { useState } from 'react';
import { ArrowRight, MailCheck, RefreshCw } from 'lucide-react';
import { useTrackFlow } from '../context/TrackFlowContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export function AuthPage() {
  const {
    mode,
    firebaseUser,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    resendVerificationEmail,
    refreshVerificationStatus,
    enterDemoMode,
    signOut,
  } = useTrackFlow();

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      if (tab === 'login') {
        await signInWithEmail(email, password);
      } else {
        if (!name.trim()) {
          setErrorMsg('Please enter your full name.');
          setLoading(false);
          return;
        }
        await registerWithEmail(name, email, password);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      if (msg.includes('auth/operation-not-allowed')) {
        setErrorMsg(
          'Email/Password sign-in is not yet enabled in Firebase Console (Authentication -> Sign-in method -> Email/Password). You can use Google Sign-In or Explore Demo Workspace right now.',
        );
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'unverified' && firebaseUser) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-5">
          <div className="flex items-center gap-3 text-indigo-600 dark:text-indigo-400">
            <MailCheck className="h-6 w-6 shrink-0" />
            <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
              Verify your email address
            </h1>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            We sent a verification link to <span className="font-medium text-slate-900 dark:text-slate-100">{firebaseUser.email}</span>. Click the link in your inbox, then press Continue below.
          </p>
          <div className="flex flex-col gap-2.5">
            <Button onClick={() => refreshVerificationStatus()}>
              <RefreshCw className="h-4 w-4" />
              I have verified — Continue
            </Button>
            <Button variant="outline" onClick={() => resendVerificationEmail()}>
              Resend Verification Email
            </Button>
            <Button variant="ghost" onClick={() => signOut()}>
              Use a different account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 sm:p-8">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {/* Left Auth Column */}
        <div className="p-8 sm:p-10 flex flex-col justify-between space-y-8">
          <div className="space-y-2">
            <p className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              TrackFlow
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 [text-wrap:balance]">
              Calm, intentional Getting Things Done.
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Capture open loops, clarify next physical actions, focus by context, and run guided weekly reviews.
            </p>
          </div>

          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setErrorMsg('');
                }}
                className={`rounded-md py-2 text-xs font-medium transition-colors cursor-pointer ${
                  tab === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('register');
                  setErrorMsg('');
                }}
                className={`rounded-md py-2 text-xs font-medium transition-colors cursor-pointer ${
                  tab === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Create Account
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 leading-relaxed">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleEmailSubmit} className="space-y-3.5">
              {tab === 'register' && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Full Name
                  </span>
                  <Input
                    type="text"
                    required
                    placeholder="Elena Vance"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Email Address
                </span>
                <Input
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Password
                </span>
                <Input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <Button type="submit" className="w-full" disabled={loading}>
                <span>{tab === 'login' ? 'Sign In with Email' : 'Create Account'}</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              <span className="mx-3 text-xs text-slate-400">or</span>
              <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Button type="button" variant="outline" onClick={handleGoogle} disabled={loading}>
                Continue with Google
              </Button>
              <Button type="button" variant="secondary" onClick={() => enterDemoMode(true)}>
                Explore Demo Workspace
              </Button>
            </div>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500">
            Self-service GTD system · Real-time Firebase sync · 3 role-aware workspace modes
          </p>
        </div>

        {/* Right Calm Visual Column */}
        <div className="hidden lg:block relative min-h-[540px] bg-slate-100 dark:bg-slate-800">
          <img
            src="/src/assets/images/login_workspace_calm_1795247628972.jpg"
            alt="Minimalist daylight workspace desk with linen notebook"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/20 to-transparent flex flex-col justify-end p-8">
            <p className="text-sm font-medium text-white max-w-sm leading-relaxed">
              Every open loop captured, clarified step-by-step, and scheduled only when you confirm.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
