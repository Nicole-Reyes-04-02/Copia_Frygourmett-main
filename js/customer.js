import { escapeHtml, formatCurrency, isSupabaseConfigured, isVideoAsset, resolveImage, supabase } from "./supabase.js";
import { getRoleRedirect, normalizeRole, resolveUserRole, ROLE_LABELS } from "./auth.js";
import { mountManualPaymentCheckout, openManualPaymentCheckout } from "./manual-payment-checkout.js";
import { CATEGORIAS } from "./constants/categories.js";
import { setupNotifications } from "./services/notifications.js";

const customerForm = document.getElementById("customer-identity-form");
const menuGrid = document.getElementById("menu-grid");
const cartItemsElement = document.getElementById("cart-items");
const toastRegion = document.getElementById("guest-toast-region");
const checkoutForm = document.getElementById("checkout-form");
const customerPanels = [...document.querySelectorAll("[data-customer-panel]")];
const customerTabs = [...document.querySelectorAll("[data-customer-tab]")];

const LOCAL_FEATURED_PROMOTIONS = [
    {
        titulo: "El sabor no se explica. Se prueba.",
        titleHtml: "El sabor no se explica. <em>Se prueba.</em>",
        tag: "Cocina de autor · Delivery nocturno",
        descripcion: "Papas nativas con doble cocción, alitas glaseadas y reducciones artesanales.",
        tipo_media: "video",
        media_url: "img/prom.mp4",
        poster_url: "img/promo.avif",
        bg_url: "img/promo.avif",
        aspect_ratio: 0.5625,
        glow: "#ef4444",
        short_name: "Nuestra cocina",
        cta_label: "Pedir ahora",
        cta_href: "#carta",
        secondary_label: "Ver nuestra cocina",
        secondary_href: "#videos",
        is_hero: true
    },
    {
        titulo: "Go BBQ, glaseada al momento",
        titleHtml: "Go BBQ, <em>glaseada al momento.</em>",
        tag: "La mejor oferta del día",
        descripcion: "Alitas bañadas en salsa BBQ artesanal sobre papas rústicas.",
        tipo_media: "imagen",
        media_url: "img/bbq.avif",
        bg_url: "img/bbq.avif",
        aspect_ratio: 1,
        glow: "#f59e0b",
        price: "27.17",
        short_name: "Go BBQ",
        cta_label: "Pedir Go BBQ",
        cta_href: "#carta",
        secondary_label: "Ver la carta",
        secondary_href: "#nuestra-carta",
        is_hero: false
    },
    {
        titulo: "Entrega gratis en Rappi",
        titleHtml: "Entrega <em>gratis</em> en Rappi.",
        tag: "Solo este fin de semana",
        descripcion: "Solo este fin de semana · promoción válida 24 horas.",
        tipo_media: "imagen",
        media_url: "img/delifrygour.webp",
        bg_url: "img/delifrygour.webp",
        aspect_ratio: 940 / 788,
        glow: "#22c55e",
        short_name: "Entrega gratis",
        cta_label: "Pedir con envío gratis",
        cta_href: "#carta",
        secondary_label: "Ver la carta",
        secondary_href: "#nuestra-carta",
        is_hero: false
    },
    {
        titulo: "Pide tu domicilio",
        titleHtml: "Pide tu <em>domicilio.</em>",
        tag: "Atención por teléfono",
        descripcion: "Llámanos o escríbenos al +51 982 376 132 y lo llevamos directo a tu puerta.",
        tipo_media: "imagen",
        media_url: "img/domicilio.avif",
        bg_url: "img/domicilio.avif",
        aspect_ratio: 1125 / 1406,
        glow: "#38bdf8",
        short_name: "Domicilio",
        cta_label: "Llamar ahora",
        cta_href: "tel:+51982376132",
        secondary_label: "Ver la carta",
        secondary_href: "#carta",
        is_hero: false
    }
];

let products = [];
let productRecipes = [];
let ingredientsStock = [];
let promotions = [...LOCAL_FEATURED_PROMOTIONS];
let orders = [];
let cart = loadCart();
let activeCategory = "Todas";
let authMode = "signup";
let activeUser = null;
let activeProfile = null;
let activeName = "Comensal";
let isStoreOpen = true;
let currentServiceConfig = null;
let serviceStatusErrorShown = false;
let carouselIndex = 0;
let carouselTimer = null;
let carouselPaused = false;
let pointerStart = null;
let activeOrderChannel = null;
let notificationCleanup = null;
let activePaymentCheckout = null;
let publicContentChannel = null;

const STORE_CONFIG_STORAGE_KEY = "frygourmett-service-config";
const STORE_SYNC_CHANNEL_NAME = "frygourmett-store-sync";

function validateCustomerEmail(value) {
    const email = String(value || "").trim();
    if (!email) return "";
    const normalized = email.toLowerCase();
    if (/\.(?:con|cmo)$/.test(normalized)) {
        return "Revisa el dominio: parece que «.com» está mal escrito.";
    }
    if (/@(?:gmailcom|hotmailcom)(?:$|\.)/.test(normalized)) {
        return "El dominio parece incompleto. Por ejemplo, usa «gmail.com» o «hotmail.com».";
    }
    const [localPart, ...domainParts] = email.split("@");
    const domain = domainParts.join("@");
    const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i;
    if (!emailPattern.test(email) || localPart.length > 64 || localPart.startsWith(".")
        || localPart.endsWith(".") || localPart.includes("..") || domain.includes("..")) {
        return "Ingresa un correo válido y completo, por ejemplo nombre@gmail.com.";
    }
    return "";
}

function updateCustomerEmailValidation() {
    const input = customerForm.elements.customerEmail;
    const message = validateCustomerEmail(input.value);
    const warning = document.getElementById("customer-email-validation");
    input.setCustomValidity(message);
    warning.textContent = message;
    warning.classList.toggle("is-valid", !message && Boolean(input.value.trim()));
    return !message;
}

function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " toast-error" : ""}`;
    toast.textContent = message;
    toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 4200);
}

function setStatus(message, isError = false) {
    const status = document.getElementById("customer-auth-status");
    status.textContent = message;
    status.classList.toggle("is-error", isError);
}

function isWithinSchedule(horaApertura, horaCierre) {
    if (!horaApertura || !horaCierre) {
        // Horario por defecto oficial: 15:00 a 03:00 (Lima, UTC-5)
        horaApertura = "15:00";
        horaCierre = "03:00";
    }
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const limaMinutes = ((utcHours - 5 + 24) % 24) * 60 + utcMinutes;

    const [openH, openM] = horaApertura.split(":").map(Number);
    const [closeH, closeM] = horaCierre.split(":").map(Number);
    const openMinutes = openH * 60 + (openM || 0);
    const closeMinutes = closeH * 60 + (closeM || 0);

    if (openMinutes === closeMinutes) return true;
    if (closeMinutes < openMinutes) {
        // Cruza la medianoche (ej. 15:00 a 03:00)
        return limaMinutes >= openMinutes || limaMinutes < closeMinutes;
    }
    return limaMinutes >= openMinutes && limaMinutes < closeMinutes;
}

function computeStoreOpenStatus(service) {
    if (!service) return isWithinSchedule();
    // 1. Prioridad máxima: estado fijado manualmente por el administrador
    if (service.estado_cocina_override === true || service.estado_cocina_override === "open") {
        return true;
    }
    if (service.estado_cocina_override === false || service.estado_cocina_override === "closed") {
        return false;
    }
    // 2. Si Supabase devuelve el flag cocina_abierta (personal activo o evaluación remota)
    if (typeof service.cocina_abierta === "boolean") {
        return service.cocina_abierta;
    }
    // 3. Fallback: validación por horario
    return isWithinSchedule(service.hora_apertura, service.hora_cierre);
}

function renderServiceStatusUI(service, isOpen) {
    // 1. Barra operacional principal (cabecera superior)
    const dot = document.querySelector("#kitchen-status-indicator .status-dot");
    const text = document.getElementById("kitchen-status-text");
    if (dot) {
        dot.className = `status-dot ${isOpen ? "is-open" : "is-closed"}`;
    }
    if (text) {
        text.innerHTML = `Cocina: <strong>${isOpen ? "Abierto" : "Cerrado"}</strong>`;
    }

    // 2. Tira secundaria de estado del servicio
    const kitchen = document.getElementById("service-kitchen-status");
    if (kitchen) {
        kitchen.textContent = isOpen ? "Abierto" : "Cerrado";
        kitchen.classList.toggle("is-open", isOpen);
        kitchen.classList.toggle("is-closed", !isOpen);
        kitchen.dataset.live = "true";
    }

    // 3. Horarios oficiales y tiempos de delivery
    const opening = service?.hora_apertura;
    const closing = service?.hora_cierre;
    const hoursEl = document.getElementById("service-hours");
    if (hoursEl) {
        hoursEl.textContent = opening && closing
            ? `${opening.slice(0, 5)} a ${closing.slice(0, 5)}`
            : "3:00 PM a 3:00 AM";
    }
    const deliveryEl = document.getElementById("service-delivery-time");
    if (deliveryEl && service?.tiempo_delivery_min && service?.tiempo_delivery_max) {
        deliveryEl.textContent = `${service.tiempo_delivery_min}–${service.tiempo_delivery_max} min`;
    }

    // 4. Banners de aviso en carta y carrito
    const banner = document.getElementById("store-closed-banner");
    if (banner) banner.hidden = isOpen;
    const cartNotice = document.getElementById("cart-closed-notice");
    if (cartNotice) cartNotice.hidden = isOpen;
}

function applyServiceConfig(service, shouldPersist = true) {
    if (!service) return;
    currentServiceConfig = service;
    const open = computeStoreOpenStatus(service);
    isStoreOpen = open;

    if (shouldPersist) {
        try {
            const toPersist = {
                cocina_abierta: open,
                estado_cocina_override: service.estado_cocina_override ?? null,
                hora_apertura: service.hora_apertura || null,
                hora_cierre: service.hora_cierre || null,
                tiempo_delivery_min: service.tiempo_delivery_min || 35,
                tiempo_delivery_max: service.tiempo_delivery_max || 45,
                updated_at: new Date().toISOString()
            };
            localStorage.setItem(STORE_CONFIG_STORAGE_KEY, JSON.stringify(toPersist));
        } catch (error) {
            console.warn("No se pudo persistir el estado del servicio:", error);
        }
    }

    renderServiceStatusUI(service, isStoreOpen);
    renderMenu();
    renderCart();
}

function getSavedServiceConfig() {
    try {
        const raw = localStorage.getItem(STORE_CONFIG_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function loadServiceStatus() {
    if (!isSupabaseConfigured) return;
    const { data, error } = await supabase.rpc("obtener_estado_servicio");
    if (error) throw error;
    if (!data) throw new Error("Supabase no devolvió el estado del servicio.");
    applyServiceConfig(data, true);
    serviceStatusErrorShown = false;
}

function errorText(error) {
    return error?.message || "Ocurrió un error inesperado. Inténtalo de nuevo.";
}

function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "");
}

function clearAttendanceSession(userId) {
    if (!userId) return;
    try {
        sessionStorage.removeItem(`frygourmett-attendance-started-${userId}`);
    } catch (error) {
        console.warn("No se pudo limpiar el estado de asistencia de la sesión.", error);
    }
}

function loadCart() {
    try {
        const savedCart = sessionStorage.getItem("frygourmett-cart-v2");
        if (!savedCart) return new Map();
        const entries = JSON.parse(savedCart);
        if (!Array.isArray(entries) || !entries.every(([id, quantity]) =>
            typeof id === "string" && Number.isInteger(quantity) && quantity > 0 && quantity <= 99
        )) {
            throw new Error("El carrito guardado tiene un formato no válido.");
        }
        return new Map(entries);
    } catch (error) {
        console.error("No se pudo restaurar el carrito de esta sesión.", error);
        showToast("No pudimos recuperar tu selección anterior.", true);
        return new Map();
    }
}

function customerTabFromHash(hash) {
    let value = hash.replace(/^#/, "").toLocaleLowerCase("es");
    try {
        value = decodeURIComponent(value);
    } catch {
        return "carta";
    }
    if (["carta", "menu", "videos", "para-compartir", "platos-grandes", "grandes", "platos-familiares", "familiares", "platos-alitas", "alitas", "platos-extras", "extras", "platos-especiales", "bebidas", "promo-gourmett", "promo"].includes(value)) return "carta";
    if (["mis-pedidos", "pedidos"].includes(value)) return "pedidos";
    if (["opinion", "opiniones", "calificaciones"].includes(value)) return "calificaciones";
    if (["nosotros", "historia", "experiencia"].includes(value)) return "nosotros";
    return "carta";
}

function scrollToCustomerSection(name) {
    if (name === "carta") {
        document.getElementById("panel-carta")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "pedidos") {
        document.getElementById("panel-pedidos")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "calificaciones") {
        document.getElementById("panel-calificaciones")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "nosotros") {
        (document.getElementById("historia") || document.getElementById("panel-nosotros"))?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "videos") {
        document.getElementById("videos")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "para-compartir") {
        document.getElementById("para-compartir")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "platos-grandes" || name === "grandes") {
        document.getElementById("platos-grandes")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "platos-familiares" || name === "familiares") {
        document.getElementById("platos-familiares")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "platos-alitas" || name === "alitas") {
        document.getElementById("platos-alitas")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "platos-extras" || name === "extras") {
        document.getElementById("platos-extras")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "bebidas") {
        document.getElementById("bebidas")?.scrollIntoView({ behavior: "smooth" });
    } else if (name === "promo-gourmett" || name === "promo") {
        document.getElementById("promo-gourmett")?.scrollIntoView({ behavior: "smooth" });
    } else {
        const el = document.getElementById(name);
        if (el) el.scrollIntoView({ behavior: "smooth" });
    }
}

function activateCustomerTab(name, updateHash = true, shouldScroll = false) {
    const tab = customerTabs.find((item) => item.dataset.customerTab === name);
    if (!tab) return;
    customerTabs.forEach((item) => {
        const active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
    });
    customerPanels.forEach((panel) => {
        const isTarget = panel.dataset.customerPanel === name;
        panel.hidden = !isTarget;
        panel.classList.toggle("hidden", !isTarget);
    });
    if (updateHash && window.location.hash !== `#${name}`) {
        window.history.replaceState(null, "", `#${name}`);
    }
    if (shouldScroll) {
        scrollToCustomerSection(name);
    }
}

customerTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateCustomerTab(tab.dataset.customerTab, true, true));
    tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home" ? 0
            : event.key === "End" ? customerTabs.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + customerTabs.length) % customerTabs.length;
        customerTabs[nextIndex].focus();
        activateCustomerTab(customerTabs[nextIndex].dataset.customerTab, true, true);
    });
});
window.addEventListener("hashchange", () => {
    const rawHash = (window.location.hash || "").replace(/^#/, "");
    const tabName = customerTabFromHash(window.location.hash);
    activateCustomerTab(tabName, false, false);
    if (rawHash === "videos") {
        document.getElementById("videos")?.scrollIntoView({ behavior: "smooth" });
    } else {
        scrollToCustomerSection(rawHash || tabName);
    }
});
const initialRawHash = (window.location.hash || "").replace(/^#/, "");
activateCustomerTab(customerTabFromHash(window.location.hash), false, false);
if (initialRawHash === "videos") {
    window.setTimeout(() => document.getElementById("videos")?.scrollIntoView({ behavior: "smooth" }), 200);
} else if (["para-compartir", "platos-grandes", "platos-familiares", "platos-alitas", "platos-extras", "platos-especiales", "bebidas", "promo-gourmett", "hamburguesas-gourmett", "kid-gourmett", "nuestra-carta"].includes(initialRawHash)) {
    window.setTimeout(() => document.getElementById(initialRawHash)?.scrollIntoView({ behavior: "smooth" }), 200);
} else if (initialRawHash === "grandes") {
    window.setTimeout(() => document.getElementById("platos-grandes")?.scrollIntoView({ behavior: "smooth" }), 200);
} else if (initialRawHash === "familiares") {
    window.setTimeout(() => document.getElementById("platos-familiares")?.scrollIntoView({ behavior: "smooth" }), 200);
} else if (initialRawHash === "alitas") {
    window.setTimeout(() => document.getElementById("platos-alitas")?.scrollIntoView({ behavior: "smooth" }), 200);
} else if (initialRawHash === "extras") {
    window.setTimeout(() => document.getElementById("platos-extras")?.scrollIntoView({ behavior: "smooth" }), 200);
} else if (initialRawHash === "promo" || initialRawHash === "promo-gourmett") {
    window.setTimeout(() => document.getElementById("promo-gourmett")?.scrollIntoView({ behavior: "smooth" }), 200);
} else if (initialRawHash === "hamburguesas" || initialRawHash === "hamburguesas-gourmett") {
    window.setTimeout(() => document.getElementById("hamburguesas-gourmett")?.scrollIntoView({ behavior: "smooth" }), 200);
} else if (initialRawHash === "kid" || initialRawHash === "kids" || initialRawHash === "kid-gourmett" || initialRawHash === "kid-gourmet") {
    window.setTimeout(() => document.getElementById("kid-gourmett")?.scrollIntoView({ behavior: "smooth" }), 200);
}

document.querySelectorAll('a[href="#videos"]').forEach((link) => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        activateCustomerTab("carta", false, false);
        window.history.replaceState(null, "", "#videos");
        document.getElementById("videos")?.scrollIntoView({ behavior: "smooth" });
    });
});

