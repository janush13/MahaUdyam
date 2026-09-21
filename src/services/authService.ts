import { AuthUser, RegistrationPayload } from '../types';

const SESSION_STORAGE_KEY = 'mahaudyam_one_auth_session';
const PENDING_REG_KEY = 'mahaudyam_one_pending_reg';
const REGISTERED_USERS_KEY = 'mahaudyam_one_registered_users';

export const PROTOTYPE_OTP = '123456';

export const DEFAULT_PROTOTYPE_USER: AuthUser = {
  id: 'USR-MH-2026-08140',
  name: 'Priya Deshmukh',
  email: 'applicant@mahaudyam.in',
  mobile: '9823012345',
  entityName: 'Deshmukh Industries Pvt. Ltd.',
  role: 'APPLICANT',
  sessionStatus: 'ACTIVE',
  token: 'proto_token_usr_08140_applicant',
  createdAt: '2026-03-01T09:30:00Z',
  singleBusinessId: 'MH-SWS-2026-08140',
  kycStatus: 'VERIFIED',
  designation: 'Managing Director',
};

export const DEFAULT_PROTOTYPE_PASSWORD = 'Password@123';

// ── Prototype Officer ────────────────────────────────────────────────────────
export const DEFAULT_PROTOTYPE_OFFICER: AuthUser = {
  id: 'USR-MH-2026-OFF01',
  name: 'Rajesh Kulkarni',
  email: 'officer@mahaudyam.in',
  mobile: '9823099001',
  entityName: 'Single Window Cell — MPCB Pune',
  role: 'OFFICER',
  sessionStatus: 'ACTIVE',
  token: 'proto_token_usr_off01_officer',
  createdAt: '2026-01-01T08:00:00Z',
  designation: 'Deputy Director, Environment & Clearances',
};

export const DEFAULT_PROTOTYPE_OFFICER_PASSWORD = 'Officer@123';

// ── Prototype Inspector ──────────────────────────────────────────────────────
export const DEFAULT_PROTOTYPE_INSPECTOR: AuthUser = {
  id: 'USR-MH-2026-INS01',
  name: 'Sunita Patil',
  email: 'inspector@mahaudyam.in',
  mobile: '9823088001',
  entityName: 'Inspectorate Division — DISH Pune',
  role: 'INSPECTOR',
  sessionStatus: 'ACTIVE',
  token: 'proto_token_usr_ins01_inspector',
  createdAt: '2026-01-01T08:00:00Z',
  designation: 'Senior Inspector of Factories',
};

export const DEFAULT_PROTOTYPE_INSPECTOR_PASSWORD = 'Inspector@123';

// ── Prototype Administrator ─────────────────────────────────────────────────
// Prototype credentials: administrator@mahaudyam.in / Admin@123
export const DEFAULT_PROTOTYPE_ADMINISTRATOR: AuthUser = {
  id: 'USR-MH-2026-ADM01',
  name: 'Admin User',
  email: 'administrator@mahaudyam.in',
  mobile: '9823097001',
  entityName: 'Directorate of Industries — System Administration',
  role: 'ADMINISTRATOR',
  sessionStatus: 'ACTIVE',
  token: 'proto_token_usr_adm01_administrator',
  createdAt: '2026-01-01T08:00:00Z',
  designation: 'System Administrator (Govt. of Maharashtra)',
};

export const DEFAULT_PROTOTYPE_ADMINISTRATOR_PASSWORD = 'Admin@123';

// ── Prototype Leadership ────────────────────────────────────────────────────
// Prototype credentials: leadership@mahaudyam.in / Leadership@123
export const DEFAULT_PROTOTYPE_LEADERSHIP: AuthUser = {
  id: 'USR-MH-2026-LEAD01',
  name: 'A. Deshmukh',
  email: 'leadership@mahaudyam.in',
  mobile: '9823096001',
  entityName: 'Government of Maharashtra — State Apex Review',
  role: 'LEADERSHIP',
  sessionStatus: 'ACTIVE',
  token: 'proto_token_usr_lead01_leadership',
  createdAt: '2026-01-01T08:00:00Z',
  designation: 'Additional Chief Secretary',
};

export const DEFAULT_PROTOTYPE_LEADERSHIP_PASSWORD = 'Leadership@123';

class AuthService {
  private inMemorySession: AuthUser | null = null;
  private currentOtp: string = PROTOTYPE_OTP;
  private lastOtpSentAt: number = 0;

  constructor() {
    this.initFromStorage();
  }

