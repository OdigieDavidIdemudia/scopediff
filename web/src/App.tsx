import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { DataErrorScreen, LoadingScreen } from "./components/ui";
import { AppStoreProvider, useApp } from "./state/AppStore";
import { FeedPage } from "./pages/FeedPage";
import { ProgramsPage } from "./pages/ProgramsPage";
import { ProgramPage } from "./pages/ProgramPage";
import { ChangePage } from "./pages/ChangePage";
import { WatchlistPage } from "./pages/WatchlistPage";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { NotFoundPage } from "./pages/NotFoundPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { mode, user, authLoading } = useApp();
  const location = useLocation();
  if (mode === "demo") return <>{children}</>;
  if (authLoading) return <LoadingScreen label="Checking your session…" />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function RequireData({ children }: { children: ReactNode }) {
  const { loading, loadError, retryLive, useDemoInstead } = useApp();
  if (loading) return <LoadingScreen />;
  if (loadError) {
    return (
      <DataErrorScreen
        message={loadError}
        onRetry={() => void retryLive()}
        onDemo={useDemoInstead}
      />
    );
  }
  return <>{children}</>;
}

function RequireOnboarding({ children }: { children: ReactNode }) {
  const { mode, profile, onboardingComplete, profileLoading, loading } = useApp();
  if (mode === "demo") return <>{children}</>;
  if (profileLoading || loading || !profile) {
    return <LoadingScreen label="Loading your watchlist…" />;
  }
  if (!onboardingComplete) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function protectedPage(page: ReactNode) {
  return (
    <RequireAuth>
      <RequireData>
        <RequireOnboarding>{page}</RequireOnboarding>
      </RequireData>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppStoreProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <OnboardingPage />
                </RequireAuth>
              }
            />
            <Route path="/" element={protectedPage(<FeedPage />)} />
            <Route path="/programs" element={protectedPage(<ProgramsPage />)} />
            <Route path="/programs/:programId" element={protectedPage(<ProgramPage />)} />
            <Route path="/changes/:changeId" element={protectedPage(<ChangePage />)} />
            <Route path="/watchlist" element={protectedPage(<WatchlistPage />)} />
            <Route path="/admin" element={protectedPage(<AdminPage />)} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AppStoreProvider>
    </BrowserRouter>
  );
}
