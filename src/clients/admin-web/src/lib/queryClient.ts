import { QueryClient } from '@tanstack/react-query';

/**
 * Everything the console has loaded from the server is kept here, in memory, for the pages to
 * show again without asking. All of it belongs to the person who is signed in, so it is emptied
 * at every end of a session and at every sign-in (see `forgetSession` in api.ts and `login` in
 * AdminAuthProvider.tsx).
 *
 * It lives in its own file so that api.ts, which is not a React component, can empty it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
