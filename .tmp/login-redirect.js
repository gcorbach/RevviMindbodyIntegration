(function () {
  function initPartnerLoginReturn() {
    const params = new URLSearchParams(window.location.search);
    if (params.getAll('redirect').length !== 1) return;
    const destination = params.get('redirect');
    // Only accept a partner path, never an arbitrary URL supplied by a visitor.
    if (!/^\/partners\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(destination || '')) return;
    document.querySelectorAll('form[data-ms-form="login"]').forEach(function (form) {
      form.setAttribute('redirect', destination);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPartnerLoginReturn, { once: true });
  } else {
    initPartnerLoginReturn();
  }
})();
