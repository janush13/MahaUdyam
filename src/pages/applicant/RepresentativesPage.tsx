import React, { useState } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { applicantService } from '../../services/applicantService';
import { Representative } from '../../types/applicant';

export const RepresentativesPage: React.FC = () => {
  const [representatives, setRepresentatives] = useState<Representative[]>(
    applicantService.getRepresentatives()
  );
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Active' | 'Suspended' | 'Revoked'>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Form state for adding representative
  const [formData, setFormData] = useState({
    name: '',
    role: 'Legal Counsel & Statutory Compliance Advisor',
    organization: '',
    email: '',
    mobile: '',
    delegationScope: '',
    authorizationRef: '',
    validUntil: '31 December 2026',
    selectedPowers: [
      'Draft & Sign Statutory Clearance Applications',
      'Submit Regulatory Filings to Departmental Portals',
    ],
  });
  const [formError, setFormError] = useState<string | null>(null);

  const availablePowers = [
    'Draft & Sign Statutory Clearance Applications',
    'Submit Regulatory Filings to Departmental Portals',
    'Upload Statutory Technical Audits & Environmental Statements',
    'Respond to Departmental Observation Memos & Queries',
    'Appear Before Appellate Authority & Single Window Council',
    'Certify Capital Investments & Subsidy Sanction Claims',
  ];

  const filteredReps = representatives.filter((r) => {
    if (statusFilter === 'ALL') return true;
    return r.status === statusFilter;
  });

  const handleToggleStatus = (id: string) => {
    const updated = applicantService.toggleRepresentativeStatus(id);
    if (updated) {
      setRepresentatives(applicantService.getRepresentatives());
      setSuccessToast(`Delegation status for ${updated.name} updated to ${updated.status}.`);
      setTimeout(() => setSuccessToast(null), 4000);
    }
  };

  const handleRevoke = (id: string) => {
    const target = representatives.find((r) => r.id === id);
    applicantService.revokeRepresentative(id);
    setRepresentatives(applicantService.getRepresentatives());
    setRevokeConfirmId(null);
    setSuccessToast(`Authority for ${target?.name || 'representative'} has been legally revoked.`);
    setTimeout(() => setSuccessToast(null), 4000);
  };

  const handlePowerToggle = (power: string) => {
    setFormData((prev) => {
      const exists = prev.selectedPowers.includes(power);
      return {
        ...prev,
        selectedPowers: exists
          ? prev.selectedPowers.filter((p) => p !== power)
          : [...prev.selectedPowers, power],
      };
    });
  };

  const handleAddRepresentative = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFormError('Full name of representative is required.');
      return;
    }
    if (!formData.email.trim() || !formData.mobile.trim()) {
      setFormError('Email and mobile number are mandatory for OTP verification.');
      return;
    }
    if (!formData.authorizationRef.trim()) {
      setFormError('Board Resolution or Power of Attorney document reference is required.');
      return;
    }
    if (formData.selectedPowers.length === 0) {
      setFormError('Select at least one delegated power.');
      return;
    }

    const created = applicantService.addRepresentative({
      name: formData.name.trim(),
      role: formData.role,
      organization: formData.organization.trim() || undefined,
      email: formData.email.trim(),
      mobile: formData.mobile.trim(),
      delegationScope: formData.delegationScope.trim() || 'Statutory representations and filings.',
      delegatedPowers: formData.selectedPowers,
      authorizationRef: formData.authorizationRef.trim(),
      validUntil: formData.validUntil,
      status: 'Active',
      assignedEnterpriseIds: ['ent-dipl-01'],
    });

    setRepresentatives(applicantService.getRepresentatives());
    setSuccessToast(`Authorized ${created.name} as ${created.role} successfully.`);
    setModalOpen(false);
    setFormError(null);
    setFormData({
      name: '',
      role: 'Legal Counsel & Statutory Compliance Advisor',
      organization: '',
      email: '',
      mobile: '',
      delegationScope: '',
      authorizationRef: '',
      validUntil: '31 December 2026',
      selectedPowers: [
        'Draft & Sign Statutory Clearance Applications',
        'Submit Regulatory Filings to Departmental Portals',
      ],
    });
    setTimeout(() => setSuccessToast(null), 4000);
  };

  return (
    <ApplicantLayout
      activeTab="representatives"
      breadcrumbs={[{ label: 'Representatives & Consultants' }]}
    >
      <div className="space-y-6">
        {/* Header Ribbon */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold font-serif text-slate-900">
              Representatives, Consultants &amp; Delegated Authority
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Authorize legal counsels, environmental auditors, and chartered accountants to act on behalf of your enterprise under verified Board Resolutions.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold shadow transition flex items-center gap-1.5 self-start sm:self-center cursor-pointer"
          >
            <span>+ Delegate Authority / Add Representative</span>
          </button>
        </div>

        {/* Success Alert */}
        {successToast && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-4 rounded-xl flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="text-base">✓</span>
              <span>{successToast}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessToast(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Statutory Legal Notice Card */}
        <div className="bg-blue-50/60 border border-blue-200 p-4 rounded-xl flex items-start gap-3 text-xs text-blue-900">
          <span className="text-lg">⚖️</span>
          <div>
            <span className="font-bold block">Statutory Legal Binding Notice:</span>
            <p className="text-blue-800/90 mt-0.5 leading-relaxed">
              In accordance with the Maharashtra Right to Public Services Act and Digital Single Window governance protocols, delegated representatives act as authorized agents. All statutory declarations uploaded by delegates carry the legal authority of the parent enterprise.
            </p>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 flex-wrap gap-2">
          <div className="flex space-x-1">
            {(['ALL', 'Active', 'Suspended', 'Revoked'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  statusFilter === tab
                    ? 'bg-blue-900 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab === 'ALL' ? `All (${representatives.length})` : `${tab} (${representatives.filter((r) => r.status === tab).length})`}
              </button>
            ))}
          </div>

          <span className="text-xs text-slate-500">
            Showing {filteredReps.length} of {representatives.length} delegates
          </span>
        </div>

        {/* Representatives List */}
        <div className="grid grid-cols-1 gap-4">
          {filteredReps.map((rep) => (
            <div
              key={rep.id}
              className={`bg-white rounded-2xl border p-5 sm:p-6 shadow-2xs space-y-4 transition ${
                rep.status === 'Revoked'
                  ? 'border-slate-300 opacity-60 bg-slate-50/70'
                  : rep.status === 'Suspended'
                  ? 'border-amber-200 bg-amber-50/20'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* Header Row */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900 font-serif">
                      {rep.name}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        rep.status === 'Active'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : rep.status === 'Suspended'
                          ? 'bg-amber-100 text-amber-800 border-amber-300'
                          : 'bg-rose-100 text-rose-800 border-rose-300'
                      }`}
                    >
                      {rep.status}
                    </span>
                    <span className="text-xs text-slate-400">•</span>
                    <span className="text-xs font-semibold text-blue-900 bg-blue-50 px-2 py-0.5 rounded">
                      {rep.role}
                    </span>
                  </div>
                  {rep.organization && (
                    <p className="text-xs text-slate-500 font-medium">
                      🏛️ {rep.organization}
                    </p>
                  )}
                </div>

                {/* Actions: Toggle and Revoke */}
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {rep.status !== 'Revoked' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(rep.id)}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg border transition ${
                          rep.status === 'Active'
                            ? 'text-amber-800 bg-amber-50 border-amber-300 hover:bg-amber-100'
                            : 'text-emerald-800 bg-emerald-50 border-emerald-300 hover:bg-emerald-100'
                        }`}
                      >
                        {rep.status === 'Active' ? 'Suspend Access' : 'Activate Access'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRevokeConfirmId(rep.id)}
                        className="px-3 py-1 text-xs font-semibold text-rose-700 hover:text-rose-900 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition"
                      >
                        Revoke Power
                      </button>
                    </>
                  )}
                  {rep.status === 'Revoked' && (
                    <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                      Authority Terminated
                    </span>
                  )}
                </div>
              </div>

              {/* Contact & Authorization Reference Dossier */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-400 block text-[10.5px]">Official Email &amp; Mobile:</span>
                  <span className="font-semibold text-slate-800 block truncate">{rep.email}</span>
                  <span className="text-slate-600 font-mono">{rep.mobile}</span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10.5px]">Authorization Instrument:</span>
                  <span className="font-mono font-bold text-slate-900 block truncate">
                    {rep.authorizationRef}
                  </span>
                  <span className="text-slate-500 text-[11px]">Valid Until: {rep.validUntil}</span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10.5px]">Delegation Scope:</span>
                  <span className="font-medium text-slate-700 block truncate">
                    {rep.delegationScope}
                  </span>
                </div>
              </div>

              {/* Delegated Specific Powers */}
              <div>
                <span className="text-xs font-bold text-slate-700 block mb-2">
                  Enforceable Delegated Powers:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {rep.delegatedPowers.map((power, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-900 border border-blue-200 flex items-center gap-1"
                    >
                      <span className="text-blue-600">✓</span>
                      <span>{power}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Modal: Delegate Authority / Add Representative */}
        {modalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto"
            role="dialog"
            aria-modal="true"
          >
            <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-8 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 font-serif">
                    Delegate Authority: Add Representative or Consultant
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Empower a legal counsel, chartered accountant, or technical consultant.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-slate-400 hover:text-slate-700 p-1"
                >
                  ✕
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 text-rose-800 border border-rose-300 text-xs font-semibold">
                  ⚠️ {formError}
                </div>
              )}

              <form onSubmit={handleAddRepresentative} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Full Legal Name of Representative *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Adv. Rajeshwar Kulkarni / CA Nitin Mahajan"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Professional Role / Capacity *
                    </label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Legal Counsel & Statutory Compliance Advisor">Legal Counsel &amp; Compliance Advisor</option>
                      <option value="Environmental Auditor & Green Consultant">Environmental Auditor &amp; Green Consultant</option>
                      <option value="Chartered Accountant & Fiscal Incentives Advisor">Chartered Accountant &amp; Financial Advisor</option>
                      <option value="Architect & Industrial Safety Consultant">Architect &amp; DISH Safety Consultant</option>
                      <option value="Labour Law & Welfare Consultant">Labour Law &amp; Welfare Consultant</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Organization / Firm Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Kulkarni & Associates"
                      value={formData.organization}
                      onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Official Email *
                    </label>
                    <input
                      type="email"
                      placeholder="advocate@firm.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Mobile Number (OTP Bound) *
                    </label>
                    <input
                      type="tel"
                      placeholder="9822187654"
                      value={formData.mobile}
                      onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Authorization Instrument Ref *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Board Resolution BR/2026/04 or POA Reg. No."
                      value={formData.authorizationRef}
                      onChange={(e) => setFormData({ ...formData, authorizationRef: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Delegation Expiry Date
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 31 December 2027"
                      value={formData.validUntil}
                      onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Delegation Scope &amp; Target Departments
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. MPCB Environmental Clearances, DISH Safety & Factory Registrations"
                    value={formData.delegationScope}
                    onChange={(e) => setFormData({ ...formData, delegationScope: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                {/* Delegated Powers Selection */}
                <div>
                  <label className="block text-slate-700 font-bold mb-2">
                    Select Delegated Powers *
                  </label>
                  <div className="space-y-2 border border-slate-200 p-3 rounded-xl bg-slate-50/60 max-h-40 overflow-y-auto">
                    {availablePowers.map((power, idx) => {
                      const isChecked = formData.selectedPowers.includes(power);
                      return (
                        <label key={idx} className="flex items-center gap-2 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handlePowerToggle(power)}
                            className="rounded border-slate-300 text-blue-900 focus:ring-blue-900"
                          />
                          <span className="text-slate-800">{power}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Modal Actions */}
                <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-800 shadow cursor-pointer"
                  >
                    Grant Delegated Authority
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Confirmation Modal for Revoking Authority */}
        {revokeConfirmId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
          >
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center gap-3 text-rose-700">
                <span className="text-2xl">⚠️</span>
                <h3 className="text-base font-bold text-slate-900 font-serif">
                  Confirm Revocation of Authority
                </h3>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Are you sure you want to legally revoke statutory representation powers for{' '}
                <strong>
                  {representatives.find((r) => r.id === revokeConfirmId)?.name}
                </strong>
                ? Once revoked, this consultant will immediately lose filing and hearing rights on the Single Window Portal.
              </p>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRevokeConfirmId(null)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleRevoke(revokeConfirmId)}
                  className="px-4 py-2 bg-rose-700 text-white rounded-xl font-bold hover:bg-rose-800 text-xs shadow"
                >
                  Confirm Revocation
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ApplicantLayout>
  );
};
