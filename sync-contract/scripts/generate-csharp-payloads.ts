// T-IGH-02-CS-PAYLOADS: emit one public C# record per Zod payload schema.
//
// Walks the runtime Zod definitions exported from
// `sync-contract/schemas/payloads/index.ts`, then writes
// `<PayloadSchema>Payload.cs` files into
// `sync-contract/schemas/payloads-csharp/`. The csproj of
// ShramSafal.Application is wired to <Compile Include> that directory,
// so `using ShramSafal.Application.Contracts.Sync.Payloads;` resolves to
// the generated records.
//
// Run with: `npm run generate:csharp` (uses Node's
// --experimental-strip-types so we don't need to add tsx / ts-node).

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import * as payloadModule from '../schemas/payloads/index.ts';

// -------- Zod introspection helpers ---------------------------------------
// We deliberately import the runtime Zod schemas (not the AST) and walk
// their `_def` shape. Zod 3 exposes:
//   ZodObject     → ._def.shape() returns the field map
//   ZodString     → ._def.checks: { kind: 'datetime' | 'regex' | 'min' ... }
//   ZodNumber     → ._def.checks: { kind: 'int' | 'min' | 'max' ... }
//   ZodArray      → ._def.type: child schema
//   ZodEnum       → ._def.values: string[]
//   ZodOptional   → ._def.innerType
//
// Anything we don't recognize falls back to `object` with a "// TODO"
// breadcrumb so the generator never silently emits the wrong type.
//
// IMPORTANT: regex-detection is brittle by nature. We pin the two regex
// shapes we care about (UUID v4 and YYYY-MM-DD) by inspecting the regex
// source string, not by reference equality — `_shared.zod.ts` exports
// fresh `RegExp` instances per import.

const UUID_REGEX_SRC = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const LOG_DATE_REGEX_SRC = '^\\d{4}-\\d{2}-\\d{2}$';

interface CSharpField {
    name: string; // PascalCase
    csharpType: string; // e.g. "Guid", "string", "DateTime?", "IReadOnlyList<Foo>"
    isOptional: boolean;
    docs: string[]; // optional XML-doc lines
}

interface CSharpRecord {
    name: string; // PascalCase, suffix "Payload"
    fields: CSharpField[];
    nestedRecords: CSharpRecord[];
}

