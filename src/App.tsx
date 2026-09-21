import React from 'react';
import { RouterProvider, useRouter } from './router/Router';
import { AuthProvider } from './context/AuthContext';
import { RouteGuard } from './components/auth/RouteGuard';
import { PublicLayout } from './components/layout/PublicLayout';

import { HomePage } from './pages/HomePage';
import { AboutPage } from './pages/AboutPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ApprovalDetailPage } from './pages/ApprovalDetailPage';
import { SchemesPage } from './pages/SchemesPage';
import { SchemeDetailPage } from './pages/SchemeDetailPage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import { HelpPage } from './pages/HelpPage';
import { NoticesPage } from './pages/NoticesPage';
import { ContactPage } from './pages/ContactPage';

import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { OtpVerifyPage } from './pages/auth/OtpVerifyPage';
import { ApplicantDashboardPage } from './pages/applicant/ApplicantDashboardPage';
import { ApplicantProfilePage } from './pages/applicant/ApplicantProfilePage';
import { EnterprisesPage } from './pages/applicant/EnterprisesPage';
import { RepresentativesPage } from './pages/applicant/RepresentativesPage';
import { FindApprovalsPage } from './pages/applicant/FindApprovalsPage';
import { QuestionnairePage } from './pages/applicant/QuestionnairePage';
import { ApprovalResultsPage } from './pages/applicant/ApprovalResultsPage';
import { DocumentVaultPage } from './pages/applicant/DocumentVaultPage';
import { CteStep1ParametersPage } from './pages/applicant/CteStep1ParametersPage';
import { CteStep2DocumentsPage } from './pages/applicant/CteStep2DocumentsPage';
import { CteStep3ReviewPage } from './pages/applicant/CteStep3ReviewPage';
import { MyApplicationsPage } from './pages/applicant/MyApplicationsPage';
import { ApplicationTrackerPage } from './pages/applicant/ApplicationTrackerPage';
import { ComplianceActionCenterPage } from './pages/applicant/ComplianceActionCenterPage';
import { OfficerQueuePage } from './pages/officer/OfficerQueuePage';
import { OfficerWorkspacePage } from './pages/officer/OfficerWorkspacePage';
import { OfficerDashboardPage } from './pages/officer/OfficerDashboardPage';
import { StatutoryReportsPage } from './pages/officer/StatutoryReportsPage';
import { RTSGrievanceDeskPage } from './pages/officer/RTSGrievanceDeskPage';
import { InspectorWorkspacePage } from './pages/inspector/InspectorWorkspacePage';
import { InspectorDashboardPage } from './pages/inspector/InspectorDashboardPage';
import { AdminConfigurationPage } from './pages/admin/AdminConfigurationPage';
import { LeadershipDashboardPage } from './pages/leadership/LeadershipDashboardPage';

// ── Phase 8A — Temporary placeholder components (replaced in Phase 8B) ─────────────────

const OfficerPortalPlaceholder: React.FC<{ screen: string }> = ({ screen }) => (
  <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
    <div className="max-w-lg w-full bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-8 text-center space-y-4">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-600/20 border border-blue-500/40 mx-auto mb-2">
        <span className="text-2xl">🗂️</span>
      </div>
      <h1 className="text-xl font-bold text-white">MahaUdyam One — Officer Portal</h1>
      <p className="text-sm text-blue-300 font-semibold">{screen}</p>
      <div className="mt-4 p-3 bg-emerald-900/40 border border-emerald-700/50 rounded-lg">
        <p className="text-xs text-emerald-300 font-mono">Phase 8 foundation verified ✅</p>
        <p className="text-[11px] text-slate-400 mt-1">Role guard: OFFICER • Route protection active</p>
      </div>
      <p className="text-[11px] text-slate-500 italic">This placeholder will be replaced in Phase 8B with the full Officer workspace.</p>
    </div>
  </div>
);

