(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HamadafIsbn = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  function clean(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^0-9X]/g, "");
  }
  function isValidIsbn10(value) {
    const isbn = clean(value);
    if (!/^\d{9}[\dX]$/.test(isbn)) return false;
    const sum = [...isbn].reduce((total, char, index) => {
      const digit = char === "X" ? 10 : Number(char);
      return total + digit * (10 - index);
    }, 0);
    return sum % 11 === 0;
  }
  function isValidIsbn13(value) {
    const isbn = clean(value);
    if (!/^\d{13}$/.test(isbn)) return false;
    const sum = [...isbn.slice(0, 12)].reduce(
      (total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3),
      0,
    );
    return (10 - (sum % 10)) % 10 === Number(isbn[12]);
  }
  function isValidIsbn(value) {
    const isbn = clean(value);
    return isbn.length === 10 ? isValidIsbn10(isbn) : isValidIsbn13(isbn);
  }
  return { clean, isValidIsbn, isValidIsbn10, isValidIsbn13 };
});
