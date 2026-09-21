import React, { useState } from 'react';
import { documentVaultService } from '../../services/documentVaultService';
import { DigiLockerSyncState } from '../../types/documentVault';

interface DigiLockerBannerProps {
  digiLockerState: DigiLockerSyncState;
  onSyncComplete: () => void;
}

export const DigiLockerBanner: React.FC<DigiLockerBannerProps> = ({
  digiLockerState,
  onSyncComplete,
}) => {
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const handleSync = () => {
    setIsSyncing(true);
    setSyncFeedback(null);

    setTimeout(() => {
      const res = documentVaultService.syncDigiLocker();
      setIsSyncing(false);
      setSyncFeedback(res.message);
      onSyncComplete();

      setTimeout(() => {
        setSyncFeedback(null);
      }, 4000);
    }, 1200);
  };

  return (
    <div className="bg-gradient-to-r from-[#0b2440] via-[#0f2b48] to-[#153e66] text-white rounded-2xl p-5 sm:p-6 shadow-md border border-blue-900/50 relative overflow-hidden">
      {/* Decorative background geometry */}
      <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-white/5 to-transparent pointer-events-none" />
      <div className="absolute -right-8 -bottom-8 w-40 h-40 rounded-full bg-blue-500/10 pointer-events-none blur-xl" />

      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        {/* Left Side: National DigiLocker Linkage Branding */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              DigiLocker Linked &amp; Verified
            </span>
            <span className="text-slate-400 text-xs hidden sm:inline">•</span>
            <span className="text-[11px] text-blue-200">
              {digiLockerState.issuerAgency}
            </span>
          </div>

          <h2 className="text-lg sm:text-xl font-bold font-serif tracking-tight text-white flex items-center gap-2">
            <span>🏛️</span> Statutory Document Vault (DigiLocker Integrated)
          </h2>

          <p className="text-xs text-blue-100/85 max-w-2xl leading-relaxed">
            Statutory credentials authenticated via National e-Governance Division (NeGD) gateway. Reusable across clearances under the Maharashtra Single Window clearance architecture without paper attestation.
          </p>

          {/* Sync Feedback Toast */}
          {syncFeedback && (
            <div className="mt-2 p-2.5 rounded-xl bg-emerald-900/60 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2 animate-in fade-in duration-200">
              <span>✓</span>
              <span>{syncFeedback}</span>
            </div>
          )}
        </div>

        {/* Right Side: Credential Badges & Sync Action */}
        <div className="flex flex-col sm:flex-row lg:flex-col sm:items-center lg:items-end justify-between gap-3 shrink-0">
          <div className="grid grid-cols-2 gap-2 text-[11px] w-full sm:w-auto">
            <div className="bg-white/10 px-3 py-2 rounded-xl border border-white/10">
              <span className="text-blue-300 block text-[10px]">Aadhaar e-KYC</span>
              <span className="font-mono font-bold text-white text-[11px]">
                {digiLockerState.linkedAadhaarMasked}
              </span>
            </div>
            <div className="bg-white/10 px-3 py-2 rounded-xl border border-white/10">
              <span className="text-blue-300 block text-[10px]">Corporate PAN</span>
              <span className="font-mono font-bold text-white text-[11px]">
                {digiLockerState.linkedPan}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="text-right hidden sm:block">
              <span className="text-[10px] text-blue-300 block">Last Synced:</span>
              <span className="text-[10.5px] font-mono text-slate-200 font-medium">
                {digiLockerState.lastSyncedAt}
              </span>
            </div>

            <button
              type="button"
              onClick={handleSync}
              disabled={isSyncing}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm w-full sm:w-auto ${
                isSyncing
                  ? 'bg-blue-400/30 text-blue-200 cursor-not-allowed'
                  : 'bg-[#f58220] hover:bg-[#e07210] text-white'
              }`}
            >
              {isSyncing ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Syncing Gateway...</span>
                </>
              ) : (
                <>
                  <span>🔄 Sync with DigiLocker</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Institutional Prototype Safeguard Note */}
      <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between text-[10.5px] text-blue-200/70 gap-2">
        <span>
          Prototype Demonstration: Emulates secure DigiLocker pull. No production UIDAI/DigiLocker token handshake executed.
        </span>
        <span className="font-semibold text-blue-300">
          ✓ Certified 256-bit SHA-2 Cryptographic Ledger
        </span>
      </div>
    </div>
  );
};
