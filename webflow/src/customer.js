export class MemberstackBrowserAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemberstackBrowserAuthenticationError";
  }
}

function waitForMemberstackReadyEvent(browser, timeoutMs = 5_000) {
  if (typeof browser?.addEventListener !== "function") {
    throw new MemberstackBrowserAuthenticationError(
      "The supported Memberstack browser contract is unavailable.",
    );
  }
  return new Promise((resolve, reject) => {
    const schedule = typeof browser.setTimeout === "function"
      ? browser.setTimeout.bind(browser)
      : setTimeout;
    const cancel = typeof browser.clearTimeout === "function"
      ? browser.clearTimeout.bind(browser)
      : clearTimeout;
    const ready = () => {
      cancel(timer);
      browser.removeEventListener?.("memberstack.ready", ready);
      resolve();
    };
    const timer = schedule(() => {
      browser.removeEventListener?.("memberstack.ready", ready);
      reject(new MemberstackBrowserAuthenticationError("Memberstack did not become ready."));
    }, timeoutMs);
    browser.addEventListener("memberstack.ready", ready, { once: true });
  });
}

async function currentMemberstackDom(browser) {
  if (!browser?.$memberstackDom && browser?.$memberstackReady) {
    try {
      await browser.$memberstackReady;
    } catch {
      throw new MemberstackBrowserAuthenticationError("Memberstack did not become ready.");
    }
  } else if (!browser?.$memberstackDom) {
    await waitForMemberstackReadyEvent(browser);
  }
  const dom = browser?.$memberstackDom;
  if (typeof dom?.getCurrentMember !== "function"
    || typeof dom?.getMemberCookie !== "function") {
    throw new MemberstackBrowserAuthenticationError(
      "The supported Memberstack browser contract is unavailable.",
    );
  }
  return dom;
}

export async function createMemberstackAuthorizationHeader(browser = window) {
  const dom = await currentMemberstackDom(browser);
  const current = await dom.getCurrentMember();
  if (current?.data === null) return null;
  if (typeof current?.data?.id !== "string" || current.data.id.length === 0) {
    throw new MemberstackBrowserAuthenticationError(
      "Memberstack returned an unrecognized Customer session.",
    );
  }
  const token = await dom.getMemberCookie();
  if (typeof token !== "string"
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new MemberstackBrowserAuthenticationError(
      "Memberstack returned an unrecognized Customer token.",
    );
  }
  return { Authorization: `Bearer ${token}` };
}

export async function signInForBooking(browser = window) {
  const dom = await currentMemberstackDom(browser);
  if (typeof dom.openModal !== "function") {
    throw new MemberstackBrowserAuthenticationError("Memberstack sign in is unavailable.");
  }
  // The DOM modal resolves on login. Resume here using the existing complete URL;
  // do not follow the account's generic post-login destination.
  await dom.openModal("LOGIN");
  dom.hideModal?.();
}
