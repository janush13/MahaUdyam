import React, { useState } from 'react';
import { Link, useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import {
  DEFAULT_PROTOTYPE_PASSWORD,
  DEFAULT_PROTOTYPE_USER,
  DEFAULT_PROTOTYPE_OFFICER,
  DEFAULT_PROTOTYPE_OFFICER_PASSWORD,
  DEFAULT_PROTOTYPE_INSPECTOR,
  DEFAULT_PROTOTYPE_INSPECTOR_PASSWORD,
  PROTOTYPE_OTP,
} from '../../services/authService';

export const LoginPage: React.FC = () => {
  const { login, resetPassword, isAuthenticated, user } = useAuth();
  const { navigate } = useRouter();

  // Mode: 'login' | 'forgot_password'
  const [authMode, setAuthMode] = useState<'login' | 'forgot_password'>('login');

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);

  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Forgot password state
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetNewPass, setResetNewPass] = useState('');
  const [resetConfirmPass, setResetConfirmPass] = useState('');
  const [resetStep, setResetStep] = useState<1 | 2>(1); // 1 = identifier & request, 2 = OTP & new password
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetOtpDispatched, setResetOtpDispatched] = useState(false);

  const validateLoginForm = () => {
    const errs: Record<string, string> = {};
    if (!identifier.trim()) {
      errs.identifier = 'Enter your registered mobile number or email address';
    }
    if (!password) {
      errs.password = 'Password is required';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!validateLoginForm()) return;

    setIsSubmitting(true);
    const result = await login(identifier, password, rememberMe);
    setIsSubmitting(false);

    if (result.success) {
      setLoginSuccess(true);
      setTimeout(() => {
        const params = new URLSearchParams(window.location.search);
        const redirectParam = params.get('redirect');

        if (redirectParam) {
          navigate(redirectParam);
          return;
        }

        // Role-based portal redirect — use the role from the login result, not stale render state
        const role = result.user?.role;
        if (role === 'OFFICER') { navigate('/officer/dashboard'); return; }
        if (role === 'INSPECTOR') { navigate('/inspector/dashboard'); return; }
        if (role === 'ADMINISTRATOR') { navigate('/admin'); return; }
        if (role === 'LEADERSHIP') { navigate('/leadership'); return; }
        navigate('/applicant/dashboard');
      }, 600);
    } else {
      setLoginError(result.error || 'Authentication failed. Please check credentials.');
    }
  };

  const handleFillPrototype = (role: 'applicant' | 'officer' | 'inspector' = 'applicant') => {
    if (role === 'officer') {
      setIdentifier(DEFAULT_PROTOTYPE_OFFICER.email);
      setPassword(DEFAULT_PROTOTYPE_OFFICER_PASSWORD);
    } else if (role === 'inspector') {
      setIdentifier(DEFAULT_PROTOTYPE_INSPECTOR.email);
      setPassword(DEFAULT_PROTOTYPE_INSPECTOR_PASSWORD);
    } else {
      setIdentifier(DEFAULT_PROTOTYPE_USER.email);
      setPassword(DEFAULT_PROTOTYPE_PASSWORD);
    }
    setFieldErrors({});
    setLoginError(null);
  };

  const handleStartReset = (e: React.MouseEvent) => {
    e.preventDefault();
    setAuthMode('forgot_password');
    setResetStep(1);
    setResetIdentifier(identifier || '');
    setResetError(null);
    setResetSuccess(false);
  };

  const handleSendResetOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetIdentifier.trim()) {
      setResetError('Please enter your registered mobile number or email address');
      return;
    }
    setResetError(null);
    setResetOtpDispatched(true);
    setResetStep(2);
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetOtp.trim()) {
      setResetError('Enter the 6-digit verification OTP');
      return;
    }
    if (resetNewPass.length < 8) {
      setResetError('New password must be at least 8 characters in length');
      return;
    }
    if (resetNewPass !== resetConfirmPass) {
      setResetError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    const result = await resetPassword(resetIdentifier, resetOtp, resetNewPass);
    setIsSubmitting(false);

    if (result.success) {
      setResetSuccess(true);
      setTimeout(() => {
        setAuthMode('login');
        setPassword(resetNewPass);
        setIdentifier(resetIdentifier);
        setResetSuccess(false);
        setResetStep(1);
      }, 1500);
    } else {
      setResetError(result.error || 'Password reset failed');
    }
  };

  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col justify-center py-8 sm:py-12 px-4 sm:px-6 lg:px-8 bg-slate-100/60" data-purpose="screen-11-login">
      {/* Top Breadcrumb & Return link */}
      <div className="max-w-md w-full mx-auto mb-4 flex items-center justify-between text-xs text-slate-500">
        <Link to="/" className="inline-flex items-center text-blue-800 hover:text-blue-950 font-semibold gap-1 transition">
          <span>←</span> Return to Public Portal
        </Link>
        <span className="text-slate-400 font-mono text-[11px]">Screen 11 / Auth Gateway</span>
      </div>

      {/* Main Authentication Card */}
      <div className="max-w-md w-full mx-auto bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
        {/* Card Header with State Emblem Accent */}
        <div className="bg-[#0f2b48] text-white px-6 py-5 text-center relative">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white/10 border border-white/20 mb-2 shadow-inner">
            <span className="text-lg">🏛️</span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-white font-serif">
            {authMode === 'login' ? 'Login to MahaUdyam One' : 'Reset Password'}
          </h1>
          <p className="text-[11px] text-slate-300 mt-1 max-w-xs mx-auto">
            {authMode === 'login'
              ? 'Single Window Portal for Industrial Clearances & Subsidies'
              : 'Recover access using registered mobile or email OTP'}
          </p>
        </div>

        {/* Prototype Quick-Fill Callout */}
        <div className="bg-amber-50/80 border-b border-amber-200 px-4 py-2.5 text-[11px] text-amber-900">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-amber-700">Prototype Credentials</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => handleFillPrototype('applicant')}
              className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-200/70 hover:bg-amber-300 px-2 py-0.5 rounded transition cursor-pointer border border-amber-300"
            >
              Applicant
            </button>
            <button
              type="button"
              onClick={() => handleFillPrototype('officer')}
              className="text-[10px] font-bold uppercase tracking-wider text-blue-800 bg-blue-100 hover:bg-blue-200 px-2 py-0.5 rounded transition cursor-pointer border border-blue-300"
            >
              Officer
            </button>
            <button
              type="button"
              onClick={() => handleFillPrototype('inspector')}
              className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded transition cursor-pointer border border-emerald-300"
            >
              Inspector
            </button>
          </div>
        </div>

        <div className="p-6 sm:p-7">
          {authMode === 'login' ? (
            /* Login Form */
            <form onSubmit={handleLogin} className="space-y-4 text-xs" noValidate>
              {loginSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-800 flex items-center gap-2">
                  <span className="text-emerald-600 font-bold text-sm">✓</span>
                  <div>
                    <span className="font-bold block">Authentication Successful!</span>
                    <span className="text-[11px] text-emerald-700">Redirecting to your portal...</span>
                  </div>
                </div>
              )}

              {loginError && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-800 flex items-start gap-2">
                  <span className="text-rose-600 font-bold text-sm mt-0.5">⚠️</span>
                  <div className="text-[11px] leading-snug">
                    <span className="font-bold block text-rose-900">Login Failed</span>
                    {loginError}
                  </div>
                </div>
              )}

              {/* Identifier field */}
              <div>
                <label className="block font-semibold text-slate-800 mb-1" htmlFor="login-identifier">
                  Mobile Number or Email Address <span className="text-rose-600">*</span>
                </label>
                <input
                  id="login-identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (fieldErrors.identifier) setFieldErrors({ ...fieldErrors, identifier: '' });
                  }}
                  placeholder="e.g. 9823012345 or applicant@mahaudyam.in"
                  className={`w-full bg-slate-50 border rounded-lg px-3 py-2.5 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${fieldErrors.identifier
                    ? 'border-rose-400 focus:ring-rose-500'
                    : 'border-slate-300 focus:ring-[#0f2b48]'
                    }`}
                />
                {fieldErrors.identifier && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.identifier}</p>
                )}
              </div>

              {/* Password field */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-800" htmlFor="login-password">
                    Password <span className="text-rose-600">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleStartReset}
                    className="text-[11px] text-blue-700 hover:text-blue-900 font-medium hover:underline"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: '' });
                    }}
                    placeholder="Enter your account password"
                    className={`w-full bg-slate-50 border rounded-lg px-3 py-2.5 pr-10 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${fieldErrors.password
                      ? 'border-rose-400 focus:ring-rose-500'
                      : 'border-slate-300 focus:ring-[#0f2b48]'
                      }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-1 text-xs"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.password}</p>
                )}
              </div>

              {/* Remember Me */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center space-x-2 text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-slate-300 text-[#0f2b48] focus:ring-[#0f2b48] w-4 h-4"
                  />
                  <span className="text-xs">Remember this device for 30 days</span>
                </label>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || loginSuccess}
                  className="w-full py-2.5 px-4 bg-[#0f2b48] hover:bg-[#16385d] text-white text-xs font-bold rounded-lg shadow-sm hover:shadow transition focus:outline-none focus:ring-2 focus:ring-[#0f2b48] focus:ring-offset-2 disabled:opacity-60 flex items-center justify-center space-x-2 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Authenticating...</span>
                    </>
                  ) : (
                    <>
                      <span>Login to Portal</span>
                      <span>→</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* Forgot Password Form */
            <div className="space-y-4 text-xs">
              {resetSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-800 text-center">
                  <span className="font-bold block text-sm">Password Reset Successfully!</span>
                  <span className="text-[11px]">Returning you to login screen with updated credentials...</span>
                </div>
              )}

              {resetError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-700 text-[11px]">
                  {resetError}
                </div>
              )}

              {resetStep === 1 ? (
                <form onSubmit={handleSendResetOtp} className="space-y-3.5">
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    Enter your registered mobile or email to receive a password reset verification code.
                  </p>
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">
                      Mobile Number or Email
                    </label>
                    <input
                      type="text"
                      value={resetIdentifier}
                      onChange={(e) => setResetIdentifier(e.target.value)}
                      placeholder="9823012345 or applicant@mahaudyam.in"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0f2b48]"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className="text-slate-600 hover:text-slate-800 font-medium"
                    >
                      ← Back to Login
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-[#0f2b48] text-white font-bold rounded-lg hover:bg-slate-800 transition"
                    >
                      Send Reset OTP
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleCompleteReset} className="space-y-3">
                  <div className="p-2.5 bg-blue-50 border border-blue-200 rounded text-blue-900 text-[11px]">
                    OTP dispatched for <span className="font-semibold">{resetIdentifier}</span>.<br />
                    <span className="font-bold text-blue-700">Prototype Reset OTP: {PROTOTYPE_OTP}</span>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">
                      Enter 6-Digit OTP <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      value={resetOtp}
                      onChange={(e) => setResetOtp(e.target.value)}
                      placeholder="123456"
                      className="w-full font-mono text-center tracking-widest text-base font-bold bg-slate-50 border border-slate-300 rounded-lg py-2 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0f2b48]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">
                      New Password <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="password"
                      value={resetNewPass}
                      onChange={(e) => setResetNewPass(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0f2b48]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">
                      Confirm New Password <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="password"
                      value={resetConfirmPass}
                      onChange={(e) => setResetConfirmPass(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0f2b48]"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setResetStep(1)}
                      className="text-slate-600 hover:text-slate-800 font-medium"
                    >
                      ← Re-enter ID
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-4 py-2 bg-[#f58220] hover:bg-[#e07110] text-white font-bold rounded-lg shadow-xs transition"
                    >
                      {isSubmitting ? 'Updating...' : 'Update Password'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Registration Navigation Link */}
          <div className="mt-6 pt-5 border-t border-slate-200 text-center">
            <p className="text-xs text-slate-600">
              New Enterprise or Investor in Maharashtra?{' '}
              <Link
                to="/register"
                className="font-bold text-blue-800 hover:text-blue-950 underline decoration-blue-300 hover:decoration-blue-700 ml-1 transition"
              >
                Register Here
              </Link>
            </p>
          </div>
        </div>

        {/* Official Civic Security Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 text-[10.5px] text-slate-500 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <span className="text-emerald-600">🔒</span> 256-Bit SSL Encrypted
          </span>
          <span className="font-mono text-[10px]">MAHA-SSO v2.6</span>
        </div>
      </div>
    </div>
  );
};
