import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    decodeImage,
    fitSize,
    MAX_FILE_BYTES,
    NOT_IMAGE_TEXT,
    prepareReceiptImage,
    TOO_LARGE_TEXT,
    validateReceiptFile,
} from './receiptImage';

const photo = (size = 1000, type = 'image/jpeg') => ({ type, size, name: 'receipt.jpg' });

afterEach(() => vi.unstubAllGlobals());

describe('fitSize', () => {
    it('shrinks the longest side to 2000 keeping the proportions', () => {
        expect(fitSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
        expect(fitSize(3000, 4000)).toEqual({ width: 1500, height: 2000 });
        expect(fitSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    });

    it('never upscales', () => {
        expect(fitSize(2000, 1000)).toEqual({ width: 2000, height: 1000 });
        expect(fitSize(640, 480)).toEqual({ width: 640, height: 480 });
    });

    it('keeps at least one pixel on the short side', () => {
        expect(fitSize(40000, 3)).toEqual({ width: 2000, height: 1 });
    });
});

describe('validateReceiptFile', () => {
    it('accepts an image up to the size limit', () => {
        expect(() => validateReceiptFile(photo())).not.toThrow();
        expect(() => validateReceiptFile(photo(MAX_FILE_BYTES, 'image/heic'))).not.toThrow();
    });

    it.each([null, undefined, photo(1000, 'application/pdf'), photo(1000, ''), photo(0)])('rejects %j as not a photo', file => {
        expect(() => validateReceiptFile(file)).toThrow(NOT_IMAGE_TEXT);
    });

    it('rejects a file over 25 MB', () => {
        expect(() => validateReceiptFile(photo(MAX_FILE_BYTES + 1))).toThrow(TOO_LARGE_TEXT);
    });
});

describe('prepareReceiptImage', () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });

    it('decodes, scales and encodes, then releases the decoded image', async () => {
        const release = vi.fn();
        const decode = vi.fn(async () => ({ source: 'bitmap', width: 4000, height: 3000, release }));
        const encode = vi.fn(async () => blob);
        const file = photo();
        await expect(prepareReceiptImage(file, { decode, encode })).resolves.toBe(blob);
        expect(decode).toHaveBeenCalledWith(file);
        expect(encode).toHaveBeenCalledWith('bitmap', 2000, 1500);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('validates before decoding', async () => {
        const decode = vi.fn();
        await expect(prepareReceiptImage(photo(MAX_FILE_BYTES + 1), { decode })).rejects.toThrow(TOO_LARGE_TEXT);
        await expect(prepareReceiptImage(photo(10, 'text/plain'), { decode })).rejects.toThrow(NOT_IMAGE_TEXT);
        expect(decode).not.toHaveBeenCalled();
    });

    it('says «not a photo» when the file cannot be decoded or encoded', async () => {
        const encode = vi.fn(async () => blob);
        await expect(prepareReceiptImage(photo(), { decode: async () => { throw new Error('boom'); }, encode })).rejects.toThrow(NOT_IMAGE_TEXT);
        expect(encode).not.toHaveBeenCalled();

        const release = vi.fn();
        const decode = async () => ({ source: 's', width: 10, height: 10, release });
        await expect(prepareReceiptImage(photo(), { decode, encode: async () => { throw new Error('no canvas'); } })).rejects.toThrow(NOT_IMAGE_TEXT);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('rejects an empty image', async () => {
        const encode = vi.fn();
        await expect(prepareReceiptImage(photo(), { decode: async () => ({ source: 's', width: 0, height: 0 }), encode })).rejects.toThrow(NOT_IMAGE_TEXT);
        expect(encode).not.toHaveBeenCalled();
    });
});

describe('decodeImage', () => {
    it('uses createImageBitmap and closes the bitmap on release', async () => {
        const close = vi.fn();
        const bitmap = { width: 30, height: 20, close };
        vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
        const file = photo();
        const decoded = await decodeImage(file);
        expect(globalThis.createImageBitmap).toHaveBeenCalledWith(file);
        expect(decoded).toMatchObject({ source: bitmap, width: 30, height: 20 });
        decoded.release();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('falls back to an <img> and an object URL when createImageBitmap is missing', async () => {
        vi.stubGlobal('createImageBitmap', undefined);
        const createObjectURL = vi.fn(() => 'blob:fake');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', Object.assign(function URLStub() {}, { createObjectURL, revokeObjectURL }));
        class FakeImage {
            naturalWidth = 640;
            naturalHeight = 480;
            set src(value) { this.loadedFrom = value; queueMicrotask(() => this.onload()); }
        }
        vi.stubGlobal('Image', FakeImage);
        const decoded = await decodeImage(photo());
        expect(decoded).toMatchObject({ width: 640, height: 480 });
        expect(decoded.source.loadedFrom).toBe('blob:fake');
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    });

    it('rejects and still revokes the URL when the image fails to load', async () => {
        vi.stubGlobal('createImageBitmap', undefined);
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', Object.assign(function URLStub() {}, { createObjectURL: () => 'blob:bad', revokeObjectURL }));
        vi.stubGlobal('Image', class { set src(_) { queueMicrotask(() => this.onerror()); } });
        await expect(decodeImage(photo())).rejects.toThrow();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:bad');
    });
});
