export interface LeadershipKpi {
  label: string;
  value: string;
  badge: string;
  detail: string;
  tone: 'neutral' | 'blue' | 'green' | 'red';
}

export interface DepartmentPerformance {
  name: string;
  shortName: string;
  applications: number;
  approved: number;
  rejected: number;
  turnaroundDays: number;
  slaCompliance: number;
  tone: 'blue' | 'amber' | 'green';
}

export interface BottleneckStage {
  label: string;
  value: string;
  width: number;
  tone: 'red' | 'amber' | 'blue' | 'green';
  overdue?: boolean;
}

export const LEADERSHIP_PERIODS = ['Jan 2024 – Dec 2024', 'Q3 (Oct-Dec 2024)', 'Previous Fiscal (2023-24)'];
export const LEADERSHIP_DISTRICTS = ['All Districts (36)', 'Pune', 'Mumbai Suburban', 'Thane', 'Nagpur', 'Chhatrapati Sambhajinagar'];
export const LEADERSHIP_SECTORS = ['All Industry Sectors', 'Automobile & Auto Ancillary', 'Chemicals & Petrochemicals', 'IT & ITES', 'Textiles & Apparel'];

export const LEADERSHIP_KPIS: LeadershipKpi[] = [
  { label: 'Total Applications', value: '12,480', badge: '+14.2% YoY', detail: 'Across 42 clearances', tone: 'neutral' },
  { label: 'Under Scrutiny', value: '2,140', badge: '17.1% Active', detail: 'Desk & Joint inspection', tone: 'blue' },
  { label: 'Clearances Granted', value: '9,642', badge: '77.2% Grant', detail: 'Digital certificates issued', tone: 'green' },
  { label: 'Rejected / Returned', value: '698', badge: '5.6% Rate', detail: 'Statutory non-compliance', tone: 'red' },
  { label: 'Avg. Turnaround', value: '18.4 Days', badge: 'Target: 21d', detail: 'Reduced by 7.6 days', tone: 'neutral' },
  { label: 'RTS SLA Compliance', value: '94.8%', badge: 'Mandated', detail: 'Within notified timelines', tone: 'green' },
];

export const DEPARTMENT_PERFORMANCE: DepartmentPerformance[] = [
  { name: 'Industries Department (DoI)', shortName: 'Industries', applications: 1240, approved: 892, rejected: 126, turnaroundDays: 18, slaCompliance: 78, tone: 'blue' },
  { name: 'Environment Department (MPCB)', shortName: 'Environment (MPCB)', applications: 980, approved: 640, rejected: 210, turnaroundDays: 25, slaCompliance: 65, tone: 'amber' },
  { name: 'Labour Department (DISH)', shortName: 'Labour (DISH)', applications: 620, approved: 480, rejected: 60, turnaroundDays: 15, slaCompliance: 82, tone: 'blue' },
  { name: 'Urban Development (MIDC SPA)', shortName: 'Urban Dev (MIDC)', applications: 540, approved: 320, rejected: 140, turnaroundDays: 28, slaCompliance: 60, tone: 'amber' },
  { name: 'Fire Services (Directorate of MFS)', shortName: 'Fire Services', applications: 430, approved: 312, rejected: 90, turnaroundDays: 12, slaCompliance: 88, tone: 'green' },
  { name: 'Energy Department (MSEDCL)', shortName: 'Energy (MSEDCL)', applications: 380, approved: 276, rejected: 74, turnaroundDays: 20, slaCompliance: 75, tone: 'green' },
];

export const BOTTLENECK_STAGES: BottleneckStage[] = [
  { label: 'Application Scrutiny Stage', value: '18 Days (Overdue +4d)', width: 85, tone: 'red', overdue: true },
  { label: 'Joint Inspection Scheduling', value: '12 Days', width: 55, tone: 'amber' },
  { label: 'Inspection Report Upload (GIS Tagged)', value: '10 Days', width: 45, tone: 'blue' },
  { label: 'Competent Authority Decision', value: '8 Days', width: 35, tone: 'blue' },
  { label: 'Digital Certificate / NOC Issuance', value: '5 Days', width: 22, tone: 'green' },
];

export const leadershipAnalyticsService = {
  getKpis: (): LeadershipKpi[] => LEADERSHIP_KPIS.map((kpi) => ({ ...kpi })),
  getDepartments: (): DepartmentPerformance[] => DEPARTMENT_PERFORMANCE.map((row) => ({ ...row })),
  getBottlenecks: (): BottleneckStage[] => BOTTLENECK_STAGES.map((stage) => ({ ...stage })),
};
