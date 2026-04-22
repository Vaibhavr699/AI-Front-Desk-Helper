import React from "react";
import { AlertCircle, Lightbulb } from "lucide-react";

/**
 * AnalysisCard — the "Hung-up call analysis" and "Confused call triggers"
 * tables on the Metrics page. The header icon, footer strip, and insight
 * copy were all hardcoded orange; those are decorative brand surface, so
 * they swap to brand tokens. (Rose/emerald badges inside the table rows
 * stay as-is — those are status meaning colors, not brand.)
 */
export const AnalysisCard = ({ title, question, headers, rows, insightText, icon: Icon }) => {
  return (
    <div className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden flex flex-col h-full hover:shadow-md transition-shadow">
      <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/20">
        <div className="flex items-center gap-2 mb-1">
          {/* Header icon now picks up brand color instead of hardcoded orange. */}
          {Icon && <Icon className="w-4 h-4 text-brand-500" />}
          <h3 className="text-[11px] font-bold text-gray-900 uppercase tracking-widest">{title}</h3>
        </div>
        <p className="text-sm font-medium text-gray-500">{question}</p>
      </div>
      
      <div className="flex-1 overflow-x-auto">
        <table className="min-w-full text-left text-[11px] font-mono whitespace-nowrap">
          <thead className="bg-gray-50/30 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className={`px-6 py-3 ${i > 0 && i < headers.length - 1 ? 'text-right' : i === headers.length - 1 ? 'text-right' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50/50 transition-colors">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={`px-6 py-4 ${cellIndex === 0 ? 'font-bold text-gray-700' : 'text-right'} ${cellIndex === headers.length - 1 ? 'font-black' : ''}`}>
                    {typeof cell === 'object' ? (
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-tight ${cell.color}`}>
                        {cell.text}
                      </span>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Footer insight strip — all four hardcoded orange-* classes swap to brand-*.
          Opacity + shade choices preserved so visual weight matches the original. */}
      <div className="p-4 bg-brand-50/30 border-t border-brand-100/50">
        <div className="flex gap-3">
          <Lightbulb className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
          <p className="text-[11px] font-medium text-brand-800 leading-relaxed italic">
            {insightText}
          </p>
        </div>
      </div>
    </div>
  );
};
