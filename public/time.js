// Shared time utilities - IST timezone
window.formatIST = function(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
};

window.timeAgoIST = function(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  var now = new Date();
  var diff = now.getTime() - d.getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  // Show full IST date for older items
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

window.timeOnlyIST = function(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
};
