import React, { useState } from 'react';
import { Link } from '../router/Router';
import { MOCK_TICKETS } from '../data/mockData';
import { ContactTicket } from '../types';

export const ContactPage: React.FC = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    mobile: '',
    category: 'General Enquiry',
    subject: '',
    message: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submittedTicket, setSubmittedTicket] = useState<string | null>(null);
  const [ticketsList, setTicketsList] = useState<ContactTicket[]>(MOCK_TICKETS);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.fullName.trim()) errs.fullName = 'Full name is required';
    if (!formData.email.trim()) {
      errs.email = 'Email address is required';
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email)) {
      errs.email = 'Please provide a valid email address';
    }
    if (!formData.mobile.trim()) {
      errs.mobile = 'Mobile number is required';
    } else if (!/^[6-9]\d{9}$/.test(formData.mobile.replace(/\D/g, ''))) {
      errs.mobile = 'Enter a valid 10-digit Indian mobile number';
    }
    if (!formData.subject.trim()) errs.subject = 'Subject is required';
    if (!formData.message.trim() || formData.message.length < 15) {
      errs.message = 'Please describe your query in at least 15 characters';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const ticketId = `MUO/TKT/2026/${Math.floor(10000 + Math.random() * 90000)}`;
    setSubmittedTicket(ticketId);

    // Add to ticket list
    const newTicket: ContactTicket = {
      id: ticketId,
      category: formData.category,
      status: 'Under Review',
      lastUpdated: 'Just now',
    };
    setTicketsList([newTicket, ...ticketsList]);
  };

  const handleResetForm = () => {
    setFormData({
      fullName: '',
      email: '',
      mobile: '',
      category: 'General Enquiry',
      subject: '',
      message: '',
    });
    setErrors({});
    setSubmittedTicket(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-purpose="contact-screen">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs text-slate-500 mb-4">
        <Link to="/" className="hover:text-[#0f2b48] transition-colors">Home</Link>
        <span className="text-slate-400">›</span>
        <span aria-current="page" className="text-slate-800 font-medium">Contact &amp; Support</span>
      </nav>

      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 mb-6 shadow-2xs">
        <h1 className="text-2xl font-bold text-[#0f2b48] tracking-tight font-serif">
          Contact &amp; Investor Helpdesk
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Reach out to the Directorate of Industries, District Facilitation Cells, or submit a formal support inquiry
        </p>
      </div>

      {/* Two Column Layout: Left Details (7 cols), Right Form (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): Categories & Official Contacts */}
        <div className="lg:col-span-7 space-y-6">
          {/* 4 Helpdesk Categories */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-3">
              Helpdesk Specialized Divisions
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 mb-1">
                  <span className="text-blue-600">💬</span>
                  <span>General Enquiries</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Single Window registration, user profile, DIC contacts, and system navigation.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 mb-1">
                  <span className="text-emerald-600">📋</span>
                  <span>Application Support</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Assistance with CTE/CTO filings, building sanctions, and fee challan receipts.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 mb-1">
                  <span className="text-amber-600">💰</span>
                  <span>Financial &amp; Schemes</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Incentive claim verification, DBT bank accounts, and CA investment certificates.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 mb-1">
                  <span className="text-rose-600">⚖️</span>
                  <span>Grievance &amp; Escalation</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-tight">
                  RTS Act SLA delay escalations and first appellate authority representation.
                </p>
              </div>
            </div>
          </div>

          {/* Official Department Directory Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-4">
            <h3 className="text-xs font-bold text-[#0f2b48] uppercase tracking-wider pb-2 border-b border-slate-100">
              State Nodal Authority Details
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block mb-0.5">Physical Address</span>
                <p className="text-slate-800 font-medium leading-snug">
                  Directorate of Industries<br />
                  2nd Floor, New Administrative Building,<br />
                  Madam Cama Road, Opp. Mantralaya,<br />
                  Mumbai - 400 032, Maharashtra.
                </p>
              </div>

              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block mb-0.5">Telephony &amp; Email</span>
                <p className="text-slate-800 leading-relaxed font-mono">
                  Toll-Free: <strong>1800 233 4567</strong><br />
                  Direct: +91 22 2202 8604<br />
                  Email: <span className="text-blue-700 font-sans">support@mahaudyam.gov.in</span>
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 flex justify-between items-center">
              <span>Working Hours: <strong>09:00 AM – 06:00 PM</strong> (Mon–Fri)</span>
              <span className="text-emerald-700 font-semibold">● Central Dispatch Active</span>
            </div>
          </div>

          {/* Recent Support Tickets Tracker */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Recent Inquiries &amp; Status Logs
              </h3>
              <span className="text-[10px] text-slate-400">Deterministic Demonstration Logs</span>
            </div>

            <div className="space-y-2">
              {ticketsList.map((ticket) => (
                <div
                  key={ticket.id}
                  className="flex items-center justify-between p-2.5 rounded bg-slate-50 border border-slate-200 text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-slate-800 block text-[11px]">{ticket.id}</span>
                    <span className="text-[11px] text-slate-500">{ticket.category}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      ticket.status === 'Resolved'
                        ? 'bg-emerald-100 text-emerald-800'
                        : ticket.status === 'In Progress'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {ticket.status}
                    </span>
                    <span className="block text-[10px] text-slate-400 mt-0.5">{ticket.lastUpdated}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): "Send us a Message" Form */}
        <div className="lg:col-span-5">
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs" data-purpose="contact-form-container">
            <h2 className="text-sm font-bold text-[#0f2b48] pb-2 border-b border-slate-100 mb-4">
              Send us a Message
            </h2>

            {submittedTicket ? (
              <div className="py-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto text-xl font-bold">
                  ✓
                </div>
                <h3 className="text-sm font-bold text-slate-900">Inquiry Logged Successfully!</h3>
                <p className="text-xs text-slate-600 leading-relaxed max-w-xs mx-auto">
                  Your ticket has been recorded with reference number:
                </p>
                <div className="font-mono text-sm font-bold bg-slate-100 text-blue-800 py-1.5 px-3 rounded inline-block border border-slate-300">
                  {submittedTicket}
                </div>
                <p className="text-[11px] text-slate-500 pt-1">
                  Our investor support officer will review and update this ticket within 2 business days.
                </p>
                <div className="pt-3">
                  <button
                    type="button"
                    onClick={handleResetForm}
                    className="px-4 py-2 bg-[#0f2b48] text-white text-xs font-semibold rounded hover:bg-slate-800 transition"
                  >
                    Submit Another Inquiry
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Full Name <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="e.g. Ramesh Kulkarni"
                    className={`w-full bg-slate-50 border rounded px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-1 ${
                      errors.fullName ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 focus:ring-blue-600'
                    }`}
                  />
                  {errors.fullName && <p className="text-[10px] text-rose-600 mt-0.5">{errors.fullName}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Email Address <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="ramesh@company.in"
                      className={`w-full bg-slate-50 border rounded px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-1 ${
                        errors.email ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 focus:ring-blue-600'
                      }`}
                    />
                    {errors.email && <p className="text-[10px] text-rose-600 mt-0.5">{errors.email}</p>}
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Mobile (+91) <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="tel"
                      value={formData.mobile}
                      onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                      placeholder="9823012345"
                      className={`w-full bg-slate-50 border rounded px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-1 ${
                        errors.mobile ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 focus:ring-blue-600'
                      }`}
                    />
                    {errors.mobile && <p className="text-[10px] text-rose-600 mt-0.5">{errors.mobile}</p>}
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Helpdesk Category
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                  >
                    <option value="General Enquiry">General Enquiry</option>
                    <option value="Application Support">Application &amp; Clearances</option>
                    <option value="Financial & Schemes">Schemes &amp; Subsidies</option>
                    <option value="Grievance & Escalation">Grievance / RTS Delay</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Subject / Concern <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    placeholder="Brief summary of query"
                    className={`w-full bg-slate-50 border rounded px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-1 ${
                      errors.subject ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 focus:ring-blue-600'
                    }`}
                  />
                  {errors.subject && <p className="text-[10px] text-rose-600 mt-0.5">{errors.subject}</p>}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Message <span className="text-rose-600">*</span>
                  </label>
                  <textarea
                    rows={4}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Provide details about your industrial unit, application reference (if any), and issue..."
                    className={`w-full bg-slate-50 border rounded px-3 py-2 text-slate-800 focus:bg-white focus:outline-none focus:ring-1 ${
                      errors.message ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 focus:ring-blue-600'
                    }`}
                  />
                  {errors.message && <p className="text-[10px] text-rose-600 mt-0.5">{errors.message}</p>}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-[#f58220] hover:bg-[#e07110] text-white font-bold text-xs rounded shadow-xs transition"
                  >
                    Submit Support Ticket
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
