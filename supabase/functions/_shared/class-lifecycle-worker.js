function terminalSupport(work) {
  return work.attemptCount >= 96;
}

function cancellationReadInput(context) {
  const waitlist = context.attempt.type === "waitlist_removal";
  return {
    removalType: waitlist ? "waitlist" : "roster",
    classId: context.booking.classId,
    clientId: context.booking.clientId,
    clientUniqueId: context.booking.clientUniqueId,
    ...(waitlist
      ? { waitlistEntryId: context.booking.waitlistEntryId }
      : { visitId: context.booking.visitId }),
  };
}

function restorationReadInput(context) {
  return {
    classId: context.booking.classId,
    clientId: context.booking.clientId,
    clientServiceId: context.booking.clientServiceId,
    baseline: context.booking.restorationBaseline,
  };
}

export async function runClassLifecycleWorker(dependencies, limit = 25) {
  const webhookEvents = await dependencies.catalogue.claimWebhookBatch(limit);
  let webhookQueued = 0;
  for (const event of webhookEvents) {
    webhookQueued += await dependencies.catalogue.processWebhook(event.id);
  }

  const workItems = await dependencies.catalogue.claimLifecycleBatch(limit);
  const results = [];
  for (const work of workItems) {
    try {
      const context = await dependencies.catalogue.resolveLifecycleContext(work);
      const provider = await dependencies.createProvider(context);
      if (work.purpose === "cancellation") {
        const cancellationAlreadyConfirmed = context.booking.status === "cancelled"
          && ["confirmed", "reconciled"].includes(context.booking.cancellationStatus);
        if (!cancellationAlreadyConfirmed) {
          const observation = await provider.reconcileCancellation(cancellationReadInput(context));
          if (observation.status === "cancelled" && observation.authoritativeCancelled === true) {
            await dependencies.catalogue.reconcileCancellationFromRead(context, observation);
          } else {
            const status = terminalSupport(work) ? "requires_support" : "queued";
            await dependencies.catalogue.reconcileCancellationFromRead(context, observation);
            await dependencies.catalogue.finishLifecycle({
              id: work.id,
              status,
              errorCode: observation.errorCode ?? "CANCELLATION_STATUS_UNKNOWN",
            });
            results.push({ id: work.id, status });
            continue;
          }
        }

        if (context.booking.fulfilmentMode === "existing_entitlement") {
          const restoration = await provider.reconcileEntitlementRestoration(restorationReadInput(context));
          await dependencies.catalogue.recordEntitlementRestoration(context, restoration);
          if (!["confirmed", "failed"].includes(restoration.status)) {
            const status = terminalSupport(work) ? "requires_support" : "queued";
            await dependencies.catalogue.finishLifecycle({
              id: work.id,
              status,
              errorCode: restoration.errorCode ?? "ENTITLEMENT_RESTORATION_UNKNOWN",
            });
            results.push({ id: work.id, status });
            continue;
          }
        }

        await dependencies.catalogue.finishLifecycle({ id: work.id, status: "completed" });
        results.push({ id: work.id, status: "completed" });
        continue;
      }

      const observation = await provider.reconcileBooking({
        mode: context.booking.fulfilmentMode,
        classId: context.booking.classId,
        clientId: context.booking.clientId,
        serviceProductId: context.booking.serviceProductId,
      });
      if (context.booking.status === "unknown"
        && ["confirmed", "waitlisted"].includes(observation.status)) {
        await dependencies.catalogue.completeBookingReconciliation(context, observation);
        await dependencies.catalogue.finishLifecycle({ id: work.id, status: "completed" });
        results.push({ id: work.id, status: "completed" });
        continue;
      }
      if ((context.booking.status === "confirmed" && observation.status === "confirmed")
        || (context.booking.status === "waitlisted" && observation.status === "waitlisted")) {
        await dependencies.catalogue.finishLifecycle({ id: work.id, status: "completed" });
        results.push({ id: work.id, status: "completed" });
        continue;
      }
      const status = terminalSupport(work) ? "requires_support" : "queued";
      await dependencies.catalogue.finishLifecycle({
        id: work.id,
        status,
        errorCode: observation.errorCode ?? "BOOKING_STATUS_UNRESOLVED",
      });
      results.push({ id: work.id, status });
    } catch {
      const status = terminalSupport(work) ? "requires_support" : "queued";
      await dependencies.catalogue.finishLifecycle({
        id: work.id,
        status,
        errorCode: "LIFECYCLE_PROVIDER_READ_FAILED",
      });
      results.push({ id: work.id, status });
    }
  }
  return { webhooksProcessed: webhookEvents.length, webhookBookingsQueued: webhookQueued, reconciliations: results };
}
