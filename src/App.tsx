import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { SettingsProvider } from './store/SettingsContext';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './pages/HomePage';

const PracticeSetupPage = lazy(() =>
  import('./pages/PracticeSetupPage').then((m) => ({ default: m.PracticeSetupPage })),
);
const SessionPage = lazy(() =>
  import('./pages/SessionPage').then((m) => ({ default: m.SessionPage })),
);
const VocabularyPage = lazy(() =>
  import('./pages/VocabularyPage').then((m) => ({ default: m.VocabularyPage })),
);
const ProgressPage = lazy(() =>
  import('./pages/ProgressPage').then((m) => ({ default: m.ProgressPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function PageFallback() {
  return (
    <main className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <div className="stack gap-3" style={{ alignItems: 'center' }}>
        <span className="hanzi" style={{ fontSize: 42, color: 'var(--accent)', opacity: 0.7 }}>
          书
        </span>
        <span className="small faint">Loading…</span>
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <main className="page" style={{ textAlign: 'center', paddingTop: 90 }}>
      <div className="hanzi" style={{ fontSize: 64, color: 'var(--accent)', opacity: 0.7 }}>
        迷
      </div>
      <h1 style={{ marginTop: 10 }}>Page not found</h1>
      <p className="muted" style={{ margin: '8px 0 22px' }}>
        That route doesn’t exist.
      </p>
      <Link className="btn btn-primary" to="/">
        Back to dashboard
      </Link>
    </main>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route element={<AppShell />}>
            <Route
              path="/"
              element={
                <Suspense fallback={<PageFallback />}>
                  <HomePage />
                </Suspense>
              }
            />
            <Route
              path="/practice"
              element={
                <Suspense fallback={<PageFallback />}>
                  <PracticeSetupPage />
                </Suspense>
              }
            />
            <Route
              path="/vocabulary"
              element={
                <Suspense fallback={<PageFallback />}>
                  <VocabularyPage />
                </Suspense>
              }
            />
            <Route
              path="/progress"
              element={
                <Suspense fallback={<PageFallback />}>
                  <ProgressPage />
                </Suspense>
              }
            />
            <Route
              path="/settings"
              element={
                <Suspense fallback={<PageFallback />}>
                  <SettingsPage />
                </Suspense>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route
            path="/practice/session"
            element={
              <Suspense fallback={<PageFallback />}>
                <SessionPage />
              </Suspense>
            }
          />
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  );
}
