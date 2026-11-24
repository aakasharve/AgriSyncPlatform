/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass F3) — the product card the saved screen opens: the result screen's own
 * `ProductCard` (every fact, the हो / नाही / फोटो answers through the answer kit, the "did you mean" names, the close words — all
 * unchanged), drawn in the approved design's look (`.pcard`) by a scoped stylesheet. The flag-off screen opens `ProductCard`
 * directly and never sees this look.
 */
import React from 'react';
import ProductCard, { type ProductCardProps } from '../voiceResult/ProductCard';
import './savedProductCard.css';

export const SavedProductCard: React.FC<ProductCardProps> = (props) => (
    <div className="vr2-pcard" data-testid="vr2-product-card">
        <ProductCard {...props} />
    </div>
);

export default SavedProductCard;
