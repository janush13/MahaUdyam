import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthUser, RegistrationPayload } from '../types';
import { authService, DEFAULT_PROTOTYPE_USER } from '../services/authService';

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (identifier: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string; user?: AuthUser }>;
  logout: () => void;
  pendingRegistration: RegistrationPayload | null;
  setPendingRegistration: (payload: RegistrationPayload | null) => void;
  sendOtp: (mobile: string) => { success: boolean; message: string; cooldown: number };
  verifyRegistrationOtp: (otp: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (identifier: string, otp: string, newPass: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ success: false }),
  logout: () => {},
  pendingRegistration: null,
  setPendingRegistration: () => {},
  sendOtp: () => ({ success: false, message: '', cooldown: 0 }),
  verifyRegistrationOtp: async () => ({ success: false }),
  resetPassword: async () => ({ success: false }),
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pendingRegistration, setPendingRegistrationState] = useState<RegistrationPayload | null>(null);

  useEffect(() => {
    const existing = authService.getSession();
    if (existing) {
      setUser(existing);
    }
    const pending = authService.getPendingRegistration();
    if (pending) {
      setPendingRegistrationState(pending);
    }
    setIsLoading(false);
  }, []);

  const login = async (identifier: string, password: string, rememberMe: boolean = true) => {
    setIsLoading(true);
    try {
      const res = await authService.login(identifier, password, rememberMe);
      if (res.success && res.user) {
        setUser(res.user);
        return { success: true, user: res.user };
      }
      return { success: false, error: res.error || 'Authentication failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    authService.clearSession();
    setUser(null);
  };

  const setPendingRegistration = (payload: RegistrationPayload | null) => {
    authService.setPendingRegistration(payload);
    setPendingRegistrationState(payload);
  };

  const sendOtp = (mobile: string) => {
    return authService.sendOtp(mobile);
  };

  const verifyRegistrationOtp = async (otp: string) => {
    if (!pendingRegistration) {
      return { success: false, error: 'Registration session expired. Please fill the registration form again.' };
    }
    setIsLoading(true);
    try {
      const res = await authService.verifyRegistrationOtp(otp, pendingRegistration);
      if (res.success && res.user) {
        setUser(res.user);
        setPendingRegistrationState(null);
        return { success: true };
      }
      return { success: false, error: res.error || 'Verification failed' };
    } finally {
      setIsLoading(false);
    }
  };

  const resetPassword = async (identifier: string, otp: string, newPass: string) => {
    setIsLoading(true);
    try {
      return await authService.resetPassword(identifier, otp, newPass);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user && user.sessionStatus === 'ACTIVE',
        isLoading,
        login,
        logout,
        pendingRegistration,
        setPendingRegistration,
        sendOtp,
        verifyRegistrationOtp,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
