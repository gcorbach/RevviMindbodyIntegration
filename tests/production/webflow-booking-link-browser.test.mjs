import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Use an installed Playwright module and Chromium without downloading browsers in pnpm test.
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
test("booking links select the server context and survive sign in in the browser", { skip: !modulePath }, async (t) => {
  const { chromium } = await import(modulePath);
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const origin = "https://revvi.test";
  const selected = { businessSlug: "selected-studio", locationId: "11111111-1111-4111-8111-111111111111",
    offerId: "22222222-2222-4222-8222-222222222222" };
  const link = `/book?${new URLSearchParams(selected)}`;
  const embed = readFileSync(new URL("../../webflow/embed-site-99.html", import.meta.url), "utf8")
    .replace(/<link[^>]+>/g, "").replace(/<script[^>]+><\/script>/g, "");
  const bundle = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");
  async function fixture({ signedIn = true, wrongLocation = false, available = false } = {}) {
    const page = await browser.newPage();
    const requests = [];
    const quotes = [];
    const bookings = [];
    const session = { classId: "501", name: "Selected Class", startAt: "2026-09-20T14:00:00Z",
      timezone: "America/New_York", availabilityState: "available" };
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("offer-class-availability")) {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true, data: {
          business: { slug: selected.businessSlug, name: "Selected Business" },
          offer: { id: selected.offerId, title: "Selected Offer" },
          location: { id: wrongLocation ? "wrong" : selected.locationId, name: "New York Studio", timezone: "America/New_York" },
          sessions: available ? [session] : [],
        } } });
      }
      if (url.pathname.endsWith("booking-quote")) {
        quotes.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true, data: { quoteId: "selected-quote", session,
          price: { grandTotal: 0, currency: "USD" }, expiresAt: "2026-09-20T13:00:00Z" } } });
      }
      if (url.pathname.endsWith("create-booking")) {
        bookings.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true, data: { booking: { id: "selected-booking", status: "confirmed",
          className: session.name, startAt: session.startAt, locationName: "New York Studio" } } } });
      }
      if (url.origin === origin) return route.fulfill({ contentType: "text/html", body: embed });
      return route.fulfill({ status: 204, body: "" });
    });
    await page.addInitScript((signedIn) => {
      let member = signedIn;
      window.$memberstackDom = {
        getCurrentMember: async () => ({ data: member ? { id: "member" } : null }),
        getMemberCookie: async () => "test.jwt.signature",
        openModal: async (type) => { window.loginModalType = type; member = true; },
        hideModal: () => {},
      };
    }, signedIn);
    return { page, requests, quotes, bookings, async visit(path) { await page.goto(origin + path); await page.addScriptTag({ content: bundle }); } };
  }
  try {
    await t.test("the selected URL Offer carries through quote and booking confirmation", async () => {
      const f = await fixture({ available: true });
      try {
        await f.visit(link);
        await f.page.locator("[data-class-select]").click();
        await f.page.locator("[data-booking-class-continue]").click();
        await f.page.locator("[data-time-select]").click();
        await f.page.locator("[data-booking-continue]").click();
        await f.page.locator("[data-quote-confirm]").click();
        await f.page.waitForFunction(() => document.querySelector("[data-revvi-booking]").dataset.bookingState === "success");
        assert.deepEqual(f.requests[0], selected);
        assert.deepEqual(f.quotes, [{ offerId: selected.offerId, sessionId: "501" }]);
        assert.equal(f.bookings.length, 1);
        assert.equal(f.bookings[0].quoteId, "selected-quote");
        assert.match(await f.page.locator("[data-booking-confirmation-message]").textContent(), /New York Studio/);
      } finally { await f.page.close(); }
    });
    await t.test("URL replaces sandbox defaults and obtains timezone from the server", async () => {
      const f = await fixture();
      try {
        await f.visit(link);
        await f.page.waitForFunction(() => document.querySelector("[data-revvi-booking]").dataset.bookingState === "empty");
        assert.deepEqual(f.requests, [selected]);
        assert.equal(await f.page.locator("[data-booking-location]").textContent(), "New York Studio");
        assert.equal(await f.page.locator("[data-revvi-booking]").getAttribute("data-location-timezone"), "America/New_York");
        assert.equal(await f.page.locator("[data-booking-business]").textContent(), "Selected Business");
      } finally { await f.page.close(); }
    });
    await t.test("sign in resumes the selected Offer without requesting availability anonymously", async () => {
      const f = await fixture({ signedIn: false });
      try {
        await f.visit(link);
        await f.page.locator("[data-booking-sign-in]").waitFor({ state: "visible" });
        assert.equal(f.requests.length, 0);
        await f.page.locator("[data-booking-sign-in]").click();
        await f.page.waitForFunction(() => document.querySelector("[data-revvi-booking]").dataset.bookingState === "empty");
        assert.deepEqual(f.requests, [selected]);
        assert.equal(await f.page.evaluate(() => window.loginModalType), "LOGIN");
        assert.equal(new URL(f.page.url()).searchParams.get("offerId"), selected.offerId);
      } finally { await f.page.close(); }
    });
    await t.test("a redirect returning without parameters restores the pending link", async () => {
      const f = await fixture({ signedIn: false });
      try {
        await f.visit(link);
        await f.page.locator("[data-booking-sign-in]").waitFor({ state: "visible" });
        await f.visit("/book");
        await f.page.locator("[data-booking-sign-in]").waitFor({ state: "visible" });
        assert.equal(new URL(f.page.url()).searchParams.get("offerId"), selected.offerId);
        await f.page.locator("[data-booking-sign-in]").click();
        await f.page.waitForFunction(() => document.querySelector("[data-revvi-booking]").dataset.bookingState === "empty");
        assert.deepEqual(f.requests, [selected]);
      } finally { await f.page.close(); }
    });
    for (const path of ["/book", "/book?businessSlug=selected-studio", `${link}&offerId=${selected.offerId}`]) {
      await t.test(`invalid context fails before a request: ${path}`, async () => {
        const f = await fixture();
        try {
          await f.visit(path);
          assert.equal(await f.page.locator("[data-revvi-booking]").getAttribute("data-booking-state"), "error");
          assert.equal(f.requests.length, 0);
        } finally { await f.page.close(); }
      });
    }
    await t.test("a mismatched server Location cannot display availability", async () => {
      const f = await fixture({ wrongLocation: true });
      try {
        await f.visit(link);
        await f.page.waitForFunction(() => document.querySelector("[data-revvi-booking]").dataset.bookingState === "error");
        assert.equal(await f.page.locator("[data-booking-location]").textContent(), "");
      } finally { await f.page.close(); }
    });
  } finally { await browser.close(); }
});