// =========================================================
// CATÁLOGOS LOCALES Y VINCULACIÓN CON SUPABASE
// =========================================================
const SPECIAL_DISHES_CATALOG = [
    {
        name: "Lomo Saltado",
        image: "img/Platos Especiales/Lomo Saltado.jpg",
        defaultPrice: 42.00,
        defaultDesc: "Trozos jugosos de lomo fino salteados al wok con cebolla, tomate, ají amarillo y crocantes papas.",
        prepTime: "15–20 min"
    },
    {
        name: "Alitas BBQ",
        image: "img/Platos Especiales/Alitas BBQ.jpg",
        defaultPrice: 28.00,
        defaultDesc: "Crocantes alitas bañadas en nuestra salsa barbacoa artesanal con toque ahumado especial.",
        prepTime: "12–15 min"
    },
    {
        name: "Papas Rústicas",
        image: "img/Platos Especiales/Papas Rústicas.jpg",
        defaultPrice: 16.00,
        defaultDesc: "Papas nativas cortadas a mano, doradas al punto crocante con hierbas aromáticas y salsas de la casa.",
        prepTime: "10–15 min"
    },
    {
        name: "Estofado",
        image: "img/Platos Especiales/Estofado.jpg",
        defaultPrice: 40.00,
        defaultDesc: "Carne tierna cocida a fuego lento con especias tradicionales, verduras frescas y salsa casera.",
        prepTime: "20–25 min"
    },
    {
        name: "Combo Frygourmett",
        image: "img/Platos Especiales/Combo Frygourmett.jpg",
        defaultPrice: 49.00,
        defaultDesc: "La combinación insignia: alitas crocantes, papas rústicas y selección especial para compartir.",
        prepTime: "15–20 min"
    }
];

const SHARE_DISHES_CATALOG = [
    {
        name: "Fajitas de carne y pollo",
        image: "img/Platos Para Compartir/Fajitas de carne y pollo Para Compartir.jpg",
        defaultPrice: 48.00,
        defaultDesc: "Tiras selectas de carne de res y pechuga de pollo salteadas al wok con pimientos, cebollas y guacamole artesanal.",
        prepTime: "20–25 min"
    },
    {
        name: "Pizza artesanal",
        image: "img/Platos Para Compartir/Pizza artesanal Para Compartir.jpg",
        defaultPrice: 42.00,
        defaultDesc: "Masa fina artesanal horneada a la piedra, salsa pomodoro italiana, abundante queso mozzarella y especias.",
        prepTime: "18–22 min"
    },
    {
        name: "Lasaña con queso",
        image: "img/Platos Para Compartir/Lasaña con queso Para Compartir.jpg",
        defaultPrice: 38.00,
        defaultDesc: "Capas de pasta fresca intercaladas con salsa boloñesa casera, bechamel sedosa y gratinado de queso parmesano.",
        prepTime: "20–25 min"
    },
    {
        name: "Arroz con mariscos",
        image: "img/Platos Para Compartir/Arroz con mariscos Para Compartir.jpg",
        defaultPrice: 46.00,
        defaultDesc: "Arroz criollo al punto con mixtura fresca de mariscos, ají amarillo, culantro, vino blanco y salsa especial.",
        prepTime: "20–25 min"
    },
    {
        name: "Causa limeña",
        image: "img/Platos Para Compartir/Causa limeña Para Compartir.jpg",
        defaultPrice: 36.00,
        defaultDesc: "Delicada masa de papa amarilla sazonada con ají y limón, generoso relleno de pollo, palta fresca y huevo.",
        prepTime: "15–18 min"
    },
    {
        name: "Chicharrón de pescado",
        image: "img/Platos Para Compartir/Chicharrón de pescado Para Compartir.jpg",
        defaultPrice: 44.00,
        defaultDesc: "Trozos crocantes y dorados de pescado del día, servidos con yucas fritas, sarsa criolla y tártara de la casa.",
        prepTime: "15–20 min"
    }
];

const LARGE_DISHES_CATALOG = [
    {
        name: "Arroz Chaufa Especial",
        image: "img/Platos Grandes/Arroz Chaufa Especial.jpg",
        defaultPrice: 34.00,
        defaultDesc: "Arroz salteado al wok al estilo oriental con trozos de pollo, carne, huevo, cebolla china y sillao de primera.",
        prepTime: "15–20 min"
    },
    {
        name: "Arroz con Pollo",
        image: "img/Platos Grandes/Arroz con Pollo.jpg",
        defaultPrice: 32.00,
        defaultDesc: "Clásico arroz al culantro cocinado con cerveza negra, acompañado de presa dorada y salsa criolla fresca.",
        prepTime: "18–22 min"
    },
    {
        name: "Bistec a lo Pobre",
        image: "img/Platos Grandes/Bistec a lo Pobre.jpg",
        defaultPrice: 38.00,
        defaultDesc: "Generoso filete de bistec a la plancha servido con papas fritas crocantes, plátano frito, huevo montado y arroz.",
        prepTime: "15–20 min"
    },
    {
        name: "Churrasco con Papas",
        image: "img/Platos Grandes/Churrasco con Papas.jpg",
        defaultPrice: 36.00,
        defaultDesc: "Corte jugoso de churrasco a las brasas sazonado con especias de la casa, acompañado de papas doradas y ensalada.",
        prepTime: "15–20 min"
    },
    {
        name: "Pollo a la Brasa",
        image: "img/Platos Grandes/Pollo a la Brasa.jpg",
        defaultPrice: 35.00,
        defaultDesc: "1/4 de nuestro auténtico pollo a la brasa dorado y crujiente, servido con papas fritas y cremas artesanales.",
        prepTime: "12–15 min"
    },
    {
        name: "Pollo Broaster",
        image: "img/Platos Grandes/Pollo Broaster.jpg",
        defaultPrice: 28.00,
        defaultDesc: "Crujiente presa de pollo broaster con empanizado especial secreto, papas fritas y ensalada fresca.",
        prepTime: "12–15 min"
    },
    {
        name: "Tallarín Saltado",
        image: "img/Platos Grandes/Tallarín Saltado.jpg",
        defaultPrice: 34.00,
        defaultDesc: "Tallarines criollos salteados al fuego vivo con tiras de carne, tomate, cebolla roja, ají amarillo y cebolla china.",
        prepTime: "15–20 min"
    }
];

const FAMILY_DISHES_CATALOG = [
    {
        name: "Banquete Familiar",
        image: "img/Platos Familiares/Banquete Familiar.jpg",
        defaultPrice: 65.00,
        defaultDesc: "Un festín completo para toda la familia con variedad de carnes selectas, guarniciones y salsas de la casa.",
        prepTime: "25–30 min"
    },
    {
        name: "Chaufa Familiar",
        image: "img/Platos Familiares/Chaufa Familiar.jpg",
        defaultPrice: 52.00,
        defaultDesc: "Fuente abundante de arroz chaufa salteado al wok al fuego vivo con pollo, carne, huevo y cebollita china.",
        prepTime: "20–25 min"
    },
    {
        name: "Combo Familiar de Alitas",
        image: "img/Platos Familiares/Combo Familiar de Alitas.jpg",
        defaultPrice: 58.00,
        defaultDesc: "Generosa porción de alitas crocantes bañadas en nuestras salsas artesanales, acompañadas de papas fritas y cremas.",
        prepTime: "20–25 min"
    },
    {
        name: "Combo Familiar FRYGOURMETT",
        image: "img/Platos Familiares/Combo Familiar FRYGOURMETT.jpg",
        defaultPrice: 68.00,
        defaultDesc: "La especialidad insignia para compartir: pollo crujiente, alitas glaseadas, papas rústicas y bebidas.",
        prepTime: "25–30 min"
    },
    {
        name: "Parrillada Familiar",
        image: "img/Platos Familiares/Parrillada Familiar.jpg",
        defaultPrice: 75.00,
        defaultDesc: "Selectos cortes de carne a las brasas, chuletas, chorizo parrillero, papas doradas y ensalada fresca.",
        prepTime: "25–35 min"
    },
    {
        name: "Pollo a la Brasa Familiar",
        image: "img/Platos Familiares/Pollo a la Brasa Familiar.jpg",
        defaultPrice: 62.00,
        defaultDesc: "1 pollo a la brasa entero sazonado con la receta secreta del chef, papas fritas familiares y cremas artesanales.",
        prepTime: "15–20 min"
    },
    {
        name: "Tallarín Saltado Familiar",
        image: "img/Platos Familiares/Tallarín Saltado Familiar.jpg",
        defaultPrice: 54.00,
        defaultDesc: "Gran fuente de tallarines criollos salteados con tiras de carne tierna, cebolla, tomate, ají amarillo y sillao.",
        prepTime: "20–25 min"
    }
];

const WINGS_DISHES_CATALOG = [
    {
        name: "Alitas Buffalo",
        image: "img/Platos Alitas/Alitas Buffalo.jpg",
        defaultPrice: 28.00,
        defaultDesc: "Alitas bañadas en clásica salsa Buffalo picante con mantequilla clarificada y toque cítrico, servidas con salsa artesanal.",
        prepTime: "12–15 min"
    },
    {
        name: "Alitas Crispy",
        image: "img/Platos Alitas/Alitas Crispy.jpg",
        defaultPrice: 26.00,
        defaultDesc: "Alitas ultra crocantes con empanizado especial sazonado con especias secretas de la casa, doradas a la perfección.",
        prepTime: "12–15 min"
    },
    {
        name: "Alitas FRYGOURMETT",
        image: "img/Platos Alitas/Alitas FRYGOURMETT.jpg",
        defaultPrice: 30.00,
        defaultDesc: "Nuestra receta de autor: marinadas 24 horas y glaseadas con reducción especial de ají amarillo ahumado y miel de maracuyá.",
        prepTime: "15–18 min"
    },
    {
        name: "Alitas Miel Mostaza",
        image: "img/Platos Alitas/Alitas Miel Mostaza.jpg",
        defaultPrice: 28.00,
        defaultDesc: "Alitas doradas glaseadas en suave emulsión de mostaza dijon, miel pura de abeja y un sutil toque especiado.",
        prepTime: "12–15 min"
    },
    {
        name: "Alitas Picantes",
        image: "img/Platos Alitas/Alitas Picantes.jpg",
        defaultPrice: 28.00,
        defaultDesc: "Para amantes del picante intenso: bañadas en salsa de rocoto, ají limo y especias seleccionadas a fuego vivo.",
        prepTime: "12–15 min"
    },
    {
        name: "Alitas Teriyaki",
        image: "img/Platos Alitas/Alitas Teriyaki.jpg",
        defaultPrice: 28.00,
        defaultDesc: "Alitas jugosas bañadas en auténtica salsa teriyaki artesanal reducida con sésamo tostado y toques frescos de jengibre.",
        prepTime: "12–15 min"
    }
];

const EXTRAS_DISHES_CATALOG = [
    {
        name: "Arroz con Papa a la Huancaína",
        image: "img/Extras/Arroz con Papa a la Huancaína.jpg",
        defaultPrice: 16.00,
        defaultDesc: "Porción de arroz blanco graneado servido con papas sancochadas y abundante crema huancaína artesanal de la casa.",
        prepTime: "8–12 min"
    },
    {
        name: "Arroz con Pollo",
        image: "img/Extras/Arroz con Pollo.jpg",
        defaultPrice: 18.00,
        defaultDesc: "Porción extra de clásico arroz con pollo al culantro con toque criollo y sarsa criolla fresca.",
        prepTime: "10–15 min"
    },
    {
        name: "Papa a la Huancaína",
        image: "img/Extras/Papa a la Huancaína.jpg",
        defaultPrice: 14.00,
        defaultDesc: "Rodajas de papa suave bañadas en nuestra cremosa salsa huancaína tradicional con queso fresco y ají amarillo.",
        prepTime: "5–10 min"
    },
    {
        name: "Papas Fritas",
        image: "img/Extras/Papas Fritas.jpg",
        defaultPrice: 12.00,
        defaultDesc: "Porción generosa de papas fritas clásicas, doradas al punto crocante exterior y tiernas por dentro.",
        prepTime: "8–10 min"
    },
    {
        name: "Papas Nativas",
        image: "img/Extras/Papas Nativas.jpg",
        defaultPrice: 14.00,
        defaultDesc: "Papas nativas seleccionadas de los andes peruanos con doble cocción artesanal y toque especial de sal de maras.",
        prepTime: "10–12 min"
    },
    {
        name: "Papas Rústicas",
        image: "img/Extras/Papas Rústicas.jpg",
        defaultPrice: 14.00,
        defaultDesc: "Corte rústico con piel doradas a las finas hierbas aromáticas, acompañadas de nuestras cremas de la casa.",
        prepTime: "10–12 min"
    }
];

const BEVERAGES_CATALOG = [
    {
        name: "Agua San Luis",
        image: "img/Bebidas/Agua san luis.jpg",
        defaultPrice: 5.00,
        presentation: "625 ml",
        defaultDesc: "Agua mineral de mesa natural sin gas, perfectamente fría para acompañar tu plato."
    },
    {
        name: "Inka Cola",
        image: "img/Bebidas/Inka cola.jpg",
        defaultPrice: 7.00,
        presentation: "500 ml",
        defaultDesc: "La bebida de sabor nacional servida bien helada, el acompañamiento tradicional perfecto."
    },
    {
        name: "Chicha Morada",
        image: "img/Bebidas/Chicha Morada.jpg",
        defaultPrice: 8.00,
        presentation: "500 ml",
        defaultDesc: "Elaborada artesanalmente con maíz morado, piña, manzana, canela y clavo de olor."
    },
    {
        name: "Limonada",
        image: "img/Bebidas/Limonada.jpg",
        defaultPrice: 7.50,
        presentation: "500 ml",
        defaultDesc: "Refrescante limonada recién exprimida con limones seleccionados y toque fresco de hierbabuena."
    },
    {
        name: "Coca Cola",
        image: "img/Bebidas/Coca Cola.jpg",
        defaultPrice: 7.00,
        presentation: "500 ml",
        defaultDesc: "Clásica gaseosa servida helada para refrescar cada momento de tu comida."
    }
];

const PROMO_GOURMETT_CATALOG = [
    {
        name: "2x1 Lomo Saltado",
        image: "img/Promo Gourmett/2x1 Lomo Saltado.jpg",
        regularPrice: 84.00,
        promoPrice: 42.00,
        defaultDesc: "Promoción exclusiva 2x1: dos porciones de nuestro lomo fino salteado al wok al precio de uno, con papas crocantes y arroz.",
        prepTime: "15–20 min",
        badge: "2x1"
    },
    {
        name: "Combo Familiar Gourmett",
        image: "img/Promo Gourmett/Combo Familiar Gourmett.jpg",
        regularPrice: 79.00,
        promoPrice: 69.00,
        defaultDesc: "Banquete familiar completo en oferta: pollo a la brasa, papas familiares, ensalada fresca y cremas de la casa.",
        prepTime: "20–25 min",
        badge: "PROMO"
    },
    {
        name: "Combo Gourmett",
        image: "img/Promo Gourmett/Combo Gourmett.jpg",
        regularPrice: 48.00,
        promoPrice: 38.00,
        defaultDesc: "Combinación individual especial: presa crocante, papas nativas, alitas de autor y bebida fría.",
        prepTime: "12–15 min",
        badge: "OFERTA"
    },
    {
        name: "Promo Alitas",
        image: "img/Promo Gourmett/Promo Alitas.jpg",
        regularPrice: 40.00,
        promoPrice: 32.00,
        defaultDesc: "Docena de alitas glaseadas en dos salsas artesanales a elección, con papas fritas y cremas de la casa.",
        prepTime: "12–15 min",
        badge: "PROMO"
    },
    {
        name: "Promo Fin de Semana",
        image: "img/Promo Gourmett/Promo Fin de Semana.jpg",
        regularPrice: 58.00,
        promoPrice: 48.00,
        defaultDesc: "Especial fin de semana: cortes selectos a la parrilla, papas rústicas y guarnición criolla.",
        prepTime: "15–20 min",
        badge: "OFERTA"
    },
    {
        name: "Promo Hamburguesa",
        image: "img/Promo Gourmett/Promo Hamburguesa.jpg",
        regularPrice: 35.00,
        promoPrice: 28.00,
        defaultDesc: "Hamburguesa artesanal premium con queso fundido, tocino crocante, papas fritas y salsa secreta.",
        prepTime: "10–15 min",
        badge: "PROMO"
    },
    {
        name: "Promo para Compartir",
        image: "img/Promo Gourmett/Promo para Compartir.jpg",
        regularPrice: 55.00,
        promoPrice: 45.00,
        defaultDesc: "Surtido especial para dos: tequeños artesanales, alitas crocantes, papas nativas y salsas.",
        prepTime: "15–20 min",
        badge: "PROMO"
    },
    {
        name: "Promo Pareja",
        image: "img/Promo Gourmett/Promo Pareja.jpg",
        regularPrice: 52.00,
        promoPrice: 42.00,
        defaultDesc: "Menú dúo para dos personas con platos de autor, guarnición generosa y dos bebidas heladas.",
        prepTime: "15–20 min",
        badge: "OFERTA"
    }
];

