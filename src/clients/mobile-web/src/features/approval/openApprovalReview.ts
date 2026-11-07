/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 (I28, lane L4b; founder D-3 "one approval path, same result from every entry point") — THE door. The
 * strip, the waiting drawer, आढावा, the हजेरी page's तपासा, the dashboard's तपासायचं and a job card's
 * linked record all call this, and it opens the one review sheet (`ApprovalReviewHost`, mounted once by the router)
 * on the one list (`approvalQueue`). The event is the existing cross-tree hop (`OPEN_REVIEW_INBOX_EVENT`) the strip
 * already used, so a door outside the router's provider tree reaches it too.
 */
import { requestOpenReviewInbox } from '../oversight/oversightNavigationEvents';
import { setApprovalFocus } from './approvalQueue';

/** Opens the one review sheet; `logId` puts that record first (a door that is about one record). */
export function openApprovalReview(logId?: string | null): void {
    setApprovalFocus(logId ?? null);
    requestOpenReviewInbox();
}
