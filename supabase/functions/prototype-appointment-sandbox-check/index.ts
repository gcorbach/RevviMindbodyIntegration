import { appointmentPrototypeUnavailable } from "../_prototype/appointment/runtime.js";

const requiredEnvironment = [
  "MINDBODY_API_KEY",
  "MINDBODY_SANDBOX_SITE_ID",
  "MINDBODY_BASE_URL",
] as const;

function configurationError() {
  const missing = requiredEnvironment.filter((name) => !Deno.env.get(name));

  return Response.json(
    {
      error: "Mindbody sandbox configuration is incomplete.",
      missing,
    },
    { status: 500 },
  );
}

Deno.serve(async (request) => {
  const unavailable = appointmentPrototypeUnavailable();
  if (unavailable) return unavailable;

  if (requiredEnvironment.some((name) => !Deno.env.get(name))) {
    return configurationError();
  }

  const baseUrl = Deno.env.get("MINDBODY_BASE_URL")!.replace(/\/$/, "");
  const check = new URL(request.url).searchParams.get("check") ?? "payment-types";
  const availabilityStart = new Date();
  const availabilityEnd = new Date(availabilityStart);
  availabilityEnd.setDate(availabilityStart.getDate() + 14);
  const paths: Record<string, string> = {
    "payment-types": "/site/paymenttypes",
    "session-types": "/site/sessiontypes?Limit=10",
    availability:
      `/appointment/bookableitems?SessionTypeIds=23&StartDate=${encodeURIComponent(availabilityStart.toISOString())}&EndDate=${encodeURIComponent(availabilityEnd.toISOString())}`,
  };
  const path = paths[check];

  if (!path) {
    return Response.json(
      { error: "Unknown check.", supportedChecks: Object.keys(paths) },
      { status: 400 },
    );
  }

  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Api-Key": Deno.env.get("MINDBODY_API_KEY")!,
      SiteId: Deno.env.get("MINDBODY_SANDBOX_SITE_ID")!,
    },
  });

  const body = await response.text();

  if (!response.ok) {
    return Response.json(
      {
        error: `Mindbody rejected the ${check} capability check.`,
        status: response.status,
        response: body,
      },
      { status: response.status },
    );
  }

  return new Response(body, {
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
});
