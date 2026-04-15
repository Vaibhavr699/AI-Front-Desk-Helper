/** Check if a tenant should be "open" based on business_hours JSON and their timezone. */
function isWithinBusinessHours(tenant) {
  if (!tenant || !tenant.business_hours) return true;
  
  const timezone = tenant.timezone || 'America/Chicago';
  const now = new Date();
  const tenantTimeStr = now.toLocaleString('en-US', { timeZone: timezone });
  const tenantTime = new Date(tenantTimeStr);
  
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[tenantTime.getDay()];
  
  const config = tenant.business_hours[dayName];
  if (!config || config.closed) return false;

  const [openH, openM] = (config.open || "08:00").split(':').map(Number);
  const [closeH, closeM] = (config.close || "17:00").split(':').map(Number);

  const currentH = tenantTime.getHours();
  const currentM = tenantTime.getMinutes();

  const currentTotal = currentH * 60 + currentM;
  const openTotal = openH * 60 + openM;
  const closeTotal = closeH * 60 + closeM;

  return currentTotal >= openTotal && currentTotal < closeTotal;
}

module.exports = { isWithinBusinessHours };
