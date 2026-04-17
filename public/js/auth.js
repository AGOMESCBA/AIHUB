// Verifica autenticação em todas as páginas protegidas
(async function () {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) throw new Error('unauthenticated');
  } catch (_) {
    window.location.href = '/login.html';
  }
})();

function logout() {
  fetch('/api/logout', { method: 'POST' }).finally(() => {
    window.location.href = '/login.html';
  });
}
