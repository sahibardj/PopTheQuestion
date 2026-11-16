(() => {
  const D = window.DESTINATIONS;
  const V = window.VENDORS;
  const F = window.FILTERS;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const HIKE_LABEL = Object.fromEntries(F.hike);
  const AI_DAILY_CREDITS = 15;

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stripHtml = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.trim();

  // ---------------- State ----------------
  const BUDGET_MIN = 1000;
  const BUDGET_MAX = 15000;

  // Starting points and rough round-trip economy fares per person (USD) between world regions.
  const ORIGINS = {
    "Delhi, India": "southasia", "Mumbai, India": "southasia", "Bengaluru, India": "southasia",
    "Dubai, UAE": "mideast", "Singapore": "seasia", "Tokyo, Japan": "eastasia",
    "London, UK": "europe", "Paris, France": "europe",
    "New York, USA": "northam", "San Francisco, USA": "northam", "Toronto, Canada": "northam",
    "Sydney, Australia": "oceania",
  };
  const FARES = {
    southasia: { southasia: 120, eastasia: 650, northam: 1300, europe: 750 },
    seasia: { southasia: 400, eastasia: 500, northam: 1200, europe: 900 },
    eastasia: { southasia: 650, eastasia: 150, northam: 1000, europe: 1000 },
    mideast: { southasia: 300, eastasia: 800, northam: 1300, europe: 500 },
    europe: { southasia: 700, eastasia: 950, northam: 750, europe: 150 },
    northam: { southasia: 1300, eastasia: 1000, northam: 250, europe: 700 },
    oceania: { southasia: 1000, eastasia: 900, northam: 1400, europe: 1600 },
  };
  const DEST_REGION = { Japan: "eastasia", India: "southasia", Canada: "northam", USA: "northam", Greece: "europe", Switzerland: "europe", France: "europe", Italy: "europe" };
  // Flights for two, round trip, from the chosen starting point.
  const flightFor = (d) => 2 * FARES[ORIGINS[state.origin]][DEST_REGION[d.country]];
  const totalFor = (d) => [d.budget[0] + flightFor(d), d.budget[1] + flightFor(d)];
  const state = {
    sel: { months: new Set(), weather: new Set(), season: new Set(), scenery: new Set(), hike: new Set(), continent: new Set(), country: new Set() },
    maxBudget: BUDGET_MAX,
    origin: ORIGINS[localStorage.getItem("ptq-origin")] ? localStorage.getItem("ptq-origin") : "Delhi, India",
    sort: "featured",
    currency: localStorage.getItem("ptq-currency") || "USD",
    rates: { USD: 1, EUR: 0.92, GBP: 0.79, INR: 84, JPY: 150, CAD: 1.37, AUD: 1.52, AED: 3.67, SGD: 1.34, CHF: 0.88 },
  };

  // ---------------- Currency ----------------
  const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD", "AED", "SGD", "CHF"];
  const money = (usd) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: state.currency, maximumFractionDigits: 0 }).format(
      Math.round((usd * (state.rates[state.currency] || 1)) / roundTo()) * roundTo()
    );
  const roundTo = () => ((state.rates[state.currency] || 1) > 50 ? 100 : 10);

  function initOrigin() {
    const sel = $("#origin");
    sel.innerHTML = Object.keys(ORIGINS).map((o) => `<option ${o === state.origin ? "selected" : ""}>${o}</option>`).join("");
    sel.onchange = () => {
      state.origin = sel.value;
      localStorage.setItem("ptq-origin", sel.value);
      refreshPrices();
    };
  }

  function initCurrency() {
    const sel = $("#currency");
    sel.innerHTML = CURRENCIES.map((c) => `<option ${c === state.currency ? "selected" : ""}>${c}</option>`).join("");
    sel.onchange = () => {
      state.currency = sel.value;
      localStorage.setItem("ptq-currency", sel.value);
      refreshPrices();
    };
    fetch("https://open.er-api.com/v6/latest/USD")
      .then((r) => r.json())
      .then((j) => {
        if (j.rates) {
          CURRENCIES.forEach((c) => j.rates[c] && (state.rates[c] = j.rates[c]));
          refreshPrices();
        }
      })
      .catch(() => {});
  }

  function refreshPrices() {
    renderBudgetLabel();
    renderGrid();
    const open = currentBoardId();
    if (open) openBoard(open);
  }

  // ---------------- Free images (Wikimedia Commons, loaded at runtime) ----------------
  const imgCache = new Map();
  const BAD = /\b(map|logo|diagram|flag|coat of arms|plan|chart|locator|svg|sign|ticket|stamp)\b/i;

  const STORE_KEY = "ptq-img-v1";
  const WEEK = 7 * 864e5;
  const stored = (() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return s.t > Date.now() - WEEK ? s : { t: Date.now(), q: {} };
    } catch {
      return { t: Date.now(), q: {} };
    }
  })();
  const persist = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(stored)); } catch {}
  };

  // Wikimedia rate-limits bursts (~15 searches/min), so run searches one at a time with a gap.
  let queue = Promise.resolve();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function throttledJson(url) {
    const run = queue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(url);
          if (r.ok) {
            const j = await r.json();
            await sleep(400);
            return j;
          }
        } catch {}
        await sleep(1500 * (attempt + 1));
      }
      return {};
    });
    queue = run.catch(() => {});
    return run;
  }

  function searchImages(query, limit = 10, width = 640) {
    const key = `${query}|${limit}|${width}`;
    if (imgCache.has(key)) return imgCache.get(key);
    if (stored.q[key]) {
      const hit = Promise.resolve(stored.q[key]);
      imgCache.set(key, hit);
      return hit;
    }
    const url =
      "https://commons.wikimedia.org/w/api.php?" +
      new URLSearchParams({
        action: "query", format: "json", origin: "*",
        generator: "search", gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: String(limit),
        prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: String(width),
        iiextmetadatafilter: "Artist|LicenseShortName",
      });
    const p = throttledJson(url)
      .then((j) => {
        const list = Object.values(j.query?.pages || {})
          .sort((a, b) => a.index - b.index)
          .map((pg) => {
            const ii = pg.imageinfo?.[0] || {};
            return {
              title: pg.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
              src: ii.thumburl, w: ii.thumbwidth, h: ii.thumbheight, mime: ii.mime,
              page: ii.descriptionurl,
              artist: stripHtml(ii.extmetadata?.Artist?.value).slice(0, 60),
              license: ii.extmetadata?.LicenseShortName?.value || "",
            };
          })
          .filter((im) => im.src && /jpe?g|png|webp/.test(im.mime) && !BAD.test(im.title) && im.h / im.w < 2.2);
        if (list.length) {
          stored.q[key] = list;
          persist();
        } else {
          imgCache.delete(key);
        }
        return list;
      })
      .catch(() => []);
    imgCache.set(key, p);
    return p;
  }

  const filePath = (name, width = 960) =>
    `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;

  async function searchCover(dest) {
    const imgs = await searchImages(dest.query, 8);
    return imgs.find((i) => i.h / i.w > 0.55 && i.h / i.w < 1.5) || imgs[0];
  }

  // Curated covers load straight from the image CDN (no API call); search is only a fallback.
  function coverFor(dest) {
    if (dest.cover)
      return Promise.resolve({ src: filePath(dest.cover), page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(dest.cover)}`, fallback: () => searchCover(dest) });
    return searchCover(dest);
  }

  function setImg(img, im, onDone) {
    img.onload = onDone;
    img.onerror = async () => {
      img.onerror = null;
      const alt = im.fallback && (await im.fallback());
      if (alt) img.src = alt.src;
      else onDone();
    };
    if (im.w) (img.width = im.w), (img.height = im.h);
    img.src = im.src;
  }

  // ---------------- Filters ----------------
  function matches(d) {
    const s = state.sel;
    const any = (set, arr) => !set.size || arr.some((x) => set.has(x));
    return (
      totalFor(d)[0] <= state.maxBudget &&
      any(s.months, d.months) &&
      any(s.weather, d.weather) &&
      any(s.season, d.seasons) &&
      any(s.scenery, d.scenery) &&
      any(s.hike, d.ideas.map((i) => i.hike)) &&
      any(s.continent, [d.continent]) &&
      any(s.country, [d.country])
    );
  }

  function groupHtml(key, title, options, open, grid = false) {
    const chips = options
      .map(([v, l]) => `<button class="chip" data-g="${key}" data-v="${esc(v)}">${esc(l)}</button>`)
      .join("");
    return `<details class="fgroup" data-group="${key}" ${open ? "open" : ""}>
      <summary>${title}<span class="count" hidden></span></summary>
      <div class="${grid ? "months" : "chips"}">${chips}</div>
    </details>`;
  }

  function renderFilters() {
    const countries = [...new Set(D.map((d) => d.country))].sort();
    $("#filterGroups").innerHTML =
      `<details class="fgroup" open>
        <summary>Budget for two</summary>
        <div class="range">
          <input type="range" id="budget" min="${BUDGET_MIN}" max="${BUDGET_MAX}" step="250" value="${state.maxBudget}" />
          <div class="val"><span>Total trip (with flights) under</span><b id="budgetLabel"></b></div>
        </div>
      </details>` +
      groupHtml("months", "When you want to propose", MONTHS.map((m, i) => [i + 1, m]), true, true) +
      groupHtml("weather", "Weather", F.weather, true) +
      groupHtml("season", "Season", F.season, false) +
      groupHtml("scenery", "What you love", F.scenery, true) +
      groupHtml("hike", "Hiking", F.hike, false) +
      groupHtml("continent", "Continent", F.continent.map((c) => [c, c]), false) +
      groupHtml("country", "Country", countries.map((c) => [c, c]), false);

    $("#budget").oninput = (e) => {
      state.maxBudget = +e.target.value;
      renderBudgetLabel();
      renderGrid();
    };
    $("#filterGroups").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      toggleFilter(chip.dataset.g, chip.dataset.v);
    });
    renderBudgetLabel();
  }

  function toggleFilter(g, v) {
    const set = state.sel[g];
    const val = g === "months" ? +v : v;
    set.has(val) ? set.delete(val) : set.add(val);
    syncChips();
    renderGrid();
  }

  function labelFor(g, v) {
    if (g === "months") return MONTHS[v - 1];
    const list = F[g === "season" ? "season" : g];
    const hit = Array.isArray(list) && list.find((o) => (Array.isArray(o) ? o[0] : o) === v);
    return Array.isArray(hit) ? hit[1] : v;
  }

  function syncChips() {
    document.querySelectorAll("#filterGroups .chip").forEach((c) => {
      const g = c.dataset.g;
      const v = g === "months" ? +c.dataset.v : c.dataset.v;
      c.classList.toggle("on", state.sel[g].has(v));
    });
    document.querySelectorAll(".fgroup[data-group]").forEach((el) => {
      const n = state.sel[el.dataset.group].size;
      const badge = $(".count", el);
      badge.hidden = !n;
      badge.textContent = n;
    });
    const active = Object.entries(state.sel).flatMap(([g, set]) => [...set].map((v) => ({ g, v })));
    $("#activeChips").innerHTML = active
      .map(({ g, v }) => `<button class="chip" data-g="${g}" data-v="${esc(v)}">${esc(labelFor(g, v))}</button>`)
      .join("");
  }

  function renderBudgetLabel() {
    const el = $("#budgetLabel");
    if (el) el.textContent = state.maxBudget >= BUDGET_MAX ? "Any budget" : money(state.maxBudget);
  }

  function clearFilters() {
    Object.values(state.sel).forEach((s) => s.clear());
    state.maxBudget = BUDGET_MAX;
    $("#budget").value = BUDGET_MAX;
    renderBudgetLabel();
    syncChips();
    renderGrid();
  }

  // ---------------- Grid ----------------
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        loadCover(en.target);
      }),
    { rootMargin: "400px" }
  );

  async function loadCover(card) {
    const dest = D.find((d) => d.id === card.dataset.id);
    const im = await coverFor(dest);
    const box = $(".img", card);
    if (!im) return box.classList.remove("skeleton");
    const img = $("img", box);
    img.alt = dest.name;
    setImg(img, im, () => {
      img.classList.add("loaded");
      box.classList.remove("skeleton");
      box.style.minHeight = "";
    });
  }

  function cardHtml(d, i) {
    const h = [260, 320, 230, 300, 280][i % 5];
    const best = d.months.slice(0, 3).map((m) => MONTHS[m - 1]).join(" · ");
    const tags = d.scenery.slice(0, 3).map((s) => `<span class="tag">${esc(labelFor("scenery", s))}</span>`).join("");
    return `<button class="card" data-id="${d.id}">
      <div class="img skeleton" style="min-height:${h}px"><img alt="" loading="lazy" /><span class="badge">${esc(best)}</span></div>
      <div class="body">
        <h3>${esc(d.name)}</h3>
        <div class="loc">${esc(d.region)}, ${esc(d.country)}</div>
        <div class="budget">${money(totalFor(d)[0])} – ${money(totalFor(d)[1])}</div><div class="loc" style="margin:2px 0 0">incl. flights from ${esc(state.origin.split(",")[0])}</div>
        <div class="tags">${tags}<span class="tag gold">${d.ideas.length} ideas</span></div>
      </div>
    </button>`;
  }

  function renderGrid() {
    let list = D.filter(matches);
    if (state.sort === "budget-asc") list = [...list].sort((a, b) => a.budget[0] - b.budget[0]);
    if (state.sort === "budget-desc") list = [...list].sort((a, b) => b.budget[0] - a.budget[0]);
    if (state.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));

    const grid = $("#grid");
    grid.innerHTML = list.map(cardHtml).join("");
    grid.querySelectorAll(".card").forEach((c) => io.observe(c));
    $("#empty").hidden = list.length > 0;
    $("#resultCount").textContent = `${list.length} destination${list.length === 1 ? "" : "s"}`;
  }

  // ---------------- Board ----------------
  const mapsLink = (vendorKey, d) =>
    "https://www.google.com/maps/search/" + encodeURIComponent(`${V[vendorKey].search} near ${d.name} ${d.country}`).replace(/%20/g, "+");

  const currentBoardId = () => decodeURIComponent(location.hash.slice(1));

  async function openBoard(id) {
    const d = D.find((x) => x.id === id);
    if (!d) return closeBoard();
    const hikeSel = state.sel.hike;
    const ideas = [...d.ideas]
      .map((idea, idx) => ({ ...idea, idx, ok: !hikeSel.size || hikeSel.has(idea.hike) }))
      .sort((a, b) => b.ok - a.ok || a.budget - b.budget);

    $("#boardBody").innerHTML = `
      <div class="board-hero skeleton" id="boardHero">
        <div class="overlay">
          <h2>${esc(d.name)}</h2>
          <p>${esc(d.region)}, ${esc(d.country)} · ${esc(d.continent)}</p>
        </div>
      </div>
      <div class="board-content">
        <div class="board-meta">
          <p class="blurb">${esc(d.blurb)}</p>
          <div>
            <div class="bigbudget">${money(totalFor(d)[0])} – ${money(totalFor(d)[1])}</div>
            <small>For two · ~5 nights · incl. ~${money(flightFor(d))} flights from ${esc(state.origin)}</small>
          </div>
        </div>
        <div class="tags" style="margin-bottom:14px">
          ${d.weather.map((w) => `<span class="tag">${esc(labelFor("weather", w))}</span>`).join("")}
          ${d.seasons.map((s) => `<span class="tag">${esc(labelFor("season", s))}</span>`).join("")}
          ${d.scenery.map((s) => `<span class="tag gold">${esc(labelFor("scenery", s))}</span>`).join("")}
        </div>
        <small style="color:var(--muted)">Best months to propose</small>
        <div class="monthbar">${MONTHS.map((m, i) => `<span class="${d.months.includes(i + 1) ? "best" : ""}">${m}</span>`).join("")}</div>

        <h3 class="section-title">Proposal ideas</h3>
        <div class="ideas">
          ${ideas
            .map(
              (idea) => `<div class="idea ${idea.ok ? "" : "dim"}">
                <h4>${esc(idea.title)}</h4>
                <p>${esc(idea.desc)}</p>
                <div class="row"><span class="price">+ ${money(idea.budget)}</span><span class="tag">${esc(HIKE_LABEL[idea.hike])}</span></div>
                <div class="needs">${idea.needs
                  .map((n) => `<a class="need" target="_blank" rel="noopener" href="${mapsLink(n, d)}" title="Find ${esc(V[n].label.toLowerCase())} near ${esc(d.name)}">${esc(V[n].label)} nearby ↗</a>`)
                  .join("")}</div>
                <button class="btn ask" data-idea="${idea.idx}">Plan this with AI</button>
              </div>`
            )
            .join("")}
        </div>

        <h3 class="section-title">Find vendors near ${esc(d.name)}</h3>
        <div class="vendors">
          ${Object.keys(V).map((k) => `<a class="btn" target="_blank" rel="noopener" href="${mapsLink(k, d)}">${esc(V[k].label)}</a>`).join("")}
          <button class="btn btn-primary" id="askDest">Ask AI about ${esc(d.name)}</button>
        </div>

        <h3 class="section-title">Inspiration board</h3>
        <div class="pins" id="pins"><p class="pins-status">Loading photos…</p></div>
      </div>`;

    $("#board").hidden = false;
    document.body.style.overflow = "hidden";

    $("#askDest").onclick = () => openAi({ dest: d });
    $("#boardBody").querySelectorAll(".ask").forEach((b) => (b.onclick = () => openAi({ dest: d, idea: d.ideas[+b.dataset.idea] })));

    coverFor(d).then((im) => {
      const hero = $("#boardHero");
      if (!hero || !im) return hero?.classList.remove("skeleton");
      const img = new Image();
      img.alt = d.name;
      hero.prepend(img);
      setImg(img, { ...im, w: 0 }, () => hero.classList.remove("skeleton"));
    });

    // Load the main query first, then the extra ones one by one, appending new photos as they arrive.
    const seen = new Set();
    let shown = 0;
    const pinsEl = $("#pins");
    for (const q of [d.query, ...d.boardQueries]) {
      const list = await searchImages(q, 12);
      if (currentBoardId() !== id || !pinsEl.isConnected) return;
      const fresh = list.filter((im) => !seen.has(im.page) && seen.add(im.page)).slice(0, 10);
      if (!fresh.length) continue;
      if (!shown) pinsEl.innerHTML = "";
      shown += fresh.length;
      pinsEl.insertAdjacentHTML(
        "beforeend",
        fresh
          .map(
            (im) => `<a class="pin" href="${esc(im.page)}" target="_blank" rel="noopener" title="${esc(im.title)}">
              <img src="${esc(im.src)}" width="${im.w}" height="${im.h}" loading="lazy" alt="${esc(im.title)}" />
              <span class="credit">${esc(im.artist || "Wikimedia Commons")}${im.license ? " · " + esc(im.license) : ""}</span>
            </a>`
          )
          .join("")
      );
    }
    if (!shown) pinsEl.innerHTML = `<p class="pins-status">Couldn't load photos right now. Try again in a minute.</p>`;
  }

  function closeBoard() {
    $("#board").hidden = true;
    document.body.style.overflow = "";
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  // ---------------- AI planner (free, keyless; daily credits per visitor) ----------------
  const today = () => new Date().toISOString().slice(0, 10);
  function credits() {
    const c = JSON.parse(localStorage.getItem("ptq-ai") || "{}");
    return c.date === today() ? AI_DAILY_CREDITS - c.used : AI_DAILY_CREDITS;
  }
  function useCredit() {
    const c = JSON.parse(localStorage.getItem("ptq-ai") || "{}");
    const used = c.date === today() ? c.used + 1 : 1;
    localStorage.setItem("ptq-ai", JSON.stringify({ date: today(), used }));
    renderCredits();
  }
  function renderCredits() {
    const n = credits();
    $("#creditsPill").textContent = `${n} free`;
    $("#aiNote").textContent = n > 0
      ? `${n} of ${AI_DAILY_CREDITS} free AI credits left today. Credits reset daily.`
      : "You've used today's free AI credits. Come back tomorrow!";
  }

  let aiCtx = null;
  let aiHistory = [];

  function systemPrompt() {
    const catalog = D.map((d) => `${d.name} (${d.country}; best ${d.months.map((m) => MONTHS[m - 1]).join("/")}; trip from ${state.origin} ${money(totalFor(d)[0])}-${money(totalFor(d)[1])} incl. flights)`).join("; ");
    let s =
      "You are a warm, practical marriage-proposal planner on the website 'Pop the Question'. " +
      "Keep answers under 180 words, use short markdown bullet points, and give concrete names, times and costs. " +
      `Show all prices in ${state.currency}. Destinations on the site: ${catalog}.`;
    if (aiCtx?.dest) {
      const d = aiCtx.dest;
      s += ` The user is looking at ${d.name}, ${d.region}, ${d.country}. ${d.blurb} Ideas there: ${d.ideas.map((i) => `${i.title} (~${money(i.budget)})`).join(", ")}.`;
    }
    if (aiCtx?.idea) s += ` They are specifically interested in the idea "${aiCtx.idea.title}": ${aiCtx.idea.desc}`;
    return s;
  }

  function openAi(ctx = null) {
    aiCtx = ctx;
    aiHistory = [];
    $("#aiLog").innerHTML = "";
    const place = ctx?.dest?.name;
    $("#aiContext").textContent = ctx?.idea ? `${ctx.idea.title} · ${place}` : place ? `Planning in ${place}` : "Ask anything about planning your proposal";
    const quick = place
      ? ["Plan my proposal day hour by hour", "Write a short proposal speech", "Where can I get flowers and a photographer?", "What should we pack and wear?", "How can we do this cheaper?", "Tips to keep it a surprise"]
      : ["Which destination suits us? We love snow", "Best place to propose in December?", "Romantic ideas under $1,500", "Write a short proposal speech"];
    $("#aiQuick").innerHTML = quick.map((q) => `<button class="chip">${esc(q)}</button>`).join("");
    $("#ai").hidden = false;
    renderCredits();
    $("#aiInput").focus();
  }

  function mdToHtml(md) {
    const lines = esc(md).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\s)\*(\S.+?)\*/g, "$1<i>$2</i>").split("\n");
    let html = "";
    let inList = false;
    for (const raw of lines) {
      const line = raw.trim();
      const li = line.match(/^([-*•]|\d+[.)])\s+(.*)/);
      if (li) {
        if (!inList) (html += "<ul>"), (inList = true);
        html += `<li>${li[2]}</li>`;
        continue;
      }
      if (inList) (html += "</ul>"), (inList = false);
      if (!line) continue;
      const h = line.match(/^#{1,6}\s+(.*)/);
      html += h ? `<h4>${h[1]}</h4>` : `<p>${line}</p>`;
    }
    return html + (inList ? "</ul>" : "");
  }

  function addMsg(role, html) {
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.innerHTML = html;
    $("#aiLog").append(el);
    $("#aiLog").scrollTop = $("#aiLog").scrollHeight;
    return el;
  }

  async function ask(text) {
    text = text.trim();
    if (!text) return;
    if (credits() <= 0) return addMsg("bot", "<p>You've used today's free AI credits. They reset tomorrow.</p>");
    addMsg("user", esc(text));
    aiHistory.push({ role: "user", content: text });
    const pending = addMsg("bot", '<span class="typing">Thinking</span>');
    try {
      const res = await fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai", messages: [{ role: "system", content: systemPrompt() }, ...aiHistory.slice(-8)] }),
      });
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      const reply = j.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error("empty");
      aiHistory.push({ role: "assistant", content: reply });
      pending.innerHTML = mdToHtml(reply);
      useCredit();
    } catch {
      aiHistory.pop();
      pending.innerHTML = "<p>The free AI is busy right now. Please try again in a moment (no credit was used).</p>";
    }
    $("#aiLog").scrollTop = $("#aiLog").scrollHeight;
  }

  // ---------------- Wiring ----------------
  function toggleFilters() {
    if (matchMedia("(max-width: 860px)").matches) document.body.classList.toggle("filters-open");
    else document.body.classList.toggle("filters-closed");
  }

  function init() {
    initCurrency();
    initOrigin();
    renderFilters();
    syncChips();
    renderGrid();
    renderCredits();

    $("#toggleFilters").onclick = toggleFilters;
    $("#scrim").onclick = () => document.body.classList.remove("filters-open");
    $("#clearFilters").onclick = clearFilters;
    $("#emptyClear").onclick = clearFilters;
    $("#sort").onchange = (e) => {
      state.sort = e.target.value;
      renderGrid();
    };
    $("#activeChips").onclick = (e) => {
      const c = e.target.closest(".chip");
      if (c) toggleFilter(c.dataset.g, c.dataset.v);
    };
    $("#grid").onclick = (e) => {
      const card = e.target.closest(".card");
      if (card) location.hash = card.dataset.id;
    };
    $("#closeBoard").onclick = closeBoard;
    $("#board").onclick = (e) => e.target.id === "board" && closeBoard();
    window.addEventListener("hashchange", () => (currentBoardId() ? openBoard(currentBoardId()) : closeBoard()));
    if (currentBoardId()) openBoard(currentBoardId());

    $("#openAi").onclick = () => openAi();
    $("#closeAi").onclick = () => ($("#ai").hidden = true);
    $("#aiQuick").onclick = (e) => e.target.closest(".chip") && ask(e.target.textContent);
    $("#aiForm").onsubmit = (e) => {
      e.preventDefault();
      ask($("#aiInput").value);
      $("#aiInput").value = "";
    };
    $("#aiInput").onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("#aiForm").requestSubmit();
      }
    };
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#ai").hidden) $("#ai").hidden = true;
      else if (!$("#board").hidden) closeBoard();
    });
  }

  init();
})();
