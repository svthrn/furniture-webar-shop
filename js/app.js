/* Каталог мебели с WebAR-просмотром: чистый Vanilla JS без сборки. */
(() => {
  "use strict";

  const VIEWER_TIMEOUT_MS = 4000;
  const THUMBS = { "Кресла": "🪑", "Столы": "🍽️", "Диваны": "🛋️" };

  const state = {
    products: [],
    categories: [],
    search: "",
    category: "all",
    maxPrice: Number.POSITIVE_INFINITY,
    selected: null,
  };

  const el = (id) => document.getElementById(id);

  const ui = {
    categories: el("categories"),
    search: el("search"),
    price: el("price"),
    priceOutput: el("price-output"),
    reset: el("reset"),
    grid: el("grid"),
    empty: el("empty"),
    count: el("count"),
    modal: el("modal"),
    viewer: el("viewer"),
    arButton: el("ar-button"),
    arNote: el("ar-note"),
    colors: el("colors"),
    colorName: el("color-name"),
    dimToggle: el("dimensions-toggle"),
    dimensions: el("dimensions"),
    materials: el("materials"),
  };

  const money = new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  });

  /* ---------- Данные ---------- */

  async function loadCatalog() {
    const response = await fetch("data/catalog.json", { cache: "no-cache" });
    if (!response.ok) {
      throw new Error("catalog.json: HTTP " + response.status);
    }
    const data = await response.json();
    state.products = data.products;
    state.maxPrice = Math.max(...state.products.map((p) => p.price));
    state.categories = [...new Set(state.products.map((p) => p.category))];
  }

  /* ---------- Фильтры ---------- */

  function buildCategoryChips() {
    const all = document.createElement("button");
    all.type = "button";
    all.className = "chip";
    all.textContent = "Все";
    all.dataset.category = "all";
    all.setAttribute("aria-pressed", "true");
    ui.categories.append(all);

    for (const category of state.categories) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = category;
      chip.dataset.category = category;
      chip.setAttribute("aria-pressed", "false");
      ui.categories.append(chip);
    }
  }

  function applyFilters() {
    const query = state.search.trim().toLowerCase();
    return state.products.filter((product) => {
      const matchesName = product.name.toLowerCase().includes(query);
      const matchesCategory =
        state.category === "all" || product.category === state.category;
      const matchesPrice = product.price <= state.maxPrice;
      return matchesName && matchesCategory && matchesPrice;
    });
  }

  /* ---------- Карточки ---------- */

  function renderGrid() {
    const products = applyFilters();
    ui.grid.replaceChildren();

    for (const product of products) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      card.dataset.id = product.id;

      const thumb = document.createElement("div");
      thumb.className = "card__thumb";
      thumb.textContent = THUMBS[product.category] || "🪑";
      thumb.setAttribute("aria-hidden", "true");

      const body = document.createElement("div");
      body.className = "card__body";

      const category = document.createElement("span");
      category.className = "card__category";
      category.textContent = product.category;

      const name = document.createElement("span");
      name.className = "card__name";
      name.textContent = product.name;

      const meta = document.createElement("span");
      meta.className = "card__meta";
      const { width, depth, height } = product.dimensions;
      meta.textContent = `${width}×${depth}×${height} см`;

      const price = document.createElement("span");
      price.className = "card__price";
      price.textContent = money.format(product.price);

      body.append(category, name, meta, price);
      card.append(thumb, body);
      ui.grid.append(card);
    }

    ui.count.textContent = `Найдено товаров: ${products.length}`;
    ui.empty.hidden = products.length > 0;
  }

  /* ---------- Карточка товара ---------- */

  function openProduct(id) {
    const product = state.products.find((item) => item.id === id);
    if (!product) return;

    state.selected = product;

    el("modal-category").textContent = product.category;
    el("modal-title").textContent = product.name;
    el("modal-price").textContent = money.format(product.price);
    el("modal-description").textContent = product.description;

    el("dim-width").textContent = `${product.dimensions.width} см`;
    el("dim-depth").textContent = `${product.dimensions.depth} см`;
    el("dim-height").textContent = `${product.dimensions.height} см`;
    setDimensionsVisible(false);

    ui.materials.replaceChildren();
    for (const item of product.materials) {
      const li = document.createElement("li");
      li.textContent = item;
      ui.materials.append(li);
    }

    ui.viewer.setAttribute("alt", `${product.name} — 3D-модель`);
    // ios-src задаём только когда файл .usdz реально есть, иначе Quick Look
    // запрашивал бы несуществующий путь.
    if (product.ios_src) {
      ui.viewer.setAttribute("ios-src", product.ios_src);
    } else {
      ui.viewer.removeAttribute("ios-src");
    }
    ui.viewer.setAttribute("src", product.model);

    buildSwatches(product);
    ui.modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeProduct() {
    ui.modal.hidden = true;
    document.body.style.overflow = "";
    state.selected = null;
  }

  function buildSwatches(product) {
    ui.colors.replaceChildren();
    const base = product.colors[0];

    for (const color of product.colors) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "swatch";
      swatch.style.background = color.hex;
      swatch.title = color.name;
      swatch.setAttribute("aria-label", color.name);
      swatch.setAttribute("aria-pressed", String(color.id === base.id));
      swatch.dataset.id = color.id;
      ui.colors.append(swatch);
    }

    ui.colorName.textContent = base.name;
    applyColor(base);
  }

  function selectColor(colorId) {
    const product = state.selected;
    if (!product) return;
    const color = product.colors.find((item) => item.id === colorId);
    if (!color) return;

    for (const swatch of ui.colors.children) {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.id === colorId));
    }
    ui.colorName.textContent = color.name;
    applyColor(color);
  }

  /* Перекрашивает материал модели через API <model-viewer>;
     если у варианта нет индекса материала, подменяет модель
     на другой файл того же товара (variant.model). */
  function applyColor(color) {
    const product = state.selected;
    if (!product) return;

    const variant = color.variant;
    if (variant && variant.material === undefined) {
      ui.viewer.setAttribute("src", variant.model);
      return;
    }

    const viewer = ui.viewer;
    const repaint = () => {
      const materials = viewer.model?.materials;
      if (!materials?.length) return;
      const material = materials[color.material ?? 0];
      // Цвет задаётся через pbrMetallicRoughness: setBaseColorFactor у самого
      // материала в v4 нет.
      material?.pbrMetallicRoughness?.setBaseColorFactor([
        ...hexToLinear(color.hex),
        1,
      ]);
    };

    // Модель ещё загружается: красим сразу после события load.
    if (!viewer.modelIsVisible) {
      viewer.addEventListener("load", repaint, { once: true });
      return;
    }
    repaint();
  }

  function hexToLinear(hex) {
    const value = hex.replace("#", "");
    const channels = [0, 2, 4].map((offset) =>
      parseInt(value.slice(offset, offset + 2), 16) / 255
    );
    return channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
    );
  }

  /* ---------- Габариты ---------- */

  function setDimensionsVisible(visible) {
    ui.dimensions.hidden = !visible;
    ui.dimToggle.setAttribute("aria-expanded", String(visible));
    ui.dimToggle.textContent = visible ? "Скрыть габариты" : "Показать габариты";
  }

  /* ---------- AR ---------- */

  function updateArAvailability() {
    if (!ui.viewer.canActivateAR) {
      ui.arButton.hidden = true;
      ui.arNote.textContent =
        "AR-режим доступен на смартфоне: Android — через Scene Viewer/WebXR, iOS — через Quick Look. Установите модель в комнате прямо из браузера.";
      return;
    }
    ui.arButton.hidden = false;
    ui.arNote.textContent = "Перетащите модель по комнате и нажмите «Поставить в комнате».";
  }

  /* ---------- События ---------- */

  function bindEvents() {
    ui.search.addEventListener("input", (event) => {
      state.search = event.target.value;
      renderGrid();
    });

    ui.categories.addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      state.category = chip.dataset.category;
      for (const sibling of ui.categories.children) {
        sibling.setAttribute("aria-pressed", String(sibling === chip));
      }
      renderGrid();
    });

    ui.price.addEventListener("input", (event) => {
      state.maxPrice = Number(event.target.value);
      ui.priceOutput.textContent = money.format(state.maxPrice);
      renderGrid();
    });

    ui.reset.addEventListener("click", () => {
      state.search = "";
      state.category = "all";
      state.maxPrice = Number.POSITIVE_INFINITY;
      ui.search.value = "";
      ui.price.value = ui.price.max;
      ui.priceOutput.textContent = money.format(Number(ui.price.max));
      for (const chip of ui.categories.children) {
        chip.setAttribute("aria-pressed", String(chip.dataset.category === "all"));
      }
      renderGrid();
    });

    ui.grid.addEventListener("click", (event) => {
      const card = event.target.closest(".card");
      if (card) openProduct(card.dataset.id);
    });

    ui.colors.addEventListener("click", (event) => {
      const swatch = event.target.closest(".swatch");
      if (swatch) selectColor(swatch.dataset.id);
    });

    ui.dimToggle.addEventListener("click", () => {
      setDimensionsVisible(ui.dimensions.hidden);
    });

    ui.modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close]")) closeProduct();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !ui.modal.hidden) closeProduct();
    });

    ui.viewer.addEventListener("load", updateArAvailability);
    ui.viewer.addEventListener("error", () => {
      ui.arNote.textContent = "Не удалось загрузить 3D-модель. Проверьте файл модели.";
    });
  }

  /* ---------- Старт ---------- */

  async function init() {
    ui.priceOutput.textContent = money.format(Number(ui.price.max));
    try {
      await loadCatalog();
    } catch (error) {
      ui.count.textContent = `Не удалось загрузить каталог: ${error.message}`;
      return;
    }

    buildCategoryChips();
    renderGrid();
    bindEvents();

    if (typeof customElements.get("model-viewer") === "undefined") {
      window.setTimeout(() => {
        if (typeof customElements.get("model-viewer") === "undefined") {
          ui.count.textContent +=
            " · 3D-просмотр требует доступа к CDN @google/model-viewer.";
        }
      }, VIEWER_TIMEOUT_MS);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
