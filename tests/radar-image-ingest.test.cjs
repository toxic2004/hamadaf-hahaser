const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function extraction() {
  return import(
    path.join(
      __dirname,
      "..",
      "supabase/functions/radar-image-ingest/extraction-core.mjs",
    )
  );
}

const BOOKS = [
  { id: "book-1", title: "אנטי שביר", author: "נסים ניקולס טאלב" },
  { id: "book-2", title: "מיליונר ברגע", author: null },
];

test("buildExtractionPrompt includes every book title so matching is only ever against the real list", async () => {
  const { buildExtractionPrompt } = await extraction();
  const prompt = buildExtractionPrompt(BOOKS);
  assert.match(prompt, /אנטי שביר/);
  assert.match(prompt, /מיליונר ברגע/);
  assert.match(prompt, /\[id:book-1\]/);
});

test("buildExtractionPrompt handles an empty book list without crashing", async () => {
  const { buildExtractionPrompt } = await extraction();
  const prompt = buildExtractionPrompt([]);
  assert.match(prompt, /אין ספרים ברשימה/);
});

test("parseModelResponse: valid response with a real book_id is kept as-is", async () => {
  const { parseModelResponse } = await extraction();
  const raw = JSON.stringify({
    books: [
      {
        book_id: "book-1",
        matched_title: "אנטי שביר",
        confidence: "high",
        seller_name: "יואל",
        phone: null,
        item_price: 20,
        shipping_price: null,
        pickup_location: "תל אביב",
        bundle_note: null,
      },
    ],
  });
  const result = parseModelResponse(raw, ["book-1", "book-2"]);
  assert.equal(result.error, null);
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].book_id, "book-1");
  assert.equal(result.books[0].item_price, 20);
});

test("parseModelResponse: regression - a book_id the model invented (not in this user's real list) is stripped to null/none, never trusted", async () => {
  const { parseModelResponse } = await extraction();
  const raw = JSON.stringify({
    books: [
      {
        book_id: "some-other-users-book-id",
        matched_title: "משהו",
        confidence: "high",
        item_price: 30,
      },
    ],
  });
  const result = parseModelResponse(raw, ["book-1", "book-2"]);
  assert.equal(result.books[0].book_id, null);
  assert.equal(
    result.books[0].confidence,
    "none",
    "confidence must be forced to none when the book_id isn't real - never show a fabricated match as confident",
  );
});

test("parseModelResponse: malformed JSON degrades to empty result, never throws", async () => {
  const { parseModelResponse } = await extraction();
  const result = parseModelResponse("not json at all {{{", ["book-1"]);
  assert.equal(result.error, "invalid_json");
  assert.deepEqual(result.books, []);
});

test("parseModelResponse: missing books array degrades safely", async () => {
  const { parseModelResponse } = await extraction();
  const result = parseModelResponse(JSON.stringify({ foo: "bar" }), ["book-1"]);
  assert.equal(result.error, "invalid_shape");
  assert.deepEqual(result.books, []);
});

test("parseModelResponse: negative or non-numeric price is dropped to null, never passed through", async () => {
  const { parseModelResponse } = await extraction();
  const raw = JSON.stringify({
    books: [
      {
        book_id: "book-1",
        matched_title: "אנטי שביר",
        confidence: "high",
        item_price: -5,
      },
      {
        book_id: "book-2",
        matched_title: "מיליונר ברגע",
        confidence: "low",
        item_price: "לא ברור",
      },
    ],
  });
  const result = parseModelResponse(raw, ["book-1", "book-2"]);
  assert.equal(result.books[0].item_price, null);
  assert.equal(result.books[1].item_price, null);
});

test("parseModelResponse: bundle price case (real scenario) - item_price null, bundle_note preserved, never a fabricated split", async () => {
  const { parseModelResponse } = await extraction();
  const raw = JSON.stringify({
    books: [
      {
        book_id: "book-1",
        matched_title: "אנטי שביר",
        confidence: "high",
        item_price: null,
        bundle_note: 'מחיר 100 ש"ח לשלושה ספרים יחד, לא ניתן לפצל',
      },
    ],
  });
  const result = parseModelResponse(raw, ["book-1"]);
  assert.equal(result.books[0].item_price, null);
  assert.match(result.books[0].bundle_note, /100/);
});

test("extractOffersFromImage: sends the image and prompt correctly, parses a mocked API response", async () => {
  const { extractOffersFromImage } = await extraction();
  const fetchImpl = async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init.body);
    assert.equal(body.messages[0].content[0].type, "image");
    assert.equal(body.messages[0].content[0].source.data, "ZmFrZS1pbWFnZQ==");
    return {
      ok: true,
      json: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              books: [
                {
                  book_id: "book-1",
                  matched_title: "אנטי שביר",
                  confidence: "high",
                  item_price: 20,
                },
              ],
            }),
          },
        ],
      }),
    };
  };
  const result = await extractOffersFromImage({
    fetchImpl,
    apiKey: "fake-key",
    imageBase64: "ZmFrZS1pbWFnZQ==",
    mediaType: "image/png",
    books: BOOKS,
  });
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].item_price, 20);
});

test("extractOffersFromImage: API error surfaces as a thrown error, never a silent fabricated result", async () => {
  const { extractOffersFromImage } = await extraction();
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    text: async () => "internal error",
  });
  await assert.rejects(
    () =>
      extractOffersFromImage({
        fetchImpl,
        apiKey: "fake-key",
        imageBase64: "ZmFrZS1pbWFnZQ==",
        mediaType: "image/png",
        books: BOOKS,
      }),
    /Anthropic API error 500/,
  );
});

test("extractOffersFromImage: missing API key throws immediately, never attempts a request", async () => {
  const { extractOffersFromImage } = await extraction();
  await assert.rejects(
    () =>
      extractOffersFromImage({
        apiKey: "",
        imageBase64: "x",
        mediaType: "image/png",
        books: BOOKS,
      }),
    /Missing Anthropic API key/,
  );
});
