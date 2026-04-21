import React from 'react';
import { motion } from 'framer-motion';
import { Check, Star, Mail, Send, Calendar, CheckCircle2 } from 'lucide-react';

const STEPS = [
  { id: 'New Lead', icon: Star, color: 'blue' },
  { id: 'Qualified', icon: CheckCircle2, color: 'indigo' },
  { id: 'Estimate Sent', icon: Send, color: 'amber' },
  { id: 'FollowUp', icon: Mail, color: 'purple' },
  { id: 'Booked', icon: Calendar, color: 'emerald' }
];

export default function StatusStepper({ currentStatus }) {
  const currentIndex = STEPS.findIndex(s => s.id === currentStatus);
  const isTerminal = currentIndex === -1 && (currentStatus === 'Closed' || currentStatus === 'Lost');

  // If closed/lost, we still show the progress but maybe different styling
  const effectiveIndex = isTerminal ? STEPS.length : currentIndex;

  return (
    <div className="w-full py-8 px-4 bg-white rounded-2xl border border-stone-200 shadow-sm mb-8">
      <div className="relative flex items-center justify-between">
        {/* Background Rail */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 w-full bg-stone-100 rounded-full z-0"></div>
        
        {/* Progress Fill */}
        <motion.div 
          className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-stone-900 rounded-full z-0"
          initial={{ width: 0 }}
          animate={{ width: `${(Math.max(0, effectiveIndex) / (STEPS.length - 1)) * 100}%` }}
          transition={{ duration: 1, ease: "circOut" }}
        ></motion.div>

        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isCompleted = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const isFuture = idx > currentIndex;

          return (
            <div key={step.id} className="relative z-10 flex flex-col items-center">
              <motion.div 
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors duration-500 shadow-sm ${
                  isCompleted ? 'bg-stone-900 border-stone-900 text-white' :
                  isCurrent ? 'bg-white border-stone-900 text-stone-900' :
                  'bg-white border-stone-200 text-stone-300'
                }`}
                initial={false}
                animate={isCurrent ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                transition={{ repeat: isCurrent ? Infinity : 0, duration: 2 }}
              >
                {isCompleted ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
              </motion.div>
              
              <div className="absolute -bottom-8 whitespace-nowrap text-center">
                <span className={`text-[10px] font-bold uppercase tracking-widest ${
                  isCurrent ? 'text-stone-900' : 'text-stone-400'
                }`}>
                  {step.id}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {isTerminal && (
        <div className="mt-12 flex justify-center">
          <div className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest ${
            currentStatus === 'Closed' ? 'bg-stone-100 text-stone-600' : 'bg-red-50 text-red-600'
          }`}>
            Final State: {currentStatus}
          </div>
        </div>
      )}
    </div>
  );
}
