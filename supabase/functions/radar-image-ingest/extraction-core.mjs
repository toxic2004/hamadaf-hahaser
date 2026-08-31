// Pure functions for radar-image-ingest, kept separate from the Deno
// handler so they can be unit-tested with plain Node + a mocked fetch,
// same pattern as scanner-core.mjs. No Supabase/Deno-specific APIs here.

const MODEL = "claude-haiku-4-5-20251001";
const MAX_BOOKS_IN_PROMPT = 200;

// Same approved pickup regions as the price rule used everywhere else in
// this project (section 6 of the original spec). Checked here in code,
// not left to the model to judge - same reasoning as
// isApprovedPickupBranch() in the report-engine's scanner-core.mjs:
// a fixed list is reliable, asking a model to "decide" whether a region
// counts is not.
const APPROVED_PICKUP_REGIONS = [
  "פתח תקווה",
  "בני ברק",
  "תל אביב",
  "גוש דן",
  "רמת גן",
  "גבעתיים",
  "חולון",
  "בת ים",
  "מודיעין",
  "ירושלים",
];

export function isApprovedPickupRegion(pickupLocation) {
  if (!pickupLocation) return false;
  return APPROVED_PICKUP_REGIONS.some((region) =>
    pickupLocation.includes(region),
  );
}

// Section 3 of the spec (kept unchanged by the architectural amendment):
// matching happens ONLY against books already in the 'מחפש' list - never
// invented, never matched against books in other statuses.
export function buildBookContextLines(books) {
  return books
    .slice(0, MAX_BOOKS_IN_PROMPT)
    .map(
      (book) =>
        `- ${book.title}${book.author ? ` (${book.author})` : ""} [id:${book.id}]`,
    )
    .join("\n");
}

// contextText: free text the user optionally types alongside the image.
// Added 2026-08-31 after a real case (Limor Noy conversation) where the
// book titles were only in the surrounding chat text, never in the
// screenshot itself - a single image alone can't reproduce what a human
// reading the whole conversation would see. This doesn't fully close
// that gap (the automated system still only sees what's typed in for
// this one upload, not the full conversation history the user has with
// each seller), but it closes the part that's actually fixable: letting
// the user hand over the text that matters, not just the picture.
export function buildExtractionPrompt(books, contextText) {
  const bookList = buildBookContextLines(books);
  const contextSection = contextText
    ? `\n\nטקסט נוסף שהמשתמש הזין ידנית (למשל תוכן ההודעה שמסביב לצילום המסך):\n${contextText}\n`
    : "";
  return `אתה עוזר לחלץ נתונים מצילום מסך או טקסט של הצעת מכירת ספר יד שנייה מקבוצת פייסבוק.

רשימת הספרים שהמשתמש מחפש כרגע (התאמה מותרת רק מול הרשימה הזו):
${bookList || "(אין ספרים ברשימה)"}
${contextSection}
חלץ מהתמונה/טקסט כל ספר המוצע שתואם לרשימה למעלה. עבור כל ספר, החזר:
- book_id: המזהה [id:...] מהרשימה למעלה, רק אם ההתאמה כמעט ודאית. אחרת null.
- matched_title: שם הספר מהרשימה שההצעה כנראה מתאימה אליו, גם אם book_id הוא null.
- confidence: "high" / "low" / "none" - "high" רק אם ההתאמה חד-משמעית לחלוטין (כותר מדויק, לא חלק/מהדורה אחרת. שים לב: "חלק 1", "חלק 2" או מהדורה שונה הם ספר אחר, לא אותה התאמה).
- seller_name, phone: כפי שמופיע, או null אם לא ידוע.
- item_price: מספר בלבד, או null אם לא צוין מחיר מפורש לספר הזה בנפרד (למשל אם זה מחיר לחבילה של כמה ספרים יחד - אל תמציא פיצול, השאר null ותציין זאת ב-bundle_note).
- shipping_price: מספר, או null אם לא צוין.
- pickup_location: כפי שמופיע, או null.
- bundle_note: אם המחיר הוא לחבילה של כמה ספרים יחד ולא ניתן לפצל, תאר זאת כאן. אחרת null.

לעולם אל תמציא ערך לשדה שלא מופיע בבירור במקור. אם אין ספרים תואמים בתמונה, החזר מערך ריק.

החזר אך ורק JSON תקני בפורמט הבא, בלי טקסט נוסף לפניו או אחריו:
{"books": [{"book_id": string|null, "matched_title": string, "confidence": "high"|"low"|"none", "seller_name": string|null, "phone": string|null, "item_price": number|null, "shipping_price": number|null, "pickup_location": string|null, "bundle_note": string|null}]}`;
}

