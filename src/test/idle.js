import { act } from '@testing-library/react';

// Запускает накопленные колбэки requestIdleCallback (см. src/test/setup.js) и
// дожидается ответов, которые они успели запросить.
export async function flushIdle() {
  await act(async () => {
    const queue = window.__idleQueue.splice(0);
    queue.forEach(callback => callback?.({ didTimeout: false, timeRemaining: () => 50 }));
  });
  await act(async () => {});
}
