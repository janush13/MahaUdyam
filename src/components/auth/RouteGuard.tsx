import React, { useEffect, ReactNode } from 'react';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { AuthRole } from '../../types';

interface RouteGuardProps {
  children: ReactNode;
  requireAuth?: boolean;
  requireRole?: AuthRole | AuthRole[];
  preventAuth?: boolean; // e.g. for /login or /register when already logged in
  redirectTo?: string;
}

// Landing route for each role. Roles without a portal yet go to the public home
// (never to /applicant/*, which would bounce them straight back and loop).
const ROLE_HOME: Record<AuthRole, string> = {
  APPLICANT: '/applicant/dashboard',
  OFFICER: '/officer/dashboard',
  INSPECTOR: '/inspector/dashboard',
  ADMINISTRATOR: '/admin',
  LEADERSHIP: '/leadership',
};

export const RouteGuard: React.FC<RouteGuardProps> = ({
  children,
  requireAuth = false,
  requireRole,
  preventAuth = false,
  redirectTo,
}) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { currentPath, navigate } = useRouter();

  const allowedRoles: AuthRole[] | undefined = requireRole
    ? Array.isArray(requireRole) ? requireRole : [requireRole]
    : undefined;

  const isRoleAuthorized =
    !allowedRoles ||
    (!!user && allowedRoles.includes(user.role));

  useEffect(() => {
    if (isLoading) return;

    if (requireAuth && !isAuthenticated) {
      const target = redirectTo || `/login?redirect=${encodeURIComponent(currentPath)}`;
      navigate(target);
    } else if (preventAuth && isAuthenticated) {
      // Already signed in (e.g. just logged in from /login) — go to the user's own portal
      const target = user ? (ROLE_HOME[user.role] ?? '/') : (redirectTo || '/applicant/dashboard');
      navigate(target);
    } else if (isAuthenticated && !isRoleAuthorized) {
      // Authenticated but wrong role — redirect to their own portal root
      navigate(user ? (ROLE_HOME[user.role] ?? '/') : '/');
    }
  }, [isAuthenticated, isLoading, isRoleAuthorized, requireAuth, preventAuth, redirectTo, currentPath, navigate, user]);

  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center p-8 text-center">
        <div className="space-y-3">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Verifying Single Window authorization...</p>
        </div>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) {
    return null;
  }

  if (preventAuth && isAuthenticated) {
    return null;
  }

  if (isAuthenticated && !isRoleAuthorized) {
    return null;
  }

  return <>{children}</>;
};
