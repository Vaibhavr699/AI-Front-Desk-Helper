import React from "react";
import { AlertCircle, Lightbulb } from "lucide-react";

export const AnalysisCard = ({ title, question, headers, rows, insightText, icon: Icon }) => {
  return (
    <div className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden flex flex-col h-full hover:shadow-md transition-shadow">
      <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/20">
        <div className="flex items-center gap-2 mb-1">
          {Icon && <Icon className="w-4 h-4 text-orange-500" />}
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

      <div className="p-4 bg-orange-50/30 border-t border-orange-100/50">
        <div className="flex gap-3">
          <Lightbulb className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
          <p className="text-[11px] font-medium text-orange-800 leading-relaxed italic">
            {insightText}
          </p>
        </div>
      </div>
    </div>
  );
};
