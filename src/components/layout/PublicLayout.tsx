import React, { ReactNode } from 'react';
import { AccessibilityStrip } from './AccessibilityStrip';
import { MainHeader } from './MainHeader';
import { PrimaryNavigation } from './PrimaryNavigation';
import { Footer } from './Footer';

interface PublicLayoutProps {
  children: ReactNode;
}

export const PublicLayout: React.FC<PublicLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col font-sans bg-[#f8fafc] text-slate-800">
      {/* 1. Accessibility Utility Bar */}
      <AccessibilityStrip />

      {/* 2. Official Emblem Header with Auth State */}
      <MainHeader />

      {/* 3. Primary Navy Navigation Bar */}
      <PrimaryNavigation />

      {/* 4. Page Main Content */}
      <main id="main-content" className="flex-1">
        {children}
      </main>

      {/* 5. Institutional Footer */}
      <Footer />
    </div>
  );
};

