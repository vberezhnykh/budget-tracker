// Фото чека перед отправкой: проверка файла, уменьшение и перекодирование
// в JPEG. Снимок с телефона весит 3-8 МБ, а читать чек моделям хватает
// и двух тысяч пикселей по длинной стороне - так запрос быстрее и дешевле.
// Работа с браузером (декодирование, canvas) вынесена в два шва, decode и
// encode: в jsdom настоящего canvas нет, и тесты подставляют свои.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SIDE = 2000;
export const JPEG_QUALITY = 0.85;

export const NOT_IMAGE_TEXT = 'Это не похоже на фото.';
export const TOO_LARGE_TEXT = 'Фото слишком большое.';

// Размер после уменьшения: длинная сторона не больше maxSide, пропорции
// сохраняются, увеличения нет.
export function fitSize(width, height, maxSide = MAX_SIDE) {
    const longest = Math.max(width, height);
    if (!(longest > maxSide)) return { width, height };
    const scale = maxSide / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Файл проверяется до декодирования: огромный или чужой файл не должен
// съесть память телефона.
export function validateReceiptFile(file) {
    if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/') || !(file.size > 0)) {
        throw new Error(NOT_IMAGE_TEXT);
    }
    if (file.size > MAX_FILE_BYTES) throw new Error(TOO_LARGE_TEXT);
}

// Декодирует файл в { source, width, height, release }. source годится для
// drawImage. createImageBitmap учитывает поворот из EXIF; без него - <img>.
export async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(file);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    }
    const url = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('decode failed'));
            element.src = url;
        });
        return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => {} };
    } finally {
        URL.revokeObjectURL(url);
    }
}

// Рисует картинку в нужный размер и сжимает в JPEG. Подложка белая: у PNG с
// прозрачностью иначе вышел бы чёрный фон.
export function encodeJpeg(source, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('no canvas'));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', JPEG_QUALITY);
    });
}

export async function prepareReceiptImage(file, { decode = decodeImage, encode = encodeJpeg } = {}) {
    validateReceiptFile(file);
    let decoded;
    try {
        decoded = await decode(file);
    } catch {
        // Не открылся как картинка: например, формат, который браузер не знает.
        throw new Error(NOT_IMAGE_TEXT);
    }
    try {
        const { width, height } = fitSize(decoded.width, decoded.height);
        if (!(width > 0) || !(height > 0)) throw new Error(NOT_IMAGE_TEXT);
        return await encode(decoded.source, width, height);
    } catch (error) {
        throw error.message === NOT_IMAGE_TEXT ? error : new Error(NOT_IMAGE_TEXT);
    } finally {
        decoded.release?.();
    }
}
