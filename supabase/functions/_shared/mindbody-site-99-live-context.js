const SITE_ID = "-99";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class Site99LiveContextError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = "Site99LiveContextError";
    this.code = code;
    this.status = status;
  }
}

function text(value) {
  return value == null ? null : String(value).trim() || null;
}

function id(value) {
  return text(value?.Id ?? value?.id ?? value);
}

function normalizedName(value) {
  return text(value)?.normalize("NFKC").replace(/\s+/g, " ").toLowerCase() ?? null;
}

function invalidManifest(detail = "") {
  throw new Site99LiveContextError(
    "SITE_99_LIVE_MANIFEST_INVALID",
    `The Site -99 stable-name manifest is invalid${detail ? ` (${detail})` : ""}.`,
  );
}

export function parseSite99ClassFamilyManifest(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw ?? ""));
  } catch {
    invalidManifest();
  }
  if (!Array.isArray(parsed) || parsed.length === 0) invalidManifest();
  const familyIds = new Set();
  return Object.freeze(parsed.map((family, familyIndex) => {
    const familyId = text(family?.id);
    const pricingOptionName = text(family?.pricingOptionName);
    const selectors = Array.isArray(family?.selectors) ? family.selectors : [];
    if (!UUID.test(familyId ?? "") || familyIds.has(familyId)
      || !pricingOptionName || selectors.length === 0) {
      invalidManifest(`family[${familyIndex}]`);
    }
    familyIds.add(familyId);
    return Object.freeze({
      id: familyId,
      pricingOptionName,
      selectors: Object.freeze(selectors.map((selector, selectorIndex) => {
        const normalized = Object.freeze({
          locationName: text(selector?.locationName),
          programName: text(selector?.programName),
          classDescriptionName: text(selector?.classDescriptionName),
          sessionTypeName: text(selector?.sessionTypeName),
        });
        if (Object.values(normalized).some((value) => !value)) {
          invalidManifest(`family[${familyIndex}].selectors[${selectorIndex}]`);
        }
        return normalized;
      })),
    });
  }));
}

function uniqueNamed(values, name, relationId, kind) {
  let matches = values.filter((value) => normalizedName(value?.Name) === normalizedName(name)
    && (!relationId || !id(value?.Program ?? value?.ProgramId)
      || id(value?.Program ?? value?.ProgramId) === relationId));
  if (matches.length > 1) {
    const active = matches.filter((value) => value?.Active !== false && value?.IsActive !== false);
    if (active.length === 1) matches = active;
  }
  if (matches.length !== 1 || !id(matches[0])) {
    throw new Site99LiveContextError(
      matches.length === 0 ? "SITE_99_SELECTOR_NO_MATCH" : "SITE_99_SELECTOR_AMBIGUOUS",
      `The Site -99 ${kind} selector did not resolve uniquely.`,
      503,
    );
  }
  return matches[0];
}

function allowlistFromFamilies(families) {
  const values = (field) => [...new Set(families.flatMap((family) => family.providerMappings)
    .map((mapping) => mapping[field])
    .filter(Boolean))];
  return {
    location: values("providerLocationId"),
    program: values("providerProgramId"),
    classDescription: values("providerClassDescriptionId"),
    sessionType: values("providerSessionTypeId"),
    classSchedule: [],
  };
}

export async function refreshSite99LiveContext(context, dependencies) {
  if (String(context?.integration?.providerSiteId ?? "") !== SITE_ID) return context;
  const manifest = parseSite99ClassFamilyManifest(dependencies?.manifest);
  const configuredFamilies = Array.isArray(context?.classFamilies) ? context.classFamilies : [];
  if (configuredFamilies.length === 0) {
    throw new Site99LiveContextError(
      "SITE_99_CLASS_FAMILIES_MISSING",
      "The Site -99 Offer has no database-backed Class families.",
    );
  }
  const manifestById = new Map(manifest.map((family) => [family.id, family]));
  if (configuredFamilies.some((family) => !manifestById.has(String(family?.id ?? "")))) {
    throw new Site99LiveContextError(
      "SITE_99_CLASS_FAMILY_MANIFEST_MISMATCH",
      "The Site -99 stable-name manifest does not cover every approved database Class family.",
    );
  }
  const provider = dependencies?.provider;
  if (!provider || typeof provider.getSessionTypes !== "function") {
    throw new TypeError("A Mindbody Class discovery provider is required.");
  }
  const [locations, programs, descriptions, sessionTypes] = await Promise.all([
    provider.getLocations(),
    provider.getPrograms({ scheduleType: "Class" }),
    provider.getClassDescriptions({ includeInactive: true }),
    provider.getSessionTypes({ includeInactive: false }),
  ]);
  const activeLocations = locations.filter((value) => value?.Active !== false && value?.IsActive !== false);
  const activePrograms = programs.filter((value) => value?.Active !== false && value?.IsActive !== false);
  const activeSessionTypes = sessionTypes.filter((value) => value?.Active !== false && value?.IsActive !== false);
  const refreshedFamilies = configuredFamilies.map((configuredFamily) => {
    const stableFamily = manifestById.get(String(configuredFamily.id));
    return {
      ...configuredFamily,
      providerServiceProductName: stableFamily.pricingOptionName,
      providerMappings: stableFamily.selectors.map((selector) => {
        const location = uniqueNamed(activeLocations, selector.locationName, null, "Location");
        const program = uniqueNamed(activePrograms, selector.programName, null, "Program");
        const programId = id(program);
        const description = uniqueNamed(
          descriptions,
          selector.classDescriptionName,
          programId,
          "Class Description",
        );
        const sessionType = uniqueNamed(
          activeSessionTypes,
          selector.sessionTypeName,
          programId,
          "Session Type",
        );
        return {
          providerLocationId: id(location),
          providerClassDescriptionId: id(description),
          providerProgramId: programId,
          providerSessionTypeId: id(sessionType),
        };
      }),
    };
  });
  const inventoryAllowlist = allowlistFromFamilies(refreshedFamilies);
  if (inventoryAllowlist.location.length !== 1) {
    throw new Site99LiveContextError(
      "SITE_99_SELECTOR_LOCATION_NOT_SHARED",
      "Every Site -99 Class family must resolve to the same Location.",
    );
  }
  const providerLocationId = inventoryAllowlist.location[0];
  if (providerLocationId !== "1") {
    throw new Site99LiveContextError(
      "SITE_99_LOCATION_CHANGED",
      "The Site -99 sandbox write gate only permits Location 1.",
    );
  }
  return {
    ...context,
    location: { ...context.location, providerLocationId },
    inventoryAllowlist,
    classFamilies: refreshedFamilies,
    allowInactiveClassDescriptions: true,
  };
}
