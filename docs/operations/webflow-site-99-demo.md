# Physical Webflow Site -99 demo

This preview lets Revvi demonstrate the existing Webflow Booking widget against live Mindbody public-sandbox Class data. It is a local, loopback-only provider demo—not a production deployment.

## What the audience sees

1. A Revvi Yoga Offer at the Mindbody public-sandbox Location.
2. A current Yoga Class occurrence discovered live from Site `-99`.
3. A client-aware `$13 USD` quote calculated twice with `Test=true` and no provider mutation.
4. A **Confirm Booking** action using fictitious sandbox Cash; no card details are collected.
5. A truthful confirmation only after the Sale, Cash Payment, ClientService, Visit, roster, and Client Schedule converge.
6. A ten-minute inspection window in which the exact Visit remains active in Mindbody Business.
7. Manual cleanup from the widget, with automatic and shutdown cleanup as safety backstops.

The page labels that its local identity does not prove Memberstack. The hosted Webflow staging demo must use a real Memberstack test member instead.

## Start the preview

Build the committed Webflow assets:

```powershell
pnpm build:webflow
```

Load the Site `-99` credentials into the current PowerShell process without saving them to a file or command history:

```powershell
$env:MINDBODY_API_KEY = Read-Host "Mindbody sandbox API key"
$env:MINDBODY_SANDBOX_USERNAME = Read-Host "Mindbody sandbox staff username"
$mindbodyPassword = Read-Host "Mindbody sandbox staff password" -AsSecureString
$env:MINDBODY_SANDBOX_PASSWORD = [System.Net.NetworkCredential]::new("", $mindbodyPassword).Password
$env:MINDBODY_SANDBOX_SITE_ID = "-99"
$env:MINDBODY_SANDBOX_WRITE_CONFIRM = "BOOK_AND_CANCEL_SITE_-99"
pnpm demo:webflow:site99
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) on the same computer. The server binds only to `127.0.0.1`; it is not exposed to the local network or internet.

Stop it with `Ctrl+C`. The server first cleans any active demo Booking and only exits after Mindbody confirms removal. If cleanup is not confirmed, it remains running so you can retry. Then clear the process environment:

```powershell
Remove-Item Env:MINDBODY_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:MINDBODY_SANDBOX_USERNAME -ErrorAction SilentlyContinue
Remove-Item Env:MINDBODY_SANDBOX_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:MINDBODY_SANDBOX_SITE_ID -ErrorAction SilentlyContinue
Remove-Item Env:MINDBODY_SANDBOX_WRITE_CONFIRM -ErrorAction SilentlyContinue
$mindbodyPassword = $null
```

## How to test it physically

Use this short script during the demonstration:

1. Point out the purple sandbox boundary banner.
2. Show that the Class name, time, and provisional price load from Mindbody rather than being typed into the page.
3. Select the Class and show the provider-calculated quote and cancellation explanation.
4. Click **Confirm Booking** once. The operation can take several seconds because it waits for six independent Mindbody evidence surfaces.
5. Leave the confirmation page open. It gives the searchable synthetic Client name/ID, Cash Sale ID, Visit ID, and automatic-cleanup time.
6. In a second tab, sign in at [Mindbody Business](https://business.mindbodyonline.com/) and select Site `-99`.
7. Search Clients for the exact `Revvi Sandbox …` name or Client ID shown by the widget. Open that Client and inspect its upcoming schedule/visits; the displayed Visit should still be active. The displayed Cash Sale is available in the Client's purchase history.
8. Return to the widget and click **Clean up demo Booking**. Double-clicking is suppressed. Wait for **Sandbox Booking verified and removed safely**.
9. Refresh the Mindbody Client or Class roster and confirm the Visit is gone. The sandbox Sale can remain as retained evidence.
10. Refresh the demo page to demonstrate fresh live discovery rather than cached fixture data.

If you do not click the cleanup button, the server attempts exact cleanup after ten minutes. It retries if another provider request is in progress. Pressing `Ctrl+C` also attempts cleanup before shutdown.

If the result says it is being reconciled, do not click again with a new request. Keep the server running and retain the terminal's safe error code so exact cleanup can continue.

## What is still needed for the hosted Revvi demo

The same widget can be placed on a Webflow staging Offer page, but a truthful end-to-end hosted demo additionally requires:

- Webflow staging-page publish access and a place to host the versioned `dist/` assets.
- A hosted or HTTPS-tunnelled Supabase staging backend.
- The Revvi Memberstack test app ID and server secret.
- One eligible Memberstack test plan ID and test Customer.
- The Webflow staging origin added to the server allowlist.

The hosted page must not reuse the local demo identity. Memberstack must provide the browser JWT and the backend must re-read the current test Customer before every provider write.

## Boundaries

- The preview cannot target any Mindbody Site other than `-99` or any origin other than Mindbody's official Public API origin.
- Every committed run uses a unique, non-personal synthetic Mindbody Client.
- The Cash tender is fictitious sandbox evidence only.
- This does not prove the production payment route in issue #40 or activate a production Business under issue #41.
