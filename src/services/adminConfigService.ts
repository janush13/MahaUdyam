export type AdminWorkspaceTab =
  | 'users'
  | 'roles'
  | 'approval-rules'
  | 'workflow'
  | 'master-data'
  | 'audit-logs';

export interface ApprovalClearanceRow {
  serviceCode: string;
  name: string;
  department: string;
  applicability: 'Mandatory' | 'Conditional';
  sla: string;
  dependency: string;
}

export interface RbacMatrixRow {
  id: string;
  roleName: string;
  description: string;
  users: number;
  view: boolean;
  create: boolean;
  verify: boolean;
  recommend: boolean;
  statutoryGrant: 'none' | 'restricted' | 'statutory';
  configEngine: boolean;
  status: 'Active';
  highlight?: boolean;
}

export interface WorkflowStage {
  id: string;
  label: string;
  sla: string;
  title: string;
  actor: string;
  badge: string;
  badgeCls: string;
  featured?: boolean;
}

export interface AdminAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  actionCls: string;
  entity: string;
  referenceId: string;
  ip: string;
  result: 'Success';
}

export const RULE_VERSION = 'v2.4';

export const APPROVAL_CLEARANCE_ROWS: ApprovalClearanceRow[] = [
  {
    serviceCode: 'CTE-01',
    name: 'Consent to Establish (CTE) under Water & Air Acts',
    department: 'Environment Dept (MPCB)',
    applicability: 'Mandatory',
    sla: '30 Days',
    dependency: 'Gatekeeper Clearance; Pre-requisite for Construction',
  },
  {
    serviceCode: 'FL-06',
    name: 'Factory Plan Sanction & Factory Licence Registration',
    department: 'Labour Dept (DISH)',
    applicability: 'Mandatory',
    sla: '45 Days',
    dependency: 'Concurrent with Building Plan; requires CTE reference',
  },
  {
    serviceCode: 'NOC-04',
    name: 'Provisional Fire Safety NOC for Hazardous Occupancy',
    department: 'Fire Services (MIDC Fire Dept)',
    applicability: 'Mandatory',
    sla: '30 Days',
    dependency: 'Pre-requisite for Building Plan sanction',
  },
  {
    serviceCode: 'HT-09',
    name: 'High Tension (33kV) Industrial Power Connection Feasibility',
    department: 'Energy Dept (MSEDCL)',
    applicability: 'Conditional',
    sla: '30 Days',
    dependency: 'Active if Contract Demand > 100 KVA',
  },
  {
    serviceCode: 'BP-11',
    name: 'Industrial Building Plan & Structural Clearance',
    department: 'Urban Development (MIDC SPA)',
    applicability: 'Mandatory',
    sla: '60 Days',
    dependency: 'Depends on Provisional Fire NOC clearance',
  },
];

export const RBAC_MATRIX_ROWS: RbacMatrixRow[] = [
  {
    id: 'admin',
    roleName: 'System Administrator',
    description: 'System configuration, RBAC, master data & rule authoring',
    users: 2,
    view: true,
    create: true,
    verify: false,
    recommend: false,
    statutoryGrant: 'restricted',
    configEngine: true,
    status: 'Active',
  },
  {
    id: 'officer',
    roleName: 'Department Officer',
    description: 'Process and scrutinise applications & coordinate NOCs',
    users: 24,
    view: true,
    create: false,
    verify: true,
    recommend: true,
    statutoryGrant: 'none',
    configEngine: false,
    status: 'Active',
  },
  {
    id: 'inspector',
    roleName: 'Inspector',
    description: 'Conduct inspections and submit field verification reports',
    users: 18,
    view: true,
    create: true,
    verify: true,
    recommend: false,
    statutoryGrant: 'none',
    configEngine: false,
    status: 'Active',
  },
  {
    id: 'authority',
    roleName: 'Statutory Approving Authority',
    description: 'Approve / Reject applications under Maharashtra RTS Act',
    users: 6,
    view: true,
    create: false,
    verify: true,
    recommend: true,
    statutoryGrant: 'statutory',
    configEngine: false,
    status: 'Active',
    highlight: true,
  },
  {
    id: 'viewer',
    roleName: 'Department Viewer',
    description: 'Read-only access to department data, dashboards and MIS',
    users: 10,
    view: true,
    create: false,
    verify: false,
    recommend: false,
    statutoryGrant: 'none',
    configEngine: false,
    status: 'Active',
  },
];

