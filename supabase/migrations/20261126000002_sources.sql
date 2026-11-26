-- Feste Nachrichtenquellen. "core" = immer aktiv (allgemeine Lage, für Eilmeldungen).
-- Alle anderen werden aktiv, sobald der passende Bereich in der App gewählt ist.
insert into public.sources (key, name, kind, url, lang, category, weight, breaking, interval_sec, core, enabled) values
-- Allgemein (immer an)
('rss:tagesschau', 'tagesschau', 'rss', 'https://www.tagesschau.de/index~rss2.xml', 'de', 'top', 1.25, false, 60, true, true),
('rss:spiegel', 'DER SPIEGEL', 'rss', 'https://www.spiegel.de/schlagzeilen/index.rss', 'de', 'top', 1.15, false, 75, true, true),
('rss:zeit', 'ZEIT ONLINE', 'rss', 'https://newsfeed.zeit.de/index', 'de', 'top', 1.15, false, 120, true, true),
('rss:faz', 'FAZ', 'rss', 'https://www.faz.net/rss/aktuell/', 'de', 'top', 1.15, false, 120, true, true),
('rss:ntv', 'n-tv', 'rss', 'https://www.n-tv.de/rss', 'de', 'top', 1.0, false, 90, true, true),
('rss:zdf', 'ZDFheute', 'rss', 'https://www.zdf.de/rss/zdf/nachrichten', 'de', 'top', 1.15, false, 120, true, true),
('rss:dlf', 'Deutschlandfunk', 'rss', 'https://www.deutschlandfunk.de/nachrichten-100.rss', 'de', 'top', 1.15, false, 120, true, true),
('rss:sz', 'Süddeutsche Zeitung', 'rss', 'https://rss.sueddeutsche.de/rss/Topthemen', 'de', 'top', 1.1, false, 150, true, true),
('bsky:tagesschau', 'tagesschau', 'bluesky', 'tagesschau.bsky.social', 'de', 'top', 1.25, false, 45, true, true),
('bsky:spiegel', 'DER SPIEGEL', 'bluesky', 'spiegel.de', 'de', 'top', 1.15, false, 45, true, true),
('bsky:zeit', 'ZEIT ONLINE', 'bluesky', 'zeit.de', 'de', 'top', 1.15, false, 60, true, true),
('rss:bbc', 'BBC News', 'rss', 'https://feeds.bbci.co.uk/news/rss.xml', 'en', 'top', 1.25, false, 60, true, true),
('rss:guardian', 'The Guardian', 'rss', 'https://www.theguardian.com/world/rss', 'en', 'top', 1.1, false, 120, true, true),
('rss:nyt', 'New York Times', 'rss', 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', 'en', 'top', 1.2, false, 120, true, true),
('rss:npr', 'NPR', 'rss', 'https://feeds.npr.org/1001/rss.xml', 'en', 'top', 1.0, false, 180, true, true),
('rss:aljazeera', 'Al Jazeera', 'rss', 'https://www.aljazeera.com/xml/rss/all.xml', 'en', 'top', 1.0, false, 180, true, true),
('bsky:reuters', 'Reuters', 'bluesky', 'reuters.com', 'en', 'top', 1.3, false, 30, true, true),
('bsky:ap', 'AP News', 'bluesky', 'apnews.com', 'en', 'top', 1.3, false, 30, true, true),

-- Börse & Finanzen
('rss:handelsblatt', 'Handelsblatt', 'rss', 'https://www.handelsblatt.com/contentexport/feed/top-themen', 'de', 'boerse', 1.15, false, 120, false, false),
('rss:finanzen-net', 'finanzen.net', 'rss', 'https://www.finanzen.net/rss/news', 'de', 'boerse', 1.0, false, 90, false, false),
('rss:tagesschau-finanzen', 'tagesschau Börse', 'rss', 'https://www.tagesschau.de/wirtschaft/finanzen/index~rss2.xml', 'de', 'boerse', 1.15, false, 180, false, false),
('rss:mw-bulletins', 'MarketWatch Eilmeldungen', 'rss', 'https://feeds.content.dowjones.io/public/rss/mw_bulletins', 'en', 'boerse', 1.25, true, 30, false, false),
('rss:mw-top', 'MarketWatch', 'rss', 'https://feeds.content.dowjones.io/public/rss/mw_topstories', 'en', 'boerse', 1.1, false, 120, false, false),
('rss:wsj-markets', 'WSJ Markets', 'rss', 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain', 'en', 'boerse', 1.2, false, 180, false, false),
('rss:bloomberg-markets', 'Bloomberg Markets', 'rss', 'https://feeds.bloomberg.com/markets/news.rss', 'en', 'boerse', 1.25, false, 90, false, false),
('rss:cnbc', 'CNBC', 'rss', 'https://www.cnbc.com/id/100003114/device/rss/rss.html', 'en', 'boerse', 1.15, false, 90, false, false),
('rss:seekingalpha', 'Seeking Alpha', 'rss', 'https://seekingalpha.com/market_currents.xml', 'en', 'boerse', 1.0, false, 60, false, false),
('bsky:bloomberg', 'Bloomberg', 'bluesky', 'bloomberg.com', 'en', 'boerse', 1.25, false, 45, false, false),
('bsky:cnbc', 'CNBC', 'bluesky', 'cnbc.com', 'en', 'boerse', 1.15, false, 60, false, false),
('bsky:ft', 'Financial Times', 'bluesky', 'financialtimes.com', 'en', 'boerse', 1.2, false, 60, false, false),

-- Krypto
('rss:coindesk', 'CoinDesk', 'rss', 'https://www.coindesk.com/arc/outboundfeeds/rss/', 'en', 'krypto', 1.1, false, 120, false, false),
('rss:cointelegraph', 'Cointelegraph', 'rss', 'https://cointelegraph.com/rss', 'en', 'krypto', 1.0, false, 180, false, false),
('rss:btc-echo', 'BTC-ECHO', 'rss', 'https://www.btc-echo.de/feed/', 'de', 'krypto', 1.0, false, 240, false, false),

-- Tech
('rss:heise', 'heise online', 'rss', 'https://www.heise.de/rss/heise-atom.xml', 'de', 'tech', 1.1, false, 120, false, false),
('rss:golem', 'Golem.de', 'rss', 'https://rss.golem.de/rss.php?feed=RSS2.0', 'de', 'tech', 1.05, false, 180, false, false),
('rss:t3n', 't3n', 'rss', 'https://t3n.de/rss.xml', 'de', 'tech', 1.0, false, 240, false, false),
('rss:verge', 'The Verge', 'rss', 'https://www.theverge.com/rss/index.xml', 'en', 'tech', 1.15, false, 120, false, false),
('rss:techcrunch', 'TechCrunch', 'rss', 'https://techcrunch.com/feed/', 'en', 'tech', 1.1, false, 150, false, false),
('rss:ars', 'Ars Technica', 'rss', 'https://feeds.arstechnica.com/arstechnica/index', 'en', 'tech', 1.1, false, 240, false, false),
('rss:bbc-tech', 'BBC Technology', 'rss', 'https://feeds.bbci.co.uk/news/technology/rss.xml', 'en', 'tech', 1.15, false, 240, false, false),
('rss:engadget', 'Engadget', 'rss', 'https://www.engadget.com/rss.xml', 'en', 'tech', 1.0, false, 240, false, false),
('rss:9to5mac', '9to5Mac', 'rss', 'https://9to5mac.com/feed/', 'en', 'tech', 1.0, false, 240, false, false),

-- KI
('rss:the-decoder-de', 'THE DECODER', 'rss', 'https://the-decoder.de/feed/', 'de', 'ki', 1.05, false, 240, false, false),
('rss:the-decoder-en', 'THE DECODER (EN)', 'rss', 'https://the-decoder.com/feed/', 'en', 'ki', 1.05, false, 240, false, false),
('rss:techcrunch-ai', 'TechCrunch AI', 'rss', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'en', 'ki', 1.1, false, 180, false, false),
('rss:venturebeat-ai', 'VentureBeat AI', 'rss', 'https://venturebeat.com/category/ai/feed/', 'en', 'ki', 1.0, false, 300, false, false),
('rss:openai', 'OpenAI', 'rss', 'https://openai.com/news/rss.xml', 'en', 'ki', 1.25, false, 180, false, false),
('rss:google-ai', 'Google AI Blog', 'rss', 'https://blog.google/technology/ai/rss/', 'en', 'ki', 1.15, false, 300, false, false),

-- Gaming
('rss:eurogamer-de', 'Eurogamer.de', 'rss', 'https://www.eurogamer.de/feed', 'de', 'gaming', 1.0, false, 240, false, false),
('rss:ign', 'IGN', 'rss', 'https://feeds.feedburner.com/ign/all', 'en', 'gaming', 1.1, false, 150, false, false),
('rss:eurogamer', 'Eurogamer', 'rss', 'https://www.eurogamer.net/feed', 'en', 'gaming', 1.05, false, 240, false, false),
('rss:vgc', 'VGC', 'rss', 'https://www.videogameschronicle.com/feed/', 'en', 'gaming', 1.1, false, 180, false, false),
('rss:pcgamer', 'PC Gamer', 'rss', 'https://www.pcgamer.com/rss/', 'en', 'gaming', 1.0, false, 240, false, false),
('rss:gematsu', 'Gematsu', 'rss', 'https://www.gematsu.com/feed', 'en', 'gaming', 1.0, false, 240, false, false),
('rss:ps-blog', 'PlayStation Blog', 'rss', 'https://blog.playstation.com/feed/', 'en', 'gaming', 1.15, false, 300, false, false),
('rss:xbox-wire', 'Xbox Wire', 'rss', 'https://news.xbox.com/en-us/feed/', 'en', 'gaming', 1.15, false, 300, false, false),

-- Politik Deutschland
('rss:tagesschau-inland', 'tagesschau Inland', 'rss', 'https://www.tagesschau.de/inland/index~rss2.xml', 'de', 'politik_de', 1.25, false, 120, false, false),
('rss:spiegel-politik', 'SPIEGEL Politik', 'rss', 'https://www.spiegel.de/politik/index.rss', 'de', 'politik_de', 1.15, false, 180, false, false),
('rss:zeit-politik', 'ZEIT Politik', 'rss', 'https://newsfeed.zeit.de/politik/index', 'de', 'politik_de', 1.15, false, 240, false, false),
('rss:welt-politik', 'WELT Politik', 'rss', 'https://www.welt.de/feeds/section/politik.rss', 'de', 'politik_de', 1.05, false, 240, false, false),

-- Politik USA
('rss:politico', 'POLITICO', 'rss', 'https://rss.politico.com/politics-news.xml', 'en', 'politik_us', 1.15, false, 150, false, false),
('rss:nyt-politics', 'NYT Politics', 'rss', 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', 'en', 'politik_us', 1.2, false, 180, false, false),
('rss:bbc-us', 'BBC US & Canada', 'rss', 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', 'en', 'politik_us', 1.2, false, 180, false, false),
('rss:npr-politics', 'NPR Politics', 'rss', 'https://feeds.npr.org/1014/rss.xml', 'en', 'politik_us', 1.05, false, 240, false, false),
('rss:thehill', 'The Hill', 'rss', 'https://thehill.com/feed/', 'en', 'politik_us', 1.0, false, 180, false, false),
('rss:tagesschau-amerika', 'tagesschau Amerika', 'rss', 'https://www.tagesschau.de/ausland/amerika/index~rss2.xml', 'de', 'politik_us', 1.25, false, 180, false, false),
('bsky:politico', 'POLITICO', 'bluesky', 'politico.com', 'en', 'politik_us', 1.15, false, 60, false, false),
('bsky:axios', 'Axios', 'bluesky', 'axios.com', 'en', 'politik_us', 1.15, false, 60, false, false),

-- Welt
('rss:tagesschau-ausland', 'tagesschau Ausland', 'rss', 'https://www.tagesschau.de/ausland/index~rss2.xml', 'de', 'welt', 1.25, false, 120, false, false),
('rss:spiegel-ausland', 'SPIEGEL Ausland', 'rss', 'https://www.spiegel.de/ausland/index.rss', 'de', 'welt', 1.15, false, 180, false, false),
('rss:dw', 'Deutsche Welle', 'rss', 'https://rss.dw.com/rdf/rss-de-all', 'de', 'welt', 1.1, false, 240, false, false),
('rss:bbc-world', 'BBC World', 'rss', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'en', 'welt', 1.25, false, 120, false, false),
('rss:france24', 'France 24', 'rss', 'https://www.france24.com/en/rss', 'en', 'welt', 1.05, false, 240, false, false),

-- Wirtschaft
('rss:tagesschau-wirtschaft', 'tagesschau Wirtschaft', 'rss', 'https://www.tagesschau.de/wirtschaft/index~rss2.xml', 'de', 'wirtschaft', 1.25, false, 150, false, false),
('rss:spiegel-wirtschaft', 'SPIEGEL Wirtschaft', 'rss', 'https://www.spiegel.de/wirtschaft/index.rss', 'de', 'wirtschaft', 1.15, false, 180, false, false),
('rss:faz-wirtschaft', 'FAZ Wirtschaft', 'rss', 'https://www.faz.net/rss/aktuell/wirtschaft/', 'de', 'wirtschaft', 1.15, false, 180, false, false),
('rss:manager-magazin', 'manager magazin', 'rss', 'https://www.manager-magazin.de/news/index.rss', 'de', 'wirtschaft', 1.1, false, 240, false, false),
('rss:wiwo', 'WirtschaftsWoche', 'rss', 'https://www.wiwo.de/contentexport/feed/rss/schlagzeilen', 'de', 'wirtschaft', 1.1, false, 240, false, false),
('rss:bbc-business', 'BBC Business', 'rss', 'https://feeds.bbci.co.uk/news/business/rss.xml', 'en', 'wirtschaft', 1.2, false, 180, false, false),
('rss:nyt-business', 'NYT Business', 'rss', 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', 'en', 'wirtschaft', 1.2, false, 240, false, false),

-- Wissenschaft & Raumfahrt
('rss:spektrum', 'Spektrum.de', 'rss', 'https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406', 'de', 'wissen', 1.1, false, 300, false, false),
('rss:tagesschau-wissen', 'tagesschau Wissen', 'rss', 'https://www.tagesschau.de/wissen/index~rss2.xml', 'de', 'wissen', 1.2, false, 300, false, false),
('rss:space', 'Space.com', 'rss', 'https://www.space.com/feeds/all', 'en', 'wissen', 1.05, false, 240, false, false),
('rss:spaceflightnow', 'Spaceflight Now', 'rss', 'https://spaceflightnow.com/feed/', 'en', 'wissen', 1.05, false, 300, false, false),
('rss:nasa', 'NASA', 'rss', 'https://www.nasa.gov/news-release/feed/', 'en', 'wissen', 1.2, false, 300, false, false),
('rss:sciencedaily', 'ScienceDaily', 'rss', 'https://www.sciencedaily.com/rss/top.xml', 'en', 'wissen', 1.0, false, 600, false, false),

-- Sport
('rss:kicker', 'kicker', 'rss', 'https://newsfeed.kicker.de/news/aktuell', 'de', 'sport', 1.15, false, 120, false, false),
('rss:sportschau', 'Sportschau', 'rss', 'https://www.sportschau.de/index~rss2.xml', 'de', 'sport', 1.15, false, 180, false, false),
('rss:transfermarkt', 'Transfermarkt', 'rss', 'https://www.transfermarkt.de/rss/news', 'de', 'sport', 1.05, false, 240, false, false),
('rss:bbc-sport', 'BBC Sport', 'rss', 'https://feeds.bbci.co.uk/sport/rss.xml', 'en', 'sport', 1.15, false, 180, false, false),
('rss:espn', 'ESPN', 'rss', 'https://www.espn.com/espn/rss/news', 'en', 'sport', 1.1, false, 180, false, false),

-- Auto & Mobilität
('rss:electrive', 'electrive', 'rss', 'https://www.electrive.net/feed/', 'de', 'auto', 1.05, false, 300, false, false),
('rss:heise-autos', 'heise Autos', 'rss', 'https://www.heise.de/autos/rss/news-atom.xml', 'de', 'auto', 1.0, false, 300, false, false),
('rss:electrek', 'Electrek', 'rss', 'https://electrek.co/feed/', 'en', 'auto', 1.05, false, 240, false, false),

-- Film & Serien
('rss:filmstarts', 'FILMSTARTS', 'rss', 'https://www.filmstarts.de/rss/nachrichten.xml', 'de', 'film', 1.0, false, 300, false, false),
('rss:serienjunkies', 'Serienjunkies', 'rss', 'https://www.serienjunkies.de/rss/news.xml', 'de', 'film', 1.0, false, 300, false, false),
('rss:variety', 'Variety', 'rss', 'https://variety.com/feed/', 'en', 'film', 1.1, false, 240, false, false),
('rss:deadline', 'Deadline', 'rss', 'https://deadline.com/feed/', 'en', 'film', 1.1, false, 240, false, false),
('rss:thr', 'Hollywood Reporter', 'rss', 'https://www.hollywoodreporter.com/feed/', 'en', 'film', 1.1, false, 300, false, false),

-- Musik & Popkultur
('rss:rollingstone-de', 'Rolling Stone', 'rss', 'https://www.rollingstone.de/feed/', 'de', 'musik', 1.0, false, 300, false, false),
('rss:billboard', 'Billboard', 'rss', 'https://www.billboard.com/feed/', 'en', 'musik', 1.1, false, 300, false, false),
('rss:pitchfork', 'Pitchfork', 'rss', 'https://pitchfork.com/feed/feed-news/rss', 'en', 'musik', 1.0, false, 300, false, false),

-- Gesundheit
('rss:aerzteblatt', 'Deutsches Ärzteblatt', 'rss', 'https://www.aerzteblatt.de/rss/news.asp', 'de', 'gesundheit', 1.1, false, 300, false, false),
('rss:spiegel-gesundheit', 'SPIEGEL Gesundheit', 'rss', 'https://www.spiegel.de/gesundheit/index.rss', 'de', 'gesundheit', 1.1, false, 300, false, false),
('rss:bbc-health', 'BBC Health', 'rss', 'https://feeds.bbci.co.uk/news/health/rss.xml', 'en', 'gesundheit', 1.15, false, 300, false, false),

-- Verbraucher & Alltag
('rss:tagesschau-verbraucher', 'tagesschau Verbraucher', 'rss', 'https://www.tagesschau.de/wirtschaft/verbraucher/index~rss2.xml', 'de', 'verbraucher', 1.2, false, 300, false, false),

-- US-Börsenaufsicht: Pflichtmeldungen (8-K). Nur aktiv, wenn eine Kontaktadresse hinterlegt ist.
('sec:8k', 'SEC Pflichtmeldungen (8-K)', 'sec', 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=100&output=atom', 'en', 'boerse', 1.3, false, 60, false, false)
on conflict (key) do nothing;
