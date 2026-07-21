"use strict";

const db = HamadafSupabase.createClient();
const $ = (id) => document.getElementById(id);
const SOURCES = [
  "יד2",
  "סימניה",
  "Marketplace",
  "פייסבוק ציבורי",
  "עברית",
  "סטימצקי",
  "צומת ספרים",
  "חנויות עצמאיות",
  "חיפוש כללי",
];
let user;
let books = [];
let offers = [];
let dealThreshold = 70;

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

function money(value) {
  const number = HamadafPrice.numberOrNull(value);
  return number === null
    ? "לא ידוע"
    : new Intl.NumberFormat("he-IL", {
        style: "currency",
        currency: "ILS",
      }).format(number);
}

function currentBook() {
  return books.find((book) => book.id === $("bookSelect").value);
}

function sourceSearches(title) {
  const query = encodeURIComponent(title || "ספרים");
  const google = (text) =>
    `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  return [
    [
      "יד2",
      "https://www.yad2.co.il/market/collections/books-media_books-and-magazines_books",
    ],
    ["סימניה", `https://simania.co.il/searchBooks.php?query=${query}`],
    [
      "Marketplace",
      `https://www.facebook.com/marketplace/telaviv/search/?query=${query}`,
    ],
    ["פייסבוק ציבורי", `https://www.facebook.com/search/posts/?q=${query}`],
    ["עברית", `https://www.e-vrit.co.il/Search/${query}`],
    [
      "סטימצקי",
      `https://www.steimatzky.co.il/catalogsearch/result/?q=${query}`,
    ],
    ["צומת ספרים", google(`site:booknet.co.il ${title}`)],
    ["חנויות עצמאיות", google(`חנויות ספרים עצמאיות ${title}`)],
    ["חיפוש כללי", google(`ספר מודפס ${title} מחיר`)],
  ];
}

