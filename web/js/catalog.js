// Themenkatalog für die Einrichtung: Bereiche, Unterthemen mit Suchbegriffen, Beispiele für die Push-Grenze.
// p = Vorschlag für die Wichtigkeit (3 = Sofort-Push, 2 = wichtig, 1 = nur in der App)

export const CATEGORIES = [
  {
    id: "boerse", name: "Börse & Finanzen", emoji: "📈",
    topics: [
      { id: "boerse.maerkte", name: "Aktienmärkte", emoji: "📊", p: 2, kw: ["DAX", "S&P 500", "Nasdaq", "Dow Jones", "Wall Street", "Börsencrash", "stock market"] },
      { id: "boerse.zinsen", name: "Zinsen & Notenbanken", emoji: "🏦", p: 2, kw: ["Leitzins", "EZB", "Federal Reserve", "Zinsentscheid", "Inflation", "interest rates"] },
      { id: "boerse.zahlen", name: "Quartalszahlen", emoji: "🧾", p: 1, kw: ["Quartalszahlen", "Gewinnwarnung", "earnings", "Berichtssaison"] },
      { id: "boerse.etf", name: "ETFs & Geldanlage", emoji: "🧺", p: 1, kw: ["ETF", "MSCI World", "Sparplan", "Geldanlage"] },
      { id: "boerse.rohstoffe", name: "Gold & Rohstoffe", emoji: "🥇", p: 1, kw: ["Goldpreis", "Ölpreis", "Rohstoffe", "gold price", "oil price"] },
      { id: "boerse.ipo", name: "Börsengänge", emoji: "🔔", p: 1, kw: ["Börsengang", "IPO"] },
      { id: "boerse.immobilien", name: "Immobilien", emoji: "🏠", p: 1, kw: ["Immobilienpreise", "Bauzinsen", "Immobilienmarkt"] },
    ],
  },
  {
    id: "krypto", name: "Krypto", emoji: "🪙",
    topics: [
      { id: "krypto.bitcoin", name: "Bitcoin", emoji: "₿", p: 2, kw: ["Bitcoin", "BTC"] },
      { id: "krypto.ethereum", name: "Ethereum", emoji: "💠", p: 1, kw: ["Ethereum", "Ether"] },
      { id: "krypto.altcoins", name: "Solana & Altcoins", emoji: "🧪", p: 1, kw: ["Solana", "Altcoin", "XRP", "Dogecoin"] },
      { id: "krypto.regulierung", name: "Krypto-Regulierung", emoji: "⚖️", p: 1, kw: ["Krypto-Regulierung", "Bitcoin-ETF", "crypto regulation", "Kryptobörse"] },
    ],
  },
  {
    id: "tech", name: "Tech", emoji: "💻",
    topics: [
      { id: "tech.apple", name: "Apple", emoji: "🍎", p: 2, kw: ["Apple", "iPhone", "iOS", "MacBook"] },
      { id: "tech.google", name: "Google", emoji: "🔎", p: 1, kw: ["Google", "Alphabet", "Android", "Pixel"] },
      { id: "tech.microsoft", name: "Microsoft", emoji: "🪟", p: 1, kw: ["Microsoft", "Windows"] },
      { id: "tech.chips", name: "Chips & Halbleiter", emoji: "🧩", p: 2, kw: ["Halbleiter", "Chiphersteller", "TSMC", "ASML", "semiconductor"] },
      { id: "tech.social", name: "Soziale Medien", emoji: "📱", p: 1, kw: ["TikTok", "Instagram", "WhatsApp", "YouTube", "Twitter", "Snapchat"] },
      { id: "tech.musk", name: "Elon Musk", emoji: "🚗", p: 1, kw: ["Elon Musk", "Tesla", "xAI"] },
      { id: "tech.sicherheit", name: "IT-Sicherheit", emoji: "🔐", p: 1, kw: ["Hackerangriff", "Datenleck", "Sicherheitslücke", "Cyberangriff", "data breach"] },
      { id: "tech.smartphones", name: "Smartphones & Gadgets", emoji: "📲", p: 1, kw: ["Smartphone", "Samsung Galaxy", "Smartwatch"] },
    ],
  },
  {
    id: "ki", name: "Künstliche Intelligenz", emoji: "🤖",
    topics: [
      { id: "ki.openai", name: "OpenAI & ChatGPT", emoji: "💬", p: 2, kw: ["OpenAI", "ChatGPT", "Sam Altman"] },
      { id: "ki.anthropic", name: "Anthropic & Claude", emoji: "🟠", p: 2, kw: ["Anthropic", "Claude AI", "Claude"] },
      { id: "ki.google", name: "Google Gemini", emoji: "✨", p: 1, kw: ["Gemini", "Google DeepMind", "DeepMind"] },
      { id: "ki.modelle", name: "Neue KI-Modelle", emoji: "🧠", p: 2, kw: ["KI-Modell", "Sprachmodell", "AI model", "LLM"] },
      { id: "ki.regeln", name: "KI-Regeln & Gesetze", emoji: "⚖️", p: 1, kw: ["KI-Verordnung", "AI Act", "KI-Regulierung", "AI regulation"] },
      { id: "ki.robotik", name: "Robotik", emoji: "🦾", p: 1, kw: ["humanoide Roboter", "Robotik", "humanoid robot"] },
      { id: "ki.allgemein", name: "KI allgemein", emoji: "🤖", p: 1, kw: ["Künstliche Intelligenz", "KI", "artificial intelligence"] },
    ],
  },
  {
    id: "gaming", name: "Gaming", emoji: "🎮",
    topics: [
      { id: "gaming.gta", name: "GTA 6", emoji: "🌴", p: 3, kw: ["GTA 6", "GTA VI", "Rockstar Games", "Grand Theft Auto"] },
      { id: "gaming.playstation", name: "PlayStation", emoji: "🎮", p: 1, kw: ["PlayStation", "PS5", "PS6", "Sony Interactive"] },
      { id: "gaming.xbox", name: "Xbox", emoji: "❎", p: 1, kw: ["Xbox", "Game Pass"] },
      { id: "gaming.nintendo", name: "Nintendo", emoji: "🍄", p: 1, kw: ["Nintendo", "Switch 2", "Zelda", "Mario"] },
      { id: "gaming.pc", name: "PC & Steam", emoji: "🖥️", p: 1, kw: ["Steam", "Valve", "Steam Deck", "PC-Spiele"] },
      { id: "gaming.cod", name: "Call of Duty", emoji: "🔫", p: 1, kw: ["Call of Duty", "Warzone"] },
      { id: "gaming.fussball", name: "EA Sports FC", emoji: "⚽", p: 1, kw: ["EA Sports FC", "EA FC"] },
      { id: "gaming.fortnite", name: "Fortnite", emoji: "🪂", p: 1, kw: ["Fortnite", "Epic Games"] },
      { id: "gaming.releases", name: "Große Releases", emoji: "📅", p: 2, kw: ["Releasedatum", "release date", "Release-Termin", "Game Awards"] },
      { id: "gaming.hardware", name: "Grafikkarten", emoji: "🧮", p: 1, kw: ["Grafikkarte", "GeForce", "Radeon", "RTX"] },
      { id: "gaming.esport", name: "E-Sport", emoji: "🏆", p: 1, kw: ["E-Sport", "Esports", "League of Legends", "Counter-Strike"] },
    ],
  },
  {
    id: "politik_de", name: "Politik Deutschland", emoji: "🇩🇪",
    topics: [
      { id: "de.regierung", name: "Bundesregierung", emoji: "🏛️", p: 2, kw: ["Bundesregierung", "Bundeskanzler", "Kanzler", "Koalition"] },
      { id: "de.bundestag", name: "Bundestag & Gesetze", emoji: "📜", p: 1, kw: ["Bundestag", "Gesetzentwurf", "Bundesrat"] },
      { id: "de.wahlen", name: "Wahlen", emoji: "🗳️", p: 3, kw: ["Bundestagswahl", "Landtagswahl", "Wahlergebnis", "Hochrechnung", "Neuwahl"] },
      { id: "de.geld", name: "Rente, Steuern, Bürgergeld", emoji: "💶", p: 2, kw: ["Rente", "Steuern", "Bürgergeld", "Mindestlohn", "Kindergeld"] },
      { id: "de.migration", name: "Migration", emoji: "🧳", p: 1, kw: ["Migration", "Asyl", "Abschiebung"] },
      { id: "de.verteidigung", name: "Bundeswehr", emoji: "🪖", p: 1, kw: ["Bundeswehr", "Wehrpflicht", "Verteidigungsminister"] },
      { id: "de.parteien", name: "Parteien", emoji: "🎗️", p: 1, kw: ["CDU", "SPD", "Grüne", "AfD", "FDP", "BSW", "Linke"] },
    ],
  },
  {
    id: "politik_us", name: "Politik USA", emoji: "🇺🇸",
    topics: [
      { id: "us.praesident", name: "Präsident & Weißes Haus", emoji: "🏛️", p: 2, kw: ["Trump", "Weißes Haus", "White House", "US-Präsident"] },
      { id: "us.wahlen", name: "US-Wahlen", emoji: "🗳️", p: 3, kw: ["Midterms", "Zwischenwahlen", "US-Wahl", "Präsidentschaftswahl", "midterm elections"] },
      { id: "us.kongress", name: "Kongress", emoji: "🏢", p: 1, kw: ["US-Kongress", "US-Senat", "Repräsentantenhaus", "Shutdown", "Congress"] },
      { id: "us.gericht", name: "Supreme Court", emoji: "⚖️", p: 1, kw: ["Supreme Court", "Oberster Gerichtshof"] },
      { id: "us.zoelle", name: "Zölle & Handel", emoji: "🚢", p: 2, kw: ["Zölle", "Strafzölle", "Handelskrieg", "tariffs", "trade war"] },
    ],
  },
  {
    id: "welt", name: "Weltgeschehen", emoji: "🌍",
    topics: [
      { id: "welt.ukraine", name: "Ukraine & Russland", emoji: "🇺🇦", p: 2, kw: ["Ukraine", "Putin", "Selenskyj", "Kreml"] },
      { id: "welt.nahost", name: "Nahost", emoji: "🕊️", p: 2, kw: ["Israel", "Gaza", "Iran", "Nahost", "Hamas"] },
      { id: "welt.china", name: "China & Taiwan", emoji: "🇨🇳", p: 1, kw: ["China", "Taiwan", "Xi Jinping", "Peking"] },
      { id: "welt.eu", name: "Europäische Union", emoji: "🇪🇺", p: 1, kw: ["EU-Kommission", "Europäische Union", "EU-Gipfel", "Brüssel"] },
      { id: "welt.katastrophen", name: "Naturkatastrophen", emoji: "🌋", p: 2, kw: ["Erdbeben", "Tsunami", "Vulkanausbruch", "Hurrikan", "earthquake"] },
      { id: "welt.anschlaege", name: "Anschläge & Krisen", emoji: "🚨", p: 2, kw: ["Anschlag", "Terror", "Attentat", "Geiselnahme"] },
    ],
  },
  {
    id: "wirtschaft", name: "Wirtschaft", emoji: "🏭",
    topics: [
      { id: "wi.konjunktur", name: "Konjunktur", emoji: "📉", p: 1, kw: ["Konjunktur", "Rezession", "Wirtschaftswachstum", "Bruttoinlandsprodukt"] },
      { id: "wi.auto", name: "Autoindustrie", emoji: "🚙", p: 1, kw: ["Volkswagen", "BMW", "Mercedes", "Autoindustrie", "Porsche"] },
      { id: "wi.energie", name: "Energiepreise", emoji: "⚡", p: 1, kw: ["Strompreis", "Gaspreis", "Energiepreise", "Spritpreise"] },
      { id: "wi.streiks", name: "Streiks & Arbeitsmarkt", emoji: "🪧", p: 2, kw: ["Streik", "Warnstreik", "Tarifverhandlungen", "Arbeitslosigkeit"] },
      { id: "wi.pleiten", name: "Insolvenzen & Übernahmen", emoji: "🧨", p: 1, kw: ["Insolvenz", "Übernahme", "Stellenabbau", "Fusion"] },
      { id: "wi.startups", name: "Start-ups", emoji: "🚀", p: 1, kw: ["Start-up", "Startup", "Finanzierungsrunde", "Einhorn"] },
    ],
  },
  {
    id: "wissen", name: "Wissenschaft & Raumfahrt", emoji: "🔭",
    topics: [
      { id: "wissen.spacex", name: "SpaceX & Starship", emoji: "🚀", p: 2, kw: ["SpaceX", "Starship", "Falcon 9"] },
      { id: "wissen.raumfahrt", name: "NASA & ESA", emoji: "🛰️", p: 1, kw: ["NASA", "ESA", "Raumfahrt", "Artemis", "Raumstation"] },
      { id: "wissen.medizin", name: "Medizin & Forschung", emoji: "🧬", p: 1, kw: ["Durchbruch", "Studie zeigt", "Impfstoff", "Krebsforschung"] },
      { id: "wissen.klima", name: "Klima & Umwelt", emoji: "🌡️", p: 1, kw: ["Klimawandel", "Klimagipfel", "Erderwärmung", "CO2"] },
      { id: "wissen.physik", name: "Physik & Weltall", emoji: "🌌", p: 1, kw: ["Astronomie", "Schwarzes Loch", "James Webb", "Kernfusion"] },
    ],
  },
  {
    id: "sport", name: "Sport", emoji: "⚽",
    topics: [
      { id: "sport.bundesliga", name: "Bundesliga", emoji: "🇩🇪", p: 1, kw: ["Bundesliga", "DFB-Pokal"] },
      { id: "sport.cl", name: "Champions League", emoji: "🏆", p: 1, kw: ["Champions League", "Europa League"] },
      { id: "sport.dfb", name: "Nationalmannschaft", emoji: "🦅", p: 2, kw: ["Nationalmannschaft", "DFB-Elf", "Nagelsmann", "Weltmeisterschaft", "WM 2026"] },
      { id: "sport.transfers", name: "Transfers", emoji: "🔁", p: 1, kw: ["Transfer", "Wechsel perfekt", "Ablöse"] },
      { id: "sport.f1", name: "Formel 1", emoji: "🏎️", p: 1, kw: ["Formel 1", "Formula 1", "Grand Prix", "Verstappen"] },
      { id: "sport.nba", name: "NBA", emoji: "🏀", p: 1, kw: ["NBA", "Basketball"] },
      { id: "sport.nfl", name: "NFL", emoji: "🏈", p: 1, kw: ["NFL", "Super Bowl"] },
      { id: "sport.tennis", name: "Tennis", emoji: "🎾", p: 1, kw: ["Tennis", "Wimbledon", "Zverev", "Grand Slam"] },
      { id: "sport.kampf", name: "Boxen & UFC", emoji: "🥊", p: 1, kw: ["UFC", "Boxen", "Boxkampf"] },
    ],
    clubs: ["FC Bayern", "Borussia Dortmund", "Bayer Leverkusen", "RB Leipzig", "VfB Stuttgart", "Eintracht Frankfurt", "Hamburger SV", "Werder Bremen", "1. FC Köln", "Schalke 04", "Borussia Mönchengladbach", "Hertha BSC", "Union Berlin", "SC Freiburg", "FC St. Pauli", "Real Madrid", "FC Barcelona", "Manchester City", "FC Liverpool", "FC Arsenal"],
  },
  {
    id: "auto", name: "Auto & Mobilität", emoji: "🚗",
    topics: [
      { id: "auto.eauto", name: "E-Autos", emoji: "🔋", p: 1, kw: ["Elektroauto", "E-Auto", "Ladeinfrastruktur", "electric vehicle"] },
      { id: "auto.tesla", name: "Tesla", emoji: "⚡", p: 1, kw: ["Tesla", "Model Y", "Cybertruck", "Robotaxi"] },
      { id: "auto.bahn", name: "Bahn & Verkehr", emoji: "🚆", p: 1, kw: ["Deutsche Bahn", "Bahnstreik", "Deutschlandticket"] },
      { id: "auto.neu", name: "Neue Modelle", emoji: "🆕", p: 1, kw: ["Neuvorstellung", "Weltpremiere", "Facelift"] },
    ],
  },
  {
    id: "film", name: "Film & Serien", emoji: "🎬",
    topics: [
      { id: "film.netflix", name: "Netflix & Streaming", emoji: "📺", p: 1, kw: ["Netflix", "Disney+", "Prime Video", "Streaming"] },
      { id: "film.marvel", name: "Marvel & Star Wars", emoji: "🦸", p: 1, kw: ["Marvel", "Star Wars", "Avengers"] },
      { id: "film.kino", name: "Kino & Trailer", emoji: "🍿", p: 1, kw: ["Kinostart", "Trailer", "Oscar", "Box Office"] },
      { id: "film.serien", name: "Serien-Neuheiten", emoji: "🎞️", p: 1, kw: ["neue Staffel", "Serienstart", "Staffel"] },
    ],
  },
  {
    id: "musik", name: "Musik & Popkultur", emoji: "🎧",
    topics: [
      { id: "musik.alben", name: "Neue Alben", emoji: "💿", p: 1, kw: ["neues Album", "new album", "Albumankündigung"] },
      { id: "musik.touren", name: "Konzerte & Tourneen", emoji: "🎤", p: 1, kw: ["Tournee", "Tour-Termine", "Konzert", "Festival"] },
      { id: "musik.rap", name: "Deutschrap & Hip-Hop", emoji: "🎙️", p: 1, kw: ["Deutschrap", "Rapper", "Hip-Hop"] },
      { id: "musik.stars", name: "Stars & Promis", emoji: "🌟", p: 1, kw: ["Promi", "Star", "Royals"] },
    ],
  },
  {
    id: "gesundheit", name: "Gesundheit", emoji: "🩺",
    topics: [
      { id: "ges.fitness", name: "Fitness & Ernährung", emoji: "🏋️", p: 1, kw: ["Fitness", "Ernährung", "Training", "Protein"] },
      { id: "ges.medizin", name: "Medizin-Neuigkeiten", emoji: "💊", p: 1, kw: ["Medikament", "Zulassung", "Krankenkasse", "Therapie"] },
      { id: "ges.psyche", name: "Psyche & Schlaf", emoji: "🧘", p: 1, kw: ["Schlaf", "Stress", "mentale Gesundheit"] },
    ],
  },
  {
    id: "verbraucher", name: "Alltag & Verbraucher", emoji: "🛒",
    topics: [
      { id: "verb.preise", name: "Preise & Kosten", emoji: "🏷️", p: 1, kw: ["Preiserhöhung", "Lebensmittelpreise", "Mieten", "Nebenkosten"] },
      { id: "verb.recht", name: "Neue Regeln & Gesetze", emoji: "📋", p: 2, kw: ["das ändert sich", "neue Regeln", "tritt in Kraft", "Änderungen ab"] },
      { id: "verb.rueckruf", name: "Rückrufe & Warnungen", emoji: "⚠️", p: 1, kw: ["Rückruf", "Produktwarnung", "Warnung vor"] },
      { id: "verb.studium", name: "Studium & Ausbildung", emoji: "🎓", p: 1, kw: ["BAföG", "Studium", "Ausbildung", "Semester"] },
    ],
  },
];

