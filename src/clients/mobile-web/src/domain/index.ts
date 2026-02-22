/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain Layer Index
 *
 * Pure type definitions only. No business logic.
 * - types/ - Domain type definitions
 * - ai/contracts/ - AI type definitions
 * - ledger/ - Ledger type definitions
 *
 * Note: System services (Clock, IdGenerator, DateKeyService) are in core/domain/services/
 * Note: Selection selectors are in application/selectors/ContextSelectors.ts
 * Note: SoftDeletePolicy is in application/policies/SoftDeletePolicy.ts
 */

// Domain Types
export * from './types';
