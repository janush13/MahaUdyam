import React, { useState, useEffect } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { applicantService } from '../../services/applicantService';
import { ApplicantProfile } from '../../types/applicant';

export const ApplicantProfilePage: React.FC = () => {
  const initial = applicantService.getProfile();
  const [profile, setProfile] = useState<ApplicantProfile>(initial);
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Password Change Modal / Flow
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', newPass: '', confirm: '' });
  const [pwdMessage, setPwdMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const isDirty = JSON.stringify(profile) !== JSON.stringify(applicantService.getProfile());
    setHasChanges(isDirty);
  }, [profile]);

  const handleFieldChange = (field: keyof ApplicantProfile, value: any) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
    setSavedSuccess(false);
  };

  const handleAddressChange = (field: keyof ApplicantProfile['address'], value: string) => {
    setProfile((prev) => ({
      ...prev,
      address: { ...prev.address, [field]: value },
    }));
    setSavedSuccess(false);
  };

  const handleNotificationChange = (field: keyof ApplicantProfile['notifications'], value: any) => {
    setProfile((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, [field]: value },
    }));
    setSavedSuccess(false);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    applicantService.updateProfile(profile);
    setHasChanges(false);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 4000);
  };

  const handleReset = () => {
    setProfile(applicantService.getProfile());
    setHasChanges(false);
    setSavedSuccess(false);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdForm.current || !pwdForm.newPass || !pwdForm.confirm) {
      setPwdMessage({ type: 'error', text: 'All password fields are required.' });
      return;
    }
    if (pwdForm.newPass.length < 8) {
      setPwdMessage({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (pwdForm.newPass !== pwdForm.confirm) {
      setPwdMessage({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }

    setPwdMessage({ type: 'success', text: 'Password changed successfully for Single Business ID session.' });
    setPwdForm({ current: '', newPass: '', confirm: '' });
    setTimeout(() => {
      setPwdModalOpen(false);
      setPwdMessage(null);
    }, 2000);
  };

  return (
    <ApplicantLayout
      activeTab="profile"
      breadcrumbs={[{ label: 'Profile & Account Settings' }]}
    >
      <form onSubmit={handleSave} className="space-y-6">
        {/* Page Title & Status Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold font-serif text-slate-900">
              Applicant Profile &amp; Account Settings
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Verify your statutory identity, legal address, contact channels, and digital security credentials.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              <span>✓</span> Single Business ID Active
            </span>
          </div>
        </div>

        {/* Success Alert Banner */}
        {savedSuccess && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-4 rounded-xl flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="text-base">✓</span>
              <span>Profile information and statutory preferences saved successfully.</span>
            </div>
            <button
              type="button"
              onClick={() => setSavedSuccess(false)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Floating Unsaved Changes Warning Banner */}
        {hasChanges && (
          <div className="sticky top-16 z-20 bg-amber-50 border-2 border-amber-400 p-3.5 rounded-xl shadow-md flex items-center justify-between flex-wrap gap-2 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 text-amber-900 text-xs font-bold">
              <span>⚠️</span>
              <span>You have unsaved changes to your applicant profile.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-lg transition"
              >
                Discard
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold text-white bg-blue-900 hover:bg-blue-800 rounded-lg shadow transition cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          </div>
        )}

        {/* Section 1: Personal & Statutory Dossier */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-5">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
              <span>👤</span> 1. Personal &amp; Statutory Dossier
            </h2>
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              UIDAI Aadhaar Verified
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* Full Name */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Full Name (as per PAN &amp; Aadhaar)
              </label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900 text-slate-900 font-medium"
                required
              />
            </div>

            {/* Designation */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Designation / Capacity
              </label>
              <input
                type="text"
                value={profile.designation}
                onChange={(e) => handleFieldChange('designation', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900 text-slate-900 font-medium"
                required
              />
            </div>

            {/* Single Business ID (Read-only statutory anchor) */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Single Business ID (Immutable)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={profile.singleBusinessId}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-100 text-blue-950 font-mono font-bold cursor-not-allowed select-all"
                />
                <span className="absolute right-2.5 top-2 text-[10px] font-bold text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                  Locked
                </span>
              </div>
            </div>

            {/* Email Address */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Official Email Address
              </label>
              <input
                type="email"
                value={profile.email}
                onChange={(e) => handleFieldChange('email', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900 text-slate-900 font-medium"
                required
              />
            </div>

            {/* Mobile Number */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Registered Mobile Number (OTP Bound)
              </label>
              <input
                type="tel"
                value={profile.mobile}
                onChange={(e) => handleFieldChange('mobile', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900 text-slate-900 font-medium"
                required
              />
            </div>

            {/* PAN Number */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Permanent Account Number (PAN)
              </label>
              <input
                type="text"
                value={profile.panNumber}
                readOnly
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-100 text-slate-700 font-mono font-bold cursor-not-allowed"
              />
            </div>

            {/* Masked Aadhaar */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Aadhaar Number (UIDAI Masked)
              </label>
              <input
                type="text"
                value={profile.aadhaarNumberMasked}
                readOnly
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-100 text-slate-700 font-mono font-bold cursor-not-allowed"
              />
            </div>

            {/* Address Line 1 */}
            <div className="md:col-span-2">
              <label className="block text-slate-600 font-semibold mb-1">
                Registered Correspondence / Legal Address
              </label>
              <input
                type="text"
                value={profile.address.line1}
                onChange={(e) => handleAddressChange('line1', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900 text-slate-900 font-medium"
                required
              />
            </div>

            {/* City */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">City / Taluka</label>
              <input
                type="text"
                value={profile.address.city}
                onChange={(e) => handleAddressChange('city', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900 text-slate-900 font-medium"
                required
              />
            </div>

            {/* District */}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">District</label>
              <input
                type="text"
                value={profile.address.district}
                onChange={(e) => handleAddressChange('district', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900 text-slate-900 font-medium"
                required
              />
            </div>

            {/* State & Pincode */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-slate-600 font-semibold mb-1">State</label>
                <input
                  type="text"
                  value={profile.address.state}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-100 text-slate-700 font-medium cursor-not-allowed"
                />
              </div>
              <div className="w-28">
                <label className="block text-slate-600 font-semibold mb-1">PIN Code</label>
                <input
                  type="text"
                  value={profile.address.pincode}
                  onChange={(e) => handleAddressChange('pincode', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-900 text-slate-900 font-medium"
                  required
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Statutory Notification & Alert Preferences */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
              <span>🔔</span> 2. Statutory Notification &amp; Alert Preferences
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure mandated communication channels for queries, inspection notices, and approval orders.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* SMS Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-slate-50/60">
              <div>
                <span className="font-bold text-slate-900 block">SMS Statutory Alerts</span>
                <span className="text-[11px] text-slate-500">
                  Instant SMS notifications for OTPs, queries &amp; order releases.
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.notifications.smsAlerts}
                  onChange={(e) => handleNotificationChange('smsAlerts', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-900" />
              </label>
            </div>

            {/* Email Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-slate-50/60">
              <div>
                <span className="font-bold text-slate-900 block">Email Clearances &amp; PDF Certificates</span>
                <span className="text-[11px] text-slate-500">
                  Receive digitally signed approvals &amp; observation letters.
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.notifications.emailAlerts}
                  onChange={(e) => handleNotificationChange('emailAlerts', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-900" />
              </label>
            </div>

            {/* WhatsApp Updates Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-slate-50/60">
              <div>
                <span className="font-bold text-slate-900 block">WhatsApp Governance Channel</span>
                <span className="text-[11px] text-slate-500">
                  Daily summary and milestone updates on verified mobile number.
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.notifications.whatsappUpdates}
                  onChange={(e) => handleNotificationChange('whatsappUpdates', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
              </label>
            </div>

            {/* SLA Warning Days Dropdown */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900 block">SLA Expiry Warning Threshold</span>
                <span className="text-[11px] text-slate-500">
                  Notify before statutory RTS SLA deadline elapses.
                </span>
              </div>
              <select
                value={profile.notifications.slaWarningDays}
                onChange={(e) => handleNotificationChange('slaWarningDays', parseInt(e.target.value, 10))}
                className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white text-xs font-bold text-slate-800"
              >
                <option value={2}>2 Days Prior</option>
                <option value={3}>3 Days Prior</option>
                <option value={5}>5 Days Prior</option>
                <option value={7}>7 Days Prior</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 3: Security, 2FA & Session Credentials */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                <span>🛡️</span> 3. Security, 2FA &amp; Session Credentials
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Protect your corporate digital filings and manage credential security.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPwdModalOpen(true)}
              className="px-3 py-1.5 text-xs font-bold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition"
            >
              Change Password
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* 2FA Toggle */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-900">Two-Factor Auth (OTP)</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  Enforced
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-3">
                Mandatory SMS/Email OTP verification on every login to protect enterprise filings.
              </p>
              <span className="text-[10.5px] font-semibold text-slate-600">
                Method: SMS OTP to 98230***45
              </span>
            </div>

            {/* Active Session Info */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-900">Current Session</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <p className="text-[11px] text-slate-600">
                Location: <strong>Pune, Maharashtra</strong>
              </p>
              <p className="text-[10.5px] text-slate-500 mt-1">
                Last Authenticated: {profile.security.lastLogin}
              </p>
              <p className="text-[10px] text-emerald-700 font-mono mt-2">
                SSL 256-Bit Encrypted
              </p>
            </div>

            {/* Digital Signature Certificate (DSC) Readiness */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-900">Class 3 DSC Signer</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                  Registered
                </span>
              </div>
              <p className="text-[11px] text-slate-600">
                Signer: <strong>PRIYA DESHMUKH</strong>
              </p>
              <p className="text-[10.5px] text-slate-500 mt-1">
                Certificate Provider: eMudhra CA
              </p>
              <p className="text-[10px] text-slate-400 mt-2">
                Valid till: 14 Nov 2027
              </p>
            </div>
          </div>
        </div>

        {/* Save Bar at Bottom */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasChanges}
            className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Reset Form
          </button>
          <button
            type="submit"
            disabled={!hasChanges}
            className="px-6 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold shadow disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            Save Account Settings
          </button>
        </div>
      </form>

      {/* Change Password Modal */}
      {pwdModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 font-serif">
                Change Account Password
              </h3>
              <button
                type="button"
                onClick={() => {
                  setPwdModalOpen(false);
                  setPwdMessage(null);
                }}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                ✕
              </button>
            </div>

            {pwdMessage && (
              <div
                className={`p-3 rounded-lg text-xs font-semibold ${
                  pwdMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                    : 'bg-rose-50 text-rose-800 border border-rose-300'
                }`}
              >
                {pwdMessage.text}
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={pwdForm.current}
                  onChange={(e) => setPwdForm({ ...pwdForm, current: e.target.value })}
                  placeholder="Enter current password"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  New Password (min. 8 characters)
                </label>
                <input
                  type="password"
                  value={pwdForm.newPass}
                  onChange={(e) => setPwdForm({ ...pwdForm, newPass: e.target.value })}
                  placeholder="Enter new strong password"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={pwdForm.confirm}
                  onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })}
                  placeholder="Confirm new password"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setPwdModalOpen(false);
                    setPwdMessage(null);
                  }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-900 text-white rounded-lg font-bold hover:bg-blue-800"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ApplicantLayout>
  );
};