// Arten von Ereignissen bei Aktien (müssen zu den Schlüsseln im Dienst passen)
export const STOCK_EVENTS = [
  { id: "leadership", name: "Chefwechsel", emoji: "🪑" },
  { id: "earnings", name: "Geschäftszahlen", emoji: "🧾" },
  { id: "ma", name: "Übernahmen", emoji: "🤝" },
  { id: "market_move", name: "Kurssprünge", emoji: "📉" },
  { id: "legal", name: "Klagen & Regeln", emoji: "⚖️" },
  { id: "product", name: "Neue Produkte", emoji: "🆕" },
  { id: "analyst", name: "Analysten", emoji: "🔍" },
];
export const STOCK_EVENTS_DEFAULT = ["leadership", "earnings", "ma", "market_move", "legal"];

export const POPULAR_STOCKS = [
  { symbol: "NVDA", name: "Nvidia" }, { symbol: "AAPL", name: "Apple" }, { symbol: "MSFT", name: "Microsoft" },
  { symbol: "TSLA", name: "Tesla" }, { symbol: "AMZN", name: "Amazon" }, { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "META", name: "Meta" }, { symbol: "AMD", name: "AMD" }, { symbol: "PLTR", name: "Palantir" },
  { symbol: "SAP.DE", name: "SAP" }, { symbol: "RHM.DE", name: "Rheinmetall" }, { symbol: "SIE.DE", name: "Siemens" },
  { symbol: "ALV.DE", name: "Allianz" }, { symbol: "VOW3.DE", name: "Volkswagen" }, { symbol: "BTC-USD", name: "Bitcoin" },
];

