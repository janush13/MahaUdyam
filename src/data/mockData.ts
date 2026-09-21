import { ApprovalItem, SchemeItem, NoticeItem, FaqItem, ContactTicket } from '../types';

export const MOCK_APPROVALS: ApprovalItem[] = [
  {
    id: 'cte-01',
    serviceCode: 'CTE-01',
    name: 'Consent to Establish (CTE)',
    department: 'Environment Department',
    subDepartment: 'MPCB (Maharashtra Pollution Control Board)',
    act: 'Water (Prevention & Control) Act 1974 & Air Act 1981',
    description: 'Required for establishing a new industrial unit under applicable environmental regulations and pollution control norms.',
    slaDays: 30,
    feeText: '₹10,000',
    feeAmount: 10000,
    mode: 'Online',
    applicability: 'Mandatory',
    stage: 'Pre-Establishment',
    category: 'Environment',
    location: 'All Maharashtra',
    requiredDocumentsCount: 5,
    prerequisites: 'Pre-requisite for Factory Licence & Civil Works',
    whyApplicable: 'Triggered by: Manufacturing Sector (Automobile Components) + Orange Category + Capital Investment > ₹10 Cr under Environment Protection Act & MPCB Guidelines.'
  },
  {
    id: 'bp-11',
    serviceCode: 'BP-11',
    name: 'Building Plan Approval & Sanction',
    department: 'Urban Development Department',
    subDepartment: 'MIDC Special Planning Authority (SPA)',
    act: 'MIDC Development Control & Promotion Regulations (DCPR)',
    description: 'Approval for industrial building construction, architectural safety, and site layout compliance across designated zones.',
    slaDays: 60,
    feeText: '₹15,000',
    feeAmount: 15000,
    mode: 'Online',
    applicability: 'Mandatory',
    stage: 'Pre-Establishment',
    category: 'Urban Development',
    location: 'MIDC Notified Industrial Areas',
    requiredDocumentsCount: 7,
    prerequisites: 'Requires Fire NOC & Land Possession Receipt',
    whyApplicable: 'Triggered by: Proposed greenfield unit construction on MIDC allotted plot in Chakan Phase II, Pune.'
  },
  {
    id: 'fl-06',
    serviceCode: 'FL-06',
    name: 'Factory Licence & Plan Sanction',
    department: 'Labour Department',
    subDepartment: 'DISH (Directorate of Industrial Safety & Health)',
    act: 'Section 6, The Factories Act 1948 & Maharashtra Rules',
    description: 'Registration and grant of factory operational licence under the provisions of the Factories Act, 1948.',
    slaDays: 45,
    feeText: '₹5,000',
    feeAmount: 5000,
    mode: 'Online',
    applicability: 'Mandatory',
    stage: 'Pre-Operation',
    category: 'Labour',
    location: 'All Maharashtra',
    requiredDocumentsCount: 8,
    prerequisites: 'Requires Consent to Establish & Layout Drawings',
    whyApplicable: 'Triggered by: Planned direct employment of 150 workers (>10 workers with power) under Section 2(m)(i) of Factories Act 1948.'
  },
  {
    id: 'noc-04',
    serviceCode: 'NOC-04',
    name: 'Fire Safety Provisional NOC',
    department: 'Fire Services Department',
    subDepartment: 'MIDC Fire Prevention Division, Pune',
    act: 'Maharashtra Fire Prevention & Life Safety Measures Act 2006',
    description: 'Mandatory for commercial and industrial buildings to ensure comprehensive fire prevention and emergency escape norms.',
    slaDays: 21,
    feeText: '₹2,000',
    feeAmount: 2000,
    mode: 'Online',
    applicability: 'Mandatory',
    stage: 'Pre-Establishment',
    category: 'Fire Services',
    location: 'All Maharashtra',
    requiredDocumentsCount: 6,
    prerequisites: 'Pre-requisite for Building Plan Sanction',
    whyApplicable: 'Triggered by: Industrial plot built-up area exceeding 1,000 sq.m (Planned: 45,000 sq.ft. / ~4,180 sq.m) with hazardous processing components.'
  },
  {
    id: 'ht-09',
    serviceCode: 'HT-09',
    name: 'High Tension (HT) Power Connection',
    department: 'Energy / MSEDCL',
    subDepartment: 'Maharashtra State Electricity Distribution Co. Ltd.',
    act: 'Maharashtra Electricity Regulatory Commission (MERC) Code',
    description: 'Clearance and sanction for industrial power load, substation feasibility, and high-tension electrical infrastructure.',
    slaDays: 30,
    feeText: 'Variable',
    mode: 'Online',
    applicability: 'Conditional',
    stage: 'Pre-Establishment',
    category: 'Energy',
    location: 'All Maharashtra',
    requiredDocumentsCount: 4,
    prerequisites: 'Load feasibility subject to Substation clearances',
    whyApplicable: 'Triggered by: High-Tension (HT 11kV/22kV) power requirement (>100 kVA connected load specified: 450 kVA) in project discovery parameters.'
  },
  {
    id: 'bw-02',
    serviceCode: 'BW-02',
    name: 'Water Connection Clearance',
    department: 'MIDC / Industrial Dev.',
    subDepartment: 'Municipal / MIDC Executive Engineer',
    act: 'Maharashtra Industrial Development Act 1961',
    description: 'Water supply quota allocation, pipeline hookup permission, and infrastructure sanction for industrial setups.',
    slaDays: 30,
    feeText: 'Variable',
    mode: 'Online',
    applicability: 'Conditional',
    stage: 'Pre-Establishment',
    category: 'Water',
    location: 'MIDC Notified Industrial Areas',
    requiredDocumentsCount: 4,
    prerequisites: 'Pipeline alignment and branch tapping verification',
    whyApplicable: 'Triggered by: Bulk industrial water demand exceeding local threshold (>50,000 Litres/Day planned requirement).'
  }
];

