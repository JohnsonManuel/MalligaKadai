// Extract the Next.js __NEXT_DATA__ SSR JSON blob from a kaufDA HTML page.
// kaufDA server-renders all offer/brochure data into this script tag, so a
// plain HTTP GET + this parse is all we need (no headless browser, no keys).

function getNextData(html) {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("__NEXT_DATA__ script not found in HTML");
  return JSON.parse(m[1]);
}

module.exports = { getNextData };
