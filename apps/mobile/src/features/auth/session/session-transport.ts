// One effect setup owns one client. Never recycle a retired request queue.
export function createSessionTransport<T extends { close(): Promise<void> }>(
  factory: () => T,
  lifetime: number,
  getLifetime: () => number,
) {
  const client = factory();
  let retired = false;
  return {
    client,
    async fetchAccessToken(
      fetchToken: (input: { forceRefreshToken: boolean }) => Promise<string | null>,
      input: { forceRefreshToken: boolean },
    ) {
      if (retired || getLifetime() !== lifetime) return null;
      const token = await fetchToken(input);
      return !retired && getLifetime() === lifetime ? token : null;
    },
    retire() {
      if (retired) return;
      retired = true;
      // ConvexProviderWithAuth's descendant cleanup calls clearAuth. Let that
      // finish before close makes the client's sync getter permanently unusable.
      queueMicrotask(() => { void client.close(); });
    },
  };
}
