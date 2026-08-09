const DISABLED_RESPONSE = {
  code: "APPOINTMENT_PROTOTYPE_DISABLED",
  error: "The retained Appointment prototype is available only in an explicitly enabled local sandbox.",
};

export function appointmentPrototypeUnavailable(environment = Deno.env.toObject()) {
  const isDeployed = Boolean(environment.DENO_DEPLOYMENT_ID);
  const isExplicitlyEnabled = environment.REVVI_APPOINTMENT_PROTOTYPE_ENABLED === "true";

  if (!isDeployed && isExplicitlyEnabled) return null;

  return Response.json(DISABLED_RESPONSE, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
