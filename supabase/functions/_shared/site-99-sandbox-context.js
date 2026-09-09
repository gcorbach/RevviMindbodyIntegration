// Callers must first authorize the member and resolve the tenant-owned context.
// Sandbox routing is an Offer capability, never a Customer allowlist.
export function isEnabledSite99SandboxContext(context) {
  return context?.integration?.environment === "sandbox"
    && context.integration.providerSiteId === "-99"
    && context?.location?.providerLocationId === "1"
    && context?.mapping?.paidPaymentRoute === "mindbody_sandbox_cash"
    && context.mapping.sandboxDemoWriteEnabled === true;
}
