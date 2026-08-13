import { Actor, log } from "apify";
import { PlaywrightCrawler } from "@crawlee/playwright";
import {
  authorMatches,
  availabilityFromText,
  fulfillmentOptionsFromText,
  isDirectRebooksProductUrl,
  parsePrice,
  reportableOptions,
  titleMatches,
  validateOffer,
} from "./core.mjs";

const SITE = "https://rebooks.org.il";

async function safeText(locator) {
  if (!(await locator.count())) return "";
  return String(await locator.first().innerText()).trim();
}

await Actor.main(async () => {
  const input = (await Actor.getInput()) || {};
  const book = {
    title: String(input.title || "").trim(),
    author: String(input.author || "").trim(),
  };
  if (!book.title) throw new Error("A book title is required.");

  const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ["RESIDENTIAL"],
  });
  let result = null;

  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxRequestsPerCrawl: 1,
    maxRequestRetries: 0,
    navigationTimeoutSecs: 35,
    requestHandlerTimeoutSecs: 90,
    launchContext: {
      launchOptions: { headless: true },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    },
    preNavigationHooks: [
      async ({ page }) => {
        await page.route("**/*", async (route) => {
          const type = route.request().resourceType();
          if (["image", "media", "font"].includes(type)) await route.abort();
          else await route.continue();
        });
      },
    ],
    async requestHandler({ page }) {
      const searchTitle = await page.title();
      const searchBody = (await page.locator("body").innerText()).slice(0, 2500);
      if (/רק רגע|just a moment|cloudflare/i.test(`${searchTitle}\n${searchBody}`)) {
        throw new Error("Sipur Hozer returned a Cloudflare verification page.");
      }

      const cards = await page
        .locator("main .product-grid-item")
        .evaluateAll((elements) =>
          elements.map((card) => {
            const link = card.querySelector("h3 a[href*='/product/']");
            return {
              title: link?.textContent?.trim() || "",
              url: link?.href || "",
              author:
                card
                  .querySelector("a[href*='/book-author/']")
                  ?.textContent?.trim() || "",
              text: card.innerText || "",
            };
          }),
        );
      const candidate = cards.find(
        (card) =>
          titleMatches(book.title, card.title) &&
          authorMatches(book.author, card.author) &&
          isDirectRebooksProductUrl(card.url),
      );
      if (!candidate) {
        result = { book, source: "סיפור חוזר", status: "לא נמצא", offers: [] };
        return;
      }

      await page.goto(candidate.url, {
        waitUntil: "domcontentloaded",
        timeout: 35_000,
      });
      const productTitle = await page.title();
      const pageBody = (await page.locator("body").innerText()).slice(0, 2500);
      if (/רק רגע|just a moment|cloudflare/i.test(`${productTitle}\n${pageBody}`)) {
        throw new Error("Sipur Hozer product page returned a verification page.");
      }

      const details = page.locator("main .summary").first();
      await details.waitFor({ state: "visible", timeout: 30_000 });
      const listingTitle = await safeText(details.locator("h1"));
      const listingAuthor =
        (await safeText(details.locator("a[href*='/book-author/']"))) ||
        candidate.author;
      const addButton = details.getByRole("button", { name: /הוספה לסל/u });
      const hasAddToCart = (await addButton.count()) > 0;
      const initialText = await details.innerText();
      const itemPrice = parsePrice(initialText) ?? parsePrice(candidate.text);
      const availability = availabilityFromText(initialText, hasAddToCart);

      const shippingButton = page.getByRole("button", { name: "אפשרויות משלוח" });
      if (
        (await shippingButton.count()) &&
        (await shippingButton.first().getAttribute("aria-expanded")) !== "true"
      ) {
        await shippingButton.first().click();
      }
      const fulfillmentOptions = fulfillmentOptionsFromText(
        await details.innerText(),
      );
      const offer = {
        wantedTitle: book.title,
        wantedAuthor: book.author || null,
        listingTitle,
        listingAuthor: listingAuthor || null,
        productUrl: page.url(),
        source: "סיפור חוזר",
        itemPrice,
        availability,
        fulfillmentOptions,
      };
      offer.qualifyingOptions = reportableOptions(itemPrice, fulfillmentOptions);
      offer.concrete = validateOffer(offer);
      result = {
        book,
        source: "סיפור חוזר",
        status:
          offer.concrete && offer.availability === "במלאי" ? "נמצא" : "לא נמצא",
        offers: offer.concrete ? [offer] : [],
      };
    },
    async failedRequestHandler({ request }, error) {
      log.error(`Request failed: ${request.url}`, { error: error.message });
      result = {
        book,
        source: "סיפור חוזר",
        status: "שגיאה",
        offers: [],
        error: error.message,
      };
    },
  });

  const query = encodeURIComponent([book.title, book.author].filter(Boolean).join(" "));
  await crawler.run([`${SITE}/?s=${query}&post_type=product&dgwt_wcas=1`]);
  if (!result) {
    result = {
      book,
      source: "סיפור חוזר",
      status: "שגיאה",
      offers: [],
      error: "The crawler finished without a result.",
    };
  }
  await Actor.pushData({ scannedAt: new Date().toISOString(), ...result });
});
