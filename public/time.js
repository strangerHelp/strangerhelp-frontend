// Shared time utilities - IST timezone
// DB stores dates as UTC (datetime('now')). Append 'Z' so JS parses as UTC.
function parseUTC(dateStr) {
  if (!dateStr) return null;
  // If already has timezone info, parse directly
  if (dateStr.includes('Z') || dateStr.includes('+') || dateStr.includes('T')) return new Date(dateStr);
  // DB format: "2026-07-21 15:35:29" — this is UTC, add Z
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

window.formatIST = function(dateStr) {
  var d = parseUTC(dateStr);
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
};

window.timeAgoIST = function(dateStr) {
  var d = parseUTC(dateStr);
  if (!d || isNaN(d.getTime())) return '';
  var now = new Date();
  var diff = now.getTime() - d.getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

window.timeOnlyIST = function(dateStr) {
  var d = parseUTC(dateStr);
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
};
