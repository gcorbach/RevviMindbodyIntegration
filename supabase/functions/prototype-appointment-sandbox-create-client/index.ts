import { appointmentPrototypeUnavailable } from "../_prototype/appointment/runtime.js";

const requiredEnvironment = [
  "MINDBODY_API_KEY",
  "MINDBODY_SANDBOX_SITE_ID",
  "MINDBODY_BASE_URL",
] as const;

Deno.serve(async (request) => {
  const unavailable = appointmentPrototypeUnavailable();
  if (unavailable) return unavailable;

  if (request.method !== "POST") {
    return Response.json({ error: "Use POST to create a disposable sandbox client." }, { status: 405 });
  }

  const missing = requiredEnvironment.filter((name) => !Deno.env.get(name));
  if (missing.length > 0) {
    return Response.json({ error: "Mindbody sandbox configuration is incomplete.", missing }, { status: 500 });
  }

  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const baseUrl = Deno.env.get("MINDBODY_BASE_URL")!.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/client/addclient`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Api-Key": Deno.env.get("MINDBODY_API_KEY")!,
      SiteId: Deno.env.get("MINDBODY_SANDBOX_SITE_ID")!,
    },
    body: JSON.stringify({
      FirstName: "Revvi",
      LastName: "Sandbox",
      Email: `revvi-sandbox-${timestamp}@example.test`,
      BirthDate: "1990-01-01T00:00:00",
      ReferredBy: "Sandbox test",
      AddressLine1: "123 Sandbox Way",
      City: "San Luis Obispo",
      State: "CA",
      PostalCode: "93401",
      MobilePhone: "5555550100",
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    return Response.json(
      { error: "Mindbody rejected sandbox client creation.", status: response.status, response: body },
      { status: response.status },
    );
  }

  return new Response(body, {
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
});