// Real model output (confirmed 2026-08-31 against a live Haiku call, not
// assumed) doesn't always follow "return only JSON" literally - it can
// wrap the JSON in markdown code fences and/or add explanatory prose
// before or after it. Extracting the JSON substring first, rather than
// trusting the whole response to be valid JSON, is what makes this
// robust to that instead of discarding a perfectly good extraction as
// "invalid_json".
function extractJsonSubstring(rawText) {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return rawText.slice(firstBrace, lastBrace + 1);
  }
  return rawText;
}

// Never trusts the model's output shape blindly - every field is
// re-validated here. A malformed or partially-invented response degrades
// to "nothing extracted" rather than passing bad data through.
export function parseModelResponse(rawText, validBookIds) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonSubstring(rawText));
  } catch {
    return { books: [], error: "invalid_json" };
  }
  if (!parsed || !Array.isArray(parsed.books)) {
    return { books: [], error: "invalid_shape" };
  }
  const validIds = new Set(validBookIds);
  const books = parsed.books
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const bookId =
        typeof item.book_id === "string" && validIds.has(item.book_id)
          ? item.book_id
          : null;
      const confidence = ["high", "low", "none"].includes(item.confidence)
        ? item.confidence
        : "none";
      const rawPrice = item.item_price;
      const rawShipping = item.shipping_price;
      // Number(null) is 0, not NaN - without this explicit check, a
      // genuinely-unknown price (null, meaning "part of a bundle" or
      // "not stated") would silently become a fabricated 0 ₪. Exactly
      // the class of bug this project has hit before in production.
      const price =
        rawPrice === null || rawPrice === undefined ? NaN : Number(rawPrice);
      const shipping =
        rawShipping === null || rawShipping === undefined
          ? NaN
          : Number(rawShipping);
      return {
        book_id: bookId,
        matched_title:
          typeof item.matched_title === "string" ? item.matched_title : null,
        // A book_id the model invented (not in this user's actual list)
        // is worse than no match at all - forced back to "none" so the
        // review UI never silently offers a fabricated match.
        confidence: bookId ? confidence : "none",
        seller_name:
          typeof item.seller_name === "string" ? item.seller_name : null,
        phone: typeof item.phone === "string" ? item.phone : null,
        item_price: Number.isFinite(price) && price >= 0 ? price : null,
        shipping_price:
          Number.isFinite(shipping) && shipping >= 0 ? shipping : null,
        pickup_location:
          typeof item.pickup_location === "string"
            ? item.pickup_location
            : null,
        // Computed here, not asked from the model - same reasoning as
        // isApprovedPickupBranch() elsewhere in this project. This does
        // NOT set shipping_price - it's informational for the review UI
        // only. Actually treating approved free pickup as the total
        // price is still a decision the reviewing human makes, exactly
        // like the report engine's pickup handling.
        pickup_approved: isApprovedPickupRegion(
          typeof item.pickup_location === "string"
            ? item.pickup_location
            : null,
        ),
        bundle_note:
          typeof item.bundle_note === "string" ? item.bundle_note : null,
      };
    });
  return { books, error: null };
}

export async function extractOffersFromImage({
  fetchImpl = fetch,
  apiKey,
  imageBase64,
  mediaType,
  books,
  contextText,
  timeoutMs = 30_000,
}) {
  if (!apiKey) throw new Error("Missing Anthropic API key");
  const prompt = buildExtractionPrompt(books, contextText);
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Anthropic API error ${response.status}: ${bodyText}`);
  }
  const data = await response.json();
  const textBlock = (data.content || []).find((block) => block.type === "text");
  if (!textBlock) return { books: [], error: "no_text_in_response" };
  return parseModelResponse(
    textBlock.text,
    books.map((book) => book.id),
  );
}