export const MOCK_SCHEMES: SchemeItem[] = [
  {
    id: 'msme-competitiveness',
    code: 'SCH-IND-01',
    title: 'MSME Competitiveness Scheme',
    department: 'Industries Department',
    shortDept: 'INDUSTRIES DEPARTMENT',
    description: 'Financial assistance for technology upgradation, quality improvement and enhancement of productivity for MSME units in Maharashtra.',
    schemeType: 'Subsidy',
    beneficiary: 'MSME',
    scope: 'State Scheme',
    status: 'Open',
    highlights: [
      'Financial assistance for eligible MSME units',
      'Support for technology upgradation and plant modernization',
      'Applicable across notified manufacturing and service sectors',
      'Subsidies credited directly through transparent DBT mechanism',
      'To be implemented as per government guidelines and operational procedures'
    ],
    importantDates: {
      startDate: 'To be announced',
      endDate: 'To be announced'
    },
    benefitTypeDescription: 'Capital Subsidy'
  },
  {
    id: 'land-allotment',
    code: 'SCH-MIDC-02',
    title: 'Industrial Land Allotment Scheme',
    department: 'MIDC',
    shortDept: 'MIDC',
    description: 'Allotment of industrial plots in notified industrial areas with fast-track processing, single-window clearances and developed infrastructure support.',
    schemeType: 'Land Support',
    beneficiary: 'All Industries',
    scope: 'State Scheme',
    status: 'Open',
    highlights: [
      'Priority allotment in emerging industrial corridors',
      'Subsidized lease rates in developing zones (Zone C, D, D+)',
      'Direct pipeline, power substation and road infrastructure included'
    ]
  },
  {
    id: 'electricity-exemption',
    code: 'SCH-ENG-03',
    title: 'Electricity Duty Exemption',
    department: 'Energy Department',
    shortDept: 'ENERGY DEPARTMENT',
    description: 'Exemption from electricity duty for eligible new and expanding industrial undertakings in designated backward and developing development zones.',
    schemeType: 'Tax Benefit',
    beneficiary: 'Manufacturing',
    scope: 'State Scheme',
    status: 'Open',
    highlights: [
      '100% electricity duty waiver up to 7-10 years under PSI 2019',
      'Applicable for HT/LT connections in Zone B, C, D areas',
      'Automated digital NOC and tariff adjustment'
    ]
  },
  {
    id: 'skill-development',
    code: 'SCH-SKL-04',
    title: 'Skill Development Assistance',
    department: 'Skill Development Department',
    shortDept: 'SKILL DEVELOPMENT DEPARTMENT',
    description: 'Support for industrial training institutes and enterprise-led skill development programs aligned with sector priorities and modern apprenticeship mandates.',
    schemeType: 'Capacity Building',
    beneficiary: 'All Industries',
    scope: 'State Scheme',
    status: 'Open',
    highlights: [
      'Per-trainee training grant up to ₹15,000 for approved programs',
      'National Apprenticeship Promotion Scheme (NAPS) co-funding',
      'Priority support for precision engineering and green manufacturing'
    ]
  },
  {
    id: 'interest-subvention',
    code: 'SCH-EXP-05',
    title: 'Interest Subvention Scheme for Exporters',
    department: 'Industries Department',
    shortDept: 'INDUSTRIES DEPARTMENT',
    description: 'Interest subsidy on working capital and pre-shipment/post-shipment export credit for eligible export manufacturers operating within Maharashtra.',
    schemeType: 'Interest Subsidy',
    beneficiary: 'Export Units',
    scope: 'State Scheme',
    status: 'Open',
    highlights: [
      'Up to 5% interest subvention on term loan and export credit',
      'Maximum subsidy ceiling of ₹50 Lakhs per annum per unit',
      'Valid for units with verified GST and IEC registration'
    ]
  },
  {
    id: 'green-energy',
    code: 'SCH-GRN-06',
    title: 'Green Energy Incentive Package',
    department: 'Environment & Energy',
    shortDept: 'ENVIRONMENT & ENERGY',
    description: 'Capital grants and concession rates for adopting rooftop solar, effluent recycling, energy-efficient machinery, and zero-discharge industrial systems.',
    schemeType: 'Green Subsidy',
    beneficiary: 'Manufacturing',
    scope: 'State Scheme',
    status: 'Open',
    highlights: [
      'Up to 25% capital grant on Zero Liquid Discharge (ZLD) plant',
      'Net-metering concession for captive solar rooftop power installations',
      'Carbon audit reimbursement up to ₹2 Lakhs'
    ]
  }
];

