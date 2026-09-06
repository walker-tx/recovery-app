/** Public bootstrap-owned identity, paired with its actual backend destination. */
export type WorkOSAuthConfig = {
  environmentId: string;
  backendUrl: string;
};

export function getWorkOSAuthConfig(
  environmentId: string | undefined,
  backendUrl: string | undefined,
): WorkOSAuthConfig | null {
  const uuid =
    "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  if (!environmentId || !new RegExp(`^${uuid}:${uuid}$`).test(environmentId)) {
    return null;
  }
  if (!backendUrl || backendUrl.trim() !== backendUrl) {
    return null;
  }
  try {
    const url = new URL(backendUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      backendUrl.includes("?") ||
      backendUrl.includes("#")
    ) {
      return null;
    }
    // Use the parsed origin so Convex appends API paths to the validated destination.
    return { environmentId, backendUrl: url.origin };
  } catch {
    return null;
  }
}

/** In-memory owner/subtree key only; persistence uses environmentId alone. */
export function getWorkOSSessionScope(config: WorkOSAuthConfig): string {
  return JSON.stringify([config.environmentId, config.backendUrl]);
}