/** Suchbegriffe für eine Aktie aus Name und Kürzel ableiten. */
export function stockKeywords(name, symbol) {
  const clean = String(name).replace(/[,.]?\s+(Inc|Corp|Corporation|AG|SE|N\.?V\.?|plc|PLC|Ltd|Limited|Co|Company|Holdings?|Group|S\.?A\.?|KGaA|& Co)\.?$/gi, "").replace(/\s+(Inc|Corp|Corporation|Platforms|Technologies|Motors)\.?$/gi, "").replace(/[,.]\s*$/, "").trim();
  const base = String(symbol || "").split(/[.\-]/)[0].toUpperCase();
  const kw = [];
  if (clean) kw.push(clean);
  if (base.length >= 3 && base.toLowerCase() !== clean.toLowerCase()) kw.push(base);
  return kw;
}

// Beispiele für die Push-Grenze. level 1–5 entspricht Wichtigkeit 25 / 40 / 55 / 70 / 88.
export const LEVEL_VALUE = { 1: 25, 2: 40, 3: 55, 4: 70, 5: 88 };

export function calibrationExamples({ stock, topic }) {
  const list = [];
  if (stock) {
    list.push(
      { domain: "stocks", level: 5, text: `${stock}-Chef tritt überraschend zurück`, hint: "Chefwechsel" },
      { domain: "stocks", level: 4, text: `${stock} übertrifft Erwartungen deutlich – Aktie springt nachbörslich`, hint: "Geschäftszahlen" },
      { domain: "stocks", level: 3, text: `${stock} stellt neues Produkt vor`, hint: "Ankündigung" },
      { domain: "stocks", level: 2, text: `Analyst hebt Kursziel für ${stock} an`, hint: "Analystenmeinung" },
      { domain: "stocks", level: 1, text: `Kolumne: Ist die ${stock}-Aktie zu teuer?`, hint: "Meinung" },
    );
  }
  if (topic) {
    list.push(
      { domain: "topics", level: 5, text: `Riesige Überraschung bei „${topic}“ – alle großen Medien berichten`, hint: "Großereignis" },
      { domain: "topics", level: 4, text: `Offiziell bestätigt: wichtige Entscheidung zu „${topic}“`, hint: "Bestätigte Nachricht" },
      { domain: "topics", level: 3, text: `Neue Ankündigung zu „${topic}“`, hint: "Ankündigung" },
      { domain: "topics", level: 2, text: `Gerücht: Insider berichtet Neues zu „${topic}“`, hint: "Gerücht" },
      { domain: "topics", level: 1, text: `Interview und Hintergründe zu „${topic}“`, hint: "Hintergrund" },
    );
  }
  list.push(
    { domain: "world", level: 5, text: "Bundeskanzler tritt zurück", hint: "Historisches Ereignis" },
    { domain: "world", level: 5, text: "Schweres Erdbeben mit vielen Opfern in Europa", hint: "Katastrophe" },
    { domain: "world", level: 4, text: "Wahlergebnis steht fest: Regierungswechsel in den USA", hint: "Wahl" },
    { domain: "world", level: 3, text: "Bundestag beschließt großes Gesetzespaket", hint: "Politik" },
    { domain: "world", level: 2, text: "Minister kündigt neue Initiative an", hint: "Ankündigung" },
  );
  return list;
}

/** Aus Ja/Nein-Antworten die Schwelle berechnen: knapp unter der niedrigsten Stufe, ab der durchgehend „Ja“ kam. */
export function thresholdFromAnswers(answers) {
  // answers: [{level, yes}]
  if (!answers.length) return null;
  const byLevel = new Map();
  for (const a of answers) {
    const cur = byLevel.get(a.level) ?? { yes: 0, no: 0 };
    a.yes ? cur.yes++ : cur.no++;
    byLevel.set(a.level, cur);
  }
  let lowestYes = null;
  for (let l = 5; l >= 1; l--) {
    const c = byLevel.get(l);
    if (!c) continue;
    if (c.yes > 0 && c.yes >= c.no) lowestYes = l;
    else break;
  }
  if (lowestYes == null) return 93;
  const below = lowestYes > 1 ? LEVEL_VALUE[lowestYes - 1] : 15;
  return Math.round((LEVEL_VALUE[lowestYes] + below) / 2);
}

export const PRIORITY_LABEL = { 3: "Sofort-Push", 2: "Wichtig", 1: "Nur in der App", 0: "Ausblenden" };