export const MOCK_NOTICES: NoticeItem[] = [
  {
    id: '1',
    refNo: 'ENV/2024/CR-104/T-1',
    date: '12 Sep 2024',
    title: 'New environmental clearance guidelines notified',
    department: 'Environment Department',
    category: 'Notification',
    pdfSize: '1.8 MB',
    effectiveDate: '15 September 2024',
    summary: 'Official gazette notification revising statutory procedural checklists and scrutiny timelines for Consent to Establish (CTE) and Consent to Operate (CTO) within notified industrial clusters across Maharashtra.',
    relatedActs: [
      'Maharashtra Pollution Control Board (MPCB) Portal Guidelines',
      'Water (Prevention and Control of Pollution) Act, 1974 - Section 25',
      'Air (Prevention and Control of Pollution) Act, 1981 - Section 21'
    ]
  },
  {
    id: '2',
    refNo: 'IND/MSME/2024/SEC-4B',
    date: '08 Sep 2024',
    title: 'MSME infrastructure scheme applications open',
    department: 'Industries Department',
    category: 'Circular',
    pdfSize: '950 KB',
    effectiveDate: '08 September 2024',
    summary: 'Call for expressions of interest for industrial cluster common effluent treatment plants, shared tool rooms, and power infrastructure subsidies under the Maharashtra State Industrial Scheme.',
    relatedActs: [
      'Maharashtra Industrial Policy 2019',
      'Package Scheme of Incentives (PSI) Guidelines'
    ]
  },
  {
    id: '3',
    refNo: 'EODB/GAD/2024/082',
    date: '01 Sep 2024',
    title: 'Integration with additional departments',
    department: 'General Administration Department (IT)',
    category: 'Update',
    pdfSize: '1.2 MB',
    effectiveDate: '01 September 2024',
    summary: 'Notice regarding single sign-on API handshake integration for 5 new municipal corporations and district collectorate land records with MahaUdyam One Single Window.',
    relatedActs: ['Maharashtra Right to Public Services Act 2015']
  },
  {
    id: '4',
    refNo: 'UDD/BP/2024/REG-19',
    date: '25 Aug 2024',
    title: 'Revised checklist for building plan approval',
    department: 'Urban Development Department',
    category: 'Guideline',
    pdfSize: '2.4 MB',
    effectiveDate: '01 September 2024',
    summary: 'Standardized scrutiny checklist for factory structural stability, fire hydrant placement, and green buffer clearances for layouts above 5 acres.',
    relatedActs: ['MIDC Development Control and Promotion Regulations (DCPR)']
  },
  {
    id: '5',
    refNo: 'DIR/INSP/2024/SOP-03',
    date: '18 Aug 2024',
    title: 'Standard operating procedure for joint site inspections',
    department: 'Directorate of Industries',
    category: 'Order',
    pdfSize: '3.1 MB',
    effectiveDate: '20 August 2024',
    summary: 'Mandating randomized computerized allocation of joint inspectors and mandatory 48-hour digital report upload for all manufacturing premises inspections.',
    relatedActs: [
      'Maharashtra Right to Public Services Act, 2015 - Section 10',
      'Central Inspection System (CIS) Framework'
    ]
  },
  {
    id: '6',
    refNo: 'ENG/PSI/2024/NOT-12',
    date: '10 Aug 2024',
    title: 'Exemption notification for electricity duty under Package Scheme of Incentives',
    department: 'Energy Department',
    category: 'Notification',
    pdfSize: '1.5 MB',
    effectiveDate: '15 August 2024',
    summary: 'Fiscal incentive guidelines for eligible mega and ultra-mega industrial projects detailing procedural claim mechanism for 100% electricity duty reimbursement.',
    relatedActs: [
      'Maharashtra Electricity Duty Act 2016',
      'State Industrial Promotion Policy 2019-2024'
    ]
  }
];

