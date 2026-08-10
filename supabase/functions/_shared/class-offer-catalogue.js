import { OfferAuthorizationError } from "./class-offer-authorization.js";

function databaseError(message) {
  return new OfferAuthorizationError("AUTHORIZATION_UNAVAILABLE", message, 503);
}

export function createClassOfferCatalogue(supabase) {
  return {
    async resolveCustomer(memberstackMemberId) {
      const { data, error } = await supabase
        .rpc("resolve_class_revvi_customer", {
          candidate_memberstack_member_id: memberstackMemberId,
        });
      if (error) throw databaseError("Revvi Customer identity could not be resolved.");
      if (!Array.isArray(data) || data.length !== 1) {
        throw databaseError("Revvi Customer identity could not be resolved.");
      }
      return {
        id: data[0].customer_id,
        memberstackMemberId: data[0].memberstack_member_id,
        eligibilityOverride: data[0].eligibility_override,
      };
    },

    async resolveOfferContext({ businessId, locationId, offerId }) {
      const [businessResult, locationResult, offerResult] = await Promise.all([
        supabase.from("class_businesses").select("id, status").eq("id", businessId).maybeSingle(),
        supabase.from("class_business_locations").select("id, business_id, enabled")
          .eq("id", locationId).eq("business_id", businessId).maybeSingle(),
        supabase.from("class_revvi_offers")
          .select("id, business_id, location_id, status, eligible_memberstack_plan_ids")
          .eq("id", offerId).eq("business_id", businessId).eq("location_id", locationId).maybeSingle(),
      ]);
      if (businessResult.error || locationResult.error || offerResult.error) {
        throw databaseError("Revvi Offer authorization context could not be loaded.");
      }
      return {
        business: businessResult.data,
        location: locationResult.data
          ? {
            id: locationResult.data.id,
            businessId: locationResult.data.business_id,
            enabled: locationResult.data.enabled,
          }
          : null,
        offer: offerResult.data
          ? {
            id: offerResult.data.id,
            businessId: offerResult.data.business_id,
            locationId: offerResult.data.location_id,
            status: offerResult.data.status,
            eligibleMemberstackPlanIds: offerResult.data.eligible_memberstack_plan_ids,
          }
          : null,
      };
    },

    async recordAuthorizationCheck(context) {
      const [matchedConnection] = context.eligibility.matchedConnections;
      const { error } = await supabase.from("class_offer_authorization_checks").insert({
        business_id: context.business.id,
        location_id: context.location.id,
        offer_id: context.offer.id,
        customer_id: context.customer.id,
        purpose: context.purpose,
        memberstack_member_id: context.customer.memberstackMemberId,
        memberstack_plan_id: matchedConnection.planId,
        memberstack_plan_connection_id: matchedConnection.connectionId,
        memberstack_plan_status: matchedConnection.status,
        checked_at: context.eligibility.verifiedAt,
      });
      if (error) throw databaseError("Revvi Offer authorization evidence could not be recorded.");
    },
  };
}
