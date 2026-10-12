// Построчное чтение ответа NDJSON: по объекту на строку, строки приходят кусками
// и режутся в любом месте, в том числе посреди многобайтового символа. Читает
// по мере поступления (response.body.getReader), поэтому шаги вопроса к данным
// появляются, пока ответ ещё идёт. Если у ответа нет потока (старый браузер,
// тестовая заглушка), читает его целиком и разбирает так же.
//
// Битая строка пропускается: один неразобранный шаг не должен ронять ответ.
// Не-объекты (число, строка, null) событиями не считаются.

function parseLine(line) {
  const text = line.trim();
  if (!text) return undefined;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function* readNdjson(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    for (const line of (await response.text()).split('\n')) {
      const event = parseLine(line);
      if (event) yield event;
    }
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        const event = parseLine(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (event) yield event;
        end = buffer.indexOf('\n');
      }
    }
    // Последняя строка без перевода строки в конце.
    const event = parseLine(buffer + decoder.decode());
    if (event) yield event;
    finished = true;
  } finally {
    // Читатель вышел раньше конца (прервали цикл или ошибка): поток закрываем.
    if (!finished) reader.cancel().catch(() => {});
  }
}
