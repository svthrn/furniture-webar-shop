/* Отрисовка QR-кода в SVG на базе qrcode-generator (Kazuhiko Arase, MIT).
   Отдельный модуль, чтобы index.html оставался читаемым, а генерация
   работала офлайн и на GitHub Pages без внешних запросов. */
(() => {
  "use strict";

  if (typeof qrcode !== "function") return; // библиотека не загрузилась: молча выходим

  const NS = "http://www.w3.org/2000/svg";
  const QUIET = 4; // «тихая зона» в модулях, требуется стандартом

  /* Подбирает минимальную версию под текст: qrcode(0, 'M') делает это сам. */
  function build(text) {
    const code = qrcode(0, "M");
    code.addData(text); // addData сам переключится на UTF-8 при необходимости
    code.make();
    return code;
  }

  function toSvg(code) {
    const count = code.getModuleCount();
    const scale = Math.max(2, Math.round(256 / (count + QUIET * 2)));
    const side = (count + QUIET * 2) * scale;

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("xmlns", NS);
    svg.setAttribute("viewBox", `0 0 ${side} ${side}`);
    svg.setAttribute("width", side);
    svg.setAttribute("height", side);
    svg.setAttribute("role", "img");
    svg.setAttribute("shape-rendering", "crispEdges");

    const background = document.createElementNS(NS, "rect");
    background.setAttribute("width", side);
    background.setAttribute("height", side);
    background.setAttribute("fill", "#ffffff");
    svg.append(background);

    let path = "";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (!code.isDark(row, col)) continue;
        const x = (col + QUIET) * scale;
        const y = (row + QUIET) * scale;
        path += `M${x} ${y}h${scale}v${scale}h-${scale}z`;
      }
    }

    const modules = document.createElementNS(NS, "path");
    modules.setAttribute("d", path);
    modules.setAttribute("fill", "#11151e");
    svg.append(modules);
    return svg;
  }

  /* Возвращает <svg> или null, если текст не помещается в QR-код. */
  function render(container, text) {
    try {
      container.replaceChildren(toSvg(build(text)));
      return container.firstChild;
    } catch (error) {
      container.replaceChildren();
      return null;
    }
  }

  window.QRCode = { render };
})();
