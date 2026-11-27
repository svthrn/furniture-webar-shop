/* Каталог мебели с WebAR-просмотром: чистый Vanilla JS без сборки.
   Функции: фильтры, карточка товара, 3D-метки габаритов, диплинк ?item=,
   QR-передача на телефон и корзина на localStorage. */
(() => {
  "use strict";

  const VIEWER_TIMEOUT_MS = 4000;
  // Быстрые ракурсы камеры (camera-orbit в model-viewer). «3/4» — исходный вид.
  const CAMERA_PRESETS = {
    "34": "35deg 72deg 145%",
    front: "0deg 85deg 145%",
    side: "90deg 85deg 145%",
    top: "0deg 10deg 155%",
  };
  const DEFAULT_PRESET = "34";
  const AR_SCALE_HINTS = {
    fixed: "1:1 — реальный размер мебели",
    auto: "Свободный — размер не привязан к 1:1",
  };
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
    cart: [],
    hotspotSignature: null, // модель, для которой метки уже расставлены
    preset: null, // ключ активного ракурса камеры
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
    dimColor: el("dim-color"),
    dimToggle: el("dimensions-toggle"),
    dimensions: el("dimensions"),
    materials: el("materials"),
    resetView: el("reset-view"),
    presets: Array.from(document.querySelectorAll(".viewer-view[data-preset]")),
    autoRotate: el("auto-rotate"),
    arScale: el("ar-scale"),
    arScaleHint: el("ar-scale-hint"),
    arScaleButtons: Array.from(document.querySelectorAll("[data-scale]")),
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
      // Строки с цветом из старых версий сводим к одной позиции на товар и
      // отбрасываем те, которых нет в каталоге или с плохими данными.
      const merged = new Map();
      for (const row of parsed) {
        if (!row || typeof row.id !== "string" || !Number.isFinite(row.qty)) continue;
        if (!state.products.some((p) => p.id === row.id)) continue;
        const qty = Math.max(1, Math.floor(row.qty));
        merged.set(row.id, Math.min((merged.get(row.id) ?? 0) + qty, 99));
      }
      state.cart = [...merged]
        .map(([id, qty]) => ({ id, qty }))
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

  /* Строка «Цвет»: поле color или название первого варианта из каталога. */
  function colorLabel(product) {
    return product.color ?? product.colors?.[0]?.name ?? "";
  }

  /* Количество выбранного товара в корзине: основа для кнопки-степпера. */
  function selectedRowQty() {
    const product = state.selected;
    if (!product) return 0;
    const row = state.cart.find((item) => item.id === product.id);
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

  function addToCart(product) {
    const existing = state.cart.find((row) => row.id === product.id);
    if (existing) {
      existing.qty = Math.min(existing.qty + 1, 99);
    } else if (state.cart.length < MAX_CART_ROWS) {
      state.cart.push({ id: product.id, qty: 1 });
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
    const index = state.cart.findIndex((row) => row.id === product.id);
    if (index === -1) {
      if (delta > 0) addToCart(product);
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
      meta.textContent = `${colorLabel(product)} · ${money.format(product.price)}`;
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
    state.hotspotSignature = null; // метки пересчитаем для новой модели

    el("modal-category").textContent = product.category;
    el("modal-title").textContent = product.name;
    el("modal-price").textContent = money.format(product.price);
    el("modal-description").textContent = product.description;

    el("dim-width").textContent = `${product.dimensions.width} см`;
    el("dim-depth").textContent = `${product.dimensions.depth} см`;
    el("dim-height").textContent = `${product.dimensions.height} см`;
    ui.dimColor.textContent = colorLabel(product);
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

  /* Загрузка модели: .glb отдаётся model-viewer, камера возвращается в ракурс 3/4. */
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

    // Смена src сбрасывает камеру: после новой загрузки вернём исходный ракурс.
    viewer.addEventListener("load", resetViewerCamera, { once: true });

    viewer.setAttribute("src", product.model);
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
    state.hotspotSignature = null;
    if (options.updateUrl !== false) {
      setUrlItem(null);
    }
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

  /* Сброс вида: ракурс 3/4 с исходным масштабом, кнопка подсвечивается как активная. */

  function resetViewerCamera() {
    const viewer = ui.viewer;
    viewer.cameraTarget = "auto auto auto";
    setCameraPreset(DEFAULT_PRESET);
    viewer.fieldOfView = "auto";
    if (typeof viewer.updateFraming === "function") {
      viewer.updateFraming();
    }
  }
  /* ---------- Ракурсы камеры, автоповорот, AR-масштаб ---------- */

  function setCameraPreset(key) {
    const orbit = CAMERA_PRESETS[key];
    if (!orbit) return;
    ui.viewer.cameraOrbit = orbit;
    state.preset = key;
    for (const button of ui.presets) {
      button.setAttribute("aria-pressed", String(button.dataset.preset === key));
    }
  }

  function toggleAutoRotate() {
    const on = !ui.viewer.hasAttribute("auto-rotate");
    ui.viewer.toggleAttribute("auto-rotate", on);
    ui.autoRotate.setAttribute("aria-pressed", String(on));
  }

  function setArScale(mode) {
    if (!AR_SCALE_HINTS[mode]) return;
    ui.viewer.setAttribute("ar-scale", mode);
    ui.arScaleHint.textContent = AR_SCALE_HINTS[mode];
    for (const button of ui.arScaleButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.scale === mode));
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

  /* Кнопка в слоте model-viewer только на смартфоне с AR; на ПК — QR-код. */
  function updateArAvailability() {
    const canAr = ui.viewer.canActivateAR === true;
    ui.arButton.hidden = !canAr;
    ui.arScale.hidden = !canAr;
    ui.qrOpen.hidden = canAr;
    ui.arNote.textContent = canAr
      ? "Перетащите модель по комнате и нажмите «Поставить в комнате (AR)»."
      : "На смартфоне с поддержкой AR «Поставить в комнате» откроет модель в вашей комнате: Android — Scene Viewer или WebXR, iOS — Quick Look. Здесь кнопка покажет QR-код для телефона.";
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

    for (const button of ui.presets) {
      button.addEventListener("click", () => setCameraPreset(button.dataset.preset));
    }
    ui.autoRotate.addEventListener("click", toggleAutoRotate);
    for (const button of ui.arScaleButtons) {
      button.addEventListener("click", () => setArScale(button.dataset.scale));
    }

    ui.dimToggle.addEventListener("click", () => {
      setDimensionsVisible(!dimensionsOn());
    });

    ui.resetView.addEventListener("click", resetViewerCamera);

    ui.addToCart.addEventListener("click", () => {
      if (state.selected) addToCart(state.selected);
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
      // Ждём, пока model-viewer отдаст размеры после отрисовки кадра.
      window.requestAnimationFrame(() => window.setTimeout(placeHotspots, 0));
      if (dimensionsOn()) setHotspotsVisible(true);
    });

    ui.viewer.addEventListener("error", () => {
      finishProgressBar();
      ui.arNote.textContent = "Не удалось загрузить 3D-модель. Проверьте файл модели.";
    });

    // Ручной поворот снимает подсветку ракурса: вид уже не совпадает с кнопкой.
    ui.viewer.addEventListener("camera-change", (event) => {
      if (event.detail?.source !== "user-interaction" || state.preset === null) return;
      state.preset = null;
      for (const button of ui.presets) button.setAttribute("aria-pressed", "false");
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
    setArScale(ui.viewer.getAttribute("ar-scale") ?? "fixed");

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
