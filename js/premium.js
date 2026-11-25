/* ==========================================================================
   FRYGOURMETT · PREMIUM INTERACTIVITY (js/premium.js)
   - Inclinación 3D + brillo radial del carrusel hero (cliente.html)
   - Navegación por teclado (← →) en el carrusel hero
   - Brillo ámbar en tarjetas del dashboard (index.html)
   - Count-up animado de 700 ms en métricas KPI
   - Paleta de comandos accesible con Ctrl/Cmd+K
   ========================================================================== */

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* --------------------------------------------------------------------------
   1. CARRUSEL HERO (cliente.html): Tilt 3D + Glare + Teclado ← →
   -------------------------------------------------------------------------- */
function initHero3DTiltAndKeys() {
  const carousel = document.getElementById("featured-carousel");
  if (!carousel) return;

  let activeStage = null;

  const resetCard = (stage) => {
    const card = stage?.querySelector(".pm-slide-card");
    if (!card) return;
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--gx", "50%");
    card.style.setProperty("--gy", "0%");
  };

  carousel.addEventListener("pointermove", (e) => {
    if (prefersReducedMotion() || e.pointerType === "touch") return;
    const stage = e.target.closest(".pm-slide-stage");
    if (!stage) {
      if (activeStage) {
        resetCard(activeStage);
        activeStage = null;
      }
      return;
    }
    if (activeStage && activeStage !== stage) {
      resetCard(activeStage);
    }
    activeStage = stage;
    const card = stage.querySelector(".pm-slide-card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    // ±8° de inclinación 3D
    card.style.setProperty("--ry", `${((x - 0.5) * 16).toFixed(2)}deg`);
    card.style.setProperty("--rx", `${((0.5 - y) * 16).toFixed(2)}deg`);
    card.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
    card.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
  });

  carousel.addEventListener("pointerleave", () => {
    if (activeStage) {
      resetCard(activeStage);
      activeStage = null;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const panelCarta = document.getElementById("panel-carta");
    if (panelCarta && panelCarta.hidden) return;
    if (e.key === "ArrowRight") {
      document.getElementById("carousel-next")?.click();
    } else {
      document.getElementById("carousel-previous")?.click();
    }
  });
}

/* --------------------------------------------------------------------------
   2. BRILLO ÁMBAR AL CURSOR EN TARJETAS DEL ADMIN
   -------------------------------------------------------------------------- */
function initAdminCursorGlow() {
  const wrap = document.querySelector(".content-wrap");
  if (!wrap) return;

  const cardSelector =
    ".metric-card, .panel, .admin-welcome-hero, .quick-action-card, .swiper-showcase-section article, .promotion-manager";

  wrap.addEventListener("pointermove", (e) => {
    if (prefersReducedMotion() || e.pointerType === "touch") return;
    const card = e.target.closest(cardSelector);
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${(e.clientX - r.left).toFixed(1)}px`);
    card.style.setProperty("--my", `${(e.clientY - r.top).toFixed(1)}px`);
  });
}

/* --------------------------------------------------------------------------
   3. COUNT-UP DE 700 MS EN TARJETAS KPI
   -------------------------------------------------------------------------- */
function initKpiCountUp() {
  const kpiConfigs = [
    { id: "metric-orders", format: (n) => String(Math.round(n)) },
    { id: "metric-revenue", format: (n) => `S/ ${n.toFixed(2)}` },
    { id: "dx-products", format: (n) => String(Math.round(n)) },
    { id: "dx-rating", format: (n) => n.toFixed(1) },
    { id: "metric-preparing", format: (n) => String(Math.round(n)) },
    { id: "metric-completed", format: (n) => String(Math.round(n)) },
    { id: "dx-donut-total", format: (n) => String(Math.round(n)) }
  ];

  const parseNumeric = (text) => {
    const clean = String(text || "").replace(/[^\d.,-]/g, "").replace(/,/g, "");
    if (!clean || clean === "-") return null;
    const n = Number.parseFloat(clean);
    return Number.isFinite(n) ? n : null;
  };

  kpiConfigs.forEach(({ id, format }) => {
    const el = document.getElementById(id);
    if (!el) return;

    const initialVal = parseNumeric(el.textContent);
    el.dataset.pmVal = initialVal !== null ? String(initialVal) : "0";

    const observer = new MutationObserver(() => {
      if (el.dataset.pmAnimating === "1") return;
      const target = parseNumeric(el.textContent);
      if (target === null) return;

      const from = Number.parseFloat(el.dataset.pmVal || "0") || 0;
      if (Math.abs(target - from) < 0.001) return;

      if (prefersReducedMotion()) {
        el.dataset.pmVal = String(target);
        return;
      }

      el.dataset.pmVal = String(target);
      el.dataset.pmAnimating = "1";
      const t0 = performance.now();
      const duration = 700;

      const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const current = from + (target - from) * eased;
        el.textContent = format(current);
        if (p < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = format(target);
          delete el.dataset.pmAnimating;
        }
      };

      requestAnimationFrame(step);
    });

    observer.observe(el, { childList: true, characterData: true, subtree: true });
  });
}

/* --------------------------------------------------------------------------
   4. PALETA DE COMANDOS CTRL/CMD+K (index.html)
   -------------------------------------------------------------------------- */
function initCommandPalette() {
  const palette = document.getElementById("pm-command-palette");
  const input = document.getElementById("pm-pal-input");
  const list = document.getElementById("pm-pal-list");
  if (!palette || !input || !list) return;

  let selectedIdx = 0;
  let visibleCommands = [];

  const getAvailableCommands = () => {
    const cmds = [];
    const navButtons = [
      { view: "resumen", label: "Ir a Dashboard", hint: "Vista" },
      { view: "menu", label: "Ir a Carta y Carruseles", hint: "Vista" },
      { view: "pedidos", label: "Ir a Pedidos del servicio", hint: "Vista" },
      { view: "inventario", label: "Ir a Inventario y Recetas", hint: "Vista" },
      { view: "opiniones", label: "Ir a Opiniones de clientes", hint: "Vista" },
      { view: "personal", label: "Ir a Personal y Turnos", hint: "Vista" },
      { view: "configuracion", label: "Ir a Configuración", hint: "Vista" }
    ];

    navButtons.forEach(({ view, label, hint }) => {
      const btn = document.querySelector(`.side-nav .nav-link[data-view="${view}"]`);
      if (btn && !btn.hidden) {
        cmds.push({
          label,
          hint,
          run: () => btn.click()
        });
      }
    });

    const newOrderBtn = document.querySelector(".new-order-button");
    if (newOrderBtn && !newOrderBtn.hidden) {
      cmds.push({
        label: "+ Crear pedido nuevo",
        hint: "Acción",
        run: () => newOrderBtn.click()
      });
    }

    const storeToggle = document.getElementById("admin-store-quick-toggle");
    if (storeToggle && !storeToggle.hidden) {
      cmds.push({
        label: "Alternar estado de la cocina (Abierta / Cerrada)",
        hint: "Cocina",
        run: () => storeToggle.click()
      });
    }

    const themeBtn = document.getElementById("admin-theme-toggle");
    if (themeBtn) {
      cmds.push({
        label: "Cambiar apariencia (Modo claro / oscuro)",
        hint: "Tema",
        run: () => themeBtn.click()
      });
    }

    const range30Btn = document.querySelector('[data-weekly-range="30"]');
    if (range30Btn) {
      cmds.push({
        label: "Ver gráfica de ventas de 30 días",
        hint: "Gráfica",
        run: () => range30Btn.click()
      });
    }

    const range7Btn = document.querySelector('[data-weekly-range="7"]');
    if (range7Btn) {
      cmds.push({
        label: "Ver gráfica de ventas de 7 días",
        hint: "Gráfica",
        run: () => range7Btn.click()
      });
    }

    return cmds;
  };

  const renderList = (query = "") => {
    const q = query.trim().toLowerCase();
    const all = getAvailableCommands();
    visibleCommands = q
      ? all.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q))
      : all;
    selectedIdx = Math.min(selectedIdx, Math.max(0, visibleCommands.length - 1));

    if (!visibleCommands.length) {
      list.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">No se encontraron acciones para "${query.replace(/[<>&"]/g, "")}".</div>`;
      return;
    }

    list.innerHTML = visibleCommands
      .map(
        (cmd, i) => `
        <button type="button" class="pm-pal-item${i === selectedIdx ? " is-selected" : ""}" data-pal-idx="${i}">
          <span>${cmd.label}</span>
          <kbd>${cmd.hint}</kbd>
        </button>`
      )
      .join("");
  };

  const openPalette = () => {
    if (!document.body.classList.contains("is-authenticated")) return;
    selectedIdx = 0;
    input.value = "";
    renderList("");
    palette.classList.add("is-open");
    palette.hidden = false;
    window.setTimeout(() => input.focus(), 20);
  };

  const closePalette = () => {
    palette.classList.remove("is-open");
    palette.hidden = true;
  };

  input.addEventListener("input", () => {
    selectedIdx = 0;
    renderList(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (visibleCommands.length) {
        selectedIdx = (selectedIdx + 1) % visibleCommands.length;
        renderList(input.value);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (visibleCommands.length) {
        selectedIdx = (selectedIdx - 1 + visibleCommands.length) % visibleCommands.length;
        renderList(input.value);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = visibleCommands[selectedIdx];
      if (cmd) {
        closePalette();
        cmd.run();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  });

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pal-idx]");
    if (!btn) return;
    const cmd = visibleCommands[Number(btn.dataset.palIdx)];
    if (cmd) {
      closePalette();
      cmd.run();
    }
  });

  palette.addEventListener("click", (e) => {
    if (e.target === palette) closePalette();
  });

  document.querySelector(".topbar-search kbd")?.addEventListener("click", (e) => {
    e.preventDefault();
    openPalette();
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (palette.classList.contains("is-open")) {
          closePalette();
        } else {
          openPalette();
        }
      } else if (e.key === "Escape" && palette.classList.contains("is-open")) {
        closePalette();
      }
    },
    true
  );
}

/* Inicialización segura al cargar DOM */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initHero3DTiltAndKeys();
    initAdminCursorGlow();
    initKpiCountUp();
    initCommandPalette();
  });
} else {
  initHero3DTiltAndKeys();
  initAdminCursorGlow();
  initKpiCountUp();
  initCommandPalette();
}
