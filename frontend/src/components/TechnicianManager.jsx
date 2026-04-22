import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Phone, Mail, User } from 'lucide-react';
import { getTechnicians, createTechnician, updateTechnician, deleteTechnician } from '../api';

export default function TechnicianManager({ tenantId }) {
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingTech, setEditingTech] = useState(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' });

  useEffect(() => {
    loadTechs();
  }, [tenantId]);

  async function loadTechs() {
    setLoading(true);
    try {
      const data = await getTechnicians(tenantId);
      setTechnicians(data.technicians || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editingTech) {
        await updateTechnician(editingTech.id, formData);
      } else {
        await createTechnician(tenantId, formData);
      }
      loadTechs();
      setIsAdding(false);
      setEditingTech(null);
      setFormData({ name: '', email: '', phone: '' });
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Are you sure you want to remove this technician?')) return;
    try {
      await deleteTechnician(id);
      loadTechs();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Crew Management</h2>
          <p className="text-sm text-stone-500">Add and manage your technicians for scheduling.</p>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-white rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Technician
        </button>
      </div>

      {(isAdding || editingTech) && (
        <div className="bg-stone-50 p-6 rounded-xl border border-stone-200 shadow-sm animate-in fade-in slide-in-from-top-4 duration-200">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Full Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/5 focus:border-stone-900 transition-all"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/5 focus:border-stone-900 transition-all"
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Phone</label>
              <input
                type="text"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/5 focus:border-stone-900 transition-all"
                placeholder="555-0123"
              />
            </div>
            <div className="md:col-span-3 flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => { setIsAdding(false); setEditingTech(null); }}
                className="px-4 py-2 text-sm font-medium text-stone-600 hover:text-stone-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-stone-900 text-white rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors"
              >
                {editingTech ? 'Save Changes' : 'Add Technician'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {technicians.length === 0 && !loading && (
          <div className="col-span-full py-12 text-center bg-white rounded-xl border border-dashed border-stone-300">
            <User className="w-12 h-12 text-stone-300 mx-auto mb-3" />
            <p className="text-stone-500 text-sm">No technicians added yet.</p>
          </div>
        )}
        {technicians.map(tech => (
          <div key={tech.id} className="group bg-white p-5 rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-all relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
              <button
                onClick={() => { setEditingTech(tech); setFormData({ name: tech.name, email: tech.email || '', phone: tech.phone || '' }); }}
                className="p-1.5 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-md transition-colors"
                title="Edit"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDelete(tech.id)}
                className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-col h-full">
              <div className="mb-4">
                <h3 className="font-semibold text-stone-900">{tech.name}</h3>
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Technician</span>
              </div>
              <div className="space-y-2 mt-auto">
                {tech.phone && (
                  <div className="flex items-center gap-2 text-stone-600 text-sm">
                    <Phone className="w-3 h-3 text-stone-400" />
                    <span>{tech.phone}</span>
                  </div>
                )}
                {tech.email && (
                  <div className="flex items-center gap-2 text-stone-600 text-sm">
                    <Mail className="w-3 h-3 text-stone-400" />
                    <span className="truncate">{tech.email}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