const AppRoutes: React.FC = () => {
  const { currentPath, navigate } = useRouter();

  const pathWithoutQuery = currentPath.split('?')[0];
  const path = pathWithoutQuery.length > 1 && pathWithoutQuery.endsWith('/')
    ? pathWithoutQuery.slice(0, -1)
    : pathWithoutQuery;

  // ── Phase 8A: Officer routes (OFFICER role required) ────────────────────────────────
  switch (path) {
    case '/leadership':
      return (
        <RouteGuard requireAuth requireRole="LEADERSHIP" redirectTo="/login">
          <LeadershipDashboardPage />
        </RouteGuard>
      );

    case '/admin':
      return (
        <RouteGuard requireAuth requireRole="ADMINISTRATOR" redirectTo="/login">
          <AdminConfigurationPage />
        </RouteGuard>
      );

    case '/officer/dashboard':
      return (
        <RouteGuard requireAuth requireRole="OFFICER" redirectTo="/login">
          <OfficerDashboardPage />
        </RouteGuard>
      );

    case '/officer/reports':
      return (
        <RouteGuard requireAuth requireRole="OFFICER" redirectTo="/login">
          <StatutoryReportsPage />
        </RouteGuard>
      );

    case '/officer/grievances':
      return (
        <RouteGuard requireAuth requireRole="OFFICER" redirectTo="/login">
          <RTSGrievanceDeskPage />
        </RouteGuard>
      );

    case '/officer':
    case '/officer/queue':
      return (
        <RouteGuard requireAuth requireRole="OFFICER" redirectTo="/login">
          <OfficerQueuePage />
        </RouteGuard>
      );

    case '/officer/workspace':
      return (
        <RouteGuard requireAuth requireRole="OFFICER" redirectTo="/login">
          <OfficerWorkspacePage />
        </RouteGuard>
      );

    // ── Inspector routes (INSPECTOR role required) — Screen 28 ─────────────────────────
    case '/inspector/dashboard':
      return (
        <RouteGuard requireAuth requireRole="INSPECTOR" redirectTo="/login">
          <InspectorDashboardPage />
        </RouteGuard>
      );

    case '/inspector':
    case '/inspector/workspace':
    case '/inspector/inspections':
    case '/inspector/reports':
      return (
        <RouteGuard requireAuth requireRole="INSPECTOR" redirectTo="/login">
          <InspectorWorkspacePage />
        </RouteGuard>
      );

    // ── Applicant routes (authenticated + APPLICANT role required) ─────────────────────
    case '/applicant':
    case '/applicant/dashboard':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <ApplicantDashboardPage />
        </RouteGuard>
      );

    case '/applicant/profile':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <ApplicantProfilePage />
        </RouteGuard>
      );

    case '/applicant/enterprises':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <EnterprisesPage />
        </RouteGuard>
      );

    case '/applicant/documents':
    case '/applicant/vault':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <DocumentVaultPage />
        </RouteGuard>
      );

    case '/applicant/representatives':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <RepresentativesPage />
        </RouteGuard>
      );

    case '/applicant/approvals':
    case '/applicant/approvals/find':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <FindApprovalsPage />
        </RouteGuard>
      );

    case '/applicant/approvals/questionnaire':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <QuestionnairePage />
        </RouteGuard>
      );

    case '/applicant/approvals/results':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <ApprovalResultsPage />
        </RouteGuard>
      );

    case '/applicant/applications/cte':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <CteStep1ParametersPage />
        </RouteGuard>
      );

    case '/applicant/applications/cte/documents':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <CteStep2DocumentsPage />
        </RouteGuard>
      );

    case '/applicant/applications/cte/review':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <CteStep3ReviewPage />
        </RouteGuard>
      );

    case '/applicant/applications':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <MyApplicationsPage />
        </RouteGuard>
      );

    case '/applicant/applications/tracker':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <ApplicationTrackerPage />
        </RouteGuard>
      );

    case '/applicant/compliance':
      return (
        <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
          <ComplianceActionCenterPage />
        </RouteGuard>
      );

    default:
      break;
  }

  // /inspector/inspections/:id and any other /inspector/* path resolve inside the guarded Inspector workspace.
  if (path.startsWith('/inspector/')) {
    return (
      <RouteGuard requireAuth requireRole="INSPECTOR" redirectTo="/login">
        <InspectorWorkspacePage />
      </RouteGuard>
    );
  }

  // Unknown /applicant/* paths keep the earlier behaviour: land on the (guarded) dashboard.
  if (path.startsWith('/applicant/')) {
    return (
      <RouteGuard requireAuth requireRole="APPLICANT" redirectTo="/login">
        <ApplicantDashboardPage />
      </RouteGuard>
    );
  }

  const renderContent = () => {
    switch (path) {
      // Phase 1 Public Routes
      case '/':
        return <HomePage />;
      case '/about':
        return <AboutPage />;
      case '/approvals':
      case '/services':
        return <ApprovalsPage />;
      case '/approvals/consent-to-establish':
        return <ApprovalDetailPage />;
      case '/schemes':
        return <SchemesPage />;
      case '/schemes/msme-competitiveness':
        return <SchemeDetailPage />;
      case '/how-it-works':
        return <HowItWorksPage />;
      case '/help':
        return <HelpPage />;
      case '/notices':
        return <NoticesPage />;
      case '/contact':
        return <ContactPage />;

      // Phase 2 Authentication Routes
      case '/login':
        return (
          <RouteGuard preventAuth redirectTo="/applicant/dashboard">
            <LoginPage />
          </RouteGuard>
        );

      case '/register':
        return (
          <RouteGuard preventAuth redirectTo="/applicant/dashboard">
            <RegisterPage />
          </RouteGuard>
        );

      case '/register/verify':
        return (
          <RouteGuard preventAuth redirectTo="/applicant/dashboard">
            <OtpVerifyPage />
          </RouteGuard>
        );

      default:
        // Approvals / Services detail dynamic prefix
        if (path.startsWith('/approvals/') || path.startsWith('/services/')) {
          return <ApprovalDetailPage />;
        }

        // Schemes detail dynamic prefix
        if (path.startsWith('/schemes/')) {
          return <SchemeDetailPage />;
        }

        // Fallback 404
        return (
          <div className="max-w-md mx-auto my-12 p-6 bg-white border border-slate-200 rounded-lg shadow-sm text-center space-y-4">
            <h2 className="text-base font-bold text-slate-900">Page Not Found</h2>
            <p className="text-xs text-slate-600">
              The requested route <span className="font-mono text-blue-700">{path}</span> could not be resolved.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="px-4 py-2 bg-[#0f2b48] text-white rounded text-xs font-semibold hover:bg-slate-800 transition"
              >
                Go to Home
              </button>
            </div>
          </div>
        );
    }
  };

  return <PublicLayout>{renderContent()}</PublicLayout>;
};

export default function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </RouterProvider>
  );
}