function pascalCase(camel: string): string {
    return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function unwrapOptional(schema: any): { inner: any; optional: boolean } {
    if (schema?._def?.typeName === 'ZodOptional') {
        return { inner: schema._def.innerType, optional: true };
    }
    return { inner: schema, optional: false };
}

function mapStringCheck(checks: Array<{ kind: string; regex?: RegExp }>): string {
    // Datetime takes precedence over regex.
    if (checks.some((c) => c.kind === 'datetime')) {
        return 'DateTime';
    }
    for (const check of checks) {
        if (check.kind === 'regex' && check.regex instanceof RegExp) {
            const src = check.regex.source;
            if (src === UUID_REGEX_SRC) return 'Guid';
            if (src === LOG_DATE_REGEX_SRC) return 'DateOnly';
        }
    }
    return 'string';
}

function mapNumberCheck(checks: Array<{ kind: string }>): string {
    return checks.some((c) => c.kind === 'int') ? 'int' : 'decimal';
}

function mapZodToCSharp(
    schema: any,
    nestedRecordSink: CSharpRecord[],
    nestedRecordPrefix: string,
): { csharpType: string; docs: string[] } {
    const docs: string[] = [];
    const { inner } = unwrapOptional(schema);
    const def = inner?._def;

    if (!def) {
        return { csharpType: 'object', docs: ['// generator: schema had no _def — emitted as object'] };
    }

    switch (def.typeName) {
        case 'ZodString':
            return { csharpType: mapStringCheck(def.checks ?? []), docs };
        case 'ZodNumber':
            return { csharpType: mapNumberCheck(def.checks ?? []), docs };
        case 'ZodBoolean':
            return { csharpType: 'bool', docs };
        case 'ZodArray': {
            const child = mapZodToCSharp(def.type, nestedRecordSink, nestedRecordPrefix);
            docs.push(...child.docs);
            return { csharpType: `IReadOnlyList<${child.csharpType}>`, docs };
        }
        case 'ZodEnum': {
            const values = (def.values as string[]).map((v) => `"${v}"`).join(', ');
            docs.push(`/// <summary>Allowed values: ${values}.</summary>`);
            return { csharpType: 'string', docs };
        }
        case 'ZodObject': {
            // Inline nested record (e.g. AllocationPayload, TestResultPayload).
            const childRecord = buildRecordFromShape(
                `${nestedRecordPrefix}Item`,
                def.shape(),
                nestedRecordSink,
            );
            nestedRecordSink.push(childRecord);
            return { csharpType: childRecord.name, docs };
        }
        case 'ZodAny':
        case 'ZodUnknown':
            return { csharpType: 'object', docs: ['// generator: ZodAny / ZodUnknown'] };
        default:
            return {
                csharpType: 'object',
                docs: [`// generator: unhandled zod typeName ${def.typeName} — emitted as object`],
            };
    }
}

function buildRecordFromShape(
    recordName: string,
    shape: Record<string, any>,
    nestedRecordSink: CSharpRecord[],
): CSharpRecord {
    const fields: CSharpField[] = [];
    for (const [fieldName, fieldSchema] of Object.entries(shape)) {
        const { optional } = unwrapOptional(fieldSchema);
        const { csharpType, docs } = mapZodToCSharp(
            fieldSchema,
            nestedRecordSink,
            pascalCase(fieldName),
        );
        fields.push({
            name: pascalCase(fieldName),
            csharpType: optional ? `${csharpType}?` : csharpType,
            isOptional: optional,
            docs,
        });
    }
    return { name: recordName, fields, nestedRecords: [] };
}

function emitRecord(record: CSharpRecord, indent = ''): string[] {
    const lines: string[] = [];

    // C# positional records require required parameters BEFORE any with
    // a default value (CS1737). The Zod schema doesn't constrain field
    // order, so we sort here: required first, optional second. Field
    // order within each group is preserved (stable sort).
    const sortedFields = [
        ...record.fields.filter((f) => !f.isOptional),
        ...record.fields.filter((f) => f.isOptional),
    ];

    const params = sortedFields.map((f) => {
        const defaultValue = f.isOptional ? ' = null' : '';
        // XML doc lines belong on their OWN line above the parameter, not
        // tail-appended (a `// foo` tail breaks the comma chain).
        const docLines = f.docs.map((d) => `${indent}    ${d}`);
        const param = `${indent}    ${f.csharpType} ${f.name}${defaultValue}`;
        return [...docLines, param].join('\n');
    });

    lines.push(`${indent}public sealed record ${record.name}(`);
    lines.push(params.join(',\n'));
    lines.push(`${indent});`);
    return lines;
}

function emitFile(record: CSharpRecord, sourceModule: string): string {
    const lines: string[] = [];
    lines.push('// <auto-generated>');
    lines.push('//   Source: sync-contract/schemas/payloads/' + sourceModule);
    lines.push('//   Regenerate with: cd sync-contract && npm run generate:csharp');
    lines.push('// </auto-generated>');
    lines.push('');
    lines.push('#nullable enable');
    lines.push('');
    lines.push('using System;');
    lines.push('using System.Collections.Generic;');
    lines.push('');
    lines.push('namespace ShramSafal.Application.Contracts.Sync.Payloads;');
    lines.push('');
    for (const nested of record.nestedRecords) {
        lines.push(...emitRecord(nested));
        lines.push('');
    }
    lines.push(...emitRecord(record));
    lines.push('');
    return lines.join('\n');
}

// -------- Main ------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const outDir = resolve(__dirname, '..', 'schemas', 'payloads-csharp');
await mkdir(outDir, { recursive: true });

// Build a map of ZodSchema → fileName so the auto-generated header can
// point at the canonical source file.
const payloadsDir = resolve(__dirname, '..', 'schemas', 'payloads');
const payloadFiles = (await readdir(payloadsDir)).filter(
    (f) => f.endsWith('.zod.ts') && f !== '_shared.zod.ts',
);
const exportToFile = new Map<string, string>();
for (const file of payloadFiles) {
    const contents = await readFile(resolve(payloadsDir, file), 'utf8');
    const match = contents.match(/export const (\w+Payload)\b/);
    if (match) {
        exportToFile.set(match[1], file);
    }
}

let writtenCount = 0;
let skippedCount = 0;
const skipped: string[] = [];

for (const [exportName, schema] of Object.entries(payloadModule)) {
    if (!exportName.endsWith('Payload')) continue;
    const def = (schema as any)?._def;
    if (def?.typeName !== 'ZodObject') {
        skippedCount++;
        skipped.push(`${exportName}: typeName=${def?.typeName ?? 'unknown'} — only ZodObject is supported`);
        continue;
    }
    const sourceFile = exportToFile.get(exportName) ?? '(unknown)';
    const nestedRecordSink: CSharpRecord[] = [];
    const record = buildRecordFromShape(exportName, def.shape(), nestedRecordSink);
    record.nestedRecords = nestedRecordSink;
    const cs = emitFile(record, sourceFile);
    const outPath = resolve(outDir, `${exportName}.cs`);
    await writeFile(outPath, cs, 'utf8');
    writtenCount++;
}

console.log(`Wrote ${writtenCount} C# payload record(s) to ${outDir}`);
if (skippedCount > 0) {
    console.log(`Skipped ${skippedCount} non-ZodObject schemas:`);
    for (const s of skipped) console.log(`  - ${s}`);
}
