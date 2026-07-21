const test = require("node:test");
const assert = require("node:assert/strict");
const isbn = require("../isbn-core.js");

test("validates ISBN10 and ISBN13", () => {
  assert.equal(isbn.isValidIsbn13("978-0-306-40615-7"), true);
  assert.equal(isbn.isValidIsbn10("0306406152"), true);
  assert.equal(isbn.isValidIsbn10("097522980X"), true);
  assert.equal(isbn.isValidIsbn13("9780306406158"), false);
  assert.equal(isbn.isValidIsbn("123"), false);
});
