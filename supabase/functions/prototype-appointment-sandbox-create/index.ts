import { appointmentPrototypeUnavailable } from "../_prototype/appointment/runtime.js";

const requiredEnvironment = [
  "MINDBODY_API_KEY",
  "MINDBODY_SANDBOX_SITE_ID",
  "MINDBODY_BASE_URL",
] as const;

type Availability = {
  Staff: { Id: number };
  SessionType: { Id: number };
  StartDateTime: string;
  Location: { Id: number };
};

function mindbodyHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Api-Key": Deno.env.get("MINDBODY_API_KEY")!,
    SiteId: Deno.env.get("MINDBODY_SANDBOX_SITE_ID")!,
  };
}

Deno.serve(async (request) => {
  const unavailable = appointmentPrototypeUnavailable();
  if (unavailable) return unavailable;

  if (request.method !== "POST") {
    return Response.json({ error: "Use POST with a sandbox clientId." }, { status: 405 });
  }

  const missing = requiredEnvironment.filter((name) => !Deno.env.get(name));
  if (missing.length > 0) {
    return Response.json({ error: "Mindbody sandbox configuration is incomplete.", missing }, { status: 500 });
  }

  const { clientId } = await request.json().catch(() => ({}));
  if (!clientId || typeof clientId !== "string") {
    return Response.json({ error: "A sandbox clientId is required." }, { status: 400 });
  }

  const baseUrl = Deno.env.get("MINDBODY_BASE_URL")!.replace(/\/$/, "");
  const start = new Date();
  const end = new Date(start);
  end.setDate(start.getDate() + 14);
  const availabilityResponse = await fetch(
    `${baseUrl}/appointment/bookableitems?SessionTypeIds=200&StartDate=${encodeURIComponent(start.toISOString())}&EndDate=${encodeURIComponent(end.toISOString())}`,
    { headers: mindbodyHeaders() },
  );

  if (!availabilityResponse.ok) {
    return Response.json(
      { error: "Mindbody availability lookup failed.", status: availabilityResponse.status, response: await availabilityResponse.text() },
      { status: availabilityResponse.status },
    );
  }

  const availabilityBody = await availabilityResponse.json();
  const availability = availabilityBody.Availabilities?.[0] as Availability | undefined;
  if (!availability) {
    return Response.json({ error: "No sandbox appointment availability was returned." }, { status: 409 });
  }

  const appointmentResponse = await fetch(`${baseUrl}/appointment/addappointment`, {
    method: "POST",
    headers: mindbodyHeaders(),
    body: JSON.stringify({
      ClientId: clientId,
      LocationId: availability.Location.Id,
      StaffId: availability.Staff.Id,
      SessionTypeId: availability.SessionType.Id,
      StartDateTime: availability.StartDateTime,
      ApplyPayment: false,
      IgnoreDefaultSessionLength: false,
      SendEmail: false,
      // This staff-booking endpoint is retained only as a sandbox diagnostic.
      // It is not the planned Revvi customer-booking integration path.
      Test: true,
    }),
  });

  const body = await appointmentResponse.text();
  if (!appointmentResponse.ok) {
    return Response.json(
      { error: "Mindbody rejected sandbox appointment creation.", status: appointmentResponse.status, response: body },
      { status: appointmentResponse.status },
    );
  }

  return new Response(body, {
    headers: { "Content-Type": appointmentResponse.headers.get("Content-Type") ?? "application/json" },
  });
});
