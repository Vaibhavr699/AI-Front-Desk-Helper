import React, { useState } from "react";
import { postFormData } from "../../api";
import { X, Upload, Rocket, MessageSquare, Clock, AlertCircle, CheckCircle2, ArrowRight, Zap, Target, User, FileText, ChevronRight, ShieldCheck, Info } from "lucide-react";
import { Button } from "../ui/button";
import { motion, AnimatePresence } from "framer-motion";

export default function CampaignCreator({ tenantId, onClose, onCreated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    mode: "manual", // manual | auto
    prompt_description: "",
    calling_hours_start: "08:00",
    calling_hours_end: "19:00",
    max_attempts: 3,
    consent_confirmed: false,
    csv: null,
    agent_name: "Alex",
    persona_instructions: "",
    agent_voice: "ash"
  });

  const isFormValid = formData.name && formData.csv && formData.consent_confirmed;
 
  const downloadCsvTemplate = () => {
    const headers = "first_name,last_name,phone,email,notes\n";
    const example = "John,Doe,+15551234567,john@example.com,Interested in service";
    const blob = new Blob([headers + example], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "campaign_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  async function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!isFormValid) return; 
    
    if (!formData.name) return setError("Campaign name is required");
    if (!formData.csv) return setError("Please upload a contact list (CSV)");
    if (!formData.consent_confirmed) return setError("You must confirm contact consent");
    if (formData.mode === 'manual' && !formData.prompt_description) return setError("Description is required for Manual mode");

    setLoading(true);
    setError("");

    try {
      const data = new FormData();
      data.append("name", formData.name);
      data.append("mode", formData.mode);
      data.append("prompt_description", formData.prompt_description);
      data.append("calling_hours_start", formData.calling_hours_start + ":00");
      data.append("calling_hours_end", formData.calling_hours_end + ":00");
      data.append("max_attempts", formData.max_attempts);
      data.append("consent_confirmed", formData.consent_confirmed);
      data.append("csv", formData.csv);
      data.append("tenantId", tenantId);
      data.append("agent_name", formData.agent_name);
      data.append("persona_instructions", formData.persona_instructions);
      data.append("agent_voice", formData.agent_voice);
      
      const res = await postFormData("/api/outbound/campaigns", data);
      onCreated(res);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-stone-100/30 backdrop-blur-sm p-4"
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden flex flex-col font-sans border border-stone-200"
      >
        
        <div className="bg-stone-900 px-6 py-5 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white"
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-3">
             <div className="p-2 bg-white/10 rounded-xl">
               <Rocket className="w-5 h-5 text-white" />
             </div>
             <div>
               <h2 className="text-xl font-bold tracking-tight">New Campaign</h2>
               <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">Configuration Panel</p>
             </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-5 space-y-6 max-h-[70vh] custom-scrollbar">
          {error && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }} 
              animate={{ opacity: 1, x: 0 }}
              className="p-3 bg-red-50 text-red-600 rounded-xl text-xs font-bold border border-red-100 flex items-center gap-3"
            >
              <AlertCircle size={16} />
              {error}
            </motion.div>
          )}

          <section className="space-y-1.5 focus-within:translate-x-1 transition-transform">
             <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">Campaign Name</label>
             <div className="relative">
               <Target className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300" size={16} />
               <input 
                 type="text"
                 placeholder="e.g. Real Estate Growth July"
                 className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-1 focus:ring-stone-900 transition-all outline-none text-stone-900 font-bold text-sm"
                 value={formData.name}
                 onChange={(e) => setFormData({...formData, name: e.target.value})}
               />
             </div>
          </section>

          <section className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">Behavior Mode</label>
            <div className="grid grid-cols-2 gap-3">
               <ProtocolOption 
                 active={formData.mode === 'manual'}
                 onClick={() => setFormData({...formData, mode: 'manual'})}
                 icon={MessageSquare}
                 title="Single Flow"
               />
               <ProtocolOption 
                 active={formData.mode === 'auto'}
                 onClick={() => setFormData({...formData, mode: 'auto'})}
                 icon={Zap}
                 title="Auto Optimization"
                 premium
               />
            </div>
            
            <AnimatePresence mode="wait">
              <motion.div 
                key={formData.mode}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="mt-3 p-4 bg-stone-50 border border-stone-100 rounded-2xl flex items-start gap-3 shadow-sm"
              >
                <div className={`p-1.5 rounded-lg ${formData.mode === 'auto' ? 'bg-orange-50 text-orange-600' : 'bg-brand-50 text-brand-600'}`}>
                  <Info size={14} />
                </div>
                <div className="space-y-1">
                   <h4 className="text-[10px] font-black text-stone-900 uppercase tracking-widest">{formData.mode === 'auto' ? 'Self-Evolving Campaign' : 'Fixed Protocol Mission'}</h4>
                   <p className="text-[12px] text-stone-500 font-medium leading-relaxed">
                     {formData.mode === 'auto' 
                       ? "AI generates 5 script variations and tests them in parallel. Low performing scripts are automatically retired based on booking conversion." 
                       : "AI follows a single, fixed instruction set for every call. Best for highly regulated outreach where scripts must remain constant."}
                   </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          <section className="space-y-4 p-5 bg-stone-50/50 border border-stone-200 rounded-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-all group-hover:scale-110">
              <User size={80} />
            </div>
            
            <div className="flex items-center gap-2 mb-2">
               <div className="w-1.5 h-4 bg-orange-400 rounded-full"></div>
               <h3 className="text-[10px] font-black uppercase tracking-widest text-stone-900">AI Personal Identity</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
               <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 ml-0.5">AI Caller Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-300" size={14} />
                    <input 
                      type="text"
                      placeholder="e.g. Alex, Drew, Sarah"
                      className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-xl focus:ring-1 focus:ring-stone-900 transition-all outline-none text-stone-900 font-bold text-xs"
                      value={formData.agent_name}
                      onChange={(e) => setFormData({...formData, agent_name: e.target.value})}
                    />
                  </div>
               </div>

               <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 ml-0.5">Agent Voice</label>
                  <div className="relative">
                    <Zap className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-300" size={14} />
                    <select
                      className="w-full pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-xl focus:ring-1 focus:ring-stone-900 transition-all outline-none text-stone-900 font-bold text-xs appearance-none"
                      value={formData.agent_voice}
                      onChange={e => setFormData({...formData, agent_voice: e.target.value})}
                    >
                      <option value="ash">Ash (Male - Deep)</option>
                      <option value="echo">Echo (Male - Calm)</option>
                      <option value="alloy">Alloy (Male - Neutral)</option>
                      <option value="ballad">Ballad (Male - Professional)</option>
                      <option value="sage">Sage (Male - Warm)</option>
                      <option value="shimmer">Shimmer (Female - Default)</option>
                      <option value="coral">Coral (Female - Formal)</option>
                      <option value="verse">Verse (Female - Energetic)</option>
                    </select>
                  </div>
               </div>

               <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 ml-0.5">Tone & Persona</label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-3 top-3 text-stone-300" size={14} />
                    <textarea 
                      rows={2}
                      placeholder="e.g. Energetic follow-up expert"
                      className="w-full pl-9 pr-4 py-2.5 bg-white text-xs border border-stone-200 rounded-xl focus:ring-1 focus:ring-stone-900 transition-all outline-none text-stone-900 font-medium text-xs resize-none"
                      value={formData.persona_instructions}
                      onChange={(e) => setFormData({...formData, persona_instructions: e.target.value})}
                    />
                  </div>
               </div>
            </div>
            <p className="text-[9px] text-stone-400 italic px-1">"Hi, I'm {formData.agent_name || '...'} from [Business]..."</p>
          </section>

          <section className="space-y-1.5 focus-within:translate-x-1 transition-transform">
             <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">Strategy Description</label>
             <div className="relative">
               <FileText className="absolute left-4 top-3.5 text-stone-300" size={16} />
               <textarea 
                 rows={3}
                 placeholder="How should the AI behave? What's the core focus of this call?"
                 className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-1 focus:ring-stone-900 transition-all outline-none text-stone-900 font-medium text-sm resize-none"
                 value={formData.prompt_description}
                 onChange={(e) => setFormData({...formData, prompt_description: e.target.value})}
               />
             </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
             <section className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">Contact List (CSV)</label>
                <div className="relative group">
                  <input 
                    type="file" 
                    accept=".csv"
                    onChange={(e) => setFormData({...formData, csv: e.target.files[0]})}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                  />
                  <div className={`p-6 border border-dashed rounded-xl text-center transition-all ${formData.csv ? 'bg-emerald-50/20 border-emerald-300' : 'bg-stone-50/50 group-hover:border-stone-900'}`}>
                    {formData.csv ? (
                       <div className="flex items-center gap-2 justify-center">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span className="text-[10px] font-black text-stone-900 truncate max-w-[140px] tracking-tight">{formData.csv.name}</span>
                       </div>
                    ) : (
                       <div className="flex flex-col items-center gap-1.5">
                        <Upload className="w-4 h-4 text-stone-300 group-hover:text-stone-900 transition-colors" />
                        <span className="text-[10px] font-black text-stone-900 uppercase">Select File</span>
                       </div>
                    )}
                  </div>
                </div>
                
                <div className="flex justify-between items-center mt-3 relative group/template">
                   <button 
                     type="button"
                     onClick={downloadCsvTemplate}
                     className="flex items-center gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest hover:text-stone-900 transition-all px-1"
                   >
                     <FileText size={12} className="text-stone-300 group-hover/template:text-stone-900 transition-colors" />
                     Download Template
                   </button>
                   
                   {/* Tooltip */}
                   <div className="absolute left-0 -bottom-8 opacity-0 group-hover/template:opacity-100 transition-all duration-300 pointer-events-none translate-y-1 group-hover/template:translate-y-0 z-50">
                      <div className="bg-stone-900 text-white text-[8px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg shadow-xl shadow-stone-900/10 whitespace-nowrap">
                         Download template CSV format
                      </div>
                      <div className="w-2 h-2 bg-stone-900 rotate-45 absolute -top-1 left-4"></div>
                   </div>
                </div>
             </section>

             <section className="space-y-4">
                <div className="space-y-1.5">
                   <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1">Call Window</label>
                   <div className="flex items-center gap-2 p-2 px-3 bg-stone-50 border border-stone-200 rounded-xl">
                     <Clock size={14} className="text-stone-400" />
                     <input type="time" className="bg-transparent text-[10px] font-bold outline-none flex-1" value={formData.calling_hours_start} onChange={e => setFormData({...formData, calling_hours_start: e.target.value})} />
                     <span className="text-stone-300 text-[10px]">to</span>
                     <input type="time" className="bg-transparent text-[10px] font-bold outline-none flex-1 text-right" value={formData.calling_hours_end} onChange={e => setFormData({...formData, calling_hours_end: e.target.value})} />
                   </div>
                </div>

                <div className="space-y-1.5">
                   <label className="text-[10px] font-black uppercase tracking-widest text-stone-400 ml-1 whitespace-nowrap">Max Attempts per Contact</label>
                   <div className="grid grid-cols-4 gap-1.5">
                     {[1,2,3,5].map(v => (
                       <button 
                         key={v}
                         type="button"
                         onClick={() => setFormData({...formData, max_attempts: v})}
                         className={`py-2 rounded-lg text-xs font-black transition-all ${formData.max_attempts === v ? 'bg-stone-900 text-white' : 'bg-stone-50 text-stone-400 border border-stone-200 hover:bg-stone-100'}`}
                       >
                         {v}x
                       </button>
                     ))}
                   </div>
                </div>
             </section>
          </div>

          <label className={`flex items-center gap-4 p-4 rounded-xl cursor-pointer group transition-all border ${formData.consent_confirmed ? 'bg-emerald-50 border-emerald-200' : 'bg-stone-50 border-stone-200 hover:bg-stone-100'}`}>
            <div className={`w-5 h-5 rounded border-2 flex-shrink-0 transition-all flex items-center justify-center ${formData.consent_confirmed ? 'bg-stone-900 border-stone-900' : 'bg-white border-stone-300'}`}>
              <input 
                type="checkbox" 
                className="hidden"
                checked={formData.consent_confirmed}
                onChange={(e) => setFormData({...formData, consent_confirmed: e.target.checked})}
              />
              {formData.consent_confirmed && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
            </div>
            <div className={`text-[10px] font-bold uppercase tracking-tight leading-relaxed ${formData.consent_confirmed ? 'text-emerald-900' : 'text-stone-500'}`}>
               I confirm all contacts on this list have provided consent to be contacted.
            </div>
          </label>
        </div>

        <div className="px-8 py-5 border-t border-stone-100 flex items-center gap-4 bg-stone-50/30">
           <Button variant="ghost" onClick={onClose} disabled={loading} className="px-5 py-3 font-bold uppercase text-stone-400 text-[10px]">Purge</Button>
           <button
             disabled={loading || !formData.consent_confirmed}
             onClick={handleSubmit}
             className={`flex-1 py-4 rounded-xl font-bold text-sm shadow-xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${formData.consent_confirmed ? 'bg-stone-900 text-white shadow-stone-200 hover:bg-black' : 'bg-stone-200 text-stone-400 shadow-none'}`}
           >
             {loading ? "INITIALIZING..." : "Start Outbound Calls"}
           </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ProtocolOption({ active, onClick, icon: Icon, title, premium }) {
  return (
    <button 
      type="button"
      onClick={onClick}
      className={`p-4 rounded-xl border transition-all relative group text-left ${active ? 'border-stone-900 bg-white shadow-md scale-[1.02]' : 'border-stone-200 bg-white hover:border-stone-300'}`}
    >
      <div className={`p-1.5 rounded-lg mb-2 w-fit ${active ? 'bg-stone-900 text-white' : 'bg-stone-50 text-stone-400'}`}>
        <Icon size={16} />
      </div>
      <div className={`font-bold transition-colors text-sm ${active ? 'text-stone-900' : 'text-stone-500'}`}>{title}</div>
      {premium && (
        <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-orange-500 text-[7px] font-black text-white rounded uppercase tracking-widest">ADVANCED</div>
      )}
    </button>
  );
}
