import React, { useState, useMemo } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { documentVaultService } from '../../services/documentVaultService';
import { applicantService } from '../../services/applicantService';
import {
  DocumentRecord,
  DocumentCategory,
  VerificationStatus,
  DocumentReuseRecord,
} from '../../types/documentVault';
import { DocumentRequirement } from '../../types/approvalDiscovery';
import { DigiLockerBanner } from '../../components/documents/DigiLockerBanner';
import { DocumentReuseModal } from '../../components/documents/DocumentReuseModal';
import { DocumentVersionDrawer } from '../../components/documents/DocumentVersionDrawer';
import { DocumentDetailModal } from '../../components/documents/DocumentDetailModal';
import { DocumentUploadModal } from '../../components/documents/DocumentUploadModal';
import { Phase4ReadinessSection } from '../../components/documents/Phase4ReadinessSection';

export const DocumentVaultPage: React.FC = () => {
  // State from services
  const [documents, setDocuments] = useState<DocumentRecord[]>(() =>
    documentVaultService.getAllDocuments()
  );
  const [digiLockerState, setDigiLockerState] = useState(() =>
    documentVaultService.getDigiLockerState()
  );
  const [reuseRecords, setReuseRecords] = useState<DocumentReuseRecord[]>(() =>
    documentVaultService.getReuseRecords()
  );

  // Active view tab: 'VAULT' | 'READINESS' | 'REUSE_AUDIT'
  const [activeView, setActiveView] = useState<'VAULT' | 'READINESS' | 'REUSE_AUDIT'>('VAULT');

  // Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedSource, setSelectedSource] = useState<string>('All');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>('All');

  // Modals & Drawers state
  const [selectedDocForDetail, setSelectedDocForDetail] = useState<DocumentRecord | null>(null);
  const [selectedDocForHistory, setSelectedDocForHistory] = useState<DocumentRecord | null>(null);
  const [selectedDocForRevision, setSelectedDocForRevision] = useState<DocumentRecord | null>(null);
  const [isReuseModalOpen, setIsReuseModalOpen] = useState<boolean>(false);
  const [preselectedReqForReuse, setPreselectedReqForReuse] = useState<{
    requirementName: string;
    clearanceCode: string;
    clearanceName: string;
    category?: string;
  } | undefined>(undefined);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'info'; text: string } | null>(
    null
  );

  const showToast = (text: string, type: 'success' | 'info' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const refreshState = () => {
    setDocuments(documentVaultService.getAllDocuments());
    setDigiLockerState(documentVaultService.getDigiLockerState());
    setReuseRecords(documentVaultService.getReuseRecords());
  };

  const enterprises = applicantService.getEnterprises();
  const projects = applicantService.getProjects();

  // Filtered Documents
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = doc.documentName.toLowerCase().includes(q);
        const matchesType = doc.documentType.toLowerCase().includes(q);
        const matchesNo = doc.documentNumber.toLowerCase().includes(q);
        const matchesAuth = doc.issuingAuthority.toLowerCase().includes(q);
        if (!matchesName && !matchesType && !matchesNo && !matchesAuth) {
          return false;
        }
      }

      // Category
      if (selectedCategory !== 'All' && doc.category !== selectedCategory) {
        return false;
      }

      // Status
      if (selectedStatus !== 'All') {
        if (selectedStatus === 'Verified' && doc.verificationStatus !== 'Verified') return false;
        if (selectedStatus === 'Pending' && doc.verificationStatus !== 'Pending Verification') return false;
        if (selectedStatus === 'Expired' && doc.status !== 'Expired' && doc.verificationStatus !== 'Expired') return false;
      }

      // Source
      if (selectedSource !== 'All' && doc.source !== selectedSource) {
        return false;
      }

      // Project
      if (selectedProjectFilter !== 'All') {
        if (doc.ownerType !== 'Applicant' && !doc.projectIds.includes(selectedProjectFilter)) {
          return false;
        }
      }

      return true;
    });
  }, [documents, searchQuery, selectedCategory, selectedStatus, selectedSource, selectedProjectFilter]);

  // Document Metrics
  const metrics = useMemo(() => {
    const total = documents.length;
    const verified = documents.filter((d) => d.verificationStatus === 'Verified').length;
    const pending = documents.filter((d) => d.verificationStatus === 'Pending Verification').length;
    const expired = documents.filter((d) => d.status === 'Expired' || d.verificationStatus === 'Expired').length;
    const digiLocker = documents.filter((d) => d.source === 'DigiLocker').length;
    const activeReuses = reuseRecords.filter((r) => r.status === 'Active').length;

    return { total, verified, pending, expired, digiLocker, activeReuses };
  }, [documents, reuseRecords]);

  // Handlers for action triggers
  const handleOpenReuseModal = (docOrReq?: DocumentRecord | {
    requirementName: string;
    clearanceCode: string;
    clearanceName: string;
    category?: string;
  }) => {
    if (docOrReq && 'requirementName' in docOrReq) {
      setPreselectedReqForReuse(docOrReq);
    } else if (docOrReq && 'documentName' in docOrReq) {
      setPreselectedReqForReuse({
        requirementName: docOrReq.documentType,
        clearanceCode: docOrReq.linkedApprovals[0] || 'MPCB-CTE',
        clearanceName: 'Statutory Clearance Filing',
        category: docOrReq.category,
      });
    } else {
      setPreselectedReqForReuse(undefined);
    }
    setIsReuseModalOpen(true);
  };

  const handleOpenUploadForRequirement = (req: DocumentRequirement) => {
    setIsUploadModalOpen(true);
  };

  return (
    <ApplicantLayout
      activeTab="documents"
      pageTitle="Statutory Document Vault — DigiLocker Linked"
      breadcrumbs={[
        { label: 'Applicant Portal', href: '/applicant/dashboard' },
        { label: 'My Documents' },
      ]}
    >
      <div className="space-y-6 animate-in fade-in duration-200" data-purpose="statutory-document-vault-phase5">
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed top-4 right-4 z-50 p-4 rounded-xl shadow-xl bg-slate-900 text-white border border-slate-700 flex items-center gap-3 animate-in slide-in-from-top-3 duration-200">
            <span className="text-emerald-400 font-bold">✓</span>
            <span className="text-xs font-medium">{toastMessage.text}</span>
          </div>
        )}

        {/* 1. DigiLocker Linked Primary Banner */}
        <DigiLockerBanner
          digiLockerState={digiLockerState}
          onSyncComplete={() => {
            refreshState();
            showToast('Synchronized statutory credentials with DigiLocker gateway.');
          }}
        />

        {/* 2. Document Locker Statistics Cards */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          {/* Card 1: Total Deposited */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wider">Total Vault</span>
              <span className="p-1 rounded bg-slate-100 text-xs">📁</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-slate-900 font-serif">
                {metrics.total}
              </span>
              <span className="text-[11px] text-slate-500">Records</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">All undertaking files</p>
          </div>

          {/* Card 2: Verified Reusable */}
          <div className="bg-white rounded-xl border border-emerald-200 p-4 shadow-2xs bg-gradient-to-br from-white to-emerald-50/30">
            <div className="flex items-center justify-between text-emerald-800 mb-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wider">Verified</span>
              <span className="p-1 rounded bg-emerald-100 text-emerald-800 text-xs">✓</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-emerald-900 font-serif">
                {metrics.verified}
              </span>
              <span className="text-[11px] font-bold text-emerald-700">Reusable</span>
            </div>
            <p className="text-[10px] text-emerald-600 mt-1">Ready for single window</p>
          </div>

          {/* Card 3: DigiLocker Pulled */}
          <div className="bg-white rounded-xl border border-blue-200 p-4 shadow-2xs bg-gradient-to-br from-white to-blue-50/30">
            <div className="flex items-center justify-between text-blue-800 mb-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wider">DigiLocker</span>
              <span className="p-1 rounded bg-blue-100 text-blue-800 text-xs">🏛️</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-blue-900 font-serif">
                {metrics.digiLocker}
              </span>
              <span className="text-[11px] text-blue-700">Govt Synced</span>
            </div>
            <p className="text-[10px] text-blue-600 mt-1">Authentic digital source</p>
          </div>

          {/* Card 4: In Scrutiny */}
          <div className="bg-white rounded-xl border border-amber-200 p-4 shadow-2xs bg-gradient-to-br from-white to-amber-50/30">
            <div className="flex items-center justify-between text-amber-800 mb-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wider">In Scrutiny</span>
              <span className="p-1 rounded bg-amber-100 text-amber-800 text-xs">⏳</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-amber-900 font-serif">
                {metrics.pending}
              </span>
              <span className="text-[11px] text-amber-800">Pending</span>
            </div>
            <p className="text-[10px] text-amber-700 mt-1">Officer verification</p>
          </div>

          {/* Card 5: Expired */}
          <div className="bg-white rounded-xl border border-rose-200 p-4 shadow-2xs bg-gradient-to-br from-white to-rose-50/30">
            <div className="flex items-center justify-between text-rose-800 mb-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wider">Expired</span>
              <span className="p-1 rounded bg-rose-100 text-rose-800 text-xs">⚠️</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-rose-900 font-serif">
                {metrics.expired}
              </span>
              <span className="text-[11px] text-rose-700 font-medium">Outdated</span>
            </div>
            <p className="text-[10px] text-rose-600 mt-1">Renewal required</p>
          </div>

          {/* Card 6: Reused Links */}
          <div className="bg-white rounded-xl border border-purple-200 p-4 shadow-2xs bg-gradient-to-br from-white to-purple-50/30">
            <div className="flex items-center justify-between text-purple-800 mb-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wider">Active Links</span>
              <span className="p-1 rounded bg-purple-100 text-purple-800 text-xs">🔗</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-purple-900 font-serif">
                {metrics.activeReuses}
              </span>
              <span className="text-[11px] text-purple-700">Clearances</span>
            </div>
            <p className="text-[10px] text-purple-600 mt-1">Zero physical duplication</p>
          </div>
        </section>

        {/* 3. Section Navigation Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-1">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setActiveView('VAULT')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                activeView === 'VAULT'
                  ? 'bg-[#0f2b48] text-white shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <span>📁 All Locker Documents</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                activeView === 'VAULT' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {documents.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('READINESS')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                activeView === 'READINESS'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <span>⚡ Phase 4 Clearance Matrix</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
            </button>

            <button
              type="button"
              onClick={() => setActiveView('REUSE_AUDIT')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                activeView === 'REUSE_AUDIT'
                  ? 'bg-purple-800 text-white shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <span>🔗 Statutory Reuse Audit</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                activeView === 'REUSE_AUDIT' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {reuseRecords.length}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => handleOpenReuseModal()}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>🔗 Use Existing Verified Document</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedDocForRevision(null);
                setIsUploadModalOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#0f2b48] hover:bg-[#0b1f33] text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>+ Deposit Document</span>
            </button>
          </div>
        </div>

        {/* 4. Tab 1: VAULT DOCUMENTS VIEW */}
        {activeView === 'VAULT' && (
          <div className="space-y-4">
            {/* Filter and Search Toolbar */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                {/* Search */}
                <div className="sm:col-span-4">
                  <label htmlFor="vault-search-input" className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Search Documents
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-400 text-xs">🔍</span>
                    <input
                      id="vault-search-input"
                      type="text"
                      placeholder="Title, authority, certificate no..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs bg-slate-50/50"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Category Filter */}
                <div className="sm:col-span-3">
                  <label htmlFor="vault-category-select" className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Category
                  </label>
                  <select
                    id="vault-category-select"
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs bg-white"
                  >
                    <option value="All">All Categories</option>
                    <option value="Identity & Applicant">Identity &amp; Applicant</option>
                    <option value="Enterprise Registration">Enterprise Registration</option>
                    <option value="Land & Siting">Land &amp; Siting</option>
                    <option value="Engineering & Layout">Engineering &amp; Layout</option>
                    <option value="Environmental & Health">Environmental &amp; Health</option>
                    <option value="Safety & Utility">Safety &amp; Utility</option>
                    <option value="Financial & Statutory">Financial &amp; Statutory</option>
                    <option value="Labour & Workforce">Labour &amp; Workforce</option>
                  </select>
                </div>

                {/* Verification Status Filter */}
                <div className="sm:col-span-2">
                  <label htmlFor="vault-status-select" className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Status
                  </label>
                  <select
                    id="vault-status-select"
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs bg-white"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Verified">✓ Verified (Reusable)</option>
                    <option value="Pending">⏳ Pending Scrutiny</option>
                    <option value="Expired">⚠️ Expired</option>
                  </select>
                </div>

                {/* Source Filter */}
                <div className="sm:col-span-3">
                  <label htmlFor="vault-source-select" className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Origin Source
                  </label>
                  <select
                    id="vault-source-select"
                    value={selectedSource}
                    onChange={(e) => setSelectedSource(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs bg-white"
                  >
                    <option value="All">All Sources</option>
                    <option value="DigiLocker">🏛️ DigiLocker Gateway</option>
                    <option value="Department Issued">🏢 Department Issued</option>
                    <option value="Direct Upload">📄 Direct Applicant Upload</option>
                    <option value="Single Window Repository">🗄️ Single Window Repo</option>
                  </select>
                </div>
              </div>

              {/* Active Filter Chips bar */}
              {(selectedCategory !== 'All' || selectedStatus !== 'All' || selectedSource !== 'All' || searchQuery) && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                  <span className="font-semibold">Active Filters:</span>
                  {selectedCategory !== 'All' && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1">
                      Category: {selectedCategory}
                      <button type="button" onClick={() => setSelectedCategory('All')} className="text-blue-500 hover:text-blue-700">✕</button>
                    </span>
                  )}
                  {selectedStatus !== 'All' && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1">
                      Status: {selectedStatus}
                      <button type="button" onClick={() => setSelectedStatus('All')} className="text-blue-500 hover:text-blue-700">✕</button>
                    </span>
                  )}
                  {selectedSource !== 'All' && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1">
                      Source: {selectedSource}
                      <button type="button" onClick={() => setSelectedSource('All')} className="text-blue-500 hover:text-blue-700">✕</button>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('All');
                      setSelectedStatus('All');
                      setSelectedSource('All');
                    }}
                    className="text-xs text-rose-600 hover:underline ml-1"
                  >
                    Reset all filters
                  </button>
                </div>
              )}
            </div>

            {/* Document Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Showing <strong className="text-slate-800">{filteredDocuments.length}</strong> of{' '}
                  <strong className="text-slate-800">{documents.length}</strong> statutory documents
                </span>
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  🔒 Encrypted Vault • Single Window Reuse Enabled
                </span>
              </div>

              {filteredDocuments.length === 0 ? (
                <div className="p-12 text-center">
                  <span className="text-4xl block mb-2">🗂️</span>
                  <h3 className="font-bold text-slate-800 text-sm">No statutory documents match your query</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    Try refining your keyword search or adjusting your category/status filters.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('All');
                      setSelectedStatus('All');
                      setSelectedSource('All');
                    }}
                    className="mt-4 px-4 py-2 rounded-xl text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition cursor-pointer"
                  >
                    Clear Filter Parameters
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4">Document Title &amp; Category</th>
                        <th className="py-3 px-3">Issuing Authority &amp; Certificate No.</th>
                        <th className="py-3 px-3">Source &amp; Version</th>
                        <th className="py-3 px-3">Verification &amp; Validity</th>
                        <th className="py-3 px-3">Statutory Clearance Links</th>
                        <th className="py-3 px-4 text-right">Vault Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredDocuments.map((doc) => {
                        const currentVer = documentVaultService.getCurrentVersion(doc.id);
                        const versions = documentVaultService.getDocumentVersions(doc.id);
                        const isExpired =
                          doc.status === 'Expired' ||
                          doc.verificationStatus === 'Expired' ||
                          (doc.expiryDate && new Date(doc.expiryDate).getTime() < Date.now());

                        return (
                          <tr key={doc.id} className="hover:bg-slate-50/80 transition">
                            {/* Document Title & Category */}
                            <td className="py-3.5 px-4">
                              <div className="flex items-start gap-2.5">
                                <span className="text-lg mt-0.5">
                                  {doc.category === 'Land & Siting' && '🗺️'}
                                  {doc.category === 'Enterprise Registration' && '🏢'}
                                  {doc.category === 'Identity & Applicant' && '👤'}
                                  {doc.category === 'Engineering & Layout' && '📐'}
                                  {doc.category === 'Environmental & Health' && '🌿'}
                                  {doc.category === 'Safety & Utility' && '⚡'}
                                  {doc.category === 'Financial & Statutory' && '💰'}
                                  {doc.category === 'Labour & Workforce' && '👥'}
                                  {doc.category === 'Other Regulatory Documents' && '📄'}
                                </span>
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedDocForDetail(doc)}
                                    className="font-bold text-slate-900 hover:text-blue-700 text-left text-xs block leading-snug cursor-pointer"
                                  >
                                    {doc.documentName}
                                  </button>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                      {doc.category}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      ID: {doc.id}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Authority & Number */}
                            <td className="py-3.5 px-3">
                              <span className="font-semibold text-slate-800 block truncate max-w-[200px]">
                                {doc.issuingAuthority}
                              </span>
                              <span className="text-[10.5px] font-mono font-bold text-blue-900 bg-blue-50/80 px-1.5 py-0.2 rounded border border-blue-100 inline-block mt-0.5">
                                {doc.documentNumber}
                              </span>
                            </td>

                            {/* Source & Version */}
                            <td className="py-3.5 px-3">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedDocForHistory(doc)}
                                  className="font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 hover:bg-slate-200 transition cursor-pointer"
                                  title="Click to view version history"
                                >
                                  {currentVer?.versionNumber || 'v1.0'}
                                </button>
                                {versions.length > 1 && (
                                  <span className="text-[10px] text-blue-600 font-semibold cursor-pointer" onClick={() => setSelectedDocForHistory(doc)}>
                                    ({versions.length} revs)
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-500 block mt-1">
                                {doc.source === 'DigiLocker' && '🏛️ DigiLocker Verified'}
                                {doc.source === 'Direct Upload' && '📄 Direct Upload'}
                                {doc.source === 'Department Issued' && '🏢 Dept. Issued'}
                                {doc.source === 'Single Window Repository' && '🗄️ SWS Repo'}
                              </span>
                            </td>

                            {/* Verification & Expiry */}
                            <td className="py-3.5 px-3">
                              {doc.verificationStatus === 'Verified' && !isExpired && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  <span>✓</span> Verified (Reusable)
                                </span>
                              )}
                              {doc.verificationStatus === 'Pending Verification' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                  Pending Scrutiny
                                </span>
                              )}
                              {isExpired && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                  <span>⚠️</span> Expired
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400 block mt-1">
                                {doc.expiryDate ? `Exp: ${doc.expiryDate}` : 'Validity: Perpetual'}
                              </span>
                            </td>

                            {/* Clearances */}
                            <td className="py-3.5 px-3">
                              <div className="flex flex-wrap gap-1 max-w-[150px]">
                                {doc.linkedApprovals && doc.linkedApprovals.length > 0 ? (
                                  doc.linkedApprovals.slice(0, 3).map((appCode) => (
                                    <span
                                      key={appCode}
                                      className="px-1.5 py-0.2 rounded font-mono text-[9px] font-bold bg-slate-100 text-slate-700 border border-slate-200"
                                    >
                                      {appCode}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[10px] text-slate-400 italic">Available</span>
                                )}
                                {doc.linkedApprovals.length > 3 && (
                                  <span className="text-[9.5px] text-slate-400">
                                    +{doc.linkedApprovals.length - 3} more
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Actions */}
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedDocForDetail(doc)}
                                  className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-200 transition cursor-pointer"
                                  title="View complete document dossier"
                                >
                                  Details
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSelectedDocForHistory(doc)}
                                  className="px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 rounded-lg border border-blue-200 transition cursor-pointer"
                                  title="Inspect version history"
                                >
                                  🕒
                                </button>
                                {doc.reusable && !isExpired && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenReuseModal(doc)}
                                    className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs transition cursor-pointer"
                                    title="Link this verified document into an approval"
                                  >
                                    🔗 Reuse
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. Tab 2: PHASE 4 READINESS ANALYSIS */}
        {activeView === 'READINESS' && (
          <Phase4ReadinessSection
            onOpenReuseModal={(req) => handleOpenReuseModal(req)}
            onOpenUploadForRequirement={(req) => handleOpenUploadForRequirement(req)}
            onViewDocDetails={(doc) => setSelectedDocForDetail(doc)}
          />
        )}

        {/* 6. Tab 3: STATUTORY REUSE AUDIT TRAIL */}
        {activeView === 'REUSE_AUDIT' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-5">
            <div className="border-b border-slate-100 pb-4">
              <h3 className="text-base font-bold text-slate-900 font-serif flex items-center gap-2">
                <span>🔗</span> Multi-Application Document Reuse Audit Ledger
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Under the Maharashtra Single Window Act, statutory documents deposited once are referenced across department clearances without requiring physical re-submission.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 font-semibold border-y border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Reuse Audit Ref</th>
                    <th className="py-2.5 px-3">Statutory Document (Locker)</th>
                    <th className="py-2.5 px-3">Target Clearance &amp; Code</th>
                    <th className="py-2.5 px-3">Industrial Project</th>
                    <th className="py-2.5 px-3">Linked By &amp; Date</th>
                    <th className="py-2.5 px-3 text-right">Integrity Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reuseRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-slate-800 block">{r.id}</span>
                        <span className="text-[10px] text-slate-400">Cryptographic Pointer</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-semibold text-slate-900 block">{r.documentName}</span>
                        <span className="font-mono text-[10px] text-blue-800 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-100">
                          Version {r.versionNumber}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-semibold text-slate-800 block">{r.targetClearanceName}</span>
                        <span className="text-[11px] text-slate-500">
                          Req: {r.targetRequirementName} ({r.targetClearanceCode})
                        </span>
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-700">
                        {r.projectName}
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-medium text-slate-800 block">{r.reusedBy}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(r.reusedAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <span>✓</span> Active Reference
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- MODALS & DRAWERS --- */}

        {/* 1. Reuse Modal */}
        <DocumentReuseModal
          isOpen={isReuseModalOpen}
          onClose={() => setIsReuseModalOpen(false)}
          preselectedRequirement={preselectedReqForReuse}
          onSuccess={(doc, targetName) => {
            refreshState();
            showToast(`Document '${doc.documentName}' linked to '${targetName}' successfully.`);
          }}
        />

        {/* 2. Version History Drawer */}
        <DocumentVersionDrawer
          isOpen={Boolean(selectedDocForHistory)}
          document={selectedDocForHistory}
          onClose={() => setSelectedDocForHistory(null)}
          onUploadNewRevision={(doc) => {
            setSelectedDocForRevision(doc);
            setIsUploadModalOpen(true);
          }}
        />

        {/* 3. Document Detail Modal */}
        <DocumentDetailModal
          isOpen={Boolean(selectedDocForDetail)}
          document={selectedDocForDetail}
          onClose={() => setSelectedDocForDetail(null)}
          onOpenReuseModal={(doc) => handleOpenReuseModal(doc)}
          onOpenVersionHistory={(doc) => setSelectedDocForHistory(doc)}
          onOpenUploadRevision={(doc) => {
            setSelectedDocForRevision(doc);
            setIsUploadModalOpen(true);
          }}
        />

        {/* 4. Upload Modal (New Doc or Revision) */}
        <DocumentUploadModal
          isOpen={isUploadModalOpen}
          documentToRevise={selectedDocForRevision}
          onClose={() => {
            setIsUploadModalOpen(false);
            setSelectedDocForRevision(null);
          }}
          onSuccess={() => {
            refreshState();
            showToast(
              selectedDocForRevision
                ? 'Revised document version deposited into statutory vault.'
                : 'New statutory document deposited into locker (Pending Verification).'
            );
          }}
        />
      </div>
    </ApplicantLayout>
  );
};
