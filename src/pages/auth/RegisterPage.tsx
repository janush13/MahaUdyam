import React, { useState } from 'react';
import { Link, useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { RegistrationPayload } from '../../types';

export const RegisterPage: React.FC = () => {
  const { setPendingRegistration, sendOtp } = useAuth();
  const { navigate } = useRouter();

  const [formData, setFormData] = useState({
    fullName: '',
    entityName: '',
    email: '',
    mobile: '',
    password: '',
    confirmPassword: '',
    declarationAccepted: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = () => {
    const errs: Record<string, string> = {};

    if (!formData.fullName.trim()) {
      errs.fullName = 'Full Name of applicant or authorized signatory is required';
    }

    if (!formData.entityName.trim()) {
      errs.entityName = 'Enterprise / Proposed Industrial Unit Name is required';
    }

    if (!formData.email.trim()) {
      errs.email = 'Official Email Address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errs.email = 'Please provide a valid email address';
    }

    const cleanMobile = formData.mobile.replace(/\D/g, '');
    if (!formData.mobile.trim()) {
      errs.mobile = 'Mobile Number is required for OTP dispatch';
    } else if (cleanMobile.length !== 10 || !/^[6-9]/.test(cleanMobile)) {
      errs.mobile = 'Enter a valid 10-digit Indian mobile number (e.g. 9823012345)';
    }

    if (!formData.password) {
      errs.password = 'Password is required';
    } else if (formData.password.length < 8) {
      errs.password = 'Password must be at least 8 characters long';
    }

    if (formData.password !== formData.confirmPassword) {
      errs.confirmPassword = 'Passwords do not match';
    }

    if (!formData.declarationAccepted) {
      errs.declarationAccepted = 'You must accept the statutory enterprise declaration to proceed';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    const payload: RegistrationPayload = {
      fullName: formData.fullName.trim(),
      entityName: formData.entityName.trim(),
      email: formData.email.trim(),
      mobile: formData.mobile.replace(/\D/g, ''),
      password: formData.password,
      declarationAccepted: formData.declarationAccepted,
    };

    setPendingRegistration(payload);
    sendOtp(payload.mobile);

    setTimeout(() => {
      setIsSubmitting(false);
      navigate('/register/verify');
    }, 350);
  };

  const handleFillSample = () => {
    setFormData({
      fullName: 'Vikram Shinde',
      entityName: 'Shinde Precision Forgings Pvt Ltd',
      email: 'vikram.shinde@forgings.co.in',
      mobile: '9822098765',
      password: 'Password@123',
      confirmPassword: 'Password@123',
      declarationAccepted: true,
    });
    setErrors({});
  };

  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col justify-center py-8 sm:py-10 px-4 sm:px-6 lg:px-8 bg-slate-100/60" data-purpose="screen-12-registration">
      {/* Top Breadcrumbs */}
      <div className="max-w-xl w-full mx-auto mb-4 flex items-center justify-between text-xs text-slate-500">
        <Link to="/" className="inline-flex items-center text-blue-800 hover:text-blue-950 font-semibold gap-1 transition">
          <span>←</span> Return to Public Portal
        </Link>
        <span className="text-slate-400 font-mono text-[11px]">Screen 12 / Enterprise Registration</span>
      </div>

      {/* Main Registration Card */}
      <div className="max-w-xl w-full mx-auto bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
        {/* Header with Step Indicator */}
        <div className="bg-[#0f2b48] text-white px-6 py-5 text-center relative">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white/10 border border-white/20 mb-2 shadow-inner">
            <span className="text-lg">🏭</span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-white font-serif">
            Create Your Account
          </h1>
          <p className="text-[11px] text-slate-300 mt-0.5">
            Register your enterprise for Maharashtra Single Window Clearances &amp; Incentives
          </p>

          {/* Stepper Pill */}
          <div className="flex items-center justify-center gap-2 mt-3 text-[11px]">
            <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white font-bold">
              Step 1: Enterprise Details
            </span>
            <span className="text-slate-400">→</span>
            <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-slate-300 font-medium">
              Step 2: Mobile OTP Verification
            </span>
          </div>
        </div>

        {/* Quick Test Fill Utility */}
        <div className="bg-amber-50/80 border-b border-amber-200 px-6 py-2 flex items-center justify-between text-[11px] text-amber-900">
          <span className="text-[11px] text-amber-800">
            Speed up evaluation with pre-filled test enterprise data
          </span>
          <button
            type="button"
            onClick={handleFillSample}
            className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-200/80 hover:bg-amber-300 px-2 py-0.5 rounded transition cursor-pointer border border-amber-300"
          >
            Auto-Fill Sample
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-4 text-xs" noValidate>
            {/* Applicant Name & Enterprise Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block font-semibold text-slate-800 mb-1" htmlFor="reg-fullname">
                  Applicant Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  id="reg-fullname"
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => {
                    setFormData({ ...formData, fullName: e.target.value });
                    if (errors.fullName) setErrors({ ...errors, fullName: '' });
                  }}
                  placeholder="e.g. Vikram Shinde"
                  className={`w-full bg-slate-50 border rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${
                    errors.fullName ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-[#0f2b48]'
                  }`}
                />
                {errors.fullName && <p className="text-[11px] text-rose-600 mt-1">{errors.fullName}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1" htmlFor="reg-entity">
                  Enterprise / Unit Name <span className="text-rose-600">*</span>
                </label>
                <input
                  id="reg-entity"
                  type="text"
                  value={formData.entityName}
                  onChange={(e) => {
                    setFormData({ ...formData, entityName: e.target.value });
                    if (errors.entityName) setErrors({ ...errors, entityName: '' });
                  }}
                  placeholder="e.g. Shinde Precision Forgings Pvt Ltd"
                  className={`w-full bg-slate-50 border rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${
                    errors.entityName ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-[#0f2b48]'
                  }`}
                />
                {errors.entityName && <p className="text-[11px] text-rose-600 mt-1">{errors.entityName}</p>}
              </div>
            </div>

            {/* Email & Mobile Number */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block font-semibold text-slate-800 mb-1" htmlFor="reg-email">
                  Official Email Address <span className="text-rose-600">*</span>
                </label>
                <input
                  id="reg-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => {
                    setFormData({ ...formData, email: e.target.value });
                    if (errors.email) setErrors({ ...errors, email: '' });
                  }}
                  placeholder="vikram@enterprise.in"
                  className={`w-full bg-slate-50 border rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${
                    errors.email ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-[#0f2b48]'
                  }`}
                />
                {errors.email && <p className="text-[11px] text-rose-600 mt-1">{errors.email}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1" htmlFor="reg-mobile">
                  Mobile Number (+91) <span className="text-rose-600">*</span>
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-2.5 rounded-l-lg border border-r-0 border-slate-300 bg-slate-100 text-slate-600 text-xs font-mono font-semibold">
                    +91
                  </span>
                  <input
                    id="reg-mobile"
                    type="tel"
                    maxLength={10}
                    value={formData.mobile}
                    onChange={(e) => {
                      setFormData({ ...formData, mobile: e.target.value });
                      if (errors.mobile) setErrors({ ...errors, mobile: '' });
                    }}
                    placeholder="9822098765"
                    className={`w-full bg-slate-50 border rounded-r-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${
                      errors.mobile ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-[#0f2b48]'
                    }`}
                  />
                </div>
                {errors.mobile && <p className="text-[11px] text-rose-600 mt-1">{errors.mobile}</p>}
              </div>
            </div>

            {/* Password & Confirm Password */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-800" htmlFor="reg-password">
                    Create Password <span className="text-rose-600">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[10px] text-slate-500 hover:text-slate-800"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => {
                    setFormData({ ...formData, password: e.target.value });
                    if (errors.password) setErrors({ ...errors, password: '' });
                  }}
                  placeholder="Min 8 characters"
                  className={`w-full bg-slate-50 border rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${
                    errors.password ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-[#0f2b48]'
                  }`}
                />
                {errors.password && <p className="text-[11px] text-rose-600 mt-1">{errors.password}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1" htmlFor="reg-confirm">
                  Confirm Password <span className="text-rose-600">*</span>
                </label>
                <input
                  id="reg-confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={(e) => {
                    setFormData({ ...formData, confirmPassword: e.target.value });
                    if (errors.confirmPassword) setErrors({ ...errors, confirmPassword: '' });
                  }}
                  placeholder="Re-type password"
                  className={`w-full bg-slate-50 border rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 ${
                    errors.confirmPassword ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-[#0f2b48]'
                  }`}
                />
                {errors.confirmPassword && <p className="text-[11px] text-rose-600 mt-1">{errors.confirmPassword}</p>}
              </div>
            </div>

            {/* Statutory Declaration */}
            <div className="pt-2">
              <label className="flex items-start space-x-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.declarationAccepted}
                  onChange={(e) => {
                    setFormData({ ...formData, declarationAccepted: e.target.checked });
                    if (errors.declarationAccepted) setErrors({ ...errors, declarationAccepted: '' });
                  }}
                  className="rounded border-slate-300 text-[#0f2b48] focus:ring-[#0f2b48] w-4 h-4 mt-0.5"
                />
                <span className="text-[11px] text-slate-700 leading-relaxed">
                  I solemnly affirm that the enterprise details and signatory credentials furnished above are true and accurate under the provisions of the <strong>Maharashtra Right to Public Services Act, 2015</strong> and Industrial Facilitation regulations.
                </span>
              </label>
              {errors.declarationAccepted && (
                <p className="text-[11px] text-rose-600 mt-1">{errors.declarationAccepted}</p>
              )}
            </div>

            {/* Submit Button */}
            <div className="pt-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-[#f58220] hover:bg-[#e07110] text-white text-xs font-bold rounded-lg shadow-sm hover:shadow transition focus:outline-none focus:ring-2 focus:ring-[#f58220] focus:ring-offset-2 disabled:opacity-60 flex items-center justify-center space-x-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Preparing OTP Verification...</span>
                  </>
                ) : (
                  <>
                    <span>Proceed to Mobile OTP Verification</span>
                    <span>→</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Already registered navigation */}
          <div className="mt-6 pt-5 border-t border-slate-200 text-center">
            <p className="text-xs text-slate-600">
              Already have an enterprise account?{' '}
              <Link
                to="/login"
                className="font-bold text-blue-800 hover:text-blue-950 underline decoration-blue-300 hover:decoration-blue-700 ml-1 transition"
              >
                Login to Portal
              </Link>
            </p>
          </div>
        </div>

        {/* Security strip */}
        <div className="bg-slate-50 px-6 py-2.5 border-t border-slate-200 text-[10.5px] text-slate-500 flex items-center justify-between">
          <span>Official Government of Maharashtra Single Window Registration</span>
          <span className="text-emerald-700 font-semibold">● Aadhaar/PAN e-KYC Ready</span>
        </div>
      </div>
    </div>
  );
};
