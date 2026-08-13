import fs from "node:fs/promises";
import { chromium } from "playwright";
import {
  authorMatches,
  availabilityFromProductText,
  fulfillmentOptionsFromText,
  isDirectRebooksProductUrl,
  mergePickupLocations,
  parsePrice,
  reportableFulfillmentOptions,
  titleMatches,
  validateConcreteOffer,
} from "./rebooks-browser-core.mjs";

const SITE = "https://rebooks.org.il";
const MAX_BOOKS = 100;
const PAGE_TIMEOUT_MS = 30_000;

function parseArguments(argv) {
  const values = { books: [], input: null, output: null, headed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--book") {
      const [title, author = ""] = String(argv[++index] || "").split("|");
      values.books.push({ title: title?.trim(), author: author.trim() });
    } else if (argument === "--input") {
      values.input = argv[++index] || null;
    } else if (argument === "--output") {
      values.output = argv[++index] || null;
    } else if (argument === "--headed") {
      values.headed = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return values;
}

async function loadBooks(arguments_) {
  const fileBooks = arguments_.input
    ? JSON.parse(await fs.readFile(arguments_.input, "utf8"))
    : [];
  const books = [...fileBooks, ...arguments_.books]
    .map((book) => ({
      title: String(book?.title || "").trim(),
      author: String(book?.author || "").trim(),
    }))
    .filter((book) => book.title);
  if (!books.length)
    throw new Error("Provide at least one book with --book or --input.");
  if (books.length > MAX_BOOKS)
    throw new Error(`No more than ${MAX_BOOKS} books can be scanned at once.`);
  return books;
}

async function safeText(locator) {
  if (!(await locator.count())) return "";
  return String(await locator.first().innerText()).trim();
}

async function productLinksFromSearch(page, book) {
  const query = encodeURIComponent(
    [book.title, book.author].filter(Boolean).join(" "),
  );
  await page.goto(`${SITE}/?s=${query}&post_type=product&dgwt_wcas=1`, {
    waitUntil: "domcontentloaded",
    timeout: PAGE_TIMEOUT_MS,
  });
  const main = page.getByRole("main");
  await main.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const links = await main
    .locator("h3 a[href*='/product/']")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const card = element.closest(".product-grid-item");
        return {
          title: element.textContent?.trim() || "",
          url: element.href,
          author:
            card
              ?.querySelector("a[href*='/book-author/']")
              ?.textContent?.trim() || "",
          cardText: card?.innerText || "",
          hasAddToCart: Boolean(
            card?.querySelector(
              ".add_to_cart_button, .single_add_to_cart_button",
            ),
          ),
        };
      }),
    );
  const unique = new Map();
  for (const link of links) {
    if (
      titleMatches(book.title, link.title) &&
      authorMatches(book.author, link.author) &&
      isDirectRebooksProductUrl(link.url)
    ) {
      unique.set(link.url, {
        ...link,
        itemPrice: parsePrice(link.cardText),
        availability: availabilityFromProductText(
          link.cardText,
          link.hasAddToCart,
        ),
      });
    }
  }
  return [...unique.values()].slice(0, 8);
}

async function revealShipping(page) {
  const button = page.getByRole("button", { name: "אפשרויות משלוח" });
  if (!(await button.count())) return;
  if ((await button.first().getAttribute("aria-expanded")) !== "true") {
    await button.first().click();
  }
}

async function visiblePickupLocations(page) {
  const trigger = page.getByRole("link", { name: "בדיקה באיזה סניפים" });
  if (!(await trigger.count())) return [];
  await trigger.first().click();
  await page.waitForTimeout(1_500);
  const candidates = await page
    .locator(
      "[role='dialog']:visible, .modal:visible, .mfp-content:visible, .stockist-list:visible, .store-stock:visible",
    )
    .allInnerTexts();
  const ignored = /^(?:סגור|בדיקה באיזה סניפים|מלאי לפי סניף)$/u;
  return [
    ...new Set(
      candidates
        .flatMap((value) => value.split(/\n+/u))
        .map((value) => value.trim())
        .filter((value) => value && value.length <= 90 && !ignored.test(value)),
    ),
  ];
}

async function inspectProduct(page, book, candidate) {
  await page.goto(candidate.url, {
    waitUntil: "domcontentloaded",
    timeout: PAGE_TIMEOUT_MS,
  });
  const main = page.getByRole("main");
  await main.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
  const productDetails = page.locator(".summary").first();
  await productDetails.waitFor({
    state: "visible",
    timeout: PAGE_TIMEOUT_MS,
  });
  const listingTitle = await safeText(productDetails.locator("h1"));
  const listingAuthor =
    (await safeText(productDetails.locator("a[href*='/book-author/']"))) ||
    candidate.author;
  const mainTextBeforeExpansion = await productDetails.innerText();
  const addButton = productDetails.getByRole("button", {
    name: /הוספה לסל/u,
  });
  const hasAddToCart = (await addButton.count()) > 0;
  const addButtonText = hasAddToCart ? await addButton.first().innerText() : "";
  const itemPrice =
    parsePrice(addButtonText || mainTextBeforeExpansion) ?? candidate.itemPrice;
  const availability =
    availabilityFromProductText(mainTextBeforeExpansion, hasAddToCart) ??
    candidate.availability;
  await revealShipping(page);
  const expandedText = await productDetails.innerText();
  let fulfillmentOptions = fulfillmentOptionsFromText(expandedText);
  const pickupLocations = await visiblePickupLocations(page);
  fulfillmentOptions = mergePickupLocations(
    fulfillmentOptions,
    pickupLocations,
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
  return {
    ...offer,
    qualifyingOptions:
      availability === "במלאי"
        ? reportableFulfillmentOptions(itemPrice, fulfillmentOptions)
        : [],
    concrete: validateConcreteOffer(offer),
  };
}

async function scanBook(context, book) {
  const page = await context.newPage();
  try {
    const candidates = await productLinksFromSearch(page, book);
    const offers = [];
    for (const candidate of candidates) {
      offers.push(await inspectProduct(page, book, candidate));
    }
    return {
      book,
      status: offers.some(
        (offer) => offer.concrete && offer.availability === "במלאי",
      )
        ? "נמצא"
        : "לא נמצא",
      offers: offers.filter((offer) => offer.concrete),
    };
  } catch (error) {
    let pageTitle = "";
    let pageText = "";
    try {
      pageTitle = await page.title();
      pageText = (await page.locator("body").innerText()).slice(0, 1200);
      await page.screenshot({ path: "rebooks-error.png", fullPage: true });
      await fs.writeFile("rebooks-error.html", await page.content());
    } catch {
      // Keep the original scanner error when diagnostics also fail.
    }
    return {
      book,
      status: "שגיאה",
      offers: [],
      error: error instanceof Error ? error.message : String(error),
      pageUrl: page.url(),
      pageTitle,
      pageText,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const books = await loadBooks(arguments_);
  const browser = await chromium.launch({ headless: !arguments_.headed });
  try {
    const context = await browser.newContext({
      locale: "he-IL",
      timezoneId: "Asia/Jerusalem",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    });
    const results = [];
    for (const book of books) results.push(await scanBook(context, book));
    await context.close();
    const output = JSON.stringify(
      { scannedAt: new Date().toISOString(), source: "סיפור חוזר", results },
      null,
      2,
    );
    if (arguments_.output) await fs.writeFile(arguments_.output, `${output}\n`);
    else process.stdout.write(`${output}\n`);
    if (results.some((result) => result.status === "שגיאה")) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

await main();
