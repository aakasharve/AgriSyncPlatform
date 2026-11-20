import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import LoginPage from '../LoginPage';
import loginSource from '../LoginPage.tsx?raw';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installAdapter, type CapturedRequest, type StubbedAdapter } from '@/test/stubAdapter';

/**
 * spec: trusted-control-room-2026-11-20 (CR-3, Task A7; D-155 (4), D-155b, H10).
 *
 * The sign-in page is the console's own DOOR. There is no password way; "Send me a code" goes to
 * `/shramsafal/admin/sign-in/send-code` and the code is checked at `.../check-code`; every number
 * gets the same calm sentence; a refused code says one sentence. Answers are mocked in the shapes
 * Task A6 pins; the live sign-in is walked by the main session.
 */

const WAIT = 15_000;
const SEND = '/shramsafal/admin/sign-in/send-code';
const CHECK = '/shramsafal/admin/sign-in/check-code';
const CALM =
  'If this number is approved, a code is on its way. No code after a minute? Check the number, or ask Akash.';

let stub: StubbedAdapter | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

/** The door answers a valid number the same way whether or not it is approved (A6). */
function door(check: (req: CapturedRequest) => { status: number; data: unknown }) {
  stub = installAdapter(async (req) => {
    if (req.url.includes(SEND)) {
      return { status: 200, data: { resendAfterSeconds: 60, message: CALM } };
    }
    if (req.url.includes(CHECK)) return check(req);
    return { status: 500, data: {} };
  });
  return stub;
}

async function askForCode(phone: string) {
  await userEvent.type(await screen.findByLabelText('Phone number', undefined, { timeout: WAIT }), phone);
  await userEvent.click(screen.getByRole('button', { name: /Send me a code/ }));
}

const callsTo = (s: StubbedAdapter, part: string) => s.requests.filter((r) => r.url.includes(part));

describe('the console door: the sign-in page', () => {
  it('Send_code_posts_to_the_door_and_never_to_the_farmer_route', async () => {
    const s = door(() => ({ status: 401, data: { error: 'code_not_accepted' } }));
    renderWithProviders(<LoginPage />, { route: '/login' });

    await askForCode('9000000012');

    await screen.findByLabelText('Code from the SMS', undefined, { timeout: WAIT });
    expect(callsTo(s, SEND)).toHaveLength(1);
    expect(callsTo(s, SEND)[0].method).toBe('post');
    expect(s.requests.filter((r) => r.url.includes('/user/auth/'))).toHaveLength(0);
  });

  it('Every_number_sees_the_calm_sentence_and_the_code_step', async () => {
    door(() => ({ status: 401, data: { error: 'code_not_accepted' } }));
    renderWithProviders(<LoginPage />, { route: '/login' });

    // Two numbers, one approved and one not: the page cannot tell them apart, and says the same.
    for (const phone of ['9000000012', '9000000099']) {
      await askForCode(phone);
      expect(await screen.findByText(CALM, undefined, { timeout: WAIT })).toBeInTheDocument();
      expect(screen.getByLabelText('Code from the SMS')).toBeInTheDocument();
      // Nothing says the number was approved or sent.
      expect(screen.queryByText(/We sent a code/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/has been sent/i)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Use a different number' }));
      await screen.findByLabelText('Phone number');
    }
  });

  it('says the page line and the line under the button, word for word', async () => {
    door(() => ({ status: 401, data: {} }));
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(
      await screen.findByText('Sign in with your phone number. Only numbers Akash has approved can sign in.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No code is sent to a number that is not approved.')).toBeInTheDocument();
  });

  it('There_is_no_password_way', async () => {
    renderWithProviders(<LoginPage />, { route: '/login' });
    await screen.findByLabelText('Phone number', undefined, { timeout: WAIT });

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /password/i })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    // And nothing in the page can reach the password route (D-155 (4)): read from the source.
    const code = loginSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('/user/auth/login');
    expect(code).not.toContain('/user/auth/start-otp');
    expect(code).not.toContain('/user/auth/verify-otp');
    expect(code.toLowerCase()).not.toContain('password');
  });

  it('A_refused_code_shows_one_sentence', async () => {
    const s = door(() => ({ status: 401, data: { error: 'code_not_accepted' } }));
    renderWithProviders(<LoginPage />, { route: '/login' });

    await askForCode('9000000012');
    await userEvent.type(await screen.findByLabelText('Code from the SMS', undefined, { timeout: WAIT }), '123456');
    await userEvent.click(screen.getByRole('button', { name: /^Sign in/ }));

    const alert = await screen.findByRole('alert', undefined, { timeout: WAIT });
    expect(alert).toHaveTextContent('That code did not work. Ask for a new code, or ask Akash.');
    expect(callsTo(s, CHECK)).toHaveLength(1);
    expect(callsTo(s, CHECK)[0].method).toBe('post');
    // A new code can be asked for at once.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled());
  });

  it('The_held_sign_in_still_asks_the_account_question', async () => {
    stub = installAdapter(async (req) => {
      if (req.url.includes(SEND)) return { status: 200, data: { resendAfterSeconds: 60, message: CALM } };
      if (req.url.includes(CHECK)) {
        return {
          status: 200,
          data: {
            userId: '00000000-0000-0000-0000-0000000000aa',
            accessToken: 'held-token',
            expiresAtUtc: new Date(Date.now() + 900_000).toISOString(),
            createdNewUser: false,
            deviceCheckRequired: true,
            accountName: 'Example: Field Person',
          },
        };
      }
      if (req.url.includes('/user/auth/device-check')) return { status: 200, data: { outcome: 'declined' } };
      return { status: 500, data: {} };
    });
    renderWithProviders(<LoginPage />, { route: '/login' });

    await askForCode('9000000012');
    await userEvent.type(await screen.findByLabelText('Code from the SMS', undefined, { timeout: WAIT }), '123456');
    await userEvent.click(screen.getByRole('button', { name: /^Sign in/ }));

    expect(await screen.findByText(/Is that you\?/, undefined, { timeout: WAIT })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, it is me' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'No' }));
    await waitFor(() => expect(stub?.requests.some((r) => r.url.includes('/user/auth/device-check'))).toBe(true));
  });

  it('the "sign in again" notice shows when the console sent the person here (H10)', async () => {
    // The page reads the reason from the browser's own address, where `endSession` put it.
    window.history.replaceState({}, '', '/login?signedOut=door-required');
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(await screen.findByText('Sign in again here, with a code sent to your phone.')).toBeInTheDocument();
  });
});