  private initFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // If stored session is prototype applicant, ensure current attributes
          if (parsed.email === 'applicant@mahaudyam.in') {
            parsed.name = 'Priya Deshmukh';
            parsed.entityName = 'Deshmukh Industries Pvt. Ltd.';
            parsed.singleBusinessId = 'MH-SWS-2026-08140';
            parsed.kycStatus = 'VERIFIED';
            parsed.designation = 'Managing Director';
          }
          this.inMemorySession = parsed;
        }
      }
    } catch {
      this.inMemorySession = null;
    }
  }

  private getRegisteredUsers(): Array<{ user: AuthUser; pass: string }> {
    const prototypeStaff = [
      { user: DEFAULT_PROTOTYPE_OFFICER,   pass: DEFAULT_PROTOTYPE_OFFICER_PASSWORD },
      { user: DEFAULT_PROTOTYPE_INSPECTOR, pass: DEFAULT_PROTOTYPE_INSPECTOR_PASSWORD },
      { user: DEFAULT_PROTOTYPE_ADMINISTRATOR, pass: DEFAULT_PROTOTYPE_ADMINISTRATOR_PASSWORD },
      { user: DEFAULT_PROTOTYPE_LEADERSHIP, pass: DEFAULT_PROTOTYPE_LEADERSHIP_PASSWORD },
    ];
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(REGISTERED_USERS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            // A list saved before Phase 8A has no Officer/Inspector accounts. Keep every
            // stored account untouched and append any prototype staff account that is missing.
            const missingStaff = prototypeStaff.filter(
              (p) => !parsed.some((u: { user?: AuthUser }) => u.user?.email?.toLowerCase() === p.user.email.toLowerCase())
            );
            return [...parsed, ...missingStaff];
          }
        }
      }
    } catch {
      // ignore
    }
    return [
      { user: DEFAULT_PROTOTYPE_USER, pass: DEFAULT_PROTOTYPE_PASSWORD },
      ...prototypeStaff,
    ];
  }

  private saveRegisteredUsers(users: Array<{ user: AuthUser; pass: string }>): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(users));
      }
    } catch {
      // ignore
    }
  }

  public getSession(): AuthUser | null {
    return this.inMemorySession;
  }

  public saveSession(user: AuthUser, persist: boolean = true): void {
    this.inMemorySession = user;
    if (persist && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
      } catch {
        // ignore
      }
    }
  }

  public clearSession(): void {
    this.inMemorySession = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }

  public getPendingRegistration(): RegistrationPayload | null {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const stored = window.sessionStorage.getItem(PENDING_REG_KEY);
        if (stored) return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return null;
  }

  public setPendingRegistration(data: RegistrationPayload | null): void {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        if (data) {
          window.sessionStorage.setItem(PENDING_REG_KEY, JSON.stringify(data));
        } else {
          window.sessionStorage.removeItem(PENDING_REG_KEY);
        }
      }
    } catch {
      // ignore
    }
  }

  public async login(
    identifier: string,
    password: string,
    rememberMe: boolean = true
  ): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    // Simulate brief network latency
    await new Promise((r) => setTimeout(r, 450));

    const cleanId = identifier.trim().toLowerCase();
    const cleanMobile = identifier.replace(/\D/g, '');
    const users = this.getRegisteredUsers();

    const matched = users.find(
      (u) =>
        u.user.email.toLowerCase() === cleanId ||
        (cleanMobile.length === 10 && u.user.mobile === cleanMobile)
    );

    if (!matched) {
      return {
        success: false,
        error: 'No account registered with this email or mobile number. Please check credentials or register as a new enterprise.',
      };
    }

    if (matched.pass !== password) {
      return {
        success: false,
        error: 'Incorrect password. Please verify your password or use "Forgot Password?" to reset.',
      };
    }

    const sessionUser: AuthUser = {
      ...matched.user,
      sessionStatus: 'ACTIVE',
      token: `token_proto_${Date.now()}_${matched.user.id}`,
    };

    this.saveSession(sessionUser, rememberMe);
    return { success: true, user: sessionUser };
  }

  public sendOtp(mobile: string): { success: boolean; message: string; cooldown: number } {
    this.currentOtp = PROTOTYPE_OTP;
    this.lastOtpSentAt = Date.now();
    return {
      success: true,
      message: `Prototype OTP dispatched to +91 ${mobile}`,
      cooldown: 30,
    };
  }

  public getCurrentOtp(): string {
    return this.currentOtp;
  }

  public async verifyRegistrationOtp(
    otp: string,
    registrationData: RegistrationPayload
  ): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    await new Promise((r) => setTimeout(r, 450));

    const cleanOtp = otp.trim();
    if (cleanOtp !== this.currentOtp && cleanOtp !== PROTOTYPE_OTP) {
      return {
        success: false,
        error: 'Invalid 6-digit OTP entered. Please check your SMS or use prototype OTP (123456).',
      };
    }

    // Register user
    const newUser: AuthUser = {
      id: `USR-MH-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      name: registrationData.fullName,
      email: registrationData.email.toLowerCase(),
      mobile: registrationData.mobile.replace(/\D/g, ''),
      entityName: registrationData.entityName || 'Industrial Enterprise',
      role: 'APPLICANT',
      sessionStatus: 'ACTIVE',
      token: `proto_token_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    const users = this.getRegisteredUsers();
    // Replace if existing or append
    const updatedUsers = [
      ...users.filter((u) => u.user.mobile !== newUser.mobile && u.user.email !== newUser.email),
      { user: newUser, pass: registrationData.password || 'Password@123' },
    ];
    this.saveRegisteredUsers(updatedUsers);

    // Save session
    this.saveSession(newUser, true);
    this.setPendingRegistration(null);

    return {
      success: true,
      user: newUser,
    };
  }

  public async resetPassword(
    identifier: string,
    otp: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    await new Promise((r) => setTimeout(r, 450));

    if (otp !== PROTOTYPE_OTP && otp !== this.currentOtp) {
      return {
        success: false,
        error: 'Invalid OTP code. Please enter the prototype verification code: 123456',
      };
    }

    const cleanId = identifier.trim().toLowerCase();
    const cleanMobile = identifier.replace(/\D/g, '');
    const users = this.getRegisteredUsers();

    const matchedIndex = users.findIndex(
      (u) =>
        u.user.email.toLowerCase() === cleanId ||
        (cleanMobile.length === 10 && u.user.mobile === cleanMobile)
    );

    if (matchedIndex === -1) {
      return {
        success: false,
        error: 'No registered applicant account located with this identifier.',
      };
    }

    users[matchedIndex].pass = newPassword;
    this.saveRegisteredUsers(users);

    return { success: true };
  }
}

export const authService = new AuthService();
