const MODEL = "claude-haiku-4-5-20251001";
const MAX_BOOKS_IN_PROMPT = 200;

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

export function buildBookContextLines(books) {
  return books
    .slice(0, MAX_BOOKS_IN_PROMPT)
    .map(
      (book) =>
        `- ${book.title}${book.author ? ` (${book.author})` : ""} [id:${book.id}]`,
    )
    .join("\n");
}

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
- item_price: מספר בלבד, או null אם לא צוין מחיר מפורש לספר הזה בנפרד (למשל אם זה מחיר לחבילה של כמה ספרים יחד - אל תמציא פיצול, השאר null ותציין זאת ב-bundle_note). שים לב: שמות ספרים רבים כוללים מספר בתוך הכותר עצמו (למשל "48 החוקים", "1984", "22 חוקי השיווק") - מספר כזה הוא חלק מהשם ולעולם אינו מחיר. חפש את המחיר בהקשר מחיר מפורש (מילים כמו ש"ח, שקל, ₪, מחיר, ב-), לא בכל מספר שמופיע בטקסט.
- shipping_price: מספר, או null אם לא צוין. אם צוין מחיר יחיד בלבד ואין כל אזכור למשלוח בנפרד, שים אותו ב-item_price ו-shipping_price יישאר null - אל תפצל מחיר בודד לשני שדות.
- pickup_location: כפי שמופיע, או null.
- bundle_note: אם המחיר הוא לחבילה של כמה ספרים יחד ולא ניתן לפצל, תאר זאת כאן. אחרת null.

לעולם אל תמציא ערך לשדה שלא מופיע בבירור במקור. אם אין ספרים תואמים בתמונה, החזר מערך ריק.

החזר אך ורק JSON תקני בפורמט הבא, בלי טקסט נוסף לפניו או אחריו:
{"books": [{"book_id": string|null, "matched_title": string, "confidence": "high"|"low"|"none", "seller_name": string|null, "phone": string|null, "item_price": number|null, "shipping_price": number|null, "pickup_location": string|null, "bundle_note": string|null}]}`;
}

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
  const textBlock = (data.content || []).find(
    (block) => block.type === "text",
  );
  if (!textBlock) return { books: [], error: "no_text_in_response" };
  return parseModelResponse(
    textBlock.text,
    books.map((book) => book.id),
  );
}