export const WORKFLOW_STAGES: WorkflowStage[] = [
  {
    id: '01',
    label: 'STAGE 01',
    sla: 'SLA: 0 Days',
    title: 'Filing & Payment',
    actor: 'Applicant Portal',
    badge: 'Auto-verification & GRAS Fee',
    badgeCls: 'bg-blue-50 text-blue-800 border-blue-100',
  },
  {
    id: '02',
    label: 'STAGE 02',
    sla: 'SLA: 5 Days',
    title: 'Desk Scrutiny',
    actor: 'Scrutiny Officer (DISH)',
    badge: 'Query Raising Enabled',
    badgeCls: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  {
    id: '03',
    label: 'STAGE 03',
    sla: 'SLA: 7 Days',
    title: 'Site Inspection',
    actor: 'Field Inspector',
    badge: 'Geotagged Photo Upload',
    badgeCls: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  {
    id: '04',
    label: 'STAGE 04',
    sla: 'SLA: 3 Days',
    title: 'Recommendation',
    actor: 'Officer Level 1',
    badge: 'Statutory Brief Drafted',
    badgeCls: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
  {
    id: '05',
    label: 'STAGE 05',
    sla: 'SLA: 5 Days',
    title: 'Final Grant / DSC',
    actor: 'Approving Authority',
    badge: 'Digital Sign & Barcode',
    badgeCls: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    featured: true,
  },
];

const DEFAULT_AUDIT: AdminAuditEntry[] = [
  {
    id: 'aud-1',
    timestamp: '12 Dec 2024, 04:30 PM',
    actor: 'Admin User',
    action: 'Rule Updated',
    actionCls: 'bg-blue-50 text-blue-700',
    entity: 'Approval Engine Siting Criteria',
    referenceId: 'RUL-2024-IND-018',
    ip: '10.142.6.84',
    result: 'Success',
  },
  {
    id: 'aud-2',
    timestamp: '12 Dec 2024, 10:24 AM',
    actor: 'Rohit Patil (Scrutiny Off.)',
    action: 'Query Raised',
    actionCls: 'bg-slate-100 text-slate-700',
    entity: 'Site Plan Drawing Checklist',
    referenceId: 'MUO/2024/000123',
    ip: '10.142.12.19',
    result: 'Success',
  },
  {
    id: 'aud-3',
    timestamp: '11 Dec 2024, 02:15 PM',
    actor: 'Meera Joshi',
    action: 'Master Data Edit',
    actionCls: 'bg-amber-50 text-amber-800',
    entity: 'MIDC Industrial Areas (Talegaon Phase II)',
    referenceId: 'MD-DIST-004',
    ip: '10.142.6.90',
    result: 'Success',
  },
  {
    id: 'aud-4',
    timestamp: '09 Dec 2024, 11:05 AM',
    actor: 'Pravin Shinde',
    action: 'Policy Upload',
    actionCls: 'bg-purple-50 text-purple-700',
    entity: 'GR No. IND-2024-44/P.K.12 (Industrial Policy)',
    referenceId: 'REG-DOC-2024-88',
    ip: '10.142.5.12',
    result: 'Success',
  },
];

const AUDIT_STORAGE_KEY = 'mahaudyam_admin_audit_tail';

class AdminConfigService {
  private auditTail: AdminAuditEntry[] = [];

  constructor() {
    this.loadAudit();
  }

  private loadAudit(): void {
    try {
      const saved = localStorage.getItem(AUDIT_STORAGE_KEY);
      if (saved) {
        this.auditTail = JSON.parse(saved);
      }
    } catch {
      this.auditTail = [];
    }
  }

  private persistAudit(): void {
    try {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(this.auditTail.slice(0, 20)));
    } catch {
      // ignore
    }
  }

  public getAuditLogs(): AdminAuditEntry[] {
    return [...this.auditTail, ...DEFAULT_AUDIT];
  }

  public recordAdminAction(
    action: string,
    entity: string,
    referenceId: string,
    actor: string = 'Admin User'
  ): AdminAuditEntry {
    const entry: AdminAuditEntry = {
      id: `aud-${Date.now()}`,
      timestamp: new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }),
      actor,
      action,
      actionCls: 'bg-blue-50 text-blue-700',
      entity,
      referenceId,
      ip: '10.142.6.84',
      result: 'Success',
    };
    this.auditTail.unshift(entry);
    this.persistAudit();
    return entry;
  }

  public exportRuleSchema(): string {
    return JSON.stringify(
      {
        ruleId: 'RUL-2024-IND-018',
        version: RULE_VERSION,
        exportedAt: new Date().toISOString(),
        prototypeNotice: 'MahaUdyam One prototype export — not persisted to production rule engine.',
        clearances: APPROVAL_CLEARANCE_ROWS,
      },
      null,
      2
    );
  }

  public exportAuditCsv(logs: AdminAuditEntry[]): string {
    const header = ['Timestamp', 'Admin / User', 'Action', 'Entity Modified', 'Reference ID', 'IP Address', 'Result'];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = logs.map((r) =>
      [r.timestamp, r.actor, r.action, r.entity, r.referenceId, r.ip, r.result].map(esc).join(',')
    );
    return [header.join(','), ...lines].join('\n');
  }
}

export const adminConfigService = new AdminConfigService();
