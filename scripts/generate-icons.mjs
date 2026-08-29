// Генератор иконок приложения: node scripts/generate-icons.mjs
//
// Иконки лежат в public/ готовыми файлами - этот скрипт нужен, только чтобы
// их можно было перерисовать, не подбирая заново цвета и геометрию. Он
// специально ни от чего не зависит: тащить в проект sharp или canvas ради
// четырёх картинок, которые меняются раз в год, дороже, чем сотня строк
// здесь. PNG собирается вручную, сжатие берётся из встроенного zlib.
//
// Рисунок - столбики диаграммы на фирменном градиенте. Никакого текста:
// глиф пришлось бы растеризовать самому, а на 48 пикселях (размер иконки в
// списке приложений) буквы всё равно нечитаемы.

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Те же значения, что у --color-primary и градиента фона в src/index.css.
const GRADIENT_FROM = [0x25, 0x63, 0xeb];
const GRADIENT_TO = [0x4f, 0x46, 0xe5];

// Сглаживание берётся супersampling'ом: рисуем в SCALE раз крупнее и
// усредняем. Аналитических формул сглаживания тут не нужно - фигуры
// простые, а лишний проход по массиву стоит миллисекунды.
const SCALE = 4;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
}

// rgba - плоский Uint8Array длиной width * height * 4.
function encodePng(rgba, width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // бит на канал
    ihdr[9] = 6; // цветовой тип: RGBA
    // 10-12: сжатие, фильтр, чересстрочность - нули

    // Каждой строке предшествует байт фильтра. Фильтр 0 («никакой»):
    // картинка маленькая, а разница в размере после deflate - единицы
    // процентов.
    const raw = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * (width * 4 + 1);
        raw[rowStart] = 0;
        rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// --- Рисование ------------------------------------------------------------

// Точка внутри прямоугольника со скруглёнными углами?
function insideRoundedRect(x, y, left, top, right, bottom, radius) {
    if (x < left || x > right || y < top || y > bottom) return false;
    const cx = Math.min(Math.max(x, left + radius), right - radius);
    const cy = Math.min(Math.max(y, top + radius), bottom - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
}

// options.padding - доля стороны, свободная по краям. Для maskable-иконки
// она больше: система обрезает такую иконку под свою форму, и всё значимое
// должно поместиться в центральные 80%.
function drawIcon(size, { cornerRadius, padding }) {
    const big = size * SCALE;
    const acc = new Float32Array(size * size * 4);

    const inset = big * padding;
    const radius = big * cornerRadius;
    const chartLeft = inset;
    const chartRight = big - inset;
    const chartBottom = big - inset;
    const chartWidth = chartRight - chartLeft;

    // Три столбика разной высоты - расход, доход, остаток. Ширина и зазор
    // подобраны так, чтобы на 48 пикселях столбики не сливались.
    const barWidth = chartWidth * 0.22;
    const gap = (chartWidth - barWidth * 3) / 2;
    const bars = [0.45, 0.75, 1.0].map((heightRatio, i) => {
        const left = chartLeft + i * (barWidth + gap);
        const height = (chartBottom - inset) * heightRatio;
        return { left, right: left + barWidth, top: chartBottom - height, bottom: chartBottom };
    });

    for (let sy = 0; sy < big; sy += 1) {
        for (let sx = 0; sx < big; sx += 1) {
            // Диагональный градиент, как --color-primary-gradient.
            const t = clamp01((sx / big + sy / big) / 2);
            let r = GRADIENT_FROM[0] + (GRADIENT_TO[0] - GRADIENT_FROM[0]) * t;
            let g = GRADIENT_FROM[1] + (GRADIENT_TO[1] - GRADIENT_FROM[1]) * t;
            let b = GRADIENT_FROM[2] + (GRADIENT_TO[2] - GRADIENT_FROM[2]) * t;
            let a = insideRoundedRect(sx + 0.5, sy + 0.5, 0, 0, big - 1, big - 1, radius) ? 255 : 0;

            if (a > 0) {
                for (const bar of bars) {
                    // Скругление только сверху - снизу столбики стоят на
                    // общей линии, и круглый низ читался бы как отрыв.
                    const barRadius = barWidth / 2;
                    const inBody = sx + 0.5 >= bar.left && sx + 0.5 <= bar.right
                        && sy + 0.5 >= bar.top + barRadius && sy + 0.5 <= bar.bottom;
                    const inCap = insideRoundedRect(
                        sx + 0.5, sy + 0.5, bar.left, bar.top, bar.right, bar.top + barRadius * 2, barRadius
                    );
                    if (inBody || inCap) {
                        r = 255; g = 255; b = 255;
                        break;
                    }
                }
            }

            const dx = Math.floor(sx / SCALE);
            const dy = Math.floor(sy / SCALE);
            const o = (dy * size + dx) * 4;
            acc[o] += r * (a / 255);
            acc[o + 1] += g * (a / 255);
            acc[o + 2] += b * (a / 255);
            acc[o + 3] += a;
        }
    }

    const samples = SCALE * SCALE;
    const out = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i += 1) {
        const alpha = acc[i * 4 + 3] / samples;
        // Цвет усредняется с весом альфы, иначе по краю проступала бы
        // тёмная кайма от прозрачных пикселей.
        const weight = acc[i * 4 + 3] / 255;
        const norm = weight > 0 ? weight : 1;
        out[i * 4] = Math.round(acc[i * 4] / norm);
        out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / norm);
        out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / norm);
        out[i * 4 + 3] = Math.round(alpha);
    }
    return out;
}

// --- Вывод ----------------------------------------------------------------

// cornerRadius 0.22 - примерно та же скруглённость, что у иконок iOS;
// система всё равно наложит свою маску, но в браузерном списке приложений
// и во вкладке иконка показывается как есть.
const TARGETS = [
    { file: 'icon-192.png', size: 192, cornerRadius: 0.22, padding: 0.22 },
    { file: 'icon-512.png', size: 512, cornerRadius: 0.22, padding: 0.22 },
    // maskable: фон во всю площадь, рисунок ужат в безопасную зону.
    { file: 'icon-maskable-512.png', size: 512, cornerRadius: 0, padding: 0.3 },
    // apple-touch-icon: iOS сама скругляет и не понимает maskable.
    { file: 'apple-touch-icon.png', size: 180, cornerRadius: 0, padding: 0.24 }
];

for (const { file, size, cornerRadius, padding } of TARGETS) {
    const png = encodePng(drawIcon(size, { cornerRadius, padding }), size, size);
    fs.writeFileSync(path.join(PUBLIC_DIR, file), png);
    console.log(`${file}: ${size}x${size}, ${(png.length / 1024).toFixed(1)} КБ`);
}
