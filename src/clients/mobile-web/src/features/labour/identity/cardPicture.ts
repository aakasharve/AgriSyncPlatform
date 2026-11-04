/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 screen 2). The card as ONE picture (PNG) the
 * owner sends through his own WhatsApp: the brand line, the worker's name and the line that tells him apart, the QR
 * (which holds only the card address, R6) and the code. Never his phone number or PIN. Drawn on a canvas from the QR
 * image the app already makes with the `qrcode` package; null where the device cannot draw (the caller then shares
 * the card address as text instead).
 */
import QRCode from 'qrcode';
import { cardQrPayload, displayCardCode } from './cardCode';

export interface CardPictureInput {
    brand: string;
    name: string;
    identifyLine?: string;
    code: string;
}

const W = 720;
const H = 1000;

export async function renderCardPicture(input: CardPictureInput): Promise<Blob | null> {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, '#064e3b');
    gradient.addColorStop(1, '#047857');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 30px "Noto Sans Devanagari", sans-serif';
    ctx.fillText(input.brand, 48, 80);
    ctx.font = '800 54px "Noto Sans Devanagari", sans-serif';
    ctx.fillText(input.name, 48, 160, W - 96);
    if (input.identifyLine) {
        ctx.font = '600 32px "Noto Sans Devanagari", sans-serif';
        ctx.fillText(input.identifyLine, 48, 212, W - 96);
    }

    const qrUrl = await QRCode.toDataURL(cardQrPayload(input.code), { errorCorrectionLevel: 'M', margin: 1, width: 440 });
    const qr = await loadImage(qrUrl);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect((W - 480) / 2, 260, 480, 480);
    if (qr) ctx.drawImage(qr, (W - 440) / 2, 280, 440, 440);

    ctx.font = '800 56px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(displayCardCode(input.code), W / 2, 830);

    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });
}
