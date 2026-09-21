import React, { useState, useEffect } from 'react';
import { Link, useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { PROTOTYPE_OTP } from '../../services/authService';

export const OtpVerifyPage: React.FC = () => {
  const { pendingRegistration, verifyRegistrationOtp, sendOtp } = useAuth();
  const { navigate } = useRouter();

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [cooldown, setCooldown] = useState<number>(30);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  // If user navigated directly without filling registration, fall back to sample or redirect
  const mobile = pendingRegistration?.mobile || '9822098765';
  const maskedMobile = mobile.length >= 10
    ? `+91 ${mobile.slice(0, 2)}••••••${mobile.slice(8)}`
    : `+91 ${mobile}`;

  useEffect(() => {
    let timer: any = null;
    if (cooldown > 0) {
      timer = setInterval(() => {
        setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [cooldown]);

  const handleOtpChange = (index: number, val: string) => {
    setError(null);
    const clean = val.replace(/\D/g, '');
    if (!clean && val !== '') return;

    const newOtp = [...otp];
    newOtp[index] = clean.slice(-1);
    setOtp(newOtp);

    // Auto-advance
    if (clean && index < 5) {
      const nextInput = document.getElementById(`otp-input-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-input-${index - 1}`);
      prevInput?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      const newOtp = ['', '', '', '', '', ''];
      for (let i = 0; i < pasted.length; i++) {
        newOtp[i] = pasted[i];
      }
      setOtp(newOtp);
      const targetIndex = Math.min(pasted.length, 5);
      document.getElementById(`otp-input-${targetIndex}`)?.focus();
    }
  };

  const handleAutoFillPrototypeOtp = () => {
    const chars = PROTOTYPE_OTP.split('');
    setOtp(chars);
    setError(null);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fullOtp = otp.join('');

    if (fullOtp.length !== 6) {
      setError('Please enter the complete 6-digit verification code');
      return;
    }

    setIsVerifying(true);
    const res = await verifyRegistrationOtp(fullOtp);
    setIsVerifying(false);

    if (res.success) {
      setIsVerified(true);
      setTimeout(() => {
        navigate('/applicant/dashboard');
      }, 1200);
    } else {
      setError(res.error || 'Verification failed. Incorrect OTP.');
    }
  };

  const handleResend = () => {
    if (cooldown > 0) return;
    setError(null);
    sendOtp(mobile);
    setCooldown(30);
    setResendStatus('A fresh verification code has been generated.');
    setTimeout(() => setResendStatus(null), 4000);
  };

  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col justify-center py-8 sm:py-12 px-4 sm:px-6 lg:px-8 bg-slate-100/60" data-purpose="screen-12-otp-verify">
      {/* Top Breadcrumb */}
      <div className="max-w-md w-full mx-auto mb-4 flex items-center justify-between text-xs text-slate-500">
        <Link to="/register" className="inline-flex items-center text-blue-800 hover:text-blue-950 font-semibold gap-1 transition">
          <span>←</span> Back to Registration Form
        </Link>
        <span className="text-slate-400 font-mono text-[11px]">Screen 12 / Step 2</span>
      </div>

      {/* Main OTP Card */}
      <div className="max-w-md w-full mx-auto bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
        {/* Card Header */}
        <div className="bg-[#0f2b48] text-white px-6 py-5 text-center">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white/10 border border-white/20 mb-2 shadow-inner">
            <span className="text-lg">📲</span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-white font-serif">
            {isVerified ? 'Mobile Number Verified!' : 'Verify Your Mobile Number'}
          </h1>
          <p className="text-[11px] text-slate-300 mt-1 max-w-xs mx-auto">
            {isVerified
              ? 'Your enterprise single window account is now established.'
              : `Statutory OTP dispatched to applicant mobile: ${maskedMobile}`}
          </p>
        </div>

        {/* Prototype Helper Banner */}
        {!isVerified && (
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-2.5 flex items-center justify-between text-xs text-blue-900">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-blue-800">Prototype OTP:</span>
              <span className="font-mono text-xs font-bold text-blue-950 bg-blue-100 px-1.5 py-0.5 rounded border border-blue-200">
                {PROTOTYPE_OTP}
              </span>
            </div>
            <button
              type="button"
              onClick={handleAutoFillPrototypeOtp}
              className="text-[10px] font-bold uppercase tracking-wider text-blue-800 hover:text-blue-950 bg-blue-200/80 hover:bg-blue-300 px-2 py-0.5 rounded transition cursor-pointer border border-blue-300"
            >
              Fill Code
            </button>
          </div>
        )}

        {/* Card Body */}
        <div className="p-6 sm:p-7">
          {isVerified ? (
            /* Success State */
            <div className="text-center py-4 space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto text-2xl font-bold shadow-inner">
                ✓
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Mobile Number Verified!</h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Enterprise credentials authenticated. Generating applicant workspace and initializing single window authorizations...
                </p>
              </div>
              <div className="inline-flex items-center gap-2 text-xs text-blue-800 font-semibold bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                <span>Redirecting to Applicant Dashboard...</span>
              </div>
            </div>
          ) : (
            /* OTP Form */
            <form onSubmit={handleVerify} className="space-y-5 text-xs" noValidate>
              {error && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-800 flex items-start gap-2">
                  <span className="text-rose-600 font-bold text-sm">⚠️</span>
                  <span className="text-[11px] leading-snug">{error}</span>
                </div>
              )}

              {resendStatus && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 text-[11px] text-center">
                  {resendStatus}
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-800 mb-2 text-center">
                  Enter the 6-Digit One Time Password (OTP)
                </label>

                {/* 6 Input Boxes */}
                <div className="flex items-center justify-center gap-2 sm:gap-2.5" onPaste={handlePaste}>
                  {otp.map((digit, idx) => (
                    <input
                      key={idx}
                      id={`otp-input-${idx}`}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(idx, e)}
                      className="w-10 h-12 sm:w-11 sm:h-12 text-center text-lg font-bold font-mono bg-slate-50 border-2 border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:border-[#0f2b48] focus:ring-1 focus:ring-[#0f2b48] text-slate-900 transition shadow-2xs"
                    />
                  ))}
                </div>
              </div>

              {/* Resend OTP & Countdown */}
              <div className="flex items-center justify-between text-[11px] pt-1">
                <span className="text-slate-500">Didn't receive SMS?</span>
                {cooldown > 0 ? (
                  <span className="text-slate-500 font-medium">
                    Resend code in <strong className="font-mono text-slate-700">{cooldown}s</strong>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    className="font-bold text-blue-700 hover:text-blue-900 underline transition cursor-pointer"
                  >
                    Resend OTP
                  </button>
                )}
              </div>

              {/* Submit Verification Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isVerifying}
                  className="w-full py-2.5 px-4 bg-[#0f2b48] hover:bg-[#16385d] text-white text-xs font-bold rounded-lg shadow-sm hover:shadow transition focus:outline-none focus:ring-2 focus:ring-[#0f2b48] focus:ring-offset-2 disabled:opacity-60 flex items-center justify-center space-x-2 cursor-pointer"
                >
                  {isVerifying ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Validating Security Token...</span>
                    </>
                  ) : (
                    <>
                      <span>Verify &amp; Create Enterprise Account</span>
                      <span>✓</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Return link */}
          <div className="mt-6 pt-4 border-t border-slate-200 text-center">
            <Link to="/register" className="text-xs text-slate-600 hover:text-slate-800">
              Need to modify mobile number or applicant info? Edit details
            </Link>
          </div>
        </div>

        {/* Footer info */}
        <div className="bg-slate-50 px-6 py-2.5 border-t border-slate-200 text-[10.5px] text-slate-500 flex items-center justify-between">
          <span>SMS Gateway Gateway: National Informatics Centre</span>
          <span className="font-mono text-[10px]">OTP-SLA: 15s</span>
        </div>
      </div>
    </div>
  );
};
