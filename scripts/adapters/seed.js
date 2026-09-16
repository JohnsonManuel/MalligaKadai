// Seed adapter — realistic sample German weekly prices.
// This is the DATA BOUNDARY the frontend consumes. Any real source
// (marktguru scraper, chain API, manual upload) just needs to return
// the same { weekOf, validUntil, offers[] } shape from fetchOffers().

// Monday of the current offer week + Saturday it runs until.
function currentWeek() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { weekOf: iso(monday), validUntil: iso(saturday) };
}

// price table: productId -> { chainId: [price, wasPrice?] }
// A second number means it's on offer (Angebot) reduced from wasPrice.
const PRICES = {
  haehnchenbrust: { rewe: [7.99], edeka: [8.49], lidl: [6.66, 8.49], "aldi-sued": [6.99], penny: [6.79], netto: [6.49, 7.99], kaufland: [6.98] },
  hackfleisch:    { rewe: [3.49], edeka: [3.99], lidl: [2.99], "aldi-sued": [2.89], penny: [3.19], netto: [2.99], kaufland: [2.79, 3.49] },
  monster:        { rewe: [1.49], edeka: [1.59], lidl: [0.99], "aldi-sued": [0.95], penny: [1.29], netto: [1.19], kaufland: [0.89, 1.29] },
  redbull:        { rewe: [1.19], edeka: [1.25], lidl: [0.99], penny: [1.09], netto: [0.99], kaufland: [0.95] },
  cola:           { rewe: [1.49], edeka: [1.55], lidl: [1.19], penny: [1.39], netto: [1.29], kaufland: [1.11, 1.49] },
  bier:           { rewe: [13.99], edeka: [14.49], penny: [11.99], netto: [9.99, 12.99], kaufland: [10.99] },
  milch:          { rewe: [1.09], edeka: [1.15], lidl: [0.95], "aldi-sued": [0.95], penny: [0.99], netto: [0.95], kaufland: [0.89] },
  butter:         { rewe: [1.99], edeka: [2.19], lidl: [1.69], "aldi-sued": [1.69], penny: [1.79], netto: [1.69], kaufland: [1.59, 1.99] },
  eier:           { rewe: [2.79], edeka: [2.99], lidl: [2.19], "aldi-sued": [2.19], penny: [2.49], netto: [2.29], kaufland: [1.99, 2.69] },
  kaese:          { rewe: [3.49], edeka: [3.79], lidl: [2.99], "aldi-sued": [2.89], kaufland: [2.79] },
  kaffee:         { rewe: [5.99], edeka: [6.49], lidl: [4.44, 5.99], "aldi-sued": [4.99], penny: [4.79], netto: [4.99], kaufland: [3.99, 5.49] },
  nutella:        { rewe: [3.29], edeka: [3.49], lidl: [2.99], penny: [2.99], netto: [2.99], kaufland: [2.79] },
  bananen:        { rewe: [1.49], edeka: [1.59], lidl: [1.11], "aldi-sued": [1.19], penny: [1.29], netto: [1.19], kaufland: [1.09] },
  tomaten:        { rewe: [2.49], edeka: [2.99], lidl: [1.99], "aldi-sued": [1.99], netto: [2.29] },
  spaghetti:      { rewe: [0.89], edeka: [0.99], lidl: [0.59], "aldi-sued": [0.55], penny: [0.69], netto: [0.65], kaufland: [0.49] },
  pizza:          { rewe: [2.49], edeka: [2.99], lidl: [1.99], "aldi-sued": [1.79], penny: [2.29], netto: [1.99], kaufland: [1.66, 2.29] },
  chips:          { rewe: [1.49], edeka: [1.79], lidl: [0.99, 1.49], penny: [1.29], netto: [1.19], kaufland: [0.95] },
  toilettenpapier:{ rewe: [3.49], edeka: [3.99], lidl: [2.49], "aldi-sued": [2.45], penny: [2.99], netto: [2.79], kaufland: [2.22, 2.99] }
};

async function fetchOffers() {
  const { weekOf, validUntil } = currentWeek();
  const offers = [];
  for (const [productId, byChain] of Object.entries(PRICES)) {
    for (const [chainId, [price, wasPrice]] of Object.entries(byChain)) {
      offers.push({
        productId,
        chainId,
        price,
        onOffer: wasPrice != null,
        ...(wasPrice != null ? { wasPrice } : {})
      });
    }
  }
  return { weekOf, validUntil, offers };
}

module.exports = { name: "seed", fetchOffers };
