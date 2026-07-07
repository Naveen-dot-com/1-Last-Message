window.onerror = function(message, source, lineno, colno, error) {
  alert("Error: " + message + " at " + source + ":" + lineno + ":" + colno);
};
window.onunhandledrejection = function(event) {
  alert("Unhandled Rejection: " + event.reason);
};
