/* Каталог мебели с WebAR-просмотром: чистый Vanilla JS без сборки.
   Функции: фильтры, карточка товара, 3D-метки габаритов, диплинк ?item=,
   QR-передача на телефон и корзина на localStorage. */
(() => {
  "use strict";

  const VIEWER_TIMEOUT_MS = 4000;
  // Порог металличности по умолчанию: ниже него материал считается «основным»
  // и перекрашивается; так хромированные ножки остаются нетронутыми.
  const DEFAULT_METALLIC_LIMIT = 0.7;
  // Минималистичная заглушка вместо постера: аккуратный «3D-куб» без эмодзи.
  const POSTER_FALLBACK_SVG =
    '<svg class="card__placeholder-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
    '<path d="M24 6 42 15v18L24 42 6 33V15z" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M6 15l18 9 18-9M24 24v18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linejoin="round"/>' +
    "</svg>";
  const CART_KEY = "webar-cart-v1";
  const MAX_CART_ROWS = 50; // защита localStorage от неограниченного роста

  const state = {
    products: [],
    categories: [],
    search: "",
    category: "all",
    maxPrice: Number.POSITIVE_INFINITY,
    selected: null,
    selectedColorId: null,
    cart: [],
    hotspotSignature: null, // модель, для которой метки уже расставлены
    materials: [], // снимок исходных параметров материалов текущей модели
    materialsForModel: null, // src модели, для которой снят этот снимок
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
    viewerProgress: el("viewer-progress"),
    viewerProgressBar: el("viewer-progress").querySelector(".viewer-progress__bar"),
    arButton: el("ar-button"),
    arNote: el("ar-note"),
    colors: el("colors"),
    colorName: el("color-name"),
    dimToggle: el("dimensions-toggle"),
    dimensions: el("dimensions"),
    materials: el("materials"),
    resetView: el("reset-view"),
    qrOpen: el("qr-open"),
    qrModal: el("qr-modal"),
    qrCode: el("qr-code"),
    qrItem: el("qr-item"),
    qrUrl: el("qr-url"),
    addToCart: el("add-to-cart"),
    cartPill: el("cart-pill"),
    pillMinus: el("pill-minus"),
    pillPlus: el("pill-plus"),
    pillQty: el("pill-qty"),
    cartOpen: el("cart-open"),
    cartCount: el("cart-count"),
    cartCountText: el("cart-count-text"),
    cartModal: el("cart-modal"),
    cartItems: el("cart-items"),
    cartEmpty: el("cart-empty"),
    cartTotal: el("cart-total"),
    cartClear: el("cart-clear"),
    checkout: el("checkout"),
    checkoutNote: el("checkout-note"),
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

  /* ---------- Превью карточки: постер или SVG-заглушка ---------- */

  /* Постер — реальный рендер модели. Если файла ещё нет или он не загрузился,
     показываем минималистичную SVG-заглушку: сломанная иконка не мелькает. */
  function buildPoster(product) {
    const box = document.createElement("span");
    box.className = "card__poster";

    const placeholder = document.createElement("span");
    placeholder.className = "card__placeholder";
    placeholder.innerHTML = POSTER_FALLBACK_SVG;

    if (!product.poster) {
      box.classList.add("card__poster--empty");
      box.append(placeholder);
      return box;
    }

    const img = document.createElement("img");
    img.className = "card__poster-img";
    img.src = product.poster;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    // Битую картинку убираем совсем, чтобы браузер не рисовал свою иконку.
    img.addEventListener("error", () => {
      img.remove();
      box.classList.add("card__poster--empty");
    });
    img.addEventListener("load", () => {
      box.classList.add("card__poster--ready");
    });
    box.append(placeholder, img);
    return box;
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
      thumb.setAttribute("aria-hidden", "true");
      thumb.append(buildPoster(product));

      const badge = document.createElement("span");
      badge.className = "card__badge";
      badge.textContent = "3D • AR";
      thumb.append(badge);

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

  /* ---------- Корзина: хранилище ---------- */

  function loadCart() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(CART_KEY);
    } catch (error) {
      // Приватный режим или запрет хранилища: работаем без сохранения.
      state.cart = [];
      return;
    }
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      // Отбрасываем строки, которых больше нет в каталоге или с плохими данными.
      state.cart = parsed
        .filter((row) => row && typeof row.id === "string" && Number.isFinite(row.qty))
        .map((row) => ({
          id: row.id,
          colorId: typeof row.colorId === "string" ? row.colorId : null,
          qty: Math.min(Math.max(1, Math.floor(row.qty)), 99),
        }))
        .filter((row) => state.products.some((p) => p.id === row.id))
        .slice(0, MAX_CART_ROWS);
    } catch (error) {
      state.cart = [];
    }
  }

  function saveCart() {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    } catch (error) {
      ui.checkoutNote.textContent =
        "Не удалось сохранить корзину: браузер запретил локальное хранилище.";
    }
  }

  function cartCount() {
    return state.cart.reduce((sum, row) => sum + row.qty, 0);
  }

  function cartTotal() {
    return state.cart.reduce((sum, row) => {
      const product = state.products.find((p) => p.id === row.id);
      return product ? sum + product.price * row.qty : sum;
    }, 0);
  }

  function colorNameFor(product, colorId) {
    const color = product.colors.find((item) => item.id === colorId);
    return color ? color.name : product.colors[0].name;
  }

  /* Количество выбранного варианта (товар + цвет): основа для кнопки-степпера
     и для синхронизации с боковой панелью корзины. */
  function selectedRowQty() {
    const product = state.selected;
    if (!product) return 0;
    const row = state.cart.find(
      (item) => item.id === product.id && item.colorId === state.selectedColorId
    );
    return row ? row.qty : 0;
  }

  function renderCartStepper() {
    const qty = selectedRowQty();
    const inCart = qty > 0;
    ui.addToCart.hidden = inCart;
    ui.cartPill.hidden = !inCart;
    if (inCart) {
      ui.pillQty.textContent = String(qty);
      ui.pillMinus.setAttribute("aria-label", `Уменьшить количество: ${state.selected.name}`);
      ui.pillPlus.setAttribute("aria-label", `Увеличить количество: ${state.selected.name}`);
    }
  }

  function addToCart(product, colorId) {
    const existing = state.cart.find(
      (row) => row.id === product.id && row.colorId === colorId
    );
    if (existing) {
      existing.qty = Math.min(existing.qty + 1, 99);
    } else if (state.cart.length < MAX_CART_ROWS) {
      state.cart.push({ id: product.id, colorId, qty: 1 });
    } else {
      return; // корзина переполнена
    }
    saveCart();
    renderCartCount();
    renderCartStepper();
  }

  /* Меняет количество выбранного варианта: 0 удаляет позицию
     и возвращает обычную кнопку «В корзину». */
  function stepSelected(delta) {
    const product = state.selected;
    if (!product) return;
    const index = state.cart.findIndex(
      (row) => row.id === product.id && row.colorId === state.selectedColorId
    );
    if (index === -1) {
      if (delta > 0) addToCart(product, state.selectedColorId);
      return;
    }
    const next = state.cart[index].qty + delta;
    if (next < 1) {
      state.cart.splice(index, 1);
    } else {
      state.cart[index].qty = Math.min(next, 99);
    }
    saveCart();
    renderCartCount();
    renderCartStepper();
  }

  function changeQty(index, delta) {
    const row = state.cart[index];
    if (!row) return;
    const next = row.qty + delta;
    if (next < 1) {
      state.cart.splice(index, 1);
    } else {
      row.qty = Math.min(next, 99);
    }
    saveCart();
    renderCartCount();
    renderCartStepper();
    renderCart();
  }

  function removeRow(index) {
    state.cart.splice(index, 1);
    saveCart();
    renderCartCount();
    renderCartStepper();
    renderCart();
  }

  function renderCartCount() {
    const count = cartCount();
    ui.cartCount.textContent = String(count);
    ui.cartCountText.textContent = `товаров в корзине: ${count}`;
  }

  function renderCart() {
    ui.cartItems.replaceChildren();

    state.cart.forEach((row, index) => {
      const product = state.products.find((p) => p.id === row.id);
      if (!product) return;

      const item = document.createElement("li");
      item.className = "cart__row";

      const info = document.createElement("div");
      const name = document.createElement("p");
      name.className = "cart__name";
      name.textContent = product.name;
      const meta = document.createElement("p");
      meta.className = "cart__meta";
      meta.textContent = `${colorNameFor(product, row.colorId)} · ${money.format(product.price)}`;
      info.append(name, meta);

      const controls = document.createElement("div");
      controls.className = "cart__controls";

      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "step";
      minus.textContent = "−";
      minus.setAttribute("aria-label", `Уменьшить количество: ${product.name}`);
      minus.addEventListener("click", () => changeQty(index, -1));

      const count = document.createElement("span");
      count.className = "cart__count";
      count.textContent = String(row.qty);

      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "step";
      plus.textContent = "+";
      plus.setAttribute("aria-label", `Увеличить количество: ${product.name}`);
      plus.addEventListener("click", () => changeQty(index, 1));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "step step--remove";
      remove.textContent = "×";
      remove.title = "Удалить позицию";
      remove.setAttribute("aria-label", `Удалить из корзины: ${product.name}`);
      remove.addEventListener("click", () => removeRow(index));

      controls.append(minus, count, plus, remove);

      const price = document.createElement("p");
      price.className = "cart__price";
      price.textContent = money.format(product.price * row.qty);

      item.append(info, controls, price);
      ui.cartItems.append(item);
    });

    const empty = state.cart.length === 0;
    ui.cartEmpty.hidden = !empty;
    ui.cartTotal.textContent = money.format(cartTotal());
    ui.checkout.disabled = empty;
    ui.cartClear.disabled = empty;
  }
  /* ---------- Карточка товара ---------- */

  function openProduct(id, options = {}) {
    const product = state.products.find((item) => item.id === id);
    if (!product) return false;

    state.selected = product;
    state.selectedColorId = product.colors?.[0]?.id ?? null;
    state.hotspotSignature = null; // метки пересчитаем для новой модели

    el("modal-category").textContent = product.category;
    el("modal-title").textContent = product.name;
    el("modal-price").textContent = money.format(product.price);
    el("modal-description").textContent = product.description;

    el("dim-width").textContent = `${product.dimensions.width} см`;
    el("dim-depth").textContent = `${product.dimensions.depth} см`;
    el("dim-height").textContent = `${product.dimensions.height} см`;
    for (const key of ["width", "depth", "height"]) {
      const node = ui.viewer.querySelector(`[data-dim="${key}"]`);
      if (node) node.textContent = `${product.dimensions[key]} см`;
    }
    setDimensionsVisible(false);
    loadModel(product);
    renderCartStepper();
    ui.modal.hidden = false;
    document.body.style.overflow = "hidden";

    if (options.updateUrl !== false) {
      setUrlItem(product.id);
    }
    return true;
  }

  /* Загрузка модели: снимок материалов снимается по событию load,
     а выбранный цвет применяется после того, как моделью можно управлять. */
  function loadModel(product) {
    const viewer = ui.viewer;

    ui.materials.replaceChildren();
    for (const item of product.materials) {
      const li = document.createElement("li");
      li.textContent = item;
      ui.materials.append(li);
    }

    viewer.setAttribute("alt", `${product.name} — 3D-модель`);
    // Постер показывается, пока грузится .glb: без него сцена пустует.
    if (product.poster) {
      viewer.setAttribute("poster", product.poster);
    } else {
      viewer.removeAttribute("poster");
    }
    // ios-src задаём только когда файл .usdz реально есть, иначе Quick Look
    // запрашивал бы несуществующий путь.
    if (product.ios_src) {
      viewer.setAttribute("ios-src", product.ios_src);
    } else {
      viewer.removeAttribute("ios-src");
    }

    resetViewerCamera();
    resetProgressBar();
    // Снимок материалов старой модели больше не действителен.
    state.materials = [];
    state.materialsForModel = null;

    viewer.addEventListener(
      "load",
      () => {
        captureMaterials();
        const color = product.colors?.[0];
        if (color) applyColor(color);
      },
      { once: true }
    );
    // Смена src сбрасывает камеру: после новой загрузки вернём исходный ракурс.
    viewer.addEventListener("load", resetViewerCamera, { once: true });

    viewer.setAttribute("src", product.model);
    buildSwatches(product);
  }

  /* ---------- Индикатор загрузки модели ---------- */

  /* Полоса в слоте progress-bar: показывается, пока грузится .glb,
     и плавно скрывается после загрузки. */
  function resetProgressBar() {
    ui.viewerProgress.hidden = false;
    ui.viewerProgress.classList.remove("viewer-progress--done");
    ui.viewerProgressBar.style.transform = "scaleX(0)";
  }

  function setProgress(value) {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    ui.viewerProgressBar.style.transform = `scaleX(${ratio})`;
  }

  function finishProgressBar() {
    setProgress(1);
    ui.viewerProgress.classList.add("viewer-progress--done");
    window.setTimeout(() => {
      ui.viewerProgress.hidden = true;
      ui.viewerProgress.classList.remove("viewer-progress--done");
      ui.viewerProgressBar.style.transform = "scaleX(0)";
    }, 420);
  }

  function closeProduct(options = {}) {
    ui.modal.hidden = true;
    document.body.style.overflow = "";
    state.selected = null;
    state.selectedColorId = null;
    state.hotspotSignature = null;
    if (options.updateUrl !== false) {
      setUrlItem(null);
    }
  }

  function buildSwatches(product) {
    ui.colors.replaceChildren();

    const colors = Array.isArray(product.colors) ? product.colors : [];
    const single = colors.length < 2; // один цвет: переключать нечего

    if (colors.length) {
      const base = colors[0];
      if (single) {
        // Статичный бейдж вместо группы кнопок: переключение не вызывается.
        const badge = document.createElement("span");
        badge.className = "swatch swatch--static";
        badge.style.background = base.hex || "transparent";
        badge.title = base.name;
        badge.setAttribute("role", "img");
        badge.setAttribute("aria-label", base.name);
        ui.colors.append(badge);
      } else {
        for (const color of colors) {
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
      }
      ui.colors.hidden = false;
      ui.colorName.hidden = false;
      ui.colorName.textContent = base.name;
      applyColor(base);
      return;
    }

    // Цветов нет: блок выбора скрываем и модель не перекрашиваем.
    ui.colors.hidden = true;
    ui.colorName.hidden = true;
    ui.colorName.textContent = "";
  }

  function selectColor(colorId) {
    const product = state.selected;
    if (!product || !Array.isArray(product.colors) || product.colors.length < 2) return;
    const color = product.colors.find((item) => item.id === colorId);
    if (!color) return;

    state.selectedColorId = colorId;
    for (const swatch of ui.colors.children) {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.id === colorId));
    }
    ui.colorName.textContent = color.name;
    renderCartStepper(); // у другого цвета свой счётчик
    applyColor(color);
  }

  /* Перекрашивает модель текущим вариантом цвета.

     Порядок: если снимок материалов ещё не снят, снимаем его по событию load.
     Для варианта с original: true возвращаем исходные цвет и текстуру, для
     остальных — задаём цвет и (если не keep_texture) убираем baseColorTexture. */
  function applyColor(color) {
    const product = state.selected;
    if (!product) return;

    const repaint = () => {
      if (!captureMaterials()) return;

      const targets = resolveColorTargets(product, color);
      // Снимок и модель одной версии: если материалов нет, красить нечего.
      if (color.original === true) {
        restoreOriginalMaterials();
      } else if (!targets.length) {
        return;
      } else {
        paintMaterials(targets, color);
      }
      // Текстуру не вернули через API: перезагружаем модель с чистого листа,
      // чтобы не оставалось следов прошлых перекрасок.
      if (color.original === true || targets.some((index) => state.materials[index]?.hasTexture)) {
        restoreMaterialsByReload(color);
      }
    };

    // Вариант без цвета и без флага original: показываем базовое состояние.
    if (!color.hex && color.original !== true) {
      if (state.materialsForModel === ui.viewer.getAttribute("src")) {
        restoreOriginalMaterials();
      }
      return;
    }

    if (!ui.viewer.modelIsVisible) {
      ui.viewer.addEventListener(
        "load",
        () => {
          repaint();
        },
        { once: true }
      );
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

  /* ---------- Материалы модели: исходные параметры и перекраска ---------- */

  /* Снимок материалов нужен, чтобы «оригинальный» вариант возвращал ровно то,
     что лежит в GLB: цвет и baseColorTexture (дерево, ткань). */
  function captureMaterials() {
    const viewer = ui.viewer;
    const materials = viewer.model?.materials;
    if (!materials?.length) {
      state.materials = [];
      state.materialsForModel = null;
      return false;
    }

    state.materials = Array.from(materials, (material) => {
      const pbr = material.pbrMetallicRoughness;
      return {
        name: material.name || "(без имени)",
        metallicFactor: pbr?.metallicFactor ?? 1,
        origBaseColorFactor: pbr?.baseColorFactor
          ? Array.from(pbr.baseColorFactor)
          : null,
        origBaseColorTexture:
          pbr?.baseColorTexture?.texture ?? null,
        // hasTexture считаем по наличию текстуры, а не по флагу в файле.
        hasTexture: Boolean(pbr?.baseColorTexture?.texture),
        baseColorTexture: pbr?.baseColorTexture ?? null,
      };
    });
    state.materialsForModel = viewer.getAttribute("src");
    logMaterials(state.materials);
    return true;
  }

  /* Компактный дамп материалов: по нему подбираются значения color_materials
     в data/catalog.json. */
  function logMaterials(snapshot) {
    const rows = snapshot.map(
      (item, index) =>
        `${index}: ${item.name}, metallic=${item.metallicFactor}, hasTexture=${item.hasTexture}`
    );
    console.debug(
      `[model-viewer] материалы ${state.materialsForModel}: ${rows.join(" | ")}`
    );
  }

  /* Индексы материалов, которые нужно перекрашивать. Приоритет:
     1) явное поле color_materials/target_materials у товара в catalog.json;
     2) явный material у цветового варианта (обратная совместимость);
     3) все материалы с metallicFactor < 0.7, иначе первый материал. */
  function resolveColorTargets(product, color) {
    const total = state.materials.length;
    if (!total) return [];

    const fromProduct = product.color_materials ?? product.target_materials;
    const explicit = Array.isArray(fromProduct)
      ? fromProduct
      : color.material !== undefined
        ? [color.material]
        : null;

    if (explicit) {
      return explicit.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < total
      );
    }

    const nonMetallic = state.materials
      .map((item, index) => (item.metallicFactor < DEFAULT_METALLIC_LIMIT ? index : -1))
      .filter((index) => index !== -1);

    return nonMetallic.length ? nonMetallic : [0];
  }

  /* Восстанавливает исходный вид модели: цвет и baseColorTexture каждого материала. */
  function restoreOriginalMaterials() {
    for (const material of ui.viewer.model?.materials ?? []) {
      const pbr = material.pbrMetallicRoughness;
      const snapshot = state.materials
        ? state.materials.find((item) => item.name === material.name)
        : null;
      if (snapshot?.origBaseColorFactor) {
        pbr?.setBaseColorFactor(snapshot.origBaseColorFactor);
      }
      if (snapshot?.baseColorTexture) {
        snapshot.baseColorTexture.setTexture(snapshot.origBaseColorTexture);
      }
    }
  }

  /* Красит выбранные материалы. Текстуру дерева/ткани сбрасываем: иначе цвет
     смешивается с ней и получается грязный оттенок. Нормали и шероховатость
     не трогаем. */
  function paintMaterials(targets, color) {
    const factor = [...hexToLinear(color.hex), 1];
    const keepTexture = color.keep_texture === true;

    for (const index of targets) {
      const material = state.materials[index];
      const pbr = ui.viewer.model?.materials?.[index]?.pbrMetallicRoughness;
      if (!material || !pbr) continue;
      pbr.setBaseColorFactor(factor);
      if (material.hasTexture && !keepTexture) {
        pbr.baseColorTexture?.setTexture(null);
      }
    }
  }

  /* Перезагрузка модели для чистого состояния материалов.
     API не даёт вернуть сброшенную baseColorTexture, поэтому после перекраски
     текстурного материала (и при возврате к оригиналу) перезагружаем src с
     cache-busting параметром и повторяем нужный цвет на событии load. */
  function restoreMaterialsByReload(color) {
    const viewer = ui.viewer;
    const src = viewer.getAttribute("src") || viewer.src;
    if (!src) return;

    const base = src.split("#")[0].split("?")[0];
    const nonce = `?v=${Date.now()}`;

    viewer.addEventListener(
      "load",
      () => {
        if (!captureMaterials()) return;
        if (color.original === true) {
          restoreOriginalMaterials();
        } else {
          paintMaterials(resolveColorTargets(state.selected, color), color);
        }
      },
      { once: true }
    );

    viewer.setAttribute("src", base + nonce);
    // Смена src сбрасывает камеру и метки: вернём ракурс после загрузки.
    viewer.addEventListener("load", resetViewerCamera, { once: true });
  }

  /* ---------- Габариты: текстовый список и 3D-метки ---------- */

  function dimensionsOn() {
    return ui.dimToggle.getAttribute("aria-pressed") === "true";
  }

  function setDimensionsVisible(visible) {
    ui.dimToggle.setAttribute("aria-pressed", String(visible));
    ui.dimToggle.classList.toggle("viewer-tool--active", visible);
    setHotspotsVisible(visible);
  }

  function setHotspotsVisible(visible) {
    for (const hotspot of ui.viewer.querySelectorAll(".hotspot")) {
      hotspot.hidden = !visible;
    }
  }

  /* Расставляет 3D-метки по реальным границам модели: работает для любой .glb,
     а не только для текущих файлов каталога. */
  function placeHotspots() {
    const viewer = ui.viewer;
    const product = state.selected;
    if (!viewer.getDimensions || !viewer.getBoundingBoxCenter) return;

    let dimensions = null;
    let center = null;
    try {
      dimensions = viewer.getDimensions();
      center = viewer.getBoundingBoxCenter();
    } catch (error) {
      return; // модель ещё не готова
    }
    if (!dimensions || !center || !Number.isFinite(center.x)) return;

    const { x: cx, y: cy, z: cz } = center;
    const { x: dx, y: dy, z: dz } = dimensions;
    const gap = Math.max(dx, dy, dz) * 0.08 + 0.02; // отступ от корпуса

    // Метки лежат на гранях габаритного бокса, чтобы читалось, что размер
    // относится к конкретной стороне: ширина — по нижнему переднему ребру,
    // глубина — по нижнему правому ребру (вдоль Z), высота — по правому
    // переднему вертикальному ребру.
    const baseY = cy - dy / 2;
    const frontZ = cz + dz / 2 + gap;
    const rightX = cx + dx / 2 + gap;

    const spots = [
      { name: "hotspot-width", position: `${cx} ${baseY} ${frontZ}`, normal: "0 0 1" },
      { name: "hotspot-depth", position: `${rightX} ${baseY} ${cz}`, normal: "1 0 0" },
      { name: "hotspot-height", position: `${rightX} ${cy} ${frontZ}`, normal: "1 0 0" },
    ];

    for (const spot of spots) {
      viewer.updateHotspot({
        name: spot.name,
        position: spot.position,
        normal: spot.normal,
      });
    }
    state.hotspotSignature = `${product?.id ?? ""}|${dx}|${dy}|${dz}`;
  }

  /* Исходный ракурс: модель целиком в кадре, зум в пределах min/max из разметки.
     Значения совпадают с атрибутами <model-viewer> в index.html. */
  const DEFAULT_ORBIT = "35deg 72deg 210%";

  function resetViewerCamera() {
    const viewer = ui.viewer;
    viewer.cameraTarget = "auto auto auto";
    viewer.cameraOrbit = DEFAULT_ORBIT;
    viewer.fieldOfView = "auto";
    if (typeof viewer.updateFraming === "function") {
      viewer.updateFraming();
    }
  }
  /* ---------- Диплинк ?item= ---------- */

  function productUrl(id) {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("item", id);
    } else {
      url.searchParams.delete("item");
    }
    url.hash = "";
    return url.toString();
  }

  function setUrlItem(id) {
    if (!window.history?.replaceState) return;
    const url = productUrl(id);
    const current = new URL(window.location.href);
    if (current.toString() === url) return;
    window.history.replaceState({ item: id }, "", url);
  }

  function itemFromUrl() {
    return new URL(window.location.href).searchParams.get("item");
  }

  /* ---------- QR-код для перехода на телефон ---------- */

  /* На сенсорных устройствах QR-переход не нужен: телефон уже в руках,
     а кнопка QR занимает место над сценой. Учитываем coarse pointer,
     мобильный User-Agent и доступность AR. */
  function isTouchDevice() {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const noHover = window.matchMedia?.("(hover: none)").matches ?? false;
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(
      navigator.userAgent || ""
    );
    return (coarse && noHover) || mobileUa;
  }

  function updateQrVisibility() {
    const hide = isTouchDevice(); // кнопка AR-примерки остаётся всегда
    ui.qrOpen.hidden = hide;
  }

  function openQr() {
    const product = state.selected;
    if (!product) return;

    const url = productUrl(product.id);
    ui.qrItem.textContent = product.name;
    ui.qrUrl.value = url;

    if (!window.QRCode) {
      ui.qrCode.replaceChildren();
      ui.qrCode.textContent = "Генератор QR-кода не загрузился.";
      ui.qrModal.hidden = false;
      return;
    }

    const svg = window.QRCode.render(ui.qrCode, url);
    if (!svg) {
      ui.qrCode.textContent = "Ссылка слишком длинная для QR-кода.";
    }
    ui.qrModal.hidden = false;
  }

  function closeQr() {
    ui.qrModal.hidden = true;
    ui.qrCode.replaceChildren();
  }

  /* ---------- Панель корзины ---------- */

  function openCart() {
    renderCart();
    ui.checkoutNote.textContent = "";
    ui.cartModal.hidden = false;
  }

  function closeCart() {
    ui.cartModal.hidden = true;
    ui.checkoutNote.textContent = "";
  }

  /* ---------- AR ---------- */

  function updateArAvailability() {
    if (!ui.viewer.canActivateAR) {
      ui.arButton.hidden = true;
      ui.arNote.textContent =
        "AR-режим доступен на смартфоне: Android — через Scene Viewer/WebXR, iOS — через Quick Look. Установите модель в комнате прямо из браузера. Кнопка «AR на телефоне (QR)» покажет ссылку на этот товар.";
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
      setDimensionsVisible(!dimensionsOn());
    });

    ui.resetView.addEventListener("click", resetViewerCamera);

    ui.addToCart.addEventListener("click", () => {
      if (state.selected) addToCart(state.selected, state.selectedColorId);
    });

    ui.pillMinus.addEventListener("click", () => stepSelected(-1));
    ui.pillPlus.addEventListener("click", () => stepSelected(1));

    ui.qrOpen.addEventListener("click", openQr);
    ui.cartOpen.addEventListener("click", openCart);

    ui.cartClear.addEventListener("click", () => {
      state.cart = [];
      saveCart();
      renderCartCount();
      renderCartStepper();
      renderCart();
      ui.checkoutNote.textContent = "Корзина очищена.";
    });

    ui.checkout.addEventListener("click", () => {
      const count = cartCount();
      if (!count) return;
      ui.checkoutNote.textContent =
        `Заказ на ${money.format(cartTotal())} (${count} шт.) принят. ` +
        "Это демонстрация: данные никуда не отправляются.";
    });

    ui.modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close]")) closeProduct();
    });

    ui.qrModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-qr]")) closeQr();
    });

    ui.cartModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-cart]")) closeCart();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!ui.cartModal.hidden) closeCart();
      else if (!ui.qrModal.hidden) closeQr();
      else if (!ui.modal.hidden) closeProduct();
    });

    // Метки габаритов зависят от реальных размеров: пересчитываем при загрузке
    // модели и при смене размеров окна (model-viewer пересчитывает камеру).
    ui.viewer.addEventListener("progress", (event) => {
      setProgress(event.detail?.totalProgress);
    });

    ui.viewer.addEventListener("load", () => {
      finishProgressBar();
      updateArAvailability();
      // Снимок исходных материалов: нужен для возврата к «оригиналу».
      captureMaterials();
      // Ждём, пока model-viewer отдаст размеры после отрисовки кадра.
      window.requestAnimationFrame(() => window.setTimeout(placeHotspots, 0));
      if (dimensionsOn()) setHotspotsVisible(true);
    });

    ui.viewer.addEventListener("error", () => {
      finishProgressBar();
      ui.arNote.textContent = "Не удалось загрузить 3D-модель. Проверьте файл модели.";
    });

    window.addEventListener("resize", () => {
      if (dimensionsOn()) placeHotspots();
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

    loadCart();
    buildCategoryChips();
    renderGrid();
    renderCartCount();
    renderCart();
    bindEvents();
    updateQrVisibility();

    // Диплинк: страница открыта по ссылке из QR-кода.
    const requested = itemFromUrl();
    if (requested && !openProduct(requested, { updateUrl: false })) {
      ui.count.textContent += " · Товар из ссылки не найден.";
    }

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
