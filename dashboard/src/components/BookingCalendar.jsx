import React, { useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { format } from 'date-fns';

export default function BookingCalendar({ bookings, onEventClick }) {
  const events = bookings.map(b => {
    const datePart = b.preferred_date?.includes('T') ? b.preferred_date.split('T')[0] : b.preferred_date;
    const startTime = b.appointment_time || '09:00:00';
    const endTime = b.appointment_time ? addHour(b.appointment_time) : '10:00:00';

    return {
      id: b.id,
      title: `${b.contact_name} - ${b.job_type || 'Job'}`,
      start: b.preferred_date ? `${datePart}T${startTime}` : null,
      end: b.preferred_date ? `${datePart}T${endTime}` : null,
      extendedProps: { ...b },
      backgroundColor: getStatusColor(b.status),
      borderColor: getStatusColor(b.status),
    };
  }).filter(e => e.start);

  function addHour(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  }

  function getStatusColor(status) {
    switch (status?.toLowerCase()) {
      case 'booked': return '#3b82f6'; // blue-500
      case 'confirmed': return '#10b981'; // emerald-500
      case 'completed': return '#059669'; // emerald-600
      case 'rescheduled': return '#f59e0b'; // amber-500
      case 'cancelled': return '#ef4444'; // red-500
      default: return '#78716c'; // stone-500
    }
  }

  return (
    <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm calendar-container">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
        }}
        events={events}
        eventClick={(info) => onEventClick && onEventClick(info.event.extendedProps)}
        height="auto"
        aspectRatio={1.5}
        eventTimeFormat={{
          hour: 'numeric',
          minute: '2-digit',
          meridiem: 'short'
        }}
        nowIndicator={true}
        slotMinTime="07:00:00"
        slotMaxTime="20:00:00"
      />
      <style>{`
        .fc .fc-toolbar-title { font-size: 1.25rem; font-weight: 600; color: #1c1917; }
        .fc .fc-button-primary { background-color: #f5f5f4; border-color: #e7e5e4; color: #44403c; font-weight: 500; text-transform: capitalize; }
        .fc .fc-button-primary:hover { background-color: #e7e5e4; border-color: #d6d3d1; color: #1c1917; }
        .fc .fc-button-primary:not(:disabled).fc-button-active { background-color: #1c1917; border-color: #1c1917; color: white; }
        .fc .fc-button-primary:focus { box-shadow: none; }
        .fc .fc-daygrid-day-number { color: #57534e; text-decoration: none; padding: 4px 8px; font-weight: 500; }
        .fc .fc-col-header-cell-cushion { color: #78716c; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 0; }
        .fc-theme-standard td, .fc-theme-standard th { border-color: #e7e5e4; }
        .fc .fc-event { border-radius: 6px; padding: 2px 4px; font-size: 0.8rem; font-weight: 500; cursor: pointer; border: none; }
      `}</style>
    </div>
  );
}