function renderSourceLinks() {
  const book = currentBook();
  $("sourceLinks").innerHTML = sourceSearches(book?.title)
    .map(
      ([name, url]) =>
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`,
    )
    .join("");
  if (book && !$("listingTitle").value) $("listingTitle").value = book.title;
  if (book && !$("referencePrice").value && book.new_price !== null)
    $("referencePrice").value = book.new_price;
}

function formOffer() {
  return {
    book_id: $("bookSelect").value,
    source: $("source").value,
    listing_title: $("listingTitle").value.trim(),
    seller_name: $("seller").value.trim(),
    source_url: $("sourceUrl").value.trim(),
    ad_image_url: $("adImageUrl").value.trim(),
    condition: $("condition").value,
    match_type: $("matchType").value,
    edition_language: "עברית",
    location: $("location").value,
    item_price: HamadafPrice.numberOrNull($("itemPrice").value),
    shipping_price: $("shippingKnown").checked
      ? (HamadafPrice.numberOrNull($("shippingPrice").value) ?? 0)
      : null,
    shipping_known: $("shippingKnown").checked,
    reference_new_price: HamadafPrice.numberOrNull($("referencePrice").value),
    active: true,
    is_removed: false,
  };
}

function renderScore() {
  const offer = { ...formOffer(), last_checked_at: new Date().toISOString() };
  const result = HamadafPrice.calculateDeal(offer);
  $("scorePreview").innerHTML =
    `<strong>מחיר כולל: ${money(result.total)}. ציון עסקה: ${result.score}</strong><br>${result.reasons.map(escapeHtml).join("<br>")}`;
}

function offerCard(offer, best) {
  const deal = HamadafPrice.calculateDeal(offer);
  const due =
    !offer.next_check_at || new Date(offer.next_check_at) <= new Date();
  const safeUrl = HamadafPrice.httpUrl(offer.source_url);
  const link = safeUrl
    ? `<a class="button ghost" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">פתיחת מודעה</a>`
    : "";
  const imageUrl = HamadafPrice.httpUrl(offer.ad_image_url);
  const image = imageUrl
    ? `<img class="offerImage" src="${escapeHtml(imageUrl)}" alt="תמונת המודעה" loading="lazy">`
    : "";
  return `<article class="offer${best ? " best" : ""}">
    ${image}
    <h3>${escapeHtml(offer.listing_title || currentBook()?.title || "הצעה")}</h3>
    <p><strong>${escapeHtml(offer.source)}</strong> · ${escapeHtml(offer.location || "מיקום לא ידוע")}</p>
    <p>ספר: ${money(offer.item_price)} · משלוח: ${offer.shipping_known ? money(offer.shipping_price || 0) : "לא ידוע"}</p>
    <p><strong>מחיר כולל: ${money(deal.total)}</strong></p>
    <p>${escapeHtml(offer.seller_name || "שם המוכר לא הוזן")} · ${escapeHtml(offer.match_type)}</p>
    <span class="dealScore${deal.worthwhile ? " good" : ""}">ציון ${deal.score}</span>
    <p class="sub">${due ? "נדרשת בדיקה מחודשת" : `הבדיקה הבאה עד ${new Date(offer.next_check_at).toLocaleDateString("he-IL")}`}</p>
    <div class="offerActions">${link}<button class="ghost" data-edit="${offer.id}">עריכה</button><button class="ghost" data-check="${offer.id}">בדקתי עכשיו</button><button class="ghost" data-remove="${offer.id}">המודעה הוסרה</button></div>
  </article>`;
}

function renderOfferGroup(target, group) {
  const cards = [
    ...group.cheapest.map((offer, index) => offerCard(offer, index === 0)),
    ...group.withoutPrice.map((offer) => offerCard(offer, false)),
  ];
  $(target).innerHTML = cards.length
    ? cards.join("")
    : '<div class="notice">אין הצעות פעילות בקבוצה הזאת.</div>';
}

function bindOfferActions() {
  document
    .querySelectorAll("[data-edit]")
    .forEach(
      (button) => (button.onclick = () => editOffer(button.dataset.edit)),
    );
  document
    .querySelectorAll("[data-check]")
    .forEach(
      (button) => (button.onclick = () => checkOffer(button.dataset.check)),
    );
  document
    .querySelectorAll("[data-remove]")
    .forEach(
      (button) => (button.onclick = () => removeOffer(button.dataset.remove)),
    );
}

function renderOffers() {
  const selected = offers.filter(
    (offer) => offer.book_id === $("bookSelect").value,
  );
  const groups = HamadafPrice.splitRankedOffers(selected);
  renderOfferGroup("newOffers", groups.newOffers);
  renderOfferGroup("usedOffers", groups.usedOffers);
  bindOfferActions();
}

function resetForm() {
  $("editOfferId").value = "";
  $("formTitle").textContent = "הוספת הצעה";
  ["itemPrice", "shippingPrice", "seller", "sourceUrl", "adImageUrl"].forEach(
    (id) => ($(id).value = ""),
  );
  $("listingTitle").value = currentBook()?.title || "";
  $("shippingKnown").checked = false;
  $("shippingPrice").disabled = true;
  $("condition").value = "יד שנייה";
  $("matchType").value = "מדויקת";
  $("referencePrice").value = currentBook()?.new_price ?? "";
  $("formMessage").textContent = "";
  renderScore();
}

function editOffer(id) {
  const offer = offers.find((item) => item.id === id);
  if (!offer) return;
  $("editOfferId").value = offer.id;
  $("formTitle").textContent = "עריכת הצעה";
  $("source").value = offer.source;
  $("condition").value = offer.condition;
  $("matchType").value = offer.match_type;
  $("itemPrice").value = offer.item_price ?? "";
  $("shippingKnown").checked = offer.shipping_known;
  $("shippingPrice").disabled = !offer.shipping_known;
  $("shippingPrice").value = offer.shipping_price ?? "";
  $("referencePrice").value = offer.reference_new_price ?? "";
  $("location").value = offer.location || "אחר";
  $("seller").value = offer.seller_name || "";
  $("listingTitle").value = offer.listing_title || "";
  $("sourceUrl").value = offer.source_url || "";
  $("adImageUrl").value = offer.ad_image_url || "";
  renderScore();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function createNotification(offer, type, title, body, key) {
  await db.from("notifications").upsert(
    {
      user_id: user.id,
      book_id: offer.book_id,
      offer_id: offer.id,
      notification_type: type,
      title,
      body,
      dedupe_key: key,
      metadata: {
        total_price: HamadafPrice.totalPrice(offer),
        source: offer.source,
      },
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
}

async function saveOffer() {
  if (!user || !$("bookSelect").value) return;
  if (
    $("sourceUrl").value.trim() &&
    !HamadafPrice.httpUrl($("sourceUrl").value)
  ) {
    $("formMessage").textContent = "קישור המודעה חייב להתחיל ב http או https.";
    return;
  }
  if (
    $("adImageUrl").value.trim() &&
    !HamadafPrice.httpUrl($("adImageUrl").value)
  ) {
    $("formMessage").textContent = "קישור התמונה חייב להתחיל ב http או https.";
    return;
  }
  const now = new Date();
  const next = new Date(now.getTime() + 2 * 86400000);
  const row = {
    ...formOffer(),
    user_id: user.id,
    last_checked_at: now.toISOString(),
    next_check_at: next.toISOString(),
    updated_at: now.toISOString(),
  };
  if (!row.listing_title) row.listing_title = currentBook()?.title || "הצעה";
  row.source_listing_key = HamadafPrice.fingerprint(row);
  const deal = HamadafPrice.calculateDeal(row, now);
  row.deal_score = deal.score;
  row.deal_explanation = deal.reasons.join(" | ");
  $("saveOffer").disabled = true;
  $("formMessage").textContent = "שומר...";
  const editId = $("editOfferId").value;
  let existing = editId ? offers.find((offer) => offer.id === editId) : null;
  if (!existing) {
    const match = await db
      .from("price_offers")
      .select("*")
      .eq("user_id", user.id)
      .eq("source", row.source)
      .eq("source_listing_key", row.source_listing_key)
      .maybeSingle();
    existing = match.data || null;
  }
  const oldTotal = existing ? HamadafPrice.totalPrice(existing) : null;
  const result = existing
    ? await db
        .from("price_offers")
        .update(row)
        .eq("id", existing.id)
        .select("*")
        .single()
    : await db.from("price_offers").insert(row).select("*").single();
  $("saveOffer").disabled = false;
  if (result.error) {
    $("formMessage").textContent =
      "שמירת ההצעה נכשלה. ודא שמיגרציית המחירים הופעלה.";
    return;
  }
  const saved = result.data;
  const newTotal = HamadafPrice.totalPrice(saved);
  if (oldTotal !== null && newTotal !== null && newTotal < oldTotal) {
    await createNotification(
      saved,
      "ירידת מחיר",
      "ירידת מחיר",
      `${currentBook()?.title}: המחיר ירד מ ${money(oldTotal)} ל ${money(newTotal)}`,
      `${saved.id}:drop:${newTotal}`,
    );
  }
  if (deal.score >= dealThreshold) {
    await createNotification(
      saved,
      "עסקה משתלמת",
      "נמצאה עסקה משתלמת",
      `${currentBook()?.title}: ${money(newTotal)} אצל ${saved.source}`,
      `${saved.id}:deal:${newTotal}`,
    );
  }
  db.functions
    .invoke("alerts", { body: { mode: "offer", offerId: saved.id } })
    .catch(() => {});
  $("formMessage").textContent =
    "ההצעה נשמרה. היסטוריית היום עודכנה ללא כפילות.";
  await loadOffers();
  resetForm();
}

async function checkOffer(id) {
  const now = new Date();
  const { error } = await db
    .from("price_offers")
    .update({
      last_checked_at: now.toISOString(),
      next_check_at: new Date(now.getTime() + 2 * 86400000).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", id);
  if (error) return showError("עדכון מועד הבדיקה נכשל.");
  await loadOffers();
}

async function removeOffer(id) {
  if (!confirm("לסמן שהמודעה הוסרה? ההיסטוריה תישמר.")) return;
  const now = new Date().toISOString();
  const { error } = await db
    .from("price_offers")
    .update({
      active: false,
      is_removed: true,
      last_checked_at: now,
      updated_at: now,
    })
    .eq("id", id);
  if (error) return showError("סימון המודעה כהוסרה נכשל.");
  await loadOffers();
}

function showError(message) {
  $("error").textContent = message;
  $("error").classList.remove("hidden");
}

async function loadOffers() {
  const { data, error } = await db
    .from("price_offers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error)
    return showError("טעינת ההצעות נכשלה. ודא שמיגרציית המחירים הופעלה.");
  offers = data || [];
  renderOffers();
}

async function loadData() {
  $("loading").classList.remove("hidden");
  const [bookResult, settingsResult] = await Promise.all([
    db.from("books").select("*").neq("status", "סל מחזור").order("title"),
    db.from("notification_settings").select("*").maybeSingle(),
  ]);
  $("loading").classList.add("hidden");
  if (bookResult.error) return showError("טעינת הספרים נכשלה.");
  books = bookResult.data || [];
  dealThreshold = Number(settingsResult.data?.immediate_deal_threshold ?? 70);
  $("bookSelect").innerHTML = books
    .map(
      (book) => `<option value="${book.id}">${escapeHtml(book.title)}</option>`,
    )
    .join("");
  $("content").classList.remove("hidden");
  if (!books.length) {
    $("saveOffer").disabled = true;
    $("formMessage").textContent =
      "אין עדיין ספרים להשוואה. יש להוסיף ספר במדף הראשי.";
    return;
  }
  $("saveOffer").disabled = false;
  resetForm();
  renderSourceLinks();
  await loadOffers();
}

function showSession(session) {
  user = session?.user || null;
  $("authCard").classList.toggle("hidden", Boolean(user));
  $("app").classList.toggle("hidden", !user);
  if (user) loadData();
}

$("source").innerHTML = SOURCES.map(
  (source) => `<option>${source}</option>`,
).join("");
$("login").onclick = async () => {
  $("authMessage").textContent = "מתחבר...";
  const { data, error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("authMessage").textContent = error ? "הכניסה נכשלה. בדוק את הפרטים." : "";
  if (!error) showSession(data.session);
};
$("bookSelect").onchange = () => {
  resetForm();
  renderSourceLinks();
  renderOffers();
};
$("shippingKnown").onchange = () => {
  $("shippingPrice").disabled = !$("shippingKnown").checked;
  renderScore();
};
[
  "source",
  "condition",
  "matchType",
  "itemPrice",
  "shippingPrice",
  "referencePrice",
  "location",
].forEach((id) => $(id).addEventListener("input", renderScore));
$("saveOffer").onclick = saveOffer;
$("resetForm").onclick = resetForm;
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((event, session) => showSession(session));
