export class MemberstackBrowserAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemberstackBrowserAuthenticationError";
  }
}

async function currentMemberstackDom(browser) {
  if (!browser?.$memberstackDom && browser?.$memberstackReady) {
    try {
      await browser.$memberstackReady;
    } catch {
      throw new MemberstackBrowserAuthenticationError(
        "Memberstack did not become ready.",
      );
    }
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