const BURGERS_CATALOG = [
    {
        name: "Hamburguesa Clásica",
        image: "img/Hamburguesas/Hamburguesa Clásica.jpg",
        defaultPrice: 22.00,
        defaultDesc: "Carne de res seleccionada a la parrilla, queso cheddar fundido, lechuga fresca, rodajas de tomate y salsas de la casa.",
        prepTime: "10–15 min",
        badge: "Clásica"
    },
    {
        name: "Hamburguesa BBQ",
        image: "img/Hamburguesas/Hamburguesa BBQ.jpg",
        defaultPrice: 25.00,
        defaultDesc: "Hamburguesa jugosa glaseada en nuestra salsa BBQ ahumada artesanal, cebolla caramelizada y queso cheddar fundido.",
        prepTime: "10–15 min",
        badge: "BBQ Ahumada"
    },
    {
        name: "Hamburguesa Bacon",
        image: "img/Hamburguesas/Hamburguesa Bacon.jpg",
        defaultPrice: 26.00,
        defaultDesc: "Generosas láminas de tocino crocante, carne artesanal a la brasa, queso cheddar derretido y salsa especial Frygourmett.",
        prepTime: "10–15 min",
        badge: "Bacon Crispy"
    },
    {
        name: "Hamburguesa Crispy Chicken",
        image: "img/Hamburguesas/Hamburguesa Crispy Chicken.jpg",
        defaultPrice: 24.00,
        defaultDesc: "Pechuga de pollo marinada con empanizado extra crocante, lechuga fresca, pepinillos dulces y mayonesa de la casa.",
        prepTime: "10–15 min",
        badge: "Crispy Chicken"
    },
    {
        name: "Hamburguesa Doble Gourmett",
        image: "img/Hamburguesas/Hamburguesa Doble Gourmett.jpg",
        defaultPrice: 32.00,
        defaultDesc: "Doble medallón de carne de res premium, doble queso cheddar fundido, tocino ahumado y reducción de autor.",
        prepTime: "12–18 min",
        badge: "Doble Carne"
    },
    {
        name: "Hamburguesa Parrillera",
        image: "img/Hamburguesas/Hamburguesa Parrillera.jpg",
        defaultPrice: 28.00,
        defaultDesc: "Carne artesanal al carbón con chorizo parrillero artesanal laminado, chimichurri de la casa y queso fundido.",
        prepTime: "12–18 min",
        badge: "Parrillera"
    },
    {
        name: "Hamburguesa Royal",
        image: "img/Hamburguesas/Hamburguesa Royal.jpg",
        defaultPrice: 26.00,
        defaultDesc: "Medallón artesanal a la brasa con huevo montado a punto inglés, jamón ahumado, queso cheddar y papas al hilo.",
        prepTime: "10–15 min",
        badge: "Royal"
    },
    {
        name: "Combo Hamburguesa Gourmett",
        image: "img/Hamburguesas/Combo Hamburguesa Gourmett.jpg",
        defaultPrice: 35.00,
        defaultDesc: "Hamburguesa artesanal premium acompañada de abundante porción de papas fritas doradas crocantes y bebida fría de 500 ml.",
        prepTime: "12–18 min",
        isCombo: true,
        badge: "COMBO"
    }
];

const KIDS_CATALOG = [
    {
        name: "Mini Hamburguesa Gourmett",
        image: "img/Kid Gourmett/Mini Hamburguesa Gourmett.jpg",
        defaultPrice: 18.00,
        defaultDesc: "Jugosa hamburguesa artesanal en pan brioche suave, queso cheddar derretido y papas fritas doradas.",
        prepTime: "10–12 min",
        badge: "Kids Favorito"
    },
    {
        name: "Mini Pizza",
        image: "img/Kid Gourmett/Mini Pizza.jpg",
        defaultPrice: 16.00,
        defaultDesc: "Masa artesanal crujiente con salsa pomodoro de la casa, abundante queso mozzarella fundido y toque suave de orégano.",
        prepTime: "10–15 min",
        badge: "Artesanal"
    },
    {
        name: "Mini Salchipapa",
        image: "img/Kid Gourmett/Mini Salchipapa.jpg",
        defaultPrice: 15.00,
        defaultDesc: "Papas crocantes seleccionadas servidas con salchicha frankfurter en rodajas doradas y cremas de la casa.",
        prepTime: "8–12 min",
        badge: "Clásico Kids"
    },
    {
        name: "Papas Kids",
        image: "img/Kid Gourmett/Papas Kids.jpg",
        defaultPrice: 12.00,
        defaultDesc: "Porción de papas fritas doraditas cortadas al estilo bastón, suaves por dentro y con el toque justo de sal.",
        prepTime: "8–10 min",
        badge: "Guarnición"
    },
    {
        name: "Pollo Crispy Kids",
        image: "img/Kid Gourmett/Pollo Crispy Kids.jpg",
        defaultPrice: 18.00,
        defaultDesc: "Tiras de pechuga de pollo extra crocantes con empanizado especial dorado, acompañadas de papas y salsa dulce.",
        prepTime: "10–12 min",
        badge: "Extra Crispy"
    },
    {
        name: "Combo Kid Gourmett",
        image: "img/Kid Gourmett/Combo Kid Gourmett.jpg",
        defaultPrice: 24.00,
        defaultDesc: "Mini hamburguesa gourmet acompañada de papitas crocantes, bebida refrescante y sorpresa dulce.",
        prepTime: "12–15 min",
        isCombo: true,
        badge: "COMBO"
    },
    {
        name: "Combo Kids Especial",
        image: "img/Kid Gourmett/Combo Kids Especial.jpg",
        defaultPrice: 26.00,
        defaultDesc: "Combinado especial de tiras de pollo crispy con mini pizza personal, papas doradas y bebida natural.",
        prepTime: "12–15 min",
        isCombo: true,
        badge: "COMBO"
    }
];

