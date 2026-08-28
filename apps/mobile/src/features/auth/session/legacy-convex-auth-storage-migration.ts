const LEGACY_CONVEX_AUTH_STORAGE_KEYS = [
  "__convexAuthJWT",
  "__convexAuthOAuthVerifier",
  "__convexAuthRefreshToken",
  "__convexAuthServerStateFetchTime",
] as const;

type DeleteOnlySecureStore = {
  deleteItemAsync(key: string): Promise<void>;
};

export async function migrateLegacyConvexAuthStorage(
  store: DeleteOnlySecureStore,
  convexUrl: string,
) {
  const namespace = convexUrl.replace(/[^a-zA-Z0-9]/g, "");
  await Promise.all(
    LEGACY_CONVEX_AUTH_STORAGE_KEYS.map((key) =>
      store.deleteItemAsync(`${key}_${namespace}`),
    ),
  );
}
