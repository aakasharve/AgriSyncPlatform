# @agrisync/sync-contract

Single source of truth for every sync mutation type in AgriSync.

## Invariants
1. `schemas/mutation-types.json` is the only place the list of mutation
   names lives.
2. All other declarations (TS union, frontend allow-list, backend
   dispatch, payload records) are **generated** from this JSON and must
   not be hand-edited.
3. Adding a mutation:
   - Add a JSON entry under `mutationTypes`.
   - Add a Zod schema under `schemas/payloads/<mutation>.zod.ts`.
   - Add a C# record under `schemas/payloads-csharp/<Mutation>Payload.cs`.
   - Run `npm run generate`.
   - Implement the handler under
     `src/apps/<App>/Application/UseCases/...`.
   - Add a backend dispatch case (the test will tell you which file).
   - Open a PR; CI runs the contract tests across both languages.

## Local development
```bash
npm install
npm run validate     # lint the JSON
npm run generate     # writes generated files in mobile-web + .NET
npm run test         # contract tests
```

## CI
Workflow `.github/workflows/sync-contract.yml` regenerates and diffs.
A non-empty diff fails CI.