function findProductInDatabase(name) {
    if (!Array.isArray(products) || products.length === 0) return null;
    const norm = (str) => (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const target = norm(name);
    let match = products.find((p) => norm(p.nombre) === target);
    if (match) return match;
    match = products.find((p) => {
        const pName = norm(p.nombre);
        return pName.includes(target) || target.includes(pName);
    });
    return match || null;
}

function isCategoryMatch(productCategory, selectedCategory) {
    if (!productCategory || !selectedCategory) return false;
    const norm = (str) => (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const pCat = norm(productCategory);
    const sCat = norm(selectedCategory);
    if (sCat === "todas" || pCat === "todas") return true;
    if (pCat === sCat) return true;
    if (pCat.includes(sCat) || sCat.includes(pCat)) return true;

    if (sCat.includes("para compartir") || sCat.includes("compartir")) {
        return pCat.includes("compartir") || pCat.includes("familiar") || pCat.includes("combo");
    }
    if (sCat.includes("grande")) {
        return pCat.includes("grande") || pCat.includes("principal");
    }
    if (sCat.includes("familiar")) {
        return pCat.includes("familiar") || pCat.includes("combo");
    }
    if (sCat.includes("alita")) {
        return pCat.includes("alita");
    }
    if (sCat.includes("extra")) {
        return pCat.includes("extra") || pCat.includes("guarnicion") || pCat.includes("porcion");
    }
    if (sCat.includes("bebid")) {
        return pCat.includes("bebid") || pCat.includes("refresc") || pCat.includes("gaseos");
    }
    if (sCat.includes("promo")) {
        return pCat.includes("promo") || pCat.includes("combo") || pCat.includes("especial");
    }
    if (sCat.includes("hamburguesa") || sCat.includes("burger")) {
        return pCat.includes("hamburguesa") || pCat.includes("burger");
    }
    if (sCat.includes("kid") || sCat.includes("nino") || sCat.includes("infantil")) {
        return pCat.includes("kid") || pCat.includes("nino") || pCat.includes("infantil");
    }
    return false;
}

function getCategoryItems(baseCatalog, categoryKeywords) {
    const list = [...baseCatalog];
    const catalogNames = new Set(baseCatalog.map((c) => (c.name || "").toLowerCase().trim()));
    if (Array.isArray(products) && products.length > 0) {
        products.forEach((p) => {
            const pName = (p.nombre || "").toLowerCase().trim();
            const pCat = (p.categoria || "").toLowerCase();
            const matchesCategory = categoryKeywords.some((kw) => pCat.includes(kw));
            if (matchesCategory && !catalogNames.has(pName)) {
                list.push({
                    name: p.nombre,
                    image: p.imagen_url || "img/delifrygour.webp",
                    defaultPrice: Number(p.precio || 0),
                    regularPrice: Number(p.precio_regular || p.precio_anterior || p.precio || 0),
                    promoPrice: Number(p.precio || 0),
                    defaultDesc: p.descripcion || "Plato de autor recién preparado con insumos seleccionados.",
                    prepTime: p.tiempo_preparacion || "15–20 min",
                    badge: /combo/i.test(p.categoria) ? "COMBO" : "Nuevo",
                    isCombo: /combo/i.test(p.categoria),
                    fromDatabase: true
                });
                catalogNames.add(pName);
            }
        });
    }
    return list;
}

function renderCategories() {
    const categories = ["Todas", ...CATEGORIAS];
    document.getElementById("category-filters").innerHTML = categories.map((category) => {
        const isActive = activeCategory === category || (activeCategory !== "Todas" && isCategoryMatch(category, activeCategory));
        return `<button type="button" class="category-filter${isActive ? " is-active" : ""}"
            data-category="${escapeHtml(category)}" aria-pressed="${isActive}">${escapeHtml(category)}</button>`;
    }).join("");
    updateCategoryCardsActiveState();
}

function updateCategoryCardsActiveState() {
    const norm = (str) => (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const activeNorm = norm(activeCategory);

    document.querySelectorAll("[data-category-card]").forEach((card) => {
        const cardCat = card.dataset.categoryCard;
        const isMatch = activeNorm !== "todas" && (isCategoryMatch(cardCat, activeCategory) || isCategoryMatch(activeCategory, cardCat));
        card.classList.toggle("is-active", isMatch);
        card.setAttribute("aria-pressed", String(isMatch));
    });
}

function filterByCategory(categoryName) {
    const norm = (str) => (str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const targetNorm = norm(categoryName);

    // Si la categoría pulsada ya está activa, alternar a "Todas"
    const activeNorm = norm(activeCategory);
    if (activeNorm === targetNorm || (targetNorm !== "todas" && (isCategoryMatch(activeCategory, targetNorm) || isCategoryMatch(targetNorm, activeCategory)))) {
        activeCategory = "Todas";
    } else {
        const existingCategories = [...new Set(products.map((p) => p.categoria).filter(Boolean))];
        const matched = existingCategories.find((c) => isCategoryMatch(c, categoryName));
        activeCategory = matched || categoryName;
    }

    renderCategories();
    renderMenu();
    updateCategoryCardsActiveState();

    // Desplazamiento suave hacia la sección correspondiente o la carta
    if (targetNorm.includes("compartir")) {
        if (window.location.hash !== "#para-compartir") {
            window.history.replaceState(null, "", "#para-compartir");
        }
        const shareSection = document.getElementById("para-compartir");
        if (shareSection) {
            shareSection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
    }

    if (targetNorm.includes("grande")) {
        if (window.location.hash !== "#platos-grandes") {
            window.history.replaceState(null, "", "#platos-grandes");
        }
        const largeSection = document.getElementById("platos-grandes");
        if (largeSection) {
            largeSection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
    }

    if (targetNorm.includes("familiar")) {
        if (window.location.hash !== "#platos-familiares") {
            window.history.replaceState(null, "", "#platos-familiares");
        }
        const familySection = document.getElementById("platos-familiares");
        if (familySection) {
            familySection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
    }

    if (targetNorm.includes("alita")) {
        if (window.location.hash !== "#platos-alitas") {
            window.history.replaceState(null, "", "#platos-alitas");
        }
        const wingsSection = document.getElementById("platos-alitas");
        if (wingsSection) {
            wingsSection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
    }

    if (targetNorm.includes("extra")) {
        if (window.location.hash !== "#platos-extras") {
            window.history.replaceState(null, "", "#platos-extras");
        }
        const extrasSection = document.getElementById("platos-extras");
        if (extrasSection) {
            extrasSection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
    }

    if (targetNorm.includes("bebida")) {
        if (window.location.hash !== "#bebidas") {
            window.history.replaceState(null, "", "#bebidas");
        }
        const bevSection = document.getElementById("bebidas");
        if (bevSection) {
            bevSection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
    }

    if (targetNorm.includes("promo")) {
        if (window.location.hash !== "#promo-gourmett") {
            window.history.replaceState(null, "", "#promo-gourmett");
        }
        const promoSection = document.getElementById("promo-gourmett");
        if (promoSection) {
            promoSection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
    }

    if (targetNorm.includes("hamburguesa") || targetNorm.includes("burger")) {
        if (window.location.hash !== "#hamburguesas-gourmett") {
            window.history.replaceState(null, "", "#hamburguesas-gourmett");
        }
        const burgersSection = document.getElementById("hamburguesas-gourmett");
        if (burgersSection) {
            burgersSection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
    }

    if (targetNorm.includes("kid") || targetNorm.includes("nino") || targetNorm.includes("infantil")) {
        if (window.location.hash !== "#kid-gourmett") {
            window.history.replaceState(null, "", "#kid-gourmett");
        }
        const kidsSection = document.getElementById("kid-gourmett");
        if (kidsSection) {
            kidsSection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
    }

    const menuAnchor = document.getElementById("nuestra-carta") || document.getElementById("category-filters");
    if (menuAnchor) {
        menuAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function renderShareDishes() {
    const track = document.getElementById("share-dishes-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(SHARE_DISHES_CATALOG, ["compartir"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const prepTime = dbProduct?.tiempo_preparacion || item.prepTime;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;
            const price = dbProduct ? Number(dbProduct.precio) : item.defaultPrice;

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            return `
            <article class="horizontal-dish-card snap-start${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        <span class="dish-badge dish-badge-popular bg-amber-400 text-neutral-950 font-extrabold uppercase text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <i class="fa-solid fa-users text-[9px]" aria-hidden="true"></i> Compartir
                        </span>
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                        <span aria-hidden="true">⏱</span> ${escapeHtml(prepTime)}
                    </span>
                </div>
                <div class="dish-copy">
                    <div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <strong class="dish-price">${formatCurrency(price)}</strong>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar platos para compartir:", err);
    }
}

function renderLargeDishes() {
    const track = document.getElementById("large-dishes-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(LARGE_DISHES_CATALOG, ["grande"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const prepTime = dbProduct?.tiempo_preparacion || item.prepTime;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;
            const price = dbProduct ? Number(dbProduct.precio) : item.defaultPrice;

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            return `
            <article class="horizontal-dish-card snap-start${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        <span class="dish-badge dish-badge-popular bg-amber-400 text-neutral-950 font-extrabold uppercase text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <i class="fa-solid fa-utensils text-[9px]" aria-hidden="true"></i> Grande
                        </span>
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                        <span aria-hidden="true">⏱</span> ${escapeHtml(prepTime)}
                    </span>
                </div>
                <div class="dish-copy">
                    <div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <strong class="dish-price">${formatCurrency(price)}</strong>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar platos grandes:", err);
    }
}

function renderFamilyDishes() {
    const track = document.getElementById("family-dishes-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(FAMILY_DISHES_CATALOG, ["familiar"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const prepTime = dbProduct?.tiempo_preparacion || item.prepTime;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;
            const price = dbProduct ? Number(dbProduct.precio) : item.defaultPrice;

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            return `
            <article class="horizontal-dish-card snap-start${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        <span class="dish-badge dish-badge-popular bg-amber-400 text-neutral-950 font-extrabold uppercase text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <i class="fa-solid fa-users text-[9px]" aria-hidden="true"></i> Familiar
                        </span>
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                        <span aria-hidden="true">⏱</span> ${escapeHtml(prepTime)}
                    </span>
                </div>
                <div class="dish-copy">
                    <div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <strong class="dish-price">${formatCurrency(price)}</strong>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar platos familiares:", err);
    }
}

function renderWingsDishes() {
    const track = document.getElementById("wings-dishes-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(WINGS_DISHES_CATALOG, ["alita"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const prepTime = dbProduct?.tiempo_preparacion || item.prepTime;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;
            const price = dbProduct ? Number(dbProduct.precio) : item.defaultPrice;

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            return `
            <article class="horizontal-dish-card snap-start${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        <span class="dish-badge dish-badge-popular bg-amber-400 text-neutral-950 font-extrabold uppercase text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <i class="fa-solid fa-fire text-[9px]" aria-hidden="true"></i> Alitas
                        </span>
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                        <span aria-hidden="true">⏱</span> ${escapeHtml(prepTime)}
                    </span>
                </div>
                <div class="dish-copy">
                    <div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <strong class="dish-price">${formatCurrency(price)}</strong>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar alitas:", err);
    }
}

function renderExtrasDishes() {
    const track = document.getElementById("extras-dishes-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(EXTRAS_DISHES_CATALOG, ["extra", "guarnicion"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const prepTime = dbProduct?.tiempo_preparacion || item.prepTime;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;
            const price = dbProduct ? Number(dbProduct.precio) : item.defaultPrice;

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            return `
            <article class="horizontal-dish-card snap-start${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        <span class="dish-badge dish-badge-popular bg-amber-400 text-neutral-950 font-extrabold uppercase text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <i class="fa-solid fa-plus-circle text-[9px]" aria-hidden="true"></i> Extra
                        </span>
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                        <span aria-hidden="true">⏱</span> ${escapeHtml(prepTime)}
                    </span>
                </div>
                <div class="dish-copy">
                    <div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <strong class="dish-price">${formatCurrency(price)}</strong>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar extras:", err);
    }
}

function renderSpecialDishes() {
    const track = document.getElementById("special-dishes-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(SPECIAL_DISHES_CATALOG, ["especial"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const prepTime = dbProduct?.tiempo_preparacion || item.prepTime;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;
            const price = dbProduct ? Number(dbProduct.precio) : item.defaultPrice;

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            return `
            <article class="horizontal-dish-card snap-start${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        <span class="dish-badge dish-badge-popular bg-amber-400 text-neutral-950 font-extrabold uppercase text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <i class="fa-solid fa-star text-[9px]" aria-hidden="true"></i> Especial
                        </span>
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                        <span aria-hidden="true">⏱</span> ${escapeHtml(prepTime)}
                    </span>
                </div>
                <div class="dish-copy">
                    <div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <strong class="dish-price">${formatCurrency(price)}</strong>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar platos especiales:", err);
    }
}

function renderBeverages() {
    const track = document.getElementById("beverages-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(BEVERAGES_CATALOG, ["bebida", "refresc", "gaseos"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;
            const price = dbProduct ? Number(dbProduct.precio) : item.defaultPrice;
            const presentacion = item.presentation || "500 ml";

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            return `
            <article class="horizontal-dish-card snap-start${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        <span class="beverage-presentation-pill">${escapeHtml(presentacion)}</span>
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                </div>
                <div class="dish-copy">
                    <div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <strong class="dish-price">${formatCurrency(price)}</strong>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar bebidas:", err);
    }
}

function renderPromoDishes() {
    const track = document.getElementById("promo-dishes-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(PROMO_GOURMETT_CATALOG, ["promo", "combo"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const prepTime = dbProduct?.tiempo_preparacion || item.prepTime;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;

            // Soporte para estructura comercial: precio regular y promocional
            const regularPrice = Number(dbProduct?.precio_regular || dbProduct?.precio_anterior || item.regularPrice || 0);
            const promoPrice = Number(dbProduct?.precio_promocional || dbProduct?.precio || item.promoPrice || 0);

            // Cálculo dinámico de ahorro y porcentaje de descuento
            const ahorro = Number(dbProduct?.ahorro || (regularPrice > promoPrice ? (regularPrice - promoPrice) : 0));
            const calculatedPercent = regularPrice > promoPrice ? Math.round(((regularPrice - promoPrice) / regularPrice) * 100) : 0;
            const discountPercent = Number(dbProduct?.descuento_porcentaje || calculatedPercent);

            const is2x1 = item.badge === "2x1";
            const badgeClass = is2x1 ? "bg-rose-600 text-white" : "bg-amber-400 text-neutral-950";
            const badgeIcon = is2x1 ? "fa-tag" : "fa-bolt";

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            return `
            <article class="horizontal-dish-card snap-start${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        <span class="dish-badge ${badgeClass} font-extrabold uppercase text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                            <i class="fa-solid ${badgeIcon} text-[9px]" aria-hidden="true"></i> ${escapeHtml(item.badge)}
                        </span>
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                        <span aria-hidden="true">⏱</span> ${escapeHtml(prepTime)}
                    </span>
                </div>
                <div class="dish-copy">
                    <div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <div class="dish-promo-pricing">
                                ${regularPrice > promoPrice ? `
                                    <div class="dish-regular-price-row flex items-center gap-1.5 leading-none">
                                        <span class="dish-regular-price">${formatCurrency(regularPrice)}</span>
                                        ${!is2x1 && discountPercent > 0 ? `<span class="dish-discount-badge">-${discountPercent}%</span>` : ""}
                                    </div>
                                ` : ""}
                                <strong class="dish-price">${formatCurrency(promoPrice)}</strong>
                                ${ahorro > 0 ? `
                                    <span class="dish-savings">
                                        Ahorras ${formatCurrency(ahorro)}${is2x1 ? ' <span class="text-rose-400 font-extrabold ml-1">· 2x1</span>' : ""}
                                    </span>
                                ` : ""}
                            </div>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar promociones:", err);
    }
}

function renderBurgersDishes() {
    const track = document.getElementById("burgers-dishes-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(BURGERS_CATALOG, ["hamburguesa", "burger"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const prepTime = dbProduct?.tiempo_preparacion || item.prepTime;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;
            const price = dbProduct ? Number(dbProduct.precio) : item.defaultPrice;
            const isCombo = Boolean(item.isCombo || (dbProduct?.categoria && /combo/i.test(dbProduct.categoria)));

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            const badgeHtml = isCombo
                ? `<span class="dish-badge dish-badge-combo flex items-center gap-1 shadow-sm">
                    <i class="fa-solid fa-fire text-[9px]" aria-hidden="true"></i> COMBO
                   </span>`
                : `<span class="dish-badge bg-neutral-900/90 text-amber-400 border border-amber-500/30 font-bold uppercase text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                    <i class="fa-solid fa-burger text-[9px]" aria-hidden="true"></i> ${escapeHtml(item.badge || "Artesanal")}
                   </span>`;

            return `
            <article class="horizontal-dish-card snap-start${isCombo ? " is-combo-card" : ""}${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        ${badgeHtml}
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                        <span aria-hidden="true">⏱</span> ${escapeHtml(prepTime)}
                    </span>
                </div>
                <div class="dish-copy">
                    <div>
                        <div class="dish-header-meta flex items-center justify-between text-xs mb-1">
                            <span class="dish-category font-bold uppercase tracking-wider text-[10px] text-amber-500">Hamburguesas</span>
                        </div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <strong class="dish-price">${formatCurrency(price)}</strong>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar hamburguesas:", err);
    }
}

function renderKidsDishes() {
    const track = document.getElementById("kids-dishes-track");
    if (!track) return;

    try {
        track.innerHTML = getCategoryItems(KIDS_CATALOG, ["kid", "infantil", "nino", "niño"]).map((item) => {
            const dbProduct = findProductInDatabase(item.name);
            const isSoldOut = dbProduct ? isProductSoldOut(dbProduct) : false;
            const isLowStock = dbProduct ? isProductLowStock(dbProduct) : false;
            const atCartLimit = dbProduct ? isProductAtCartLimit(dbProduct) : false;
            const prepTime = dbProduct?.tiempo_preparacion || item.prepTime;
            const imgSrc = resolveImage(item.image);
            const title = dbProduct?.nombre || item.name;
            const desc = dbProduct?.descripcion || item.defaultDesc;
            const price = dbProduct ? Number(dbProduct.precio) : item.defaultPrice;
            const isCombo = Boolean(item.isCombo || (dbProduct?.categoria && /combo/i.test(dbProduct.categoria)));

            const buttonHtml = dbProduct
                ? `<button type="button" class="dish-add-btn" data-add-to-cart="${escapeHtml(dbProduct.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                    ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`
                : `<button type="button" class="dish-add-btn" data-pending-dish="${escapeHtml(item.name)}"${!isStoreOpen ? " disabled" : ""}>
                    ${!isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                   </button>`;

            const badgeHtml = isCombo
                ? `<span class="dish-badge dish-badge-combo flex items-center gap-1 shadow-sm">
                    <i class="fa-solid fa-fire text-[9px]" aria-hidden="true"></i> COMBO
                   </span>`
                : `<span class="dish-badge bg-neutral-900/90 text-amber-400 border border-amber-500/30 font-bold uppercase text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                    <i class="fa-solid fa-shapes text-[9px]" aria-hidden="true"></i> ${escapeHtml(item.badge || "Kids")}
                   </span>`;

            return `
            <article class="horizontal-dish-card snap-start${isCombo ? " is-combo-card" : ""}${isSoldOut ? " is-sold-out" : ""}">
                <div class="dish-image-wrap">
                    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(title)}" loading="lazy">
                    <div class="dish-badges-overlay absolute top-2.5 left-2.5 z-10 flex flex-wrap gap-1">
                        ${badgeHtml}
                        ${isSoldOut ? '<span class="dish-badge stock-badge-soldout">Agotado</span>' : isLowStock ? '<span class="dish-badge stock-badge-low">Últimas unds.</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                        <span aria-hidden="true">⏱</span> ${escapeHtml(prepTime)}
                    </span>
                </div>
                <div class="dish-copy">
                    <div>
                        <div class="dish-header-meta flex items-center justify-between text-xs mb-1">
                            <span class="dish-category font-bold uppercase tracking-wider text-[10px] text-amber-500">Kid Gourmett</span>
                        </div>
                        <h3 class="dish-title">${escapeHtml(title)}</h3>
                        <p class="dish-desc">${escapeHtml(desc)}</p>
                    </div>
                    <div class="dish-footer">
                        <div class="dish-price-block">
                            <strong class="dish-price">${formatCurrency(price)}</strong>
                        </div>
                        ${buttonHtml}
                    </div>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar platos para niños:", err);
    }
}

function setupExploreCategories() {
    document.querySelectorAll("[data-category-card]").forEach((card) => {
        const handler = (e) => {
            e.preventDefault();
            const cat = card.dataset.categoryCard;
            filterByCategory(cat);
        };
        card.addEventListener("click", handler);
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                handler(e);
            }
        });
    });

    const track = document.getElementById("categories-carousel-track");
    document.getElementById("cat-carousel-prev")?.addEventListener("click", () => {
        track?.scrollBy({ left: -260, behavior: "smooth" });
    });
    document.getElementById("cat-carousel-next")?.addEventListener("click", () => {
        track?.scrollBy({ left: 260, behavior: "smooth" });
    });
}

function setupHorizontalCarousels() {
    const shareTrack = document.getElementById("share-dishes-track");
    document.getElementById("share-carousel-prev")?.addEventListener("click", () => {
        shareTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("share-carousel-next")?.addEventListener("click", () => {
        shareTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    const largeTrack = document.getElementById("large-dishes-track");
    document.getElementById("large-carousel-prev")?.addEventListener("click", () => {
        largeTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("large-carousel-next")?.addEventListener("click", () => {
        largeTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    const familyTrack = document.getElementById("family-dishes-track");
    document.getElementById("family-carousel-prev")?.addEventListener("click", () => {
        familyTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("family-carousel-next")?.addEventListener("click", () => {
        familyTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    const wingsTrack = document.getElementById("wings-dishes-track");
    document.getElementById("wings-carousel-prev")?.addEventListener("click", () => {
        wingsTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("wings-carousel-next")?.addEventListener("click", () => {
        wingsTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    const extrasTrack = document.getElementById("extras-dishes-track");
    document.getElementById("extras-carousel-prev")?.addEventListener("click", () => {
        extrasTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("extras-carousel-next")?.addEventListener("click", () => {
        extrasTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    const specTrack = document.getElementById("special-dishes-track");
    document.getElementById("spec-carousel-prev")?.addEventListener("click", () => {
        specTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("spec-carousel-next")?.addEventListener("click", () => {
        specTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    const bevTrack = document.getElementById("beverages-track");
    document.getElementById("bev-carousel-prev")?.addEventListener("click", () => {
        bevTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("bev-carousel-next")?.addEventListener("click", () => {
        bevTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    const promoTrack = document.getElementById("promo-dishes-track");
    document.getElementById("promo-carousel-prev")?.addEventListener("click", () => {
        promoTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("promo-carousel-next")?.addEventListener("click", () => {
        promoTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    const burgersTrack = document.getElementById("burgers-dishes-track");
    document.getElementById("burgers-carousel-prev")?.addEventListener("click", () => {
        burgersTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("burgers-carousel-next")?.addEventListener("click", () => {
        burgersTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    const kidsTrack = document.getElementById("kids-dishes-track");
    document.getElementById("kids-carousel-prev")?.addEventListener("click", () => {
        kidsTrack?.scrollBy({ left: -300, behavior: "smooth" });
    });
    document.getElementById("kids-carousel-next")?.addEventListener("click", () => {
        kidsTrack?.scrollBy({ left: 300, behavior: "smooth" });
    });

    shareTrack?.addEventListener("click", handleAddToCartClick);
    largeTrack?.addEventListener("click", handleAddToCartClick);
    familyTrack?.addEventListener("click", handleAddToCartClick);
    wingsTrack?.addEventListener("click", handleAddToCartClick);
    extrasTrack?.addEventListener("click", handleAddToCartClick);
    specTrack?.addEventListener("click", handleAddToCartClick);
    bevTrack?.addEventListener("click", handleAddToCartClick);
    promoTrack?.addEventListener("click", handleAddToCartClick);
    burgersTrack?.addEventListener("click", handleAddToCartClick);
    kidsTrack?.addEventListener("click", handleAddToCartClick);
}

function handleAddToCartClick(event) {
    const pendingButton = event.target.closest("[data-pending-dish]");
    if (pendingButton) {
        if (!isStoreOpen) {
            showToast("La tienda se encuentra cerrada en este momento.", true);
            return;
        }
        const dishName = pendingButton.dataset.pendingDish || "Este producto";
        showToast(`${dishName} estará disponible muy pronto para pedidos en línea.`);
        return;
    }
    const button = event.target.closest("[data-add-to-cart]");
    if (!button || !button.dataset.addToCart) return;
    if (!isStoreOpen) {
        showToast("La tienda se encuentra cerrada en este momento. No se pueden agregar productos.", true);
        return;
    }
    const productId = button.dataset.addToCart;
    const product = products.find((item) => item.id === productId && item.disponible);
    if (!product) {
        showToast("Este plato ya no está disponible. Actualiza la carta.", true);
        return;
    }
    if (isProductSoldOut(product)) {
        showToast("Este plato está agotado.", true);
        return;
    }
    const portions = resolveProductPortions(product);
    const currentQty = cart.get(product.id) || 0;
    if (portions !== null && currentQty >= portions) {
        showToast(`Solo quedan ${portions} porciones disponibles.`, true);
        return;
    }
    if (currentQty >= 99) {
        showToast("Has alcanzado el límite máximo permitido para este plato.", true);
        return;
    }
    cart.set(product.id, currentQty + 1);
    renderCart();
    showToast(`${product.nombre} añadido a tu pedido.`);
}

function getProductPortions(productId) {
    const recipes = productRecipes.filter((r) => r.producto_id === productId);
    if (!recipes.length) return null; // Sin receta asociada -> disponibilidad estándar

    let minPortions = Infinity;
    for (const r of recipes) {
        const ing = ingredientsStock.find((i) => i.id === r.ingrediente_id);
        const stockQty = Number(ing?.cantidad || 0);
        const reqQty = Number(r.cantidad_por_porcion || 1);
        const possible = reqQty > 0 ? Math.floor(stockQty / reqQty) : 0;
        if (possible < minPortions) minPortions = possible;
    }
    return Number.isFinite(minPortions) ? Math.max(0, minPortions) : null;
}

function resolveProductPortions(product) {
    if (!product) return null;
    const calculated = getProductPortions(product.id);
    if (calculated !== null) return calculated;
    if (product.porciones_disponibles !== null && product.porciones_disponibles !== undefined) {
        const num = Number(product.porciones_disponibles);
        return Number.isFinite(num) ? num : null;
    }
    return null;
}

function isProductSoldOut(product) {
    if (!product || !product.disponible) return true;
    const portions = resolveProductPortions(product);
    if (portions !== null && portions <= 0) return true;
    return false;
}

function isProductAtCartLimit(product) {
    if (!product) return false;
    const portions = resolveProductPortions(product);
    const inCart = cart.get(product.id) || 0;
    if (portions !== null) {
        return inCart >= portions;
    }
    return inCart >= 99;
}

function isProductLowStock(product) {
    if (!product) return false;
    const portions = resolveProductPortions(product);
    return portions !== null && portions > 0 && portions <= 5;
}

function renderMenu() {
    const query = document.getElementById("menu-search").value.trim().toLocaleLowerCase("es");
    const visibleProducts = products.filter((product) => product.disponible
        && (activeCategory === "Todas" || isCategoryMatch(product.categoria, activeCategory))
        && `${product.nombre} ${product.descripcion} ${product.categoria}`.toLocaleLowerCase("es").includes(query));

    menuGrid.innerHTML = visibleProducts.length
        ? visibleProducts.map((product, index) => {
            const portions = resolveProductPortions(product);
            const isSoldOut = isProductSoldOut(product);
            const isLowStock = portions !== null && portions > 0 && portions <= 5;
            const atCartLimit = isProductAtCartLimit(product);

            // Etiquetas y extras
            const prepTime = product.tiempo_preparacion || "15–20 min";
            const isPopular = product.es_popular || index < 2;

            let badgeMarkup = '<span class="dish-badge">Recién preparado</span>';
            if (isSoldOut) {
                badgeMarkup = '<span class="dish-badge stock-badge-soldout">Agotado</span>';
            } else if (isLowStock) {
                badgeMarkup = '<span class="dish-badge stock-badge-low">Últimas unidades</span>';
            }

            const availabilityText = isSoldOut
                ? "Agotado"
                : isLowStock
                    ? "Últimas unidades"
                    : null;

            return `<article class="guest-dish-card rounded-2xl overflow-hidden border shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col group${isSoldOut ? " is-sold-out" : ""}" style="--item-index: ${index};">
                <div class="dish-image-wrap relative h-48 overflow-hidden">
                    ${isVideoAsset(product.imagen_url)
                    ? `<video src="${escapeHtml(resolveImage(product.imagen_url))}" controls muted playsinline preload="metadata" poster="${escapeHtml(resolveImage("img/delifrygour.webp"))}" aria-label="Video de ${escapeHtml(product.nombre)}" class="w-full h-full object-cover"></video>`
                    : `<img src="${escapeHtml(resolveImage(product.imagen_url || "img/delifrygour.webp"))}" alt="${escapeHtml(product.nombre)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">`}
                    <div class="dish-badges-overlay absolute top-3 left-3 z-10 flex flex-wrap gap-1.5">
                        ${badgeMarkup}
                        ${isPopular && !isSoldOut ? '<span class="dish-badge dish-badge-popular bg-amber-400 text-neutral-950 text-[11px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1"><i class="fa-solid fa-star text-[10px]"></i> Popular</span>' : ""}
                    </div>
                    <span class="dish-prep-time absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full font-medium backdrop-blur-sm" title="Tiempo de preparación estimado"><span aria-hidden="true">⏱</span> ${prepTime}</span>
                </div>
                <div class="guest-dish-copy p-5 flex-1 flex flex-col justify-between">
                    <div>
                        <div class="dish-header-meta flex items-center justify-between text-xs mb-1">
                            <span class="dish-category font-bold uppercase tracking-wider text-[10px]">${escapeHtml(product.categoria || "Gourmet")}</span>
                            ${availabilityText ? `<span class="dish-availability text-[11px] font-medium ${isSoldOut ? "text-red-500 font-semibold" : isLowStock ? "text-amber-500 font-semibold" : "text-emerald-500"}">${availabilityText}</span>` : ""}
                        </div>
                        <h3 class="dish-title font-extrabold text-base mb-1 transition-colors">${escapeHtml(product.nombre)}</h3>
                        <p class="dish-desc text-xs leading-relaxed mb-4">${escapeHtml(product.descripcion || "Elaborado con técnica de alta cocina e ingredientes frescos seleccionados.")}</p>
                    </div>
                    <div class="dish-card-footer flex items-center justify-between pt-3">
                        <div class="dish-price-block">
                            <span class="dish-price-label block text-[10px] uppercase font-bold">Precio</span>
                            <strong class="dish-price text-lg font-black">${formatCurrency(product.precio)}</strong>
                        </div>
                        <button type="button" class="dish-add-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors" data-add-to-cart="${escapeHtml(product.id)}"${isSoldOut || atCartLimit || !isStoreOpen ? " disabled" : ""}>
                            ${isSoldOut ? "Agotado" : !isStoreOpen ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir'}
                        </button>
                    </div>
                </div>
            </article>`;
        }).join("")
        : `<div class="menu-empty"><strong>${products.length ? "No encontramos platos con ese filtro." : "Carta en preparación."}</strong><p>${products.length ? "Prueba otra categoría o término de búsqueda." : "El chef publicará aquí los platos disponibles en cuanto conecte la base de datos."}</p></div>`;
}

function selectedPaymentMethod() {
    return checkoutForm.querySelector('input[name="metodo_pago"]:checked')?.value || "yape";
}

function updateCashChange(total = Number(document.getElementById("cart-total").dataset.total || 0)) {
    const amountInput = document.getElementById("cash-amount");
    const estimate = document.getElementById("cash-change-estimate");
    if (!amountInput || !estimate) return;

    const rawAmount = amountInput.value.trim();
    const amount = Number(rawAmount);
    amountInput.setCustomValidity("");

    if (selectedPaymentMethod() !== "efectivo" || !rawAmount) {
        estimate.textContent = "Indica el importe para calcular el vuelto.";
        return;
    }
    if (!Number.isFinite(amount) || amount < total) {
        amountInput.setCustomValidity("El importe debe ser igual o superior al total del pedido.");
        estimate.textContent = `El importe debe cubrir el total de ${formatCurrency(total)}.`;
        return;
    }
    estimate.textContent = `Vuelto estimado: ${formatCurrency(amount - total)}.`;
}

function updatePaymentDetails() {
    const method = selectedPaymentMethod();
    const prepaidMethods = ["yape", "plin", "transferencia_interbank", "interbank"];
    const cashDetail = document.getElementById("cash-payment-detail");
    const digitalHint = document.getElementById("digital-payment-hint");
    const transferDetail = document.getElementById("transfer-payment-detail");
    const selectedLabel = document.getElementById("selected-payment-label");

    if (cashDetail) cashDetail.hidden = method !== "efectivo";
    if (digitalHint) digitalHint.hidden = !prepaidMethods.includes(method);
    if (transferDetail) transferDetail.hidden = !prepaidMethods.includes(method);
    if (selectedLabel) {
        const paymentLabels = { yape: "Yape", plin: "Plin", transferencia_interbank: "Interbank", interbank: "Interbank" };
        selectedLabel.textContent = paymentLabels[method] || "Yape";
    }
    checkoutForm.querySelectorAll(".payment-option").forEach((label) => {
        const radio = label.querySelector('input[name="metodo_pago"]');
        label.classList.toggle("is-selected", Boolean(radio && radio.checked));
    });
    updateCashChange();
}

function updateKitchenStatus() {
    // Si hay un override manual fijado por el administrador, se respeta estrictamente sin alterar por horario
    if (currentServiceConfig && currentServiceConfig.estado_cocina_override !== null && currentServiceConfig.estado_cocina_override !== undefined) {
        renderServiceStatusUI(currentServiceConfig, isStoreOpen);
        return;
    }
    const open = computeStoreOpenStatus(currentServiceConfig);
    if (open !== isStoreOpen) {
        applyServiceConfig({
            ...(currentServiceConfig || {}),
            cocina_abierta: open
        }, true);
    } else {
        renderServiceStatusUI(currentServiceConfig, isStoreOpen);
    }
}

function renderCart() {
    const entries = [...cart.entries()].map(([id, quantity]) => ({
        product: products.find((item) => item.id === id),
        quantity
    })).filter((item) => item.product);

    cartItemsElement.innerHTML = entries.length
        ? entries.map(({ product, quantity }) => `<article class="cart-item">
            <div class="cart-item-copy"><strong>${escapeHtml(product.nombre)}</strong><small>${formatCurrency(product.precio)} c/u</small></div>
            <div class="cart-item-actions">
                <div class="cart-quantity">
                    <button type="button" data-cart-change="${escapeHtml(product.id)}" data-change="-1" aria-label="Quitar una unidad de ${escapeHtml(product.nombre)}">−</button>
                    <span>${quantity}</span>
                    <button type="button" data-cart-change="${escapeHtml(product.id)}" data-change="1" aria-label="Añadir una unidad de ${escapeHtml(product.nombre)}">+</button>
                </div>
                <button class="cart-remove" type="button" data-remove-cart="${escapeHtml(product.id)}">Eliminar</button>
            </div>
        </article>`).join("")
        : '<p class="cart-empty">Aún no has elegido ningún plato.</p>';

    const count = entries.reduce((sum, item) => sum + item.quantity, 0);
    const total = entries.reduce((sum, item) => sum + Number(item.product.precio) * item.quantity, 0);
    document.getElementById("cart-count").textContent = count;
    document.getElementById("cart-total").textContent = formatCurrency(total);
    document.getElementById("cart-total").dataset.total = String(total);

    const submitBtn = document.getElementById("submit-order");
    if (submitBtn) {
        if (!isStoreOpen) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Tienda cerrada";
        } else {
            submitBtn.disabled = !count;
            submitBtn.textContent = "Confirmar pedido";
        }
    }

    const mobileCart = document.getElementById("mobile-cart-bar");
    const mobileCount = document.getElementById("mobile-cart-count");
    const mobileTotal = document.getElementById("mobile-cart-total");
    if (mobileCart) {
        mobileCart.hidden = !count;
        if (mobileCount) mobileCount.textContent = `🛒 ${count} ${count === 1 ? "producto" : "productos"}`;
        if (mobileTotal) mobileTotal.textContent = formatCurrency(total);
    }
    document.querySelectorAll("[data-add-to-cart]").forEach((button) => {
        if (!button.dataset.addToCart) return;
        const product = products.find((item) => item.id === button.dataset.addToCart);
        if (!product) return;
        const isSoldOut = isProductSoldOut(product);
        const atCartLimit = isProductAtCartLimit(product);
        const isStoreClosed = !isStoreOpen;
        button.disabled = isSoldOut || atCartLimit || isStoreClosed;
        button.innerHTML = isSoldOut ? "Agotado" : isStoreClosed ? "Tienda cerrada" : '<i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i> Añadir';
    });
    updateCashChange(total);
    try {
        sessionStorage.setItem("frygourmett-cart-v2", JSON.stringify([...cart.entries()]));
    } catch (error) {
        console.error("No se pudo guardar el carrito de esta sesión.", error);
        showToast("El carrito no se conservará si cierras esta pestaña.", true);
    }
}

function updateReviewOptions() {
    const ratingOrder = document.getElementById("rating-order");
    const available = orders.filter((order) => order.estado === "Entregado" && !order.isRated);
    ratingOrder.innerHTML = available.length
        ? `<option value="">Selecciona un pedido</option>${available.map((order) =>
            `<option value="${escapeHtml(order.id)}">#${escapeHtml(order.id.slice(0, 8).toLocaleUpperCase("es"))} · ${escapeHtml(order.items.map((item) => item.nombre).join(", "))}</option>`
        ).join("")}`
        : `<option value="">${activeUser ? "No hay pedidos entregados pendientes de calificar" : "Inicia sesión para consultar tus pedidos"}</option>`;
    ratingOrder.disabled = !available.length;
    document.querySelector("#customer-rating-form button[type='submit']").disabled = !available.length;
}

function renderOrders() {
    document.getElementById("orders-for-label").textContent = activeUser
        ? `Pedidos de ${activeName}`
        : "Inicia sesión para consultar tus entregas.";
    const list = document.getElementById("customer-orders-list");
    if (!activeUser) {
        list.innerHTML = `<div class="customer-empty-state">
            <strong>Tu pedido, siempre a la vista</strong>
            <p>Accede con tu correo y contraseña para consultar tus entregas.</p>
        </div>`;
        return;
    }
    if (!orders.length) {
        list.innerHTML = `<div class="customer-empty-state">
            <strong>Aún no tienes pedidos</strong>
            <p>Explora la carta y elige tu primer plato de alta cocina.</p>
        </div>`;
        return;
    }
    list.innerHTML = orders.map((order) => {
        const label = (order.id || "").slice(0, 8).toLocaleUpperCase("es");
        let itemsList = [];
        if (Array.isArray(order.items)) {
            itemsList = order.items;
        } else if (typeof order.items === "string") {
            try { itemsList = JSON.parse(order.items); } catch { }
        }
        const items = itemsList.length
            ? itemsList.map((item) => `${item.cantidad || item.quantity || 1} × ${item.nombre || item.name || "Plato"}`).join(", ")
            : "Detalle de platos";
        const payment = order.payment;
        const paymentMethods = ["yape", "plin", "transferencia_interbank", "yape_plin"];
        const paymentAction = !paymentMethods.includes(order.metodo_pago)
            ? ""
            : payment?.status === "paid"
                ? '<p class="customer-payment-status is-paid">✓ Pago verificado</p>'
                : payment?.status === "pending_verification" && payment.proof_url
                    ? '<p class="customer-payment-status">⏳ Comprobante enviado · pendiente de revisión</p>'
                    : `<button type="button" class="customer-pay-link" data-pay-order="${escapeHtml(order.id)}"
                        data-payment-id="${payment?.status === "pending_verification" ? escapeHtml(payment.id) : ""}"
                        data-payment-method="${escapeHtml(payment?.payment_method || order.metodo_pago)}">
                        ${payment?.status === "failed" ? "Reintentar pago" : "Completar pago"}
                    </button>`;

        let statusClass = "status-pending";
        if (order.estado === "Entregado") statusClass = "status-delivered";
        else if (order.estado === "En camino") statusClass = "status-transit";
        else if (order.estado === "En preparación" || order.estado === "Listo") statusClass = "status-prep";

        return `<article class="customer-order-card">
            <div class="customer-order-summary">
                <div class="customer-order-header-info">
                    <span class="customer-order-ref">#${escapeHtml(label)}</span>
                    <small class="customer-order-date">${escapeHtml(formatOrderDate(order.created_at))}</small>
                </div>
                <div class="customer-order-dish">${escapeHtml(items)}</div>
                <div class="customer-order-total">${formatCurrency(order.total)}</div>
                <div class="customer-order-status-wrap">
                    <span class="customer-order-status ${statusClass}">${escapeHtml(order.estado || "Pendiente")}</span>
                </div>
            </div>
            <p class="customer-delivery-address">
                <strong>Entrega:</strong> ${escapeHtml(order.direccion_entrega || "En local")}${order.distrito_zona ? `, ${escapeHtml(order.distrito_zona)}` : ""} · 
                <strong>Contacto:</strong> ${escapeHtml(order.telefono_contacto || "Sin teléfono registrado")}
            </p>
            ${paymentAction}
            ${order.estado === "Entregado" && !order.isRated ? `<button type="button" class="order-rate-link" data-rate-order="${escapeHtml(order.id)}">★ Calificar este pedido</button>` : ""}
        </article>`;
    }).join("");
}

function formatOrderDate(value) {
    return new Intl.DateTimeFormat("es-ES", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    }).format(new Date(value));
}

async function loadRecipeData() {
    try {
        const [recipeRes, stockRes] = await Promise.all([
            supabase.from("producto_insumos").select("producto_id, ingrediente_id, cantidad_por_porcion"),
            supabase.from("ingredientes").select("id, nombre, cantidad")
        ]);
        if (!recipeRes.error && recipeRes.data) productRecipes = recipeRes.data;
        if (!stockRes.error && stockRes.data) ingredientsStock = stockRes.data;
    } catch (e) {
        console.warn("Recetas o inventario no accesibles en modo comensal:", e);
    }
}

async function loadProducts() {
    await loadRecipeData();
    const { data, error } = await supabase.from("productos")
        .select("id, nombre, descripcion, precio, categoria, imagen_url, disponible, porciones_disponibles, tiempo_preparacion, precio_regular")
        .eq("disponible", true)
        .order("categoria")
        .order("nombre");
    if (error) throw error;
    products = data || [];
    let adjustedCart = false;
    for (const id of cart.keys()) {
        const product = products.find((item) => item.id === id);
        const isSoldOut = isProductSoldOut(product);
        const portions = resolveProductPortions(product);
        if (!product || isSoldOut) {
            cart.delete(id);
            adjustedCart = true;
        } else if (portions !== null && cart.get(id) > portions) {
            cart.set(id, portions);
            adjustedCart = true;
        }
    }
    renderCategories();
    renderMenu();
    renderShareDishes();
    renderLargeDishes();
    renderFamilyDishes();
    renderWingsDishes();
    renderExtrasDishes();
    renderSpecialDishes();
    renderBeverages();
    renderPromoDishes();
    renderBurgersDishes();
    renderKidsDishes();
    updateCategoryCardsActiveState();
    renderCart();
    if (adjustedCart) showToast("Actualizamos tu carrito según el inventario disponible.", true);
}

async function loadPromotions() {
    try {
        const { data, error } = await supabase.from("promociones")
            .select("id, titulo, descripcion, tipo_media, media_url, orden")
            .eq("activa", true)
            .order("orden")
            .order("created_at");
        if (!error && data && data.length > 0) {
            promotions = data;
            carouselIndex = 0;
            renderCarousel();
        }
    } catch (e) {
        console.warn("No se pudieron cargar promociones desde Supabase:", e);
    }
}

async function loadCustomerData() {
    if (!activeUser) return;
    const userEmail = (activeUser.email || "").toLowerCase().trim();
    let orderQuery = supabase.from("pedidos").select("*");
    if (activeUser.id && userEmail) {
        orderQuery = orderQuery.or(`cliente_id.eq.${activeUser.id},cliente_email.ilike.${userEmail}`);
    } else {
        orderQuery = orderQuery.eq("cliente_id", activeUser.id);
    }
    const [orderResult, reviewResult] = await Promise.all([
        orderQuery.order("created_at", { ascending: false }),
        supabase.from("opiniones").select("pedido_id").eq("cliente_id", activeUser.id)
    ]);
    if (orderResult.error) {
        console.error("Error consultando pedidos:", orderResult.error);
        throw orderResult.error;
    }
    const customerOrders = orderResult.data || [];
    const paymentsByOrder = new Map();
    if (customerOrders.length) {
        try {
            const { data: paymentRows, error: paymentError } = await supabase
                .from("payments")
                .select("id, order_id, payment_method, status, proof_url, created_at")
                .in("order_id", customerOrders.map((order) => order.id))
                .order("created_at", { ascending: false });
            if (!paymentError && paymentRows) {
                for (const payment of paymentRows) {
                    if (!paymentsByOrder.has(payment.order_id)) paymentsByOrder.set(payment.order_id, payment);
                }
            }
        } catch (paymentErr) {
            console.warn("No se pudieron cargar pagos de los pedidos:", paymentErr);
        }
    }
    const ratedOrderIds = new Set((reviewResult.data || []).map((review) => review.pedido_id));
    orders = customerOrders.map((order) => ({
        ...order,
        isRated: ratedOrderIds.has(order.id),
        payment: paymentsByOrder.get(order.id) || null
    }));
    renderOrders();
    updateReviewOptions();
}

function setAuthMode(mode) {
    authMode = mode;
    const isSignup = mode === "signup";
    const nameLabel = document.getElementById("customer-name-label");
    const phoneLabel = document.getElementById("customer-phone-label");
    if (nameLabel) nameLabel.hidden = !isSignup;
    if (phoneLabel) phoneLabel.hidden = !isSignup;
    customerForm.elements.customerName.required = isSignup;
    customerForm.elements.customerPhone.required = isSignup;
    customerForm.elements.customerPassword.autocomplete = isSignup ? "new-password" : "current-password";
    customerForm.querySelector("button[type='submit']").textContent = isSignup ? "Crear cuenta" : "Iniciar sesión";
    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
        const active = button.dataset.authMode === mode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

async function setCustomerSession(user, profile = null) {
    if (notificationCleanup) {
        notificationCleanup();
        notificationCleanup = null;
    }
    if (!user && activeUser?.id) clearAttendanceSession(activeUser.id);
    activeUser = user;
    if (user && !profile) {
        try {
            const resolved = await resolveUserRole(user);
            profile = resolved.profile;
        } catch (e) {
            console.warn("No se pudo resolver el perfil del usuario:", e);
        }
    }
    activeProfile = profile;
    activeName = profile?.nombre || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Comensal";
    const phone = profile?.telefono || user?.user_metadata?.phone || "";
    customerForm.hidden = Boolean(user);
    const modeTabs = document.querySelector(".auth-mode-tabs");
    if (modeTabs) modeTabs.hidden = Boolean(user);
    const clearBtn = document.getElementById("clear-customer");
    if (clearBtn) clearBtn.hidden = !user;

    const loginTrigger = document.getElementById("guest-login-trigger");
    if (loginTrigger) loginTrigger.hidden = Boolean(user);
    const notificationControl = document.getElementById("customer-notification-control");
    if (notificationControl) notificationControl.hidden = !user || profile?.activo === false;

    const userMenu = document.getElementById("guest-user-menu");
    const userLabel = document.getElementById("guest-user-label");
    const panelLink = document.getElementById("guest-panel-link");
    if (userMenu && userLabel) {
        userMenu.hidden = !user;
        if (user) {
            const isStaff = profile?.rol && profile.rol !== "cliente" && profile.activo !== false;
            const roleBadge = isStaff ? ` [${ROLE_LABELS[profile.rol] || profile.rol}]` : "";
            userLabel.textContent = `${activeName}${roleBadge}`;
            if (panelLink) {
                panelLink.hidden = !isStaff;
                if (isStaff) panelLink.href = getRoleRedirect(profile.rol);
            }
        }
    }

    const drawerGuest = document.getElementById("drawer-guest-block");
    const drawerAuth = document.getElementById("drawer-auth-block");
    const drawerName = document.getElementById("drawer-user-name");
    const drawerPanelLink = document.getElementById("drawer-panel-link");
    if (drawerGuest && drawerAuth) {
        drawerGuest.hidden = Boolean(user);
        drawerAuth.hidden = !user;
        if (user) {
            const isStaff = profile?.rol && profile.rol !== "cliente" && profile.activo !== false;
            if (drawerName) drawerName.textContent = `${activeName} (${ROLE_LABELS[profile?.rol] || "Personal"})`;
            if (drawerPanelLink) {
                drawerPanelLink.hidden = !isStaff;
                if (isStaff) drawerPanelLink.href = getRoleRedirect(profile.rol);
            }
        }
    }

    document.getElementById("order-hint").textContent = user
        ? "Tu pedido se registra en cocina con los datos de entrega que indiques."
        : "Inicia sesión para confirmar el pedido y guardarlo en cocina.";
    if (user && phone && checkoutForm?.elements?.telefono_contacto) {
        checkoutForm.elements.telefono_contacto.value = phone;
    }
    setStatus(user
        ? `Sesión activa para ${user.email}. Tus pedidos se sincronizan con Supabase.`
        : "Inicia sesión para ver tus pedidos y confirmar una entrega.");
    renderOrders();
    renderCart();
    updateReviewOptions();

    if (activeOrderChannel) {
        await supabase.removeChannel(activeOrderChannel);
        activeOrderChannel = null;
    }
    if (!user) return;

    if (profile?.activo !== false) {
        notificationCleanup = setupNotifications({
            userId: user.id,
            role: normalizeRole(profile?.rol) || "cliente",
            buttonId: "customer-notification-button",
            panelId: "customer-role-notifications",
            listId: "customer-role-notification-list",
            countId: "customer-notification-count",
            onError: (error) => showToast(`No se pudieron sincronizar las notificaciones: ${errorText(error)}`, true)
        });
    }

    activeOrderChannel = supabase.channel(`customer-orders-${user.id}`)
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "pedidos",
            filter: `cliente_id=eq.${user.id}`
        }, () => loadCustomerData().catch((error) => showToast(`No se pudo actualizar el pedido: ${errorText(error)}`, true)))
        .subscribe((status) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                showToast("No pudimos mantener la actualización en tiempo real de tus pedidos.", true);
            }
        });
    try {
        await loadCustomerData();
    } catch (error) {
        showToast(`No pudimos cargar tus pedidos: ${errorText(error)}`, true);
    }
}

function renderCarousel() {
    const track = document.getElementById("carousel-track");
    if (!track) return;
    track.hidden = false;
    track.classList.remove("hidden");

    const bgsEl = document.getElementById("hero-bgs");
    if (bgsEl) {
        bgsEl.innerHTML = promotions.map((promotion, index) => {
            const isVideo = isVideoAsset(promotion.media_url) || promotion.tipo_media === "video";
            const bgPath = promotion.bg_url || (isVideo ? (promotion.poster_url || "img/promo.avif") : promotion.media_url);
            const bgSrc = escapeHtml(resolveImage(bgPath));
            const activeClass = index === carouselIndex ? " is-active" : "";
            return `<img src="${bgSrc}" alt="" class="${activeClass.trim()}" loading="${index === 0 ? "eager" : "lazy"}">`;
        }).join("");
    }

    const slides = promotions.map((promotion, index) => {
        const isVideo = isVideoAsset(promotion.media_url) || promotion.tipo_media === "video";
        const mediaSrc = escapeHtml(resolveImage(promotion.media_url));
        const posterSrc = escapeHtml(resolveImage(promotion.poster_url || "img/promo.avif"));
        const isActive = index === carouselIndex;
        const ar = promotion.aspect_ratio || (isVideo ? 0.5625 : 1);
        const glow = promotion.glow || (isVideo ? "#ef4444" : "#f59e0b");
        const tag = escapeHtml(promotion.tag || "Cocina de autor · Frygourmett");
        const shortName = promotion.short_name || String(promotion.titulo || "Destacado").split(/[.,]/)[0].slice(0, 18);
        const ctaLabel = escapeHtml(promotion.cta_label || "Pedir ahora");
        const ctaHref = escapeHtml(promotion.cta_href || "#carta");
        const secLabel = escapeHtml(promotion.secondary_label || (isVideo ? "Ver nuestra cocina" : "Ver la carta"));
        const secHref = escapeHtml(promotion.secondary_href || (isVideo ? "#videos" : "#carta"));
        const isTel = ctaHref.startsWith("tel:");

        let titleHtml = "";
        if (promotion.titleHtml) {
            titleHtml = `<h1 class="pm-slide-title">${promotion.titleHtml}</h1>`;
        } else {
            const words = String(promotion.titulo || "Destacado").trim().split(/\s+/);
            const splitAt = Math.max(1, Math.ceil(words.length / 2));
            const firstHalf = escapeHtml(words.slice(0, splitAt).join(" "));
            const secondHalf = escapeHtml(words.slice(splitAt).join(" "));
            titleHtml = `<h1 class="pm-slide-title">${firstHalf}${secondHalf ? ` <em>${secondHalf}</em>` : ""}</h1>`;
        }

        const priceBadge = promotion.price
            ? `<div class="pm-price-badge"><small>Desde</small>S/ ${escapeHtml(String(promotion.price))}</div>`
            : "";

        return `<article class="carousel-slide${isActive ? " is-active" : ""}" data-carousel-slide aria-hidden="${!isActive}" aria-label="${escapeHtml(shortName)}">
            <div class="pm-slide-copy">
                <span class="pm-slide-tag"><i></i>${tag}</span>
                ${titleHtml}
                <p class="pm-slide-desc">${escapeHtml(promotion.descripcion || "Papas nativas con doble cocción, alitas glaseadas y reducciones artesanales.")}</p>
                <div class="pm-slide-actions">
                    <a class="pm-btn-primary" href="${ctaHref}">
                        ${isTel ? '<i class="fa-solid fa-phone text-xs" aria-hidden="true"></i>' : ""}
                        <span>${ctaLabel}</span>
                        ${!isTel ? '<i class="fa-solid fa-arrow-right text-xs" aria-hidden="true"></i>' : ""}
                    </a>
                    <a class="pm-btn-ghost" href="${secHref}">
                        ${isVideo ? '<i class="fa-solid fa-play text-[10px]" aria-hidden="true"></i>' : ""}
                        <span>${secLabel}</span>
                    </a>
                </div>
            </div>
            <div class="pm-slide-stage">
                <div class="pm-slide-card" style="--ar:${ar};--glow:${escapeHtml(glow)}">
                    ${isVideo
                        ? `<video src="${mediaSrc}" ${isActive ? "autoplay" : ""} muted loop playsinline preload="metadata" poster="${posterSrc}"></video>`
                        : `<img src="${mediaSrc}" alt="${escapeHtml(promotion.titulo)}" loading="${index === 0 ? "eager" : "lazy"}">`
                    }
                    ${priceBadge}
                </div>
            </div>
        </article>`;
    }).join("");

    track.innerHTML = slides;
    const hasMultiple = promotions.length > 1;
    const prevBtn = document.getElementById("carousel-previous");
    const nextBtn = document.getElementById("carousel-next");
    const dotsEl = document.getElementById("carousel-dots");
    if (prevBtn) prevBtn.hidden = !hasMultiple;
    if (nextBtn) nextBtn.hidden = !hasMultiple;
    if (dotsEl) {
        dotsEl.innerHTML = hasMultiple
            ? promotions.map((promotion, index) => {
                const shortName = promotion.short_name || String(promotion.titulo || "Destacado").split(/[.,]/)[0].slice(0, 18);
                const num = String(index + 1).padStart(2, "0");
                return `<button type="button" class="carousel-dot${index === carouselIndex ? " is-active" : ""}" data-carousel-dot="${index}" aria-label="Mostrar ${escapeHtml(shortName)}" aria-pressed="${index === carouselIndex}"><b></b>${num} <span>${escapeHtml(shortName)}</span></button>`;
            }).join("")
            : "";
    }
    showCarouselSlide(carouselIndex);
    resetCarouselTimer();
}

function showCarouselSlide(index) {
    const slides = [...document.querySelectorAll("[data-carousel-slide]")];
    if (!slides.length) return;
    carouselIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
        const active = slideIndex === carouselIndex;
        slide.classList.toggle("is-active", active);
        slide.setAttribute("aria-hidden", String(!active));
        const video = slide.querySelector("video");
        if (video) {
            if (active) {
                video.currentTime = 0;
                video.play().catch(() => { });
            } else {
                video.pause();
            }
        }
    });
    document.querySelectorAll("#hero-bgs img").forEach((img, bgIndex) => {
        img.classList.toggle("is-active", bgIndex === carouselIndex);
    });
    document.querySelectorAll("[data-carousel-dot]").forEach((dot) => {
        const active = Number(dot.dataset.carouselDot) === carouselIndex;
        dot.classList.remove("is-active");
        if (active) {
            void dot.offsetWidth;
            dot.classList.add("is-active");
        }
        dot.setAttribute("aria-pressed", String(active));
    });
}

function resetCarouselTimer() {
    window.clearInterval(carouselTimer);
    const carouselEl = document.getElementById("featured-carousel");
    if (carouselEl) {
        carouselEl.classList.toggle("is-paused", Boolean(carouselPaused));
    }
    const slideCount = document.querySelectorAll("[data-carousel-slide]").length;
    if (slideCount < 2 || carouselPaused || document.hidden
        || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    carouselTimer = window.setInterval(() => showCarouselSlide(carouselIndex + 1), 7000);
}

// Renderizar inmediatamente las promociones locales al cargar el script
promotions = [...LOCAL_FEATURED_PROMOTIONS];
carouselIndex = 0;
renderCarousel();

const carouselPrevBtn = document.getElementById("carousel-previous");
if (carouselPrevBtn) {
    carouselPrevBtn.addEventListener("click", (e) => {
        e.preventDefault();
        showCarouselSlide(carouselIndex - 1);
        resetCarouselTimer();
    });
}
const carouselNextBtn = document.getElementById("carousel-next");
if (carouselNextBtn) {
    carouselNextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        showCarouselSlide(carouselIndex + 1);
        resetCarouselTimer();
    });
}
const carouselDotsEl = document.getElementById("carousel-dots");
if (carouselDotsEl) {
    carouselDotsEl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-carousel-dot]");
        if (!button) return;
        event.preventDefault();
        showCarouselSlide(Number(button.dataset.carouselDot));
        resetCarouselTimer();
    });
}
const carousel = document.getElementById("featured-carousel");
carousel.addEventListener("mouseenter", () => {
    carouselPaused = true;
    resetCarouselTimer();
});
carousel.addEventListener("mouseleave", () => {
    carouselPaused = false;
    resetCarouselTimer();
});
carousel.addEventListener("focusin", () => {
    carouselPaused = true;
    resetCarouselTimer();
});
carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) {
        carouselPaused = false;
        resetCarouselTimer();
    }
});
carousel.addEventListener("pointerdown", (event) => {
    pointerStart = event.clientX;
});
carousel.addEventListener("pointerup", (event) => {
    if (pointerStart === null) return;
    const delta = event.clientX - pointerStart;
    pointerStart = null;
    if (Math.abs(delta) < 45) return;
    showCarouselSlide(carouselIndex + (delta < 0 ? 1 : -1));
    resetCarouselTimer();
});
carousel.addEventListener("pointercancel", () => { pointerStart = null; });
document.addEventListener("visibilitychange", resetCarouselTimer);
renderCarousel();

document.getElementById("category-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    activeCategory = button.dataset.category;
    renderCategories();
    renderMenu();
    updateCategoryCardsActiveState();
});
document.getElementById("menu-search").addEventListener("input", renderMenu);
menuGrid.addEventListener("click", handleAddToCartClick);

// Inicializar carruseles horizontales y categorías
setupExploreCategories();
setupHorizontalCarousels();
renderShareDishes();
renderLargeDishes();
renderFamilyDishes();
renderWingsDishes();
renderExtrasDishes();
renderSpecialDishes();
renderBeverages();
renderPromoDishes();
renderBurgersDishes();
renderKidsDishes();
updateCategoryCardsActiveState();

cartItemsElement.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-cart]");
    if (removeButton) {
        cart.delete(removeButton.dataset.removeCart);
        renderCart();
        return;
    }
    const button = event.target.closest("[data-cart-change]");
    if (!button) return;
    const id = button.dataset.cartChange;
    const nextQuantity = (cart.get(id) || 0) + Number(button.dataset.change);
    if (nextQuantity <= 0) cart.delete(id);
    else {
        const product = products.find((item) => item.id === id);
        const portions = resolveProductPortions(product);
        const maxAllowed = portions !== null ? Math.min(99, portions) : 99;
        if (nextQuantity > maxAllowed) {
            showToast(portions !== null ? `Solo quedan ${portions} porciones disponibles.` : "No puedes superar las 99 unidades.", true);
            return;
        }
        cart.set(id, nextQuantity);
    }
    renderCart();
});

function setCartOpen(isOpen) {
    const panel = document.getElementById("cart-panel");
    if (!panel) return;
    const openCartBtn = document.getElementById("open-cart");
    if (openCartBtn) openCartBtn.setAttribute("aria-expanded", String(isOpen));
    panel.hidden = !isOpen;
    if (isOpen) {
        activateCustomerTab("carta", true, false);
        updatePaymentDetails();
        panel.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}
const openCartTrigger = document.getElementById("open-cart");
if (openCartTrigger) {
    openCartTrigger.addEventListener("click", () => {
        const panel = document.getElementById("cart-panel");
        setCartOpen(panel ? panel.hidden : true);
    });
}
const closeCartTrigger = document.getElementById("close-cart");
if (closeCartTrigger) {
    closeCartTrigger.addEventListener("click", () => setCartOpen(false));
}
const mobileCartBar = document.getElementById("mobile-cart-bar");
if (mobileCartBar) {
    mobileCartBar.addEventListener("click", () => setCartOpen(true));
}

checkoutForm.querySelectorAll('input[name="metodo_pago"]').forEach((input) => {
    input.addEventListener("change", updatePaymentDetails);
});
document.getElementById("cash-amount").addEventListener("input", () => updateCashChange());
updatePaymentDetails();

checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isStoreOpen) {
        showToast("La tienda se encuentra cerrada en este momento. No es posible procesar el pedido.", true);
        return;
    }
    if (!activeUser) {
        activateCustomerTab("pedidos");
        showToast("Inicia sesión para confirmar tu pedido.", true);
        customerForm.elements.customerEmail.focus();
        return;
    }
    updatePaymentDetails();
    if (!checkoutForm.reportValidity()) return;
    const items = [...cart.entries()].map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
    if (!items.length) return;
    const button = document.getElementById("submit-order");
    button.disabled = true;
    button.textContent = "Confirmando pedido...";
    try {
        const data = new FormData(checkoutForm);
        const metodoPago = String(data.get("metodo_pago"));
        const cashAmount = data.get("monto_entregado") ? Number(data.get("monto_entregado")) : null;
        const total = Number(document.getElementById("cart-total").dataset.total || 0);

        const detallesPago = metodoPago === "efectivo"
            ? {
                metodo: "efectivo",
                monto_entregado: cashAmount,
                vuelto_estimado: cashAmount && cashAmount > total ? cashAmount - total : 0
            }
            : {
                metodo: metodoPago,
                estado_pago: "pendiente_de_comprobante"
            };

        const { data: createdOrder, error } = await supabase.from("pedidos").insert({
            cliente_id: activeUser.id,
            cliente_nombre: activeName,
            cliente_email: activeUser.email,
            telefono_contacto: String(data.get("telefono_contacto")).trim(),
            direccion_entrega: String(data.get("direccion_entrega")).trim(),
            distrito_zona: String(data.get("distrito_zona")).trim(),
            referencia: String(data.get("referencia")).trim(),
            metodo_pago: metodoPago,
            detalles_pago: detallesPago,
            items,
            nota: String(data.get("nota") || "").trim()
        }).select().single();

        if (error) throw error;

        cart.clear();
        if (checkoutForm.elements.nota) checkoutForm.elements.nota.value = "";
        if (checkoutForm.elements.monto_entregado) checkoutForm.elements.monto_entregado.value = "";
        renderCart();
        updatePaymentDetails();
        await loadCustomerData();
        setCartOpen(false);

        activateCustomerTab("pedidos");
        if (["yape", "plin", "transferencia_interbank", "interbank"].includes(metodoPago)) {
            showToast("Pedido registrado. Completa el pago para que el equipo lo valide.");
            try {
                activePaymentCheckout = mountManualPaymentCheckout({
                    orderId: createdOrder.id,
                    totalAmount: Number(createdOrder.total),
                    customerId: activeUser.id,
                    customerName: createdOrder.cliente_nombre || activeName,
                    customerEmail: createdOrder.cliente_email || activeUser.email,
                    customerPhone: createdOrder.telefono_contacto,
                    paymentMethod: metodoPago,
                    lockPaymentMethod: true,
                    onClose: () => { activePaymentCheckout = null; },
                    onPaymentSubmitted: async () => {
                        activePaymentCheckout = null;
                        try {
                            await loadCustomerData();
                            showToast("¡Comprobante enviado! El equipo verificará el pago.");
                        } catch (error) {
                            showToast(`Comprobante enviado; no se pudo actualizar la lista: ${errorText(error)}`, true);
                        }
                    }
                });
            } catch (error) {
                showToast(`El pedido quedó registrado, pero no se pudo abrir el pago: ${errorText(error)}`, true);
            }
        } else {
            showToast("¡Pedido en efectivo confirmado! El repartidor llevará tu vuelto.");
        }
    } catch (error) {
        showToast(`No pudimos confirmar el pedido: ${errorText(error)}`, true);
    } finally {
        button.textContent = "Confirmar pedido";
        renderCart();
    }
});

const mobileCartTrigger = document.getElementById("mobile-cart-trigger");
if (mobileCartTrigger) {
    mobileCartTrigger.addEventListener("click", () => {
        setCartOpen(true);
    });
}

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});
customerForm.elements.customerEmail.addEventListener("input", updateCustomerEmailValidation);
customerForm.elements.customerEmail.addEventListener("blur", updateCustomerEmailValidation);
customerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isSupabaseConfigured) {
        setStatus("Configura Supabase para habilitar las cuentas de comensales.", true);
        return;
    }
    if (!updateCustomerEmailValidation() || !customerForm.reportValidity()) return;
    const email = customerForm.elements.customerEmail.value.trim();
    const button = customerForm.querySelector("button[type='submit']");
    button.disabled = true;
    try {
        if (authMode === "signup") {
            const name = customerForm.elements.customerName.value.trim();
            const phone = customerForm.elements.customerPhone.value.trim();
            const normalizedPhone = normalizePhone(phone);
            if (normalizedPhone.length < 7) {
                setStatus("Ingresa un teléfono válido con al menos 7 dígitos.", true);
                button.disabled = false;
                return;
            }
            const { data, error } = await supabase.auth.signUp({
                email,
                password: customerForm.elements.customerPassword.value,
                options: { data: { full_name: name, phone, role: "cliente" } }
            });
            if (error) throw error;
            if (data.session && data.user) {
                await setCustomerSession(data.user);
                setStatus(`Cuenta creada. Ya puedes pedir a domicilio, ${name}.`);
                showToast(`Bienvenido a Frygourmett, ${name}.`);
            } else {
                setStatus("Cuenta creada. Ya puedes iniciar sesión con tu correo y contraseña.");
                showToast("Cuenta creada exitosamente. Inicia sesión para continuar.");
                setAuthMode("login");
            }
        } else {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password: customerForm.elements.customerPassword.value
            });
            if (error) throw error;

            const { role, profile, isActive } = await resolveUserRole(data.user);

            if (!isActive) {
                await supabase.auth.signOut();
                throw new Error("Tu cuenta de trabajador ha sido desactivada. Consulta con el administrador.");
            }

            if (role === "cliente") {
                await setCustomerSession(data.user, profile);
                setStatus(`Bienvenido, ${activeName}. Ya puedes continuar con tu pedido.`);
                showToast(`Bienvenido, ${activeName}.`);
            } else {
                const roleLabel = ROLE_LABELS[role] || role;
                setStatus(`Bienvenido, ${profile?.nombre || email}. Rol: ${roleLabel}. Redirigiendo a tu panel...`);
                showToast(`Acceso concedido como ${roleLabel}. Entrando al panel...`);
                const targetUrl = getRoleRedirect(role);
                window.setTimeout(() => {
                    window.location.href = targetUrl;
                }, 400);
            }
        }
    } catch (error) {
        setStatus(`No pudimos procesar la cuenta: ${errorText(error)}`, true);
    } finally {
        button.disabled = false;
    }
});

async function signOutCustomer() {
    const userId = activeUser?.id;
    if (activeProfile?.personalId && activeProfile.activo) {
        const { data: activeTurns, error: attendanceError } = await supabase.from("asistencia_turnos")
            .select("id")
            .eq("personal_id", activeProfile.personalId)
            .eq("estado_turno", "en_turno")
            .limit(1);
        if (attendanceError) {
            showToast(`No se pudo verificar el turno antes de cerrar sesión: ${errorText(attendanceError)}`, true);
            return;
        }
        if (activeTurns?.length) {
            const { error: exitError } = await supabase.rpc("marcar_salida_turno", {
                p_personal_id: null,
                p_observacion: "Salida automática al cerrar sesión"
            });
            if (exitError) {
                showToast(`No se pudo registrar la salida: ${errorText(exitError)}`, true);
                return;
            }
        }
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
        showToast(`No pudimos cerrar sesión: ${errorText(error)}`, true);
        return;
    }
    clearAttendanceSession(userId);
    await setCustomerSession(null);
    showToast("Sesión cerrada.");
}

document.getElementById("clear-customer").addEventListener("click", signOutCustomer);

document.getElementById("customer-orders-list").addEventListener("click", (event) => {
    const paymentButton = event.target.closest("[data-pay-order]");
    if (paymentButton) {
        const order = orders.find((item) => item.id === paymentButton.dataset.payOrder);
        if (!order) return;
        if (activePaymentCheckout) activePaymentCheckout.close();
        try {
            activePaymentCheckout = mountManualPaymentCheckout({
                orderId: order.id,
                totalAmount: Number(order.total),
                customerId: activeUser?.id,
                customerName: order.cliente_nombre,
                customerEmail: order.cliente_email,
                customerPhone: order.telefono_contacto,
                paymentId: paymentButton.dataset.paymentId || null,
                paymentMethod: paymentButton.dataset.paymentMethod || order.metodo_pago || "yape",
                lockPaymentMethod: true,
                onClose: () => { activePaymentCheckout = null; },
                onPaymentSubmitted: async () => {
                    activePaymentCheckout = null;
                    try {
                        await loadCustomerData();
                        showToast("Comprobante enviado. El equipo verificará el pago.");
                    } catch (error) {
                        showToast(`Comprobante enviado; no se pudo actualizar la lista: ${errorText(error)}`, true);
                    }
                }
            });
        } catch (error) {
            showToast(`No se pudo abrir el pago: ${errorText(error)}`, true);
        }
        return;
    }

    const rateButton = event.target.closest("[data-rate-order]");
    if (!rateButton) return;
    document.getElementById("rating-order").value = rateButton.dataset.rateOrder;
    activateCustomerTab("calificaciones");
});
async function loadPublicReviews() {
    const listElement = document.getElementById("public-reviews-list");
    const avgLabel = document.getElementById("public-reviews-average");
    if (!listElement) return;

    if (!isSupabaseConfigured || !supabase) {
        listElement.innerHTML = `
            <article class="public-review-card">
                <div class="review-card-stars">★★★★★</div>
                <p class="review-card-comment">"Excelente comida y muy rápida la entrega."</p>
                <div class="review-card-author"><strong>— Cliente</strong><small>Entrega reciente</small></div>
            </article>
            <article class="public-review-card">
                <div class="review-card-stars">★★★★☆</div>
                <p class="review-card-comment">"Muy buena atención."</p>
                <div class="review-card-author"><strong>— Cliente</strong><small>Entrega reciente</small></div>
            </article>`;
        return;
    }

    try {
        const { data, error } = await supabase
            .from("opiniones")
            .select("id, puntuacion, comentario, created_at, pedidos(cliente_nombre)")
            .order("created_at", { ascending: false })
            .limit(16);

        if (error) throw error;
        const reviews = data || [];
        if (!reviews.length) {
            listElement.innerHTML = `
                <div class="customer-empty-state">
                    <strong>Sé el primero en compartir tu experiencia</strong>
                    <p>Las opiniones de clientes verificados aparecerán aquí.</p>
                </div>`;
            if (avgLabel) avgLabel.textContent = "Aún sin opiniones";
            return;
        }

        const avg = (reviews.reduce((sum, r) => sum + Number(r.puntuacion || 5), 0) / reviews.length).toFixed(1);
        if (avgLabel) avgLabel.textContent = `Promedio: ★ ${avg} / 5 (${reviews.length} ${reviews.length === 1 ? "opinión" : "opiniones"})`;

        listElement.innerHTML = reviews.map((r) => {
            const stars = "★".repeat(r.puntuacion) + "☆".repeat(5 - r.puntuacion);
            const clientName = r.pedidos?.cliente_nombre
                ? escapeHtml(r.pedidos.cliente_nombre.split(" ")[0] + " " + (r.pedidos.cliente_nombre.split(" ")[1]?.slice(0, 1) || "") + ".")
                : "Cliente";
            const dateStr = formatOrderDate(r.created_at);
            return `<article class="public-review-card">
                <div class="review-card-stars" aria-label="${r.puntuacion} de 5 estrellas">${stars}</div>
                <p class="review-card-comment">"${escapeHtml(r.comentario || "Excelente comida y servicio.")}"</p>
                <div class="review-card-author">
                    <strong>— ${clientName}</strong>
                    <small>${escapeHtml(dateStr)}</small>
                </div>
            </article>`;
        }).join("");
    } catch (err) {
        console.warn("No se pudieron cargar las opiniones públicas:", err);
    }
}

document.getElementById("customer-rating-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!activeUser || !form.reportValidity()) return;
    const data = new FormData(form);
    const orderId = String(data.get("orderId"));
    const order = orders.find((item) => item.id === orderId && item.estado === "Entregado");
    if (!order || order.isRated) {
        showToast("Solo puedes calificar una vez un pedido tuyo que ya fue entregado.", true);
        return;
    }
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
        const { error } = await supabase.from("opiniones").insert({
            pedido_id: orderId,
            cliente_id: activeUser.id,
            puntuacion: Number(data.get("rating")),
            comentario: String(data.get("comment") || "").trim()
        });
        if (error) throw error;
        form.reset();
        await loadCustomerData();
        await loadPublicReviews();
        showToast("Gracias. Tu opinión ya está registrada.");
    } catch (error) {
        showToast(`No pudimos guardar la opinión: ${errorText(error)}`, true);
    } finally {
        updateReviewOptions();
    }
});

document.getElementById("share-page").addEventListener("click", async () => {
    const shareData = {
        title: "Frygourmett | Alta cocina, sin atajos",
        text: "Comida rápida con técnica de alta cocina: cada plato, ejecutado con precisión de chef.",
        url: window.location.href
    };
    try {
        if (navigator.share) await navigator.share(shareData);
        else {
            await navigator.clipboard.writeText(shareData.url);
            showToast("Enlace copiado. Compártelo donde quieras.");
        }
    } catch (error) {
        if (error.name !== "AbortError") showToast("No pudimos compartir el enlace.", true);
    }
});

const headerLogoutBtn = document.getElementById("header-logout-btn");
if (headerLogoutBtn) {
    headerLogoutBtn.addEventListener("click", signOutCustomer);
}

function openCustomerLogin() {
    activateCustomerTab("pedidos", true, true);
    setAuthMode("login");
    const identityCard = document.querySelector(".identity-card") || document.getElementById("customer-identity-form");
    if (identityCard) {
        identityCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const emailInput = document.querySelector("#customer-identity-form input[name='customerEmail']");
    if (emailInput) {
        window.setTimeout(() => {
            emailInput.focus();
        }, 350);
    }
}

const guestLoginTrigger = document.getElementById("guest-login-trigger");
if (guestLoginTrigger) {
    guestLoginTrigger.addEventListener("click", (e) => {
        e.preventDefault();
        openCustomerLogin();
    });
}

const drawerLoginBtn = document.getElementById("drawer-login-btn");
if (drawerLoginBtn) {
    drawerLoginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleDrawer(false);
        openCustomerLogin();
    });
}

const drawerLogoutBtn = document.getElementById("drawer-logout-btn");
if (drawerLogoutBtn) {
    drawerLogoutBtn.addEventListener("click", () => {
        toggleDrawer(false);
        signOutCustomer();
    });
}

const guestYear = document.getElementById("guest-year");
if (guestYear) guestYear.textContent = new Date().getFullYear();

const shareWhatsapp = document.getElementById("share-whatsapp");
if (shareWhatsapp) {
    shareWhatsapp.href = "https://wa.me/51968776288";
}
const shareGoogle = document.getElementById("share-google");
if (shareGoogle) {
    shareGoogle.href = `https://www.google.com/search?q=${encodeURIComponent("Frygourmett")}`;
}
setAuthMode("signup");

// Sincronización en tiempo real entre pestañas para cambios de estado de la tienda
window.addEventListener("storage", (event) => {
    if (event.key === STORE_CONFIG_STORAGE_KEY && event.newValue) {
        try {
            const incoming = JSON.parse(event.newValue);
            applyServiceConfig(incoming, false);
        } catch (error) {
            console.warn("No se pudo sincronizar el estado de la tienda desde storage:", error);
        }
    }
});

if (typeof BroadcastChannel !== "undefined") {
    try {
        const syncChannel = new BroadcastChannel(STORE_SYNC_CHANNEL_NAME);
        syncChannel.onmessage = (event) => {
            if (event.data?.type === "STORE_STATUS_CHANGED" && event.data.config) {
                applyServiceConfig(event.data.config, false);
            }
        };
    } catch { }
}

// Cargar inmediatamente el estado persistido de la tienda
const savedInitialConfig = getSavedServiceConfig();
if (savedInitialConfig) {
    applyServiceConfig(savedInitialConfig, false);
} else {
    updateKitchenStatus();
}
window.setInterval(updateKitchenStatus, 60000);

if (!isSupabaseConfigured) {
    setStatus("Falta Supabase. Configura .env.local para cargar la carta, iniciar sesión y guardar pedidos.", true);
    document.getElementById("service-kitchen-status").textContent = "Sin conexión";
    promotions = LOCAL_FEATURED_PROMOTIONS;
    renderCarousel();
    renderCategories();
    renderMenu();
    renderShareDishes();
    renderLargeDishes();
    renderFamilyDishes();
    renderWingsDishes();
    renderExtrasDishes();
    renderSpecialDishes();
    renderBeverages();
    renderPromoDishes();
    renderBurgersDishes();
    renderKidsDishes();
    updateCategoryCardsActiveState();
    renderCart();
    updateReviewOptions();
    void loadPublicReviews();
} else {
    const refreshServiceStatus = () => {
        void loadServiceStatus().catch((error) => {
            document.getElementById("service-kitchen-status").textContent = "No disponible";
            if (!serviceStatusErrorShown) {
                showToast(`No pudimos consultar el estado del servicio: ${errorText(error)}`, true);
                serviceStatusErrorShown = true;
            }
        });
    };
    refreshServiceStatus();
    window.setInterval(refreshServiceStatus, 30000);
    void loadProducts().catch((error) => {
        setStatus(`No pudimos cargar la carta: ${errorText(error)}`, true);
        renderMenu();
        renderShareDishes();
        renderLargeDishes();
        renderFamilyDishes();
        renderWingsDishes();
        renderExtrasDishes();
        renderSpecialDishes();
        renderBeverages();
        renderPromoDishes();
        renderBurgersDishes();
        renderKidsDishes();
    });
    void loadPromotions().catch((error) => {
        showToast(`No pudimos cargar los destacados: ${errorText(error)}`, true);
        promotions = LOCAL_FEATURED_PROMOTIONS;
        renderCarousel();
    });
    void loadPublicReviews();
    void supabase.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        return setCustomerSession(data.session?.user || null);
    }).catch((error) => setStatus(`No pudimos conectar con Supabase: ${errorText(error)}`, true));
    supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.setTimeout(() => setCustomerSession(null), 0);
    });
    publicContentChannel = supabase.channel("public-menu")
        .on("postgres_changes", { event: "*", schema: "public", table: "productos" }, () => {
            void loadProducts().catch((error) => showToast(`No se pudo actualizar la carta: ${errorText(error)}`, true));
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "configuracion_servicio" }, refreshServiceStatus)
        .on("postgres_changes", { event: "*", schema: "public", table: "promociones" }, () => {
            void loadPromotions().catch((error) => showToast(`No se pudieron actualizar los destacados: ${errorText(error)}`, true));
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "opiniones" }, () => {
            void loadPublicReviews();
        })
        .subscribe();
}

// =========================================================
// MODO CLARO / OSCURO (CLIENTE)
// =========================================================
function setCustomerTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("frygourmett-theme", theme);
    const themeBtn = document.getElementById("guest-theme-toggle");
    if (themeBtn) {
        themeBtn.setAttribute("aria-label", theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
        themeBtn.innerHTML = theme === "dark"
            ? `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
            : `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
}
const initialCustomerTheme = localStorage.getItem("frygourmett-theme") || "light";
setCustomerTheme(initialCustomerTheme);

document.getElementById("guest-theme-toggle")?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    setCustomerTheme(cur === "dark" ? "light" : "dark");
});
document.getElementById("drawer-theme-toggle")?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    setCustomerTheme(cur === "dark" ? "light" : "dark");
});

// =========================================================
// MENÚ HAMBURGUESA MÓVIL
// =========================================================
const mobileDrawer = document.getElementById("mobile-nav-drawer");
const mobileTrigger = document.getElementById("guest-mobile-trigger");
const drawerCloseBtn = document.getElementById("drawer-close-btn");

function toggleDrawer(open) {
    if (!mobileDrawer) return;
    const willOpen = typeof open === "boolean" ? open : mobileDrawer.hidden;
    mobileDrawer.hidden = !willOpen;
    document.body.classList.toggle("drawer-open", willOpen);
    if (mobileTrigger) mobileTrigger.setAttribute("aria-expanded", String(willOpen));
}

mobileTrigger?.addEventListener("click", () => toggleDrawer(true));
drawerCloseBtn?.addEventListener("click", () => toggleDrawer(false));
document.querySelectorAll(".drawer-link").forEach((link) => {
    link.addEventListener("click", () => {
        toggleDrawer(false);
        const tab = link.dataset.drawerTab;
        if (tab) {
            activateCustomerTab(tab);
        }
    });
});

// =========================================================
// REPRODUCTORES DE VIDEO DE LA COCINA
// =========================================================
document.querySelectorAll("[data-video-card]").forEach((card) => {
    const video = card.querySelector("video");
    const playBtn = card.querySelector(".video-play-trigger");
    if (!video) return;

    const setPlayIcon = (btn) => {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-play text-sm ml-0.5" aria-hidden="true"></i>';
    };
    const setPauseIcon = (btn) => {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-pause text-sm" aria-hidden="true"></i>';
    };

    const togglePlay = () => {
        document.querySelectorAll("[data-video-card] video").forEach((v) => {
            if (v !== video && !v.paused) {
                v.pause();
                const otherBtn = v.closest("[data-video-card]")?.querySelector(".video-play-trigger");
                setPlayIcon(otherBtn);
            }
        });
        if (video.paused) {
            video.play().catch(() => { });
            setPauseIcon(playBtn);
        } else {
            video.pause();
            setPlayIcon(playBtn);
        }
    };

    playBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePlay();
    });
    card.addEventListener("click", togglePlay);
    video.addEventListener("ended", () => {
        setPlayIcon(playBtn);
    });
});

// =========================================================
// MODAL LEGAL (POLÍTICAS Y RECLAMACIONES)
// =========================================================
const LEGAL_CONTENTS = {
    privacy: {
        title: "Política de Privacidad y Protección de Datos",
        content: `<h3>Tratamiento de Datos Personales (Ley N° 29733 - Perú)</h3>
<p>En <strong>FRYGOURMETT S.A.C.</strong> garantizamos la protección y confidencialidad absoluta de los datos personales facilitados por nuestros clientes y usuarios a través de esta plataforma digital.</p>
<p>Los datos solicitados (nombre, correo electrónico, teléfono de contacto y dirección de entrega en Lima) son utilizados exclusivamente para gestionar sus pedidos gastronómicos, coordinar el despacho con nuestros repartidores y emitir los comprobantes de pago correspondientes. No comercializamos ni cedemos sus datos a terceros para fines publicitarios ajenos a nuestro servicio.</p>`
    },
    terms: {
        title: "Términos y Condiciones del Servicio Delivery",
        content: `<h3>Condiciones Generales del Servicio</h3>
<p>1. <strong>Horario de Atención:</strong> El servicio delivery y de cocina atiende todos los días en el horario oficial de <strong>3:00 PM a 3:00 AM</strong> (hora de Lima, Perú).</p>
<p>2. <strong>Tiempos y Zonas de Entrega:</strong> Los despachos se realizan en las zonas habilitadas de Lima Metropolitana con un tiempo promedio de 35 a 45 minutos sujeto al tráfico vehicular y condiciones climáticas.</p>
<p>3. <strong>Modificaciones y Cancelaciones:</strong> Debido a que cada plato se elabora al momento con técnica de chef, las cancelaciones solo son válidas dentro de los primeros 5 minutos posteriores a la confirmación de la orden.</p>`
    },
    cookies: {
        title: "Política de Cookies y Almacenamiento Local",
        content: `<h3>Uso de Almacenamiento Técnico</h3>
<p>FRYGOURMETT emplea almacenamiento local en su navegador exclusivamente para fines funcionales:</p>
<ul>
    <li>Mantener los productos seleccionados en su carrito de compras.</li>
    <li>Conservar su sesión iniciada de manera segura mediante Supabase Auth.</li>
    <li>Guardar su preferencia de Modo Claro u Oscuro.</li>
</ul>
<p>No utilizamos cookies de rastreo publicitario invasivo ni transferimos sus identificadores a redes de terceros.</p>`
    },
    complaints: {
        title: "Libro de Reclamaciones Virtual",
        content: `<h3>Hoja de Reclamación Virtual (INDECOPI - Ley N° 29571)</h3>
<p>Los datos se usan exclusivamente para atender su requerimiento dentro del plazo legal aplicable.</p>
<form id="public-complaint-form" class="public-complaint-form">
  <label>Nombre completo<input name="nombre" maxlength="120" required></label>
  <label>Documento de identidad<input name="documento" maxlength="30"></label>
  <label>Correo electrónico<input name="email" type="email" maxlength="180"></label>
  <label>Teléfono<input name="telefono" maxlength="24" required></label>
  <label>Tipo de registro<select name="tipo" required><option value="Queja">Queja</option><option value="Reclamo">Reclamo</option></select></label>
  <label>Bien o servicio contratado<input name="bien_servicio" maxlength="240" required></label>
  <label>Pedido relacionado (ID opcional)<input name="pedido_id" maxlength="80"></label>
  <label>Detalle del requerimiento<textarea name="detalle" rows="5" maxlength="3000" required></textarea></label>
  <button type="submit" class="guest-button guest-button-dark">Registrar reclamación</button>
</form>
<div id="public-complaint-result" hidden></div>`
    }
};

const legalModal = document.getElementById("legal-modal");
const legalModalTitle = document.getElementById("legal-modal-title");
const legalModalBody = document.getElementById("legal-modal-body");

function setupPublicComplaintForm() {
    const form = document.getElementById("public-complaint-form");
    const result = document.getElementById("public-complaint-result");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isSupabaseConfigured || !supabase) {
            showToast("El registro temporal no está disponible. Intenta nuevamente.", true);
            return;
        }
        const data = Object.fromEntries(new FormData(form).entries());
        const payload = {
            nombre: data.nombre,
            documento: data.documento || null,
            email: data.email || null,
            telefono: data.telefono,
            tipo: data.tipo,
            bien_servicio: data.bien_servicio,
            detalle: data.detalle
        };
        const { data: createdRows, error } = await supabase.rpc("crear_reclamacion_publica", {
            p_nombre: payload.nombre,
            p_documento: payload.documento,
            p_email: payload.email,
            p_telefono: payload.telefono,
            p_tipo: payload.tipo,
            p_bien_servicio: payload.bien_servicio,
            p_detalle: payload.detalle
        });
        const created = createdRows?.[0];
        if (error) {
            showToast(`No se pudo registrar: ${error.message}`, true);
            return;
        }
        form.hidden = true;
        if (result) {
            result.hidden = false;
            result.innerHTML = `<strong>Registro recibido</strong><p>Código: <b>${escapeHtml(created.codigo)}</b></p>
                <button type="button" id="download-complaint-pdf">Descargar comprobante PDF</button>`;
            document.getElementById("download-complaint-pdf")?.addEventListener("click", () => {
                const printWindow = window.open("", "_blank", "noopener,noreferrer");
                if (!printWindow) return;
                printWindow.document.write(`<title>Comprobante ${escapeHtml(created.codigo)}</title><style>body{font-family:Arial;padding:32px}h1{color:#111}</style><h1>FRYGOURMETT - Libro de Reclamaciones</h1><p><strong>Código:</strong> ${escapeHtml(created.codigo)}</p><p><strong>Tipo:</strong> ${escapeHtml(data.tipo)}</p><p><strong>Consumidor:</strong> ${escapeHtml(data.nombre)}</p><p><strong>Bien/servicio:</strong> ${escapeHtml(data.bien_servicio)}</p><p><strong>Detalle:</strong> ${escapeHtml(data.detalle)}</p><p>Registro generado el ${new Date(created.created_at).toLocaleString("es-PE")}.</p>`);
                printWindow.document.close();
                printWindow.focus();
                printWindow.print();
            });
        }
    });
}

function openLegalModal(key) {
    const item = LEGAL_CONTENTS[key] || LEGAL_CONTENTS.privacy;
    if (legalModalTitle) legalModalTitle.textContent = item.title;
    if (legalModalBody) legalModalBody.innerHTML = item.content;
    if (legalModal) legalModal.hidden = false;
    if (key === "complaints") setupPublicComplaintForm();
}

document.querySelectorAll("[data-legal-modal]").forEach((btn) => {
    btn.addEventListener("click", () => openLegalModal(btn.dataset.legalModal));
});
document.getElementById("close-legal-modal")?.addEventListener("click", () => {
    if (legalModal) legalModal.hidden = true;
});
document.getElementById("close-legal-btn")?.addEventListener("click", () => {
    if (legalModal) legalModal.hidden = true;
});
legalModal?.addEventListener("click", (e) => {
    if (e.target === legalModal) legalModal.hidden = true;
});

// =========================================================
// BOLETÍN GOURMET
// =========================================================
document.getElementById("newsletter-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = e.target.querySelector("input[type='email']");
    if (input) {
        showToast("¡Gracias por suscribirte al boletín de Frygourmett!");
        input.value = "";
    }
});

// =========================================================
// ENLACES DIRECTOS DE NAVEGACIÓN
// =========================================================
document.querySelectorAll("[data-switch-to-nosotros], [data-footer-nav='nosotros']").forEach((el) => {
    el.addEventListener("click", (e) => {
        e.preventDefault();
        activateCustomerTab("nosotros", true, true);
    });
});
document.querySelectorAll("[data-footer-nav='carta']").forEach((el) => {
    el.addEventListener("click", (e) => {
        e.preventDefault();
        activateCustomerTab("carta", true, true);
    });
});
document.querySelectorAll("[data-footer-nav='pedidos']").forEach((el) => {
    el.addEventListener("click", (e) => {
        e.preventDefault();
        activateCustomerTab("pedidos", true, true);
    });
});
document.querySelectorAll("[data-footer-nav='calificaciones']").forEach((el) => {
    el.addEventListener("click", (e) => {
        e.preventDefault();
        activateCustomerTab("calificaciones", true, true);
    });
});
