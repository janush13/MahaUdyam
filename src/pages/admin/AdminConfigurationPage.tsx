import React, { useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  AdminWorkspaceTab,
  APPROVAL_CLEARANCE_ROWS,
  RBAC_MATRIX_ROWS,
  RULE_VERSION,
  WORKFLOW_STAGES,
  adminConfigService,
  AdminAuditEntry,
} from '../../services/adminConfigService';
import { AdminLayout } from '../../components/layout/AdminLayout';

const CHECK = <span className="text-emerald-600 font-bold" aria-label="Allowed">✓</span>;
const NONE = <span className="text-slate-300" aria-label="Not allowed">-</span>;

export const AdminConfigurationPage: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminWorkspaceTab>('approval-rules');
  const [notice, setNotice] = useState('');
  const [auditLogs, setAuditLogs] = useState<AdminAuditEntry[]>(() => adminConfigService.getAuditLogs());
  const [auditPage, setAuditPage] = useState(1);
  const [published, setPublished] = useState(false);
  const [selectedClearance, setSelectedClearance] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const approvalRef = useRef<HTMLElement>(null);
  const rolesRef = useRef<HTMLElement>(null);
  const workflowRef = useRef<HTMLElement>(null);
  const auditRef = useRef<HTMLElement>(null);

  const actor = user?.name || 'Admin User';
  const pageSize = 4;
  const visibleAudit = useMemo(() => auditLogs.slice((auditPage - 1) * pageSize, auditPage * pageSize), [auditLogs, auditPage]);
  const totalAuditPages = Math.max(1, Math.ceil(auditLogs.length / pageSize));

  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };

  const record = (action: string, entity: string, referenceId: string) => {
    const entry = adminConfigService.recordAdminAction(action, entity, referenceId, actor);
    setAuditLogs(adminConfigService.getAuditLogs());
    setAuditPage(1);
    announce(`${action} recorded in the prototype audit trail.`);
    return entry;
  };

  const focusTab = (tab: AdminWorkspaceTab) => {
    setActiveTab(tab);
    const target = tab === 'approval-rules' ? approvalRef.current
      : tab === 'roles' || tab === 'users' ? rolesRef.current
        : tab === 'workflow' ? workflowRef.current
          : auditRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const exportText = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const tabClass = (tab: AdminWorkspaceTab) =>
    `pb-2.5 border-b-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${activeTab === tab ? 'text-[#0f2b5c] font-bold border-[#0f2b5c]' : 'text-slate-600 border-transparent hover:text-[#0f2b5c]'}`;

  return (
    <AdminLayout activeTab={activeTab} onTabChange={focusTab} onNotice={announce}>
      <main className="overflow-y-auto px-4 sm:px-6 py-5 bg-[#f8fafc]" data-purpose="main-workspace">
        {notice && <div role="status" className="fixed right-5 bottom-5 z-50 max-w-sm rounded-lg bg-[#0f2b5c] px-4 py-3 text-xs font-semibold text-white shadow-xl">{notice}</div>}
        <div className="mb-4">
          <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1"><span>Portal</span><span aria-hidden="true">&gt;</span><span>Administration</span><span aria-hidden="true">&gt;</span><span className="font-medium text-[#0f2b5c]">System Configuration &amp; Rule Engine</span></div>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div><h2 className="text-xl font-bold text-[#0f2b5c] tracking-tight">Admin Configuration &amp; Statutory Rule Engine</h2><p className="text-xs text-slate-500 mt-0.5">Manage portal administrators, RBAC permissions matrix, smart approval discovery logic, and multi-department workflow routing.</p></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => exportText(adminConfigService.exportRuleSchema(), 'mahaudyam-rule-schema.json', 'application/json')} className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600">↥ Export Schema</button>
              <button type="button" onClick={() => record('New Rule Drafted', 'Statutory Rule Engine', `RUL-DRAFT-${RULE_VERSION}`)} className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0f2b5c] rounded hover:bg-[#1e3d75] shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600">＋ New Statutory Rule</button>
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200 mb-5 overflow-x-auto">
          <nav aria-label="Admin workspace tabs" className="flex items-center gap-6 min-w-max">
            <button type="button" className={tabClass('users')} onClick={() => focusTab('users')}>1. Users &amp; RBAC</button>
            <button type="button" className={`${tabClass('roles')} flex items-center gap-1.5`} onClick={() => focusTab('roles')}>2. Roles &amp; Permissions Matrix <span className="bg-slate-200 text-slate-700 text-[10px] px-1.5 py-0.5 rounded-full font-mono">5 Roles</span></button>
            <button type="button" className={`${tabClass('approval-rules')} flex items-center gap-1.5`} onClick={() => focusTab('approval-rules')}>3. Approval Rules Engine <span className="bg-[#0f2b5c] text-white text-[10px] px-1.5 py-0.5 rounded-full font-mono">Active</span></button>
            <button type="button" className={tabClass('workflow')} onClick={() => focusTab('workflow')}>4. Workflow Configuration</button>
            <button type="button" className={tabClass('master-data')} onClick={() => focusTab('master-data')}>5. Master Data &amp; Regulatory</button>
          </nav>
        </div>

        <section ref={approvalRef} id="approval-rules" className="bg-white border border-slate-200 rounded-md shadow-sm mb-6 overflow-hidden" data-purpose="rule-engine-builder">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /><h3 className="font-bold text-sm text-[#0f2b5c]">Rule #RUL-2024-IND-018: Red Category Industrial Manufacturing Clearance Matrix</h3></div>
            <div className="flex items-center gap-2 flex-wrap"><span className="text-[11px] font-mono bg-slate-200 text-slate-800 px-2 py-0.5 rounded font-semibold">Version: {RULE_VERSION} (Active)</span><span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-300 font-semibold px-2 py-0.5 rounded">{published ? 'Status: Published' : 'Status: Active'}</span><button type="button" onClick={() => record('Rule Draft Saved', 'Approval Engine Siting Criteria', 'RUL-2024-IND-018')} className="text-xs px-2.5 py-1 text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600">Save Draft</button><button type="button" onClick={() => announce('Syntax validation passed for the deterministic prototype rule.')} className="text-xs px-2.5 py-1 text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600">Validate Syntax</button><button type="button" onClick={() => { setPublished(true); record('Rule Published', 'Approval Engine Siting Criteria', 'RUL-2024-IND-018'); }} className="text-xs px-2.5 py-1 text-white bg-[#0f2b5c] rounded hover:bg-[#1e3d75] focus:outline-none focus:ring-2 focus:ring-blue-600">Publish New Version</button></div>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50/70 p-2.5 rounded border border-slate-200 text-xs"><div><span className="text-slate-500 block text-[10.5px]">Effective Date:</span><span className="font-semibold text-[#0f2b5c]">01 Jan 2024</span></div><div><span className="text-slate-500 block text-[10.5px]">Last Modified:</span><span className="font-semibold text-slate-800">12 Dec 2024, 04:30 PM</span></div><div><span className="text-slate-500 block text-[10.5px]">Author / Approver:</span><span className="font-semibold text-slate-800">Admin User (Emp ID: MH-9021)</span></div><div><span className="text-slate-500 block text-[10.5px]">Target Sector:</span><span className="font-semibold text-slate-800">Manufacturing (Red / Orange Category)</span></div></div>
            <div className="border border-blue-200 bg-blue-50/30 rounded p-3"><div className="flex items-center justify-between mb-2 gap-2"><div className="flex items-center gap-2"><span className="bg-[#0f2b5c] text-white font-bold text-[10px] px-2 py-0.5 rounded tracking-wide uppercase">IF</span><span className="font-semibold text-xs text-[#0f2b5c]">Applicant Enterprise &amp; Project Profile matches ALL of the following:</span></div><span className="text-[11px] text-blue-700 font-medium">Auto-Discovery Clause Evaluation</span></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white p-3 rounded border border-blue-100">{[['Industry Sector', 'Manufacturing (Auto & Heavy Engineering)'], ['Project Classification & Type', 'New Industrial Unit | Expansion Unit'], ['Project Regulatory Stage', 'Pre-Establishment & Construction'], ['Proposed Location / Jurisdiction', 'MIDC Notified Industrial Area (Pune / Raigad / Chakan)'], ['Gross Plant & Machinery Investment', '₹ 10.00 Cr to ₹ 50.00 Cr (Medium Enterprise)'], ['Hazardous / Pollution Siting Category', 'Red Category (Severely Polluting - MPCB/CPCB)']].map(([label, value]) => <label key={label} className="block text-[10.5px] font-semibold text-slate-600">{label}<input readOnly value={value} className={`mt-1 w-full text-xs rounded px-2.5 py-1 font-medium ${label.includes('Hazardous') ? 'bg-red-50 border-red-300 text-red-900 font-bold' : 'bg-slate-50 border-slate-300 text-slate-800'}`} /></label>)}</div><div className="mt-2.5 pt-2 border-t border-blue-100 flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Trigger Modifiers:</span>{['Boiler Capacity > 10 TPH', 'Connected Load > 100 KVA (HT Power Line)', 'Factory Plot Built-up Area > 10,000 sq.meters'].map((modifier) => <span key={modifier} className="inline-flex items-center text-[10.5px] bg-white border border-slate-300 px-2 py-0.5 rounded text-slate-700"><span className="font-bold text-[#0f2b5c] mr-1">AND</span>{modifier}</span>)}</div></div>
            <div className="flex items-center justify-center my-1 gap-2"><div className="h-px bg-slate-300 flex-1" /><div className="px-3 py-0.5 bg-[#0f2b5c] text-white text-[10px] font-bold rounded-full uppercase tracking-wider">↓ THEN GENERATE MANDATORY STATUTORY APPROVAL STACK</div><div className="h-px bg-slate-300 flex-1" /></div>
            <div className="border border-slate-200 rounded overflow-x-auto"><div className="bg-slate-100 px-3 py-2 border-b border-slate-200 flex items-center justify-between gap-2"><span className="font-bold text-xs text-[#0f2b5c]">Resulting Statutory Permissions Checklist Generated in Single Application Docket</span><span className="text-[11px] text-slate-500 shrink-0">{APPROVAL_CLEARANCE_ROWS.length} clearances triggered under Maharashtra RTS Act</span></div><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-slate-50 text-[11px] text-slate-600 border-b border-slate-200"><tr><th className="py-2 px-3">Service Code</th><th className="py-2 px-3">Clearance / Approval Name</th><th className="py-2 px-3">Competent Department</th><th className="py-2 px-3">Applicability</th><th className="py-2 px-3">Statutory SLA</th><th className="py-2 px-3">Dependency / Sequence</th><th className="py-2 px-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-200">{APPROVAL_CLEARANCE_ROWS.map((row) => <tr key={row.serviceCode} className="hover:bg-slate-50"><td className="py-2 px-3 font-mono font-semibold text-slate-700">{row.serviceCode}</td><td className="py-2 px-3 font-medium text-[#0f2b5c]">{row.name}</td><td className="py-2 px-3">{row.department}</td><td className="py-2 px-3"><span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${row.applicability === 'Mandatory' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>{row.applicability}</span></td><td className="py-2 px-3 font-semibold text-slate-800">{row.sla}</td><td className="py-2 px-3 text-slate-600 text-[11px]">{row.dependency}</td><td className="py-2 px-3 text-right"><button type="button" onClick={() => { setSelectedClearance(row.serviceCode); record('Rule Logic Viewed', row.name, row.serviceCode); }} className="text-[#0f2b5c] font-semibold hover:underline text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-600">{selectedClearance === row.serviceCode ? 'Selected' : 'Configure Logic'}</button></td></tr>)}</tbody></table></div>
          </div>
        </section>

        <section ref={rolesRef} id="roles-rbac" className="bg-white border border-slate-200 rounded-md shadow-sm mb-6" data-purpose="roles-matrix-panel">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><h3 className="font-bold text-sm text-[#0f2b5c]">Role-Based Access Control (RBAC) &amp; Governance Matrix</h3><p className="text-xs text-slate-500 mt-0.5">Strict statutory separation of administrative maintenance vs. quasi-judicial regulatory review.</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => record('User Creation Started', 'Administrator Directory', 'USR-DRAFT-001')} className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600">＋ Add User</button><button type="button" onClick={() => record('Role Creation Started', 'RBAC Matrix', 'ROLE-DRAFT-001')} className="px-2.5 py-1 text-xs font-semibold text-white bg-[#0f2b5c] rounded hover:bg-[#1e3d75] focus:outline-none focus:ring-2 focus:ring-blue-600">＋ Create Role</button></div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-xs"><thead className="bg-slate-50 text-[11px] text-slate-600 border-b border-slate-200"><tr><th className="py-2.5 px-3">Role Name</th><th className="py-2.5 px-3">Role Description</th><th className="py-2.5 px-3 text-center">Users</th><th className="py-2.5 px-3 text-center">View</th><th className="py-2.5 px-3 text-center">Create</th><th className="py-2.5 px-3 text-center">Verify</th><th className="py-2.5 px-3 text-center">Recommend</th><th className="py-2.5 px-3 text-center">Statutory Grant</th><th className="py-2.5 px-3 text-center">Config Engine</th><th className="py-2.5 px-3">Status</th><th className="py-2.5 px-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-200">{RBAC_MATRIX_ROWS.map((row) => <tr key={row.id} className={`hover:bg-slate-50 ${row.highlight ? 'bg-amber-50/50' : ''}`}><td className="py-2 px-3 font-semibold text-[#0f2b5c]"><div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${row.highlight ? 'bg-amber-500' : row.id === 'admin' ? 'bg-blue-500' : 'bg-slate-400'}`} />{row.roleName}</div></td><td className="py-2 px-3 text-slate-600 max-w-xs truncate text-[11px]">{row.description}</td><td className="py-2 px-3 text-center font-mono font-bold">{row.users}</td><td className="py-2 px-3 text-center">{row.view ? CHECK : NONE}</td><td className="py-2 px-3 text-center">{row.create ? CHECK : NONE}</td><td className="py-2 px-3 text-center">{row.verify ? CHECK : NONE}</td><td className="py-2 px-3 text-center">{row.recommend ? CHECK : NONE}</td><td className="py-2 px-3 text-center">{row.statutoryGrant === 'statutory' ? <span className="text-[10px] text-amber-700 bg-amber-100 border border-amber-200 px-1 py-0.5 rounded font-bold">✓ (Statutory)</span> : row.statutoryGrant === 'restricted' ? <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-1 py-0.5 rounded font-bold">NO (Restricted)</span> : NONE}</td><td className="py-2 px-3 text-center">{row.configEngine ? CHECK : NONE}</td><td className="py-2 px-3"><span className="text-[10.5px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">{row.status}</span></td><td className="py-2 px-3 text-right"><button type="button" onClick={() => { setSelectedRole(row.id); record('Role Viewed', row.roleName, `ROLE-${row.id.toUpperCase()}`); }} className="text-[#0f2b5c] hover:underline font-medium text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-600">{selectedRole === row.id ? 'Selected' : 'View'}</button></td></tr>)}</tbody></table></div>
        </section>

        <section ref={workflowRef} id="workflow-config" className="bg-white border border-slate-200 rounded-md shadow-sm mb-6" data-purpose="workflow-configuration-panel">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2"><div><h3 className="font-bold text-sm text-[#0f2b5c]">Multi-Department Workflow Configuration</h3><p className="text-xs text-slate-500 mt-0.5">Deterministic routing stages for statutory application processing and service-level tracking.</p></div><button type="button" onClick={() => record('Workflow Draft Saved', 'Industrial Clearance Workflow', 'WF-IND-2024-01')} className="px-2.5 py-1 text-xs font-semibold text-[#0f2b5c] bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-600">Save Workflow Draft</button></div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">{WORKFLOW_STAGES.map((stage, index) => <React.Fragment key={stage.id}><div className={`rounded border p-3 ${stage.featured ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-[#0f2b5c] tracking-wide">{stage.label}</span><span className="text-[10px] text-slate-500">{stage.sla.replace('SLA: ', '')}</span></div><h4 className="font-bold text-xs text-slate-800 mt-3">{stage.title}</h4><p className="text-[11px] text-slate-500 mt-1">{stage.actor}</p><span className={`inline-block mt-3 border px-1.5 py-1 rounded text-[10px] font-semibold ${stage.badgeCls}`}>{stage.badge}</span></div>{index < WORKFLOW_STAGES.length - 1 && <div className="hidden md:flex items-center justify-center text-slate-400" aria-hidden="true">→</div>}</React.Fragment>)}</div>
        </section>

        <section ref={auditRef} id="audit-logs" className="bg-white border border-slate-200 rounded-md shadow-sm" data-purpose="audit-log-panel">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2"><div><h3 className="font-bold text-sm text-[#0f2b5c]">System Security &amp; Configuration Audit Logs</h3><p className="text-xs text-slate-500 mt-0.5">Immutable audit trail of administrative modifications to rules, master tables, and user permissions.</p></div><button type="button" onClick={() => exportText(adminConfigService.exportAuditCsv(auditLogs), 'mahaudyam-admin-audit.csv', 'text/csv;charset=utf-8')} className="px-2.5 py-1 text-xs font-semibold text-[#0f2b5c] bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-600">⇩ Export CSV</button></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50 text-[11px] text-slate-600 border-b border-slate-200"><tr><th className="py-2 px-3">Timestamp</th><th className="py-2 px-3">Admin / User</th><th className="py-2 px-3">Action</th><th className="py-2 px-3">Entity Modified</th><th className="py-2 px-3">Reference ID</th><th className="py-2 px-3">IP Address</th><th className="py-2 px-3 text-right">Result</th></tr></thead><tbody className="divide-y divide-slate-200">{visibleAudit.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="py-2 px-3 text-slate-500 font-mono text-[11px]">{row.timestamp}</td><td className="py-2 px-3 font-semibold text-slate-800">{row.actor}</td><td className="py-2 px-3"><span className={`font-semibold px-1.5 py-0.5 rounded text-[10.5px] ${row.actionCls}`}>{row.action}</span></td><td className="py-2 px-3 text-slate-600">{row.entity}</td><td className="py-2 px-3 font-mono text-[11px]">{row.referenceId}</td><td className="py-2 px-3 text-slate-400 font-mono text-[11px]">{row.ip}</td><td className="py-2 px-3 text-right"><span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">{row.result}</span></td></tr>)}</tbody></table></div>
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500"><span>Showing {visibleAudit.length} of 2,890 log entries</span><div className="flex items-center gap-1"><button type="button" disabled={auditPage === 1} onClick={() => setAuditPage((page) => Math.max(1, page - 1))} className="px-2 py-0.5 border border-slate-300 rounded bg-white hover:bg-slate-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-600">‹ Prev</button><span className="px-2 py-0.5 font-bold text-[#0f2b5c]">{auditPage}</span><button type="button" disabled={auditPage === totalAuditPages} onClick={() => setAuditPage((page) => Math.min(totalAuditPages, page + 1))} className="px-2 py-0.5 border border-slate-300 rounded bg-white hover:bg-slate-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-600">Next ›</button></div></div>
        </section>
      </main>
    </AdminLayout>
  );
};
