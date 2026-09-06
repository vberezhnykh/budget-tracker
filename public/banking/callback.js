(() => {
  const callbackUrl = window.location.href;
  const params = new URL(callbackUrl).searchParams;
  // Retain the response only in this page's memory, never in web storage.
  window.history.replaceState(null, '', window.location.pathname);
  const status = document.getElementById('status');
  const copy = document.getElementById('copy');
  const hasResponse = params.has('state') && (params.has('code') || params.has('error'));
  if (!hasResponse) {
    status.textContent = 'Ответ банка отсутствует. Начни подключение из программы проверки.';
    return;
  }
  status.textContent = params.has('error')
    ? 'Банк вернул отказ или ошибку. Передай ответ программе, чтобы завершить проверку.'
    : 'Ответ банка получен. Для проверки доступа осталось передать его программе.';
  document.getElementById('instructions').hidden = false;
  copy.hidden = false;
  copy.addEventListener('click', async () => {
    const message = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(callbackUrl);
      message.textContent = 'Скопировано. Вставь ответ в программу проверки на компьютере.';
    } catch {
      message.textContent = 'Браузер не разрешил копирование. Разреши доступ к буферу обмена для этой страницы и повтори.';
    }
  });
})();