export const MOCK_FAQS: FaqItem[] = [
  {
    id: 'faq-1',
    category: 'General Overview',
    question: 'What is MahaUdyam One?',
    answer: 'MahaUdyam One is the Government of Maharashtra\'s integrated single window digital platform. It acts as an orchestration and applicant-experience layer enabling seamless, time-bound access to all industrial approvals, departmental clearances, government fiscal schemes, and statutory regulatory compliance.\n\nStatutory approvals and decisions continue to be executed by authorised government departments according to applicable state and national rules.'
  },
  {
    id: 'faq-2',
    category: 'General Overview',
    question: 'Who can use this portal?',
    answer: 'Any citizen, entrepreneur, MSME unit holder, large industrial investor, corporate entity, or foreign direct investor intending to establish, expand, or operate an industrial, commercial, or manufacturing enterprise within Maharashtra can register and utilize this platform.'
  },
  {
    id: 'faq-3',
    category: 'Registration & Login',
    question: 'How do I register on MahaUdyam One?',
    answer: 'Click the \'Login / Register\' button at the top header, enter your mobile number and PAN/Aadhaar credentials, verify the 6-digit one-time password (OTP), and complete your basic enterprise profile to activate your unified dashboard.'
  },
  {
    id: 'faq-4',
    category: 'Registration & Login',
    question: 'What documents are required for registration?',
    answer: 'Primary requirements include: (1) Enterprise PAN, (2) Authorized Signatory Aadhaar or PAN, (3) Certificate of Incorporation or Partnership deed (if registered entity), and (4) Valid mobile number & operational email address for OTP verification.'
  },
  {
    id: 'faq-5',
    category: 'Approvals & Applications',
    question: 'How do I track my application status?',
    answer: 'Once logged into your dashboard, select \'Applications\' to review real-time stage tracking with defined Service Level Agreement (SLA) indicators: Draft, Submitted, Under Scrutiny, Query Raised, Inspection Scheduled, Approved, or Rejected.'
  },
  {
    id: 'faq-6',
    category: 'Schemes & Incentives',
    question: 'How do I apply for a government scheme?',
    answer: 'Navigate to the \'Government Schemes\' section, filter by department or incentive type (e.g., Electricity Duty Exemption, Interest Subsidy, MSME Competitiveness Scheme), check eligibility parameters, and click \'Apply Scheme\'.'
  },
  {
    id: 'faq-7',
    category: 'General Overview',
    question: 'Where can I get help if I face an issue?',
    answer: 'You can contact the centralized toll-free support helpline at 1800 233 4567 (Mon–Sat, 9:00 AM – 6:00 PM), raise a digital support ticket via the portal, or email support@mahaudyam.gov.in.'
  },
  {
    id: 'faq-8',
    category: 'General Overview',
    question: 'Is there a fee for using this portal?',
    answer: 'No. MahaUdyam One is a free, publicly provided government single-window facilitation portal. Users are only required to remit the mandatory statutory department processing fees mandated by applicable legislative acts and rules directly via the integrated payment gateway.'
  }
];

export const MOCK_TICKETS: ContactTicket[] = [
  {
    id: 'MUO/TKT/2024/00892',
    category: 'Technical / OTP Issue',
    status: 'Resolved',
    lastUpdated: '10 Sep 2024, 14:20'
  },
  {
    id: 'MUO/TKT/2024/01045',
    category: 'Fee Challan Verification',
    status: 'In Progress',
    lastUpdated: '12 Sep 2024, 11:15'
  },
  {
    id: 'MUO/TKT/2024/01128',
    category: 'Scheme Eligibility Query',
    status: 'Under Review',
    lastUpdated: 'Today, 09:30'
  }
];
