#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const phrasesPath = path.join(projectRoot, 'public', 'assets', 'shramsathi', 'tts', 'phrases.json');
const outDir = path.join(projectRoot, 'public', 'assets', 'shramsathi', 'tts');

const apiKey = process.env.SARVAM_API_KEY || process.env.SARVAM_API_SUBSCRIPTION_KEY;
const speaker = process.env.SHRAM_SATHI_TTS_SPEAKER || 'shubh';

if (!apiKey) {
    console.log('SARVAM_API_KEY or SARVAM_API_SUBSCRIPTION_KEY is not set. Phrase manifest is ready, no audio generated.');
    process.exit(0);
}

const phrases = JSON.parse(await readFile(phrasesPath, 'utf8'));
await mkdir(outDir, { recursive: true });

for (const [key, text] of Object.entries(phrases)) {
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
        method: 'POST',
        headers: {
            'api-subscription-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text,
            target_language_code: 'mr-IN',
            model: 'bulbul:v3',
            speaker,
            pace: 0.92,
            speech_sample_rate: 24000,
            output_audio_codec: 'mp3',
            temperature: 0.45,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Sarvam TTS failed for ${key}: ${response.status} ${body}`);
    }

    const payload = await response.json();
    const audio = payload?.audios?.[0];
    if (typeof audio !== 'string' || audio.length === 0) {
        throw new Error(`Sarvam TTS response for ${key} did not include audios[0].`);
    }

    await writeFile(path.join(outDir, `${key}.mp3`), Buffer.from(audio, 'base64'));
    console.log(`wrote ${key}.mp3`);
}
