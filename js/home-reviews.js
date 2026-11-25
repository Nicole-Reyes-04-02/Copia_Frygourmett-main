import { supabase, isSupabaseConfigured, escapeHtml } from "./supabase.js";

// Banda "Opiniones de nuestros comensales": lee las mismas opiniones públicas de Supabase.
const card = document.getElementById("home-review-card");
const prev = document.getElementById("home-review-prev");
const next = document.getElementById("home-review-next");
let reviews = [];
let index = 0;
let timer;

function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.toLocaleDateString("es-PE", { day: "numeric", month: "short" })}, ${date.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function render() {
    if (!card) return;
    if (!reviews.length) {
        card.innerHTML = "<strong>Sé el primero en compartir tu experiencia.</strong>";
        return;
    }
    const review = reviews[index];
    const stars = Math.max(1, Math.min(5, Number(review.puntuacion) || 5));
    const name = review.pedidos?.cliente_nombre || "Cliente verificado";
    const starsHtml = Array.from({ length: 5 }, (_, i) => `<i class="${i < stars ? "fa-solid" : "fa-regular"} fa-star"></i>`).join("");
    card.innerHTML = `
        <div class="flex items-center gap-1.5 text-amber-500 text-sm mb-4" aria-label="${stars} de 5 estrellas">
            ${starsHtml}
        </div>
        <p class="text-neutral-800 text-base sm:text-lg font-medium leading-relaxed mb-6">
            “${escapeHtml(review.comentario || "Muy rico, excelente presentación y llegó caliente. 100% recomendado.")}”
        </p>
        <div class="flex items-center justify-between text-xs text-neutral-500 font-semibold border-t border-neutral-200/80 pt-4">
            <span class="text-neutral-900 font-bold">— ${escapeHtml(name)}</span>
            <span>${formatDate(review.created_at)}</span>
        </div>`;
}

function go(step) {
    if (!reviews.length) return;
    index = (index + step + reviews.length) % reviews.length;
    render();
    clearInterval(timer);
    timer = setInterval(() => go(1), 7000);
}

async function load() {
    if (!card) return;
    if (!isSupabaseConfigured || !supabase) { render(); return; }
    try {
        const { data, error } = await supabase
            .from("opiniones")
            .select("id, puntuacion, comentario, created_at, pedidos(cliente_nombre)")
            .order("created_at", { ascending: false })
            .limit(10);
        if (error) throw error;
        reviews = data || [];
    } catch (error) {
        console.warn("No se pudieron cargar las opiniones del inicio:", error?.message || error);
    }
    render();
    if (reviews.length > 1) timer = setInterval(() => go(1), 7000);
}

prev?.addEventListener("click", () => go(-1));
next?.addEventListener("click", () => go(1));
load();
