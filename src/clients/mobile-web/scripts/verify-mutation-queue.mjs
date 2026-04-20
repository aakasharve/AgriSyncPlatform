import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceRoot = path.resolve(__dirname, '../src');

const allowlistedWriteCalls = new Map([
    ['pushSyncBatch', ['infrastructure/sync/BackgroundSyncWorker.ts']],
    ['uploadAttachmentFile', ['infrastructure/sync/AttachmentUploadWorker.ts']],
]);

const forbiddenWriteCalls = [
    'createAttachment',
];

const extensionSet = new Set(['.ts', '.tsx']);

function toRelative(filePath) {
    return path.relative(sourceRoot, filePath).replaceAll('\\', '/');
}

function collectSourceFiles(directory, sink) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'dist' || entry.name === 'node_modules') {
            continue;
        }

        const next = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectSourceFiles(next, sink);
            continue;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (!extensionSet.has(extension)) {
            continue;
        }

        sink.push(next);
    }
}

function findCallSites(files, methodName) {
    const regex = new RegExp(`agriSyncClient\\.${methodName}\\s*\\(`, 'g');
    const matches = [];
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        if (regex.test(text)) {
            matches.push(toRelative(file));
        }
    }

    return matches;
}

const files = [];
collectSourceFiles(sourceRoot, files);

const violations = [];
for (const method of forbiddenWriteCalls) {
    const usage = findCallSites(files, method);
    if (usage.length > 0) {
        violations.push(`Forbidden direct write call agriSyncClient.${method}() found in: ${usage.join(', ')}`);
    }
}

for (const [method, allowlist] of allowlistedWriteCalls) {
    const usage = findCallSites(files, method);
    const disallowed = usage.filter(file => !allowlist.includes(file));
    if (disallowed.length > 0) {
        violations.push(`agriSyncClient.${method}() used outside allowlist: ${disallowed.join(', ')}`);
    }
}

const mutationEnqueueUsage = [];
for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('mutationQueue.enqueue(')) {
        mutationEnqueueUsage.push(toRelative(file));
    }
}

if (mutationEnqueueUsage.length === 0) {
    violations.push('No mutationQueue.enqueue(...) call was found in source.');
}

if (violations.length > 0) {
    console.error('MutationQueue verification failed:');
    for (const violation of violations) {
        console.error(`- ${violation}`);
    }

    process.exit(1);
}

console.log('MutationQueue verification passed.');
console.log(`mutationQueue.enqueue call sites: ${mutationEnqueueUsage.join(', ')}`);
