import { describe, expect, it, vi } from 'vitest';
import { readNdjson } from './readNdjson';

const encoder = new TextEncoder();

// Ответ, тело которого приходит заданными кусками (строки или байты).
function streamed(chunks) {
  const queue = chunks.map((chunk) => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
  const cancel = vi.fn(async () => {});
  const reader = {
    read: vi.fn(async () => (queue.length ? { done: false, value: queue.shift() } : { done: true, value: undefined })),
    cancel,
  };
  return { response: { body: { getReader: () => reader } }, reader };
}

const collect = async (response) => {
  const events = [];
  for await (const event of readNdjson(response)) events.push(event);
  return events;
};

describe('readNdjson', () => {
  it('reads one object per line', async () => {
    const { response } = streamed(['{"type":"step","label":"A"}\n{"type":"step_done"}\n']);
    expect(await collect(response)).toEqual([{ type: 'step', label: 'A' }, { type: 'step_done' }]);
  });

  it('puts a line back together when it is split across chunks, at any point', async () => {
    const text = '{"type":"step","label":"Транспорт"}\n{"type":"answer","basis":"b"}\n';
    for (let cut = 1; cut < text.length; cut += 1) {
      const { response } = streamed([text.slice(0, cut), text.slice(cut)]);
      expect(await collect(response)).toEqual([{ type: 'step', label: 'Транспорт' }, { type: 'answer', basis: 'b' }]);
    }
  });

  it('survives a multi-byte character cut in the middle of its bytes', async () => {
    const bytes = encoder.encode('{"label":"Ёж €"}\n');
    const { response } = streamed([bytes.slice(0, 11), bytes.slice(11, 14), bytes.slice(14)]);
    expect(await collect(response)).toEqual([{ label: 'Ёж €' }]);
  });

  it('delivers a line as soon as it is complete, not at the end of the stream', async () => {
    const gate = { release: null };
    const queue = [encoder.encode('{"type":"step"}\n')];
    const reader = {
      read: vi.fn(async () => {
        if (queue.length) return { done: false, value: queue.shift() };
        await new Promise((resolve) => { gate.release = resolve; });
        return { done: true, value: undefined };
      }),
      cancel: vi.fn(async () => {}),
    };
    const iterator = readNdjson({ body: { getReader: () => reader } });
    expect(await iterator.next()).toEqual({ done: false, value: { type: 'step' } });
    const pending = iterator.next();
    await Promise.resolve();
    gate.release();
    expect(await pending).toEqual({ done: true, value: undefined });
  });

  it('reads the last line even without a trailing newline', async () => {
    const { response } = streamed(['{"a":1}\n{"b":2}']);
    expect(await collect(response)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips empty lines, broken JSON and values that are not objects', async () => {
    const { response } = streamed(['\n  \n{"a":1}\nnot json\n42\n"text"\nnull\n[1]\n{"b":2}\n{"cut"']);
    expect(await collect(response)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('handles CRLF line endings', async () => {
    const { response } = streamed(['{"a":1}\r\n{"b":2}\r\n']);
    expect(await collect(response)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('gives nothing for an empty body', async () => {
    expect(await collect(streamed([]).response)).toEqual([]);
  });

  it('cancels the stream when the consumer stops early', async () => {
    const { response, reader } = streamed(['{"a":1}\n{"b":2}\n']);
    for await (const event of readNdjson(response)) {
      expect(event).toEqual({ a: 1 });
      break;
    }
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it('passes a read error (abort) through to the caller', async () => {
    const reader = {
      read: vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }),
      cancel: vi.fn(async () => {}),
    };
    await expect(collect({ body: { getReader: () => reader } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(reader.cancel).toHaveBeenCalled();
  });

  it('falls back to reading the whole text when there is no stream', async () => {
    const response = { body: null, text: async () => '{"a":1}\n{"b":2}\n' };
    expect(await collect(response)).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
