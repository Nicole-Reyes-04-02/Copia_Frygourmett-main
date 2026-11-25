import { isSupabaseConfigured, supabase } from "../js/supabase.js";
import { registerInventoryReplenishment } from "../js/services/inventory.js";
import { renderUnitSelector, convertToIngredientBaseUnit } from "./utils/units.js";

const hasSupabase = isSupabaseConfigured && Boolean(supabase);

export function setupUnitSelectors() {
  document.querySelectorAll("[data-unit-selector]").forEach((select) => {
    renderUnitSelector(select, select.value || select.dataset.selected || "g");
  });
}

export function setupAnimations() {
  document.documentElement.classList.add("frg-motion-ready");
  const elements = document.querySelectorAll("main section, .panel, .guest-menu-grid > *, .product-card");
  elements.forEach((element, index) => {
    element.style.setProperty("--frg-enter-delay", `${Math.min(index * 35, 280)}ms`);
    element.classList.add("frg-enter");
  });

  if (typeof IntersectionObserver === "undefined") {
    elements.forEach((element) => element.classList.add("frg-enter-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("frg-enter-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08 });

  elements.forEach((element) => observer.observe(element));
}

export function setupSwiperCarousels() {
  if (typeof window.Swiper === "undefined") {
    const timer = window.setInterval(() => {
      if (typeof window.Swiper === "undefined") return;
      window.clearInterval(timer);
      initializeSwiperInstances();
    }, 200);
    window.setTimeout(() => window.clearInterval(timer), 4000);
    return;
  }
  initializeSwiperInstances();
}

function initializeSwiperInstances() {
  if (typeof window.Swiper !== "function") return;
  try {
    const general = document.querySelector(".swiper-general-showcase");
    if (general && !general.swiper) {
      new window.Swiper(general, {
        loop: true,
        autoplay: { delay: 4500, disableOnInteraction: false },
        effect: "coverflow",
        grabCursor: true,
        centeredSlides: true,
        slidesPerView: "auto",
        coverflowEffect: { rotate: 20, stretch: 0, depth: 100, modifier: 1, slideShadows: true },
        pagination: { el: general.querySelector(".swiper-pagination"), clickable: true }
      });
    }

    const promotions = document.querySelector(".swiper-promotions-showcase");
    if (promotions && !promotions.swiper) {
      new window.Swiper(promotions, {
        loop: false,
        autoplay: { delay: 4500, disableOnInteraction: false, pauseOnMouseEnter: true },
        slidesPerView: "auto",
        spaceBetween: 14,
        grabCursor: true,
        pagination: {
          el: promotions.querySelector(".swiper-pagination-promo") || promotions.querySelector(".swiper-pagination"),
          clickable: true,
          dynamicBullets: true
        },
        navigation: {
          nextEl: promotions.querySelector(".swiper-button-next-promo") || document.querySelector(".swiper-button-next-promo"),
          prevEl: promotions.querySelector(".swiper-button-prev-promo") || document.querySelector(".swiper-button-prev-promo")
        }
      });
    }
  } catch (error) {
    console.error("No se pudieron iniciar los carruseles Swiper:", error);
  }
}

export function setupInventoryTools() {
  const panel = document.getElementById("inventario");
  if (!panel) return;

  panel.querySelectorAll("[data-inventory-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      panel.querySelectorAll("[data-inventory-tab]").forEach((tab) => {
        tab.classList.toggle("is-active", tab === button);
        tab.setAttribute("aria-selected", String(tab === button));
      });
      panel.querySelectorAll("[data-inventory-view]").forEach((view) => {
        view.hidden = view.dataset.inventoryView !== button.dataset.inventoryTab;
      });
    });
  });

  document.getElementById("inventory-export-txt")?.addEventListener("click", () => {
    const rows = [...document.querySelectorAll("#inventory-body tr")]
      .map((row) => row.textContent.replace(/\s+/g, " ").trim());
    const text = ["REPOSICION INVENTARIO FRYGOURMETT", ...rows].join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `inventario-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  });

  const input = document.getElementById("inventory-replenishment-file");
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    const role = document.body.dataset.dashboardRole;
    if (!["administrador", "almacenero"].includes(role)) {
      window.alert("Solo el Administrador y el Almacenero pueden registrar reposiciones.");
      input.value = "";
      return;
    }
    if (!/\.txt$/i.test(file.name)) {
      window.alert("Selecciona un archivo .txt.");
      input.value = "";
      return;
    }
    if (!hasSupabase) {
      window.alert("Supabase no está configurado.");
      input.value = "";
      return;
    }

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter(({ line }) => line);
      let applied = 0;
      const issues = [];

      for (const entry of lines) {
        const match = entry.line.match(/^(.+?)\s*[|;,]\s*([+]?[0-9]+(?:[.,][0-9]+)?)(?:\s*([a-zA-ZáéíóúÁÉÍÓÚñÑ.\/]+))?\s*$/);
        if (!match) {
          issues.push(`Línea ${entry.lineNumber}: formato inválido.`);
          continue;
        }

        const name = match[1].trim();
        const quantity = Number(match[2].replace(",", "."));
        if (!name || !Number.isFinite(quantity) || quantity <= 0) {
          issues.push(`Línea ${entry.lineNumber}: cantidad o ingrediente inválido.`);
          continue;
        }

        const { data: ingredient, error: ingredientError } = await supabase
          .from("ingredientes")
          .select("id,nombre,cantidad,unidad,densidad,peso_por_taza,unidad_base")
          .ilike("nombre", name)
          .maybeSingle();
        if (ingredientError) {
          issues.push(`Línea ${entry.lineNumber}: no se pudo buscar «${name}»: ${ingredientError.message}`);
          continue;
        }
        if (!ingredient) {
          issues.push(`Línea ${entry.lineNumber}: no existe el insumo «${name}».`);
          continue;
        }

        const conversion = convertToIngredientBaseUnit(quantity, match[3] || ingredient.unidad, ingredient);
        if (!conversion || conversion.noStockDeduction || !Number.isFinite(conversion.value) || conversion.value <= 0) {
          issues.push(`Línea ${entry.lineNumber}: unidad incompatible para «${ingredient.nombre}».`);
          continue;
        }

        try {
          await registerInventoryReplenishment(
            ingredient.id,
            conversion.value,
            `Reposición desde ${file.name} (línea ${entry.lineNumber})`
          );
          applied += 1;
        } catch (error) {
          issues.push(`Línea ${entry.lineNumber}: ${error.message}`);
        }
      }

      const issueSummary = issues.length
        ? `\n\nIncidencias:\n${issues.slice(0, 10).join("\n")}${issues.length > 10 ? `\n… y ${issues.length - 10} más.` : ""}`
        : "";
      window.alert(`Reposición procesada: ${applied} movimiento(s) registrados.${issueSummary}`);
    } catch (error) {
      console.error("Error al procesar la reposición:", error);
      window.alert(`No se pudo procesar el archivo de reposición: ${error.message}`);
    } finally {
      input.value = "";
    }
  });
}
