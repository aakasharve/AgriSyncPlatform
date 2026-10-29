/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec R-11 (c) — which server refusals are HELD (the farm's trial / plan), not a network blip and
 * not a conflict for the farmer.
 */

import { describe, it, expect } from 'vitest';
import { categorizeRejection, isEntitlementHeldRejection } from '../RejectionPolicy';

describe('RejectionPolicy.isEntitlementHeldRejection', () => {
    it.each([
        'entitlement.subscriptionexpired',
        'entitlement.subscriptionmissing',
        'entitlement.subscriptionpastdueforwrite',
        'entitlement.subscriptioncanceled',
        'entitlement.subscriptionsuspended',
        'Entitlement.SubscriptionExpired',
    ])('holds %s', (code) => {
        expect(isEntitlementHeldRejection({ errorCode: code })).toBe(true);
    });

    it('does not hold a refusal about the PERSON (no membership) — waiting cannot fix that', () => {
        expect(isEntitlementHeldRejection({ errorCode: 'entitlement.nomembership' })).toBe(false);
    });

    it('needs the entitlement prefix — a look-alike tail from another family is not held', () => {
        expect(isEntitlementHeldRejection({ errorCode: 'ShramSafal.SubscriptionExpired' })).toBe(false);
        expect(isEntitlementHeldRejection({ errorCode: 'SUBSCRIPTIONEXPIRED' })).toBe(false);
    });

    it('never holds on a message alone', () => {
        expect(isEntitlementHeldRejection({ errorCode: null })).toBe(false);
        expect(isEntitlementHeldRejection({ errorCode: '' })).toBe(false);
    });

    it('was RETRYABLE before R-11 (the defect): the generic categorizer still says so, which is why the worker tests HELD first', () => {
        expect(categorizeRejection({
            errorCode: 'entitlement.subscriptionexpired',
            errorMessage: 'Farm subscription has expired. Renew to continue.',
        })).toBe('RETRYABLE');
    });
});
