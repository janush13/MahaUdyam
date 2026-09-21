import React, { useState } from 'react';

export const AccessibilityStrip: React.FC = () => {
  const [fontSize, setFontSize] = useState<'normal' | 'small' | 'large'>('normal');
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [language, setLanguage] = useState<'en' | 'mr'>('en');

  const handleFontSize = (size: 'small' | 'normal' | 'large') => {
    setFontSize(size);
    const root = document.documentElement;
    if (size === 'small') {
      root.style.fontSize = '14px';
    } else if (size === 'large') {
      root.style.fontSize = '18px';
    } else {
      root.style.fontSize = '16px';
    }
  };

  const toggleContrast = () => {
    setIsHighContrast(!isHighContrast);
    if (!isHighContrast) {
      document.body.classList.add('contrast-125');
    } else {
      document.body.classList.remove('contrast-125');
    }
  };

  return (
    <aside aria-label="Accessibility and Language Bar" className="bg-slate-100 border-b border-slate-200 text-xs text-slate-600 select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-8 flex items-center justify-between">
        {/* Left Accessibility Links */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          <a
            href="#main-content"
            className="hover:text-slate-900 transition-colors font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-600"
          >
            Skip to main content
          </a>
          <span className="text-slate-300" aria-hidden="true">|</span>
          <button
            type="button"
            onClick={() => alert('Screen Reader Optimization Active (ARIA-compliant semantic structure).')}
            className="hover:text-slate-900 transition-colors text-slate-600 hidden sm:inline"
          >
            Screen Reader Access
          </button>
        </div>

        {/* Right Accessibility & Language Controls */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          {/* Text Size Controls */}
          <div aria-label="Text Size Controls" className="flex items-center space-x-1.5 border border-slate-300 rounded bg-white px-1.5 py-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => handleFontSize('small')}
              className={`px-1 text-[11px] font-bold hover:text-blue-700 ${fontSize === 'small' ? 'text-blue-700 underline' : 'text-slate-700'}`}
              title="Decrease Font Size (A-)"
            >
              A-
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => handleFontSize('normal')}
              className={`px-1 text-xs font-bold hover:text-blue-700 ${fontSize === 'normal' ? 'text-blue-700 underline' : 'text-slate-700'}`}
              title="Normal Font Size (A)"
            >
              A
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => handleFontSize('large')}
              className={`px-1 text-xs font-bold hover:text-blue-700 ${fontSize === 'large' ? 'text-blue-700 underline' : 'text-slate-700'}`}
              title="Increase Font Size (A+)"
            >
              A+
            </button>
          </div>

          <span className="text-slate-300" aria-hidden="true">|</span>

          {/* High Contrast Toggle */}
          <button
            type="button"
            onClick={toggleContrast}
            className={`flex items-center gap-1 border border-slate-300 rounded px-2 py-0.5 text-[11px] font-medium transition ${isHighContrast ? 'bg-slate-900 text-amber-400 border-slate-900' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            title="Toggle High Contrast Mode"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-slate-900 border border-amber-400 inline-block"></span>
            <span className="hidden sm:inline">Contrast</span>
          </button>

          <span className="text-slate-300" aria-hidden="true">|</span>

          {/* Language Selector */}
          <div className="relative inline-flex items-center">
            <select
              aria-label="Select Portal Language"
              value={language}
              onChange={(e) => {
                const val = e.target.value as 'en' | 'mr';
                setLanguage(val);
                if (val === 'mr') {
                  alert('मराठी भाषांतर मोड: मुख्य मजकूर देवनागरी भाषेत लोड होत आहे.');
                }
              }}
              className="text-xs bg-white border border-slate-300 rounded px-2 py-0.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer"
            >
              <option value="en">English</option>
              <option value="mr">मराठी (Marathi)</option>
            </select>
          </div>
        </div>
      </div>
    </aside>
  );
};
