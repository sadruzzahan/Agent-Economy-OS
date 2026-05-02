export function publishableKeyFromHost(hostname: string, publishableKey: string | undefined): string {
  if (hostname.endsWith(".replit.dev") || hostname.endsWith(".replit.app")) {
    const key = publishableKey?.replace("pk_live_", "pk_test_");
    if (!key) throw new Error("Missing Clerk Publishable Key");
    return key;
  }
  if (!publishableKey) throw new Error("Missing Clerk Publishable Key");
  return publishableKey;
}
