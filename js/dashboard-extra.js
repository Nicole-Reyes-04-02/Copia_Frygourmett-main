import { supabase, isSupabaseConfigured, escapeHtml, formatCurrency } from "./supabase.js";
import {
    STATUS_CLASS,
    normalizeOrderStatus,
    getNextOrderStatus,
    canRoleTransitionOrder,
    updateOrderStatusInSupabase
} from "./order-status.js";

// Widgets del dashboard sincronizados con la misma fuente real de pedidos que #pedidos.
const $ = (id) => document.getElementById(id);
const TZ = "America/Lima";
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(d));
const dayName = (d) => new Intl.DateTimeFormat("es-PE", { timeZone: TZ, weekday: "short" }).format(new Date(d)).replace(".", "");
const dayShortDate = (d) => new Intl.DateTimeFormat("es-PE", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(d));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const hour = (d) => new Intl.DateTimeFormat("es-PE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));

const STATES = [
    ["Pendiente", "Pendientes", "#f5c542"],
    ["En preparación", "En preparación", "#38b6ff"],
    ["Listo", "Listos", "#22c55e"],
    ["En camino", "En camino", "#a78bfa"],
    ["Entregado", "Entregados", "#94a3b8"]
];

let reviews = [];
let reviewIndex = 0;
let cachedOrders = [];
let weeklyRangeDays = 7;
const highlightedOrderIds = new Set();

function showDashboardToast(message, isError = false) {
    const region = $("toast-region");
    if (!region) return;
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " toast-error" : ""}`;
    toast.textContent = message;
    region.append(toast);
    window.setTimeout(() => toast.remove(), 4000);
}

function renderWeekly(orders) {
    const box = $("dx-weekly");
    const yAxis = $("dx-weekly-y");
    if (!box) return;

    const n = weeklyRangeDays === 30 ? 30 : 7;
    const days = Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 864e5));
    const totals = days.map((d) =>
        orders.filter((o) => dayKey(o.created_at) === dayKey(d)).reduce((a, o) => a + Number(o.total || 0), 0)
    );
    const max = Math.max(...totals, 1);
    const top = Math.max(100, Math.ceil(max / 200) * 200);

    if (yAxis) {
        yAxis.innerHTML = [top, top * 0.75, top * 0.5, top * 0.25, 0]
            .map((v) => `<span>S/ ${Math.round(v)}</span>`)
            .join("");
    }

    const W = 600;
    const H = 175;
    const padTop = 12;
    const padBottom = 10;
    const usableH = H - padTop - padBottom;
    const X = (i) => (n > 1 ? (i / (n - 1)) * W : W / 2);
    const Y = (val) => padTop + usableH - (val / top) * usableH;

    const pts = totals.map((val, i) => [X(i), Y(val)]);
    const pathD = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const areaD = `${pathD} L${W} ${H} L0 ${H} Z`;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const xLabels = n === 7
        ? days.map((d, i) => `<span>${i === n - 1 ? "Hoy" : cap(dayName(d))}</span>`).join("")
        : [0, 7, 14, 21, n - 1].map((idx) => `<span>${idx === n - 1 ? "Hoy" : dayShortDate(days[idx])}</span>`).join("");

    box.innerHTML = `
        <svg class="pm-weekly-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
            <defs>
                <linearGradient id="pm-weekly-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.38" />
                    <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.0" />
                </linearGradient>
            </defs>
            <path d="${areaD}" fill="url(#pm-weekly-grad)" />
            <path d="${pathD}" fill="none" stroke="#f59e0b" stroke-width="2.5" vector-effect="non-scaling-stroke" ${reduced ? "" : 'pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"'}>
                ${reduced ? "" : '<animate attributeName="stroke-dashoffset" to="0" dur="1.1s" fill="freeze" />'}
            </path>
            <line id="pm-chart-guide" x1="0" x2="0" y1="0" y2="${H}" stroke="currentColor" stroke-opacity="0.28" stroke-dasharray="3 3" opacity="0" vector-effect="non-scaling-stroke" />
            <circle id="pm-chart-dot" cx="0" cy="0" r="5" fill="#f59e0b" stroke="#07090d" stroke-width="2" opacity="0" />
        </svg>
        <div class="pm-weekly-x">${xLabels}</div>
        <div class="pm-chart-tip" id="pm-chart-tip" role="status"></div>
    `;

    const guide = $("pm-chart-guide");
    const dot = $("pm-chart-dot");
    const tip = $("pm-chart-tip");
    let focusedIdx = n - 1;

    const showPoint = (idx) => {
        if (!guide || !dot || !tip) return;
        const clamped = Math.max(0, Math.min(n - 1, idx));
        const px = X(clamped);
        const py = Y(totals[clamped]);
        guide.setAttribute("x1", px.toFixed(1));
        guide.setAttribute("x2", px.toFixed(1));
        guide.setAttribute("opacity", "1");
        dot.setAttribute("cx", px.toFixed(1));
        dot.setAttribute("cy", py.toFixed(1));
        dot.setAttribute("opacity", "1");

        const dateText = clamped === n - 1 ? "Hoy" : `${cap(dayName(days[clamped]))} · ${dayShortDate(days[clamped])}`;
        tip.innerHTML = `<b>${formatCurrency(totals[clamped])}</b><span>${escapeHtml(dateText)}</span>`;
        tip.style.left = `${Math.max(10, Math.min(90, (px / W) * 100))}%`;
        tip.style.top = `${Math.max(14, (py / H) * 82)}%`;
        tip.style.opacity = "1";
    };

    const hidePoint = () => {
        if (guide) guide.setAttribute("opacity", "0");
        if (dot) dot.setAttribute("opacity", "0");
        if (tip) tip.style.opacity = "0";
    };

    box.setAttribute("tabindex", "0");
    box.setAttribute("aria-label", `Gráfica de ventas de los últimos ${n} días. Usa flechas izquierda y derecha para explorar.`);
    box.onpointermove = (e) => {
        const r = box.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        focusedIdx = Math.round(ratio * (n - 1));
        showPoint(focusedIdx);
    };
    box.onpointerleave = hidePoint;
    box.onfocus = () => showPoint(focusedIdx);
    box.onblur = hidePoint;
    box.onkeydown = (e) => {
        if (e.key === "ArrowRight") {
            e.preventDefault();
            focusedIdx = Math.min(n - 1, focusedIdx + 1);
            showPoint(focusedIdx);
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            focusedIdx = Math.max(0, focusedIdx - 1);
            showPoint(focusedIdx);
        }
    };
}

function renderDonut(orders) {
    const donut = $("dx-donut");
    const totalEl = $("dx-donut-total");
    const legendEl = $("dx-legend");
    if (!donut || !totalEl || !legendEl) return;

    const counts = STATES.map(([key]) =>
        orders.filter((o) => normalizeOrderStatus(o.estado) === key).length
    );
    const total = counts.reduce((a, b) => a + b, 0);

    let acc = 0;
    const cumPcts = STATES.map((_, i) => {
        acc += total ? (counts[i] / total) * 100 : (i === 4 ? 100 : 0);
        return `${acc.toFixed(2)}%`;
    });

    if (typeof window.CSS?.registerProperty === "function") {
        cumPcts.forEach((pct, i) => {
            donut.style.setProperty(`--donut-p${i}`, pct);
        });
    } else {
        let prev = 0;
        const stops = total
            ? STATES.map((s, i) => {
                const from = (prev / total) * 100;
                prev += counts[i];
                return `${s[2]} ${from.toFixed(2)}% ${((prev / total) * 100).toFixed(2)}%`;
            }).join(",")
            : "#94a3b8 0% 100%";
        donut.style.background = `conic-gradient(${stops})`;
    }

    totalEl.textContent = total;
    legendEl.innerHTML = STATES.map((s, i) => `<li><i style="background:${s[2]}"></i>${s[1]}<b>${counts[i]}</b></li>`).join("");
}

function renderRecent(orders, includeTotals) {
    const body = $("dx-recent");
    if (!body) return;
    setRecentTotalVisibility(includeTotals);
    const rows = orders.slice(0, 5);
    const role = dashboardRole || document.body.dataset.dashboardRole || "";

    body.innerHTML = rows.length
        ? rows.map((order) => {
            const status = normalizeOrderStatus(order.estado);
            const nextStatus = getNextOrderStatus(status);
            const canAdvance = Boolean(nextStatus && canRoleTransitionOrder(role, status, nextStatus));
            const idShort = escapeHtml(String(order.id).slice(0, 8).toUpperCase());
            const isNew = highlightedOrderIds.has(order.id);
            const pillClass = STATUS_CLASS[status] || "st-pend";

            let statusCellHtml = "";
            if (status === "Entregado") {
                statusCellHtml = `<span class="dx-pill st-done" title="Pedido finalizado">Entregado · Finalizado</span>`;
            } else if (canAdvance) {
                statusCellHtml = `<button type="button"
                    class="pm-status-btn ${pillClass}"
                    data-advance-order="${escapeHtml(order.id)}"
                    data-current-status="${escapeHtml(status)}"
                    title="Avanzar a «${escapeHtml(nextStatus)}»">
                    <span>${escapeHtml(status)}</span> <span aria-hidden="true">→</span>
                </button>`;
            } else {
                statusCellHtml = `<span class="dx-pill ${pillClass}">${escapeHtml(status)}</span>`;
            }

            return `<tr class="${isNew ? "pm-order-new" : ""}" data-recent-row="${escapeHtml(order.id)}">
                <td>#${idShort}</td>
                <td>${escapeHtml(order.cliente_nombre)}</td>
                ${includeTotals ? `<td>${formatCurrency(order.total)}</td>` : ""}
                <td>${statusCellHtml}</td>
                <td>${hour(order.created_at)}</td>
            </tr>`;
        }).join("")
        : `<tr><td colspan="${includeTotals ? 5 : 4}" class="dx-empty">Aún no hay pedidos registrados.</td></tr>`;
}

function setRecentTotalVisibility(show) {
    const headerRow = $("dx-recent")?.closest("table")?.querySelector("thead tr");
    if (!headerRow) return;
    let totalHeader = headerRow.querySelector("[data-recent-total]");
    if (show && !totalHeader) {
        totalHeader = document.createElement("th");
        totalHeader.className = "pb-2 font-medium";
        totalHeader.dataset.recentTotal = "";
        totalHeader.textContent = "Total";
        headerRow.children[1]?.after(totalHeader);
    } else if (!show) {
        totalHeader?.remove();
    }
}

function renderPopularBars(orders) {
    const container = $("dx-popular-bars");
    if (!container) return;

    const counts = new Map();
    orders.forEach((order) => {
        if (!Array.isArray(order.items)) return;
        order.items.forEach((item) => {
            const name = String(item.nombre || "").trim();
            if (!name) return;
            counts.set(name, (counts.get(name) || 0) + Number(item.cantidad || 1));
        });
    });

    const top = [...counts.entries()]
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 4);

    if (!top.length) {
        container.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Los platos más solicitados aparecerán aquí conforme entren pedidos reales.</p>`;
        return;
    }

    const maxQty = Math.max(...top.map((d) => d.qty), 1);
    container.innerHTML = top.map((d) => {
        const pct = Math.max(8, Math.round((d.qty / maxQty) * 100));
        return `<div class="pm-popular-bar">
            <div class="pm-popular-bar-head">
                <span class="truncate pr-2 font-medium">${escapeHtml(d.name)}</span>
                <b>${d.qty} uds.</b>
            </div>
            <i class="pm-popular-bar-track"><b class="pm-popular-bar-fill" data-w="${pct}"></b></i>
        </div>`;
    }).join("");

    window.requestAnimationFrame(() => {
        container.querySelectorAll(".pm-popular-bar-fill").forEach((bar) => {
            bar.style.width = `${bar.dataset.w}%`;
        });
    });
}

function renderReview() {
    const box = $("dx-review");
    if (!box) return;
    const dots = $("dx-review-dots");
    if (!reviews.length) {
        box.innerHTML = `<p class="dx-empty">Aún no hay opiniones de clientes.</p>`;
        if (dots) dots.innerHTML = "";
        return;
    }
    const r = reviews[reviewIndex];
    const n = Math.max(1, Math.min(5, Number(r.puntuacion) || 5));
    box.innerHTML = `<div class="dx-review-head"><span class="dx-avatar" aria-hidden="true">👤</span><div><strong>${escapeHtml(r.pedidos?.cliente_nombre || "Cliente")}</strong><div class="dx-stars">${"★".repeat(n)}${"☆".repeat(5 - n)}</div></div><small>${new Date(r.created_at).toLocaleDateString("es-PE", { day: "numeric", month: "short" })}, ${hour(r.created_at)}</small></div><p>“${escapeHtml(r.comentario || "Excelente experiencia.")}”</p>`;
    if (dots) dots.innerHTML = reviews.map((_, i) => `<i class="${i === reviewIndex ? "on" : ""}"></i>`).join("");
}

let dashboardRole = document.body.dataset.dashboardRole || null;
let dashboardLoadSequence = 0;
const receptionistHiddenNodes = new Map();
const receptionistHiddenSelectors = [
    '[data-purpose="welcome-hero-banner"]',
    ".metrics-grid",
    "#dx-extra",
    ".admin-quick-actions",
    '[data-purpose="bottom-insights"]'
];

function setDashboardLayout(role) {
    const isReceptionist = role === "recepcionista";
    const selectors = isReceptionist
        ? receptionistHiddenSelectors
        : [...receptionistHiddenSelectors].reverse();
    selectors.forEach((selector) => {
        const saved = receptionistHiddenNodes.get(selector);
        if (isReceptionist) {
            const node = document.querySelector(selector);
            if (node?.parentNode && !saved) {
                receptionistHiddenNodes.set(selector, {
                    node,
                    parent: node.parentNode,
                    nextSibling: node.nextSibling
                });
                node.remove();
            }
        } else if (saved) {
            const { node, parent, nextSibling } = saved;
            parent.insertBefore(node, nextSibling?.parentNode === parent ? nextSibling : null);
            receptionistHiddenNodes.delete(selector);
        }
    });

    const statusPanel = $(".dx-status-panel");
    const recentPanel = $(".dx-recent-panel");
    if (statusPanel) statusPanel.style.gridColumn = isReceptionist ? "1 / -1" : "";
    if (recentPanel) recentPanel.style.gridColumn = isReceptionist ? "1 / -1" : "";
    setRecentTotalVisibility(!isReceptionist);
}

function applyOrdersToWidgets(ordersList) {
    cachedOrders = Array.isArray(ordersList) ? ordersList : [];
    const role = dashboardRole || document.body.dataset.dashboardRole || "";
    const isReceptionist = role === "recepcionista";

    renderDonut(cachedOrders);
    renderRecent(cachedOrders, !isReceptionist);

    if (!isReceptionist) {
        const sinceMs = Date.now() - weeklyRangeDays * 864e5;
        const rangeOrders = cachedOrders.filter((o) => new Date(o.created_at).getTime() >= sinceMs);
        renderWeekly(rangeOrders);
        renderPopularBars(rangeOrders);
    }
}

async function load() {
    const role = dashboardRole;
    const loadSequence = ++dashboardLoadSequence;
    const canSeeFullDashboard = role === "administrador" || role === "gerente";
    const isReceptionist = role === "recepcionista";
    if (!isSupabaseConfigured || !supabase || !role || (!canSeeFullDashboard && !isReceptionist)) return;

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        console.warn("Dashboard: no se pudo validar la sesión.", sessionError);
        return;
    }
    if (!sessionData?.session || role !== dashboardRole || loadSequence !== dashboardLoadSequence) return;

    // Si script.js ya cargó los pedidos reales, renderizar inmediatamente sin esperar
    if (Array.isArray(window.__frygourmettOrders) && window.__frygourmettOrders.length > 0) {
        applyOrdersToWidgets(window.__frygourmettOrders);
    }

    if (isReceptionist) {
        const allOrdersRes = await supabase
            .from("pedidos")
            .select("id,cliente_nombre,total,estado,items,created_at")
            .order("created_at", { ascending: false })
            .limit(2000);
        if (role !== dashboardRole || loadSequence !== dashboardLoadSequence) return;
        if (allOrdersRes.error) {
            console.warn("Dashboard: no se pudieron cargar los pedidos.", allOrdersRes.error);
        } else {
            applyOrdersToWidgets(allOrdersRes.data || []);
        }
        return;
    }

    const [allOrdersRes, prods, ops] = await Promise.all([
        supabase.from("pedidos").select("id,cliente_nombre,total,estado,items,created_at").order("created_at", { ascending: false }).limit(2000),
        supabase.from("productos").select("id", { count: "exact", head: true }).eq("disponible", true),
        supabase.from("opiniones").select("id,puntuacion,comentario,created_at,pedidos(cliente_nombre)").order("created_at", { ascending: false }).limit(50)
    ]);
    if (role !== dashboardRole || loadSequence !== dashboardLoadSequence) return;

    if (!allOrdersRes.error) {
        applyOrdersToWidgets(allOrdersRes.data || []);
    } else {
        console.warn("Dashboard: no se pudieron cargar los pedidos.", allOrdersRes.error);
    }

    if (!prods.error && $("dx-products")) $("dx-products").textContent = prods.count ?? 0;
    else if (prods.error) console.warn("Dashboard: no se pudieron cargar los productos activos.", prods.error);

    if (!ops.error) {
        const all = ops.data || [];
        const rating = $("dx-rating");
        if (rating) rating.textContent = all.length
            ? (all.reduce((total, review) => total + Number(review.puntuacion || 0), 0) / all.length).toFixed(1)
            : "—";
        reviews = all.slice(0, 3);
        reviewIndex = Math.min(reviewIndex, Math.max(reviews.length - 1, 0));
        renderReview();
    } else console.warn("Dashboard: no se pudieron cargar las opiniones.", ops.error);
}

/* Avanzar estado directamente desde Pedidos recientes en el Dashboard */
$("dx-recent")?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-advance-order]");
    if (!btn || btn.disabled) return;

    const orderId = btn.dataset.advanceOrder;
    const role = dashboardRole || document.body.dataset.dashboardRole || "";
    const order = cachedOrders.find((o) => o.id === orderId);
    const currentStatus = normalizeOrderStatus(order?.estado || btn.dataset.currentStatus);
    const nextStatus = getNextOrderStatus(currentStatus);

    if (!nextStatus) {
        showDashboardToast("Este pedido ya fue entregado y está finalizado.", true);
        return;
    }

    if (!canRoleTransitionOrder(role, currentStatus, nextStatus)) {
        showDashboardToast("Tu rol actual no tiene permisos para realizar esta transición.", true);
        return;
    }

    btn.disabled = true;
    try {
        const updated = await updateOrderStatusInSupabase(orderId, nextStatus);
        showDashboardToast(`Pedido #${orderId.slice(0, 8).toUpperCase()} → ${updated.estado}`);
        window.dispatchEvent(new CustomEvent("frygourmett:order-status-changed", {
            detail: { orderId, nextStatus: updated.estado, prevStatus: currentStatus, order: updated }
        }));
    } catch (err) {
        showDashboardToast(`No se pudo actualizar en Supabase: ${err?.message || "error"}`, true);
        btn.disabled = false;
    }
});

const step = (d) => { if (reviews.length) { reviewIndex = (reviewIndex + d + reviews.length) % reviews.length; renderReview(); } };
$("dx-review-prev")?.addEventListener("click", () => step(-1));
$("dx-review-next")?.addEventListener("click", () => step(1));

function updateDashboardRole(role) {
    dashboardRole = role || null;
    dashboardLoadSequence += 1;
    setDashboardLayout(dashboardRole);
    if (dashboardRole === "recepcionista" && $("dx-recent")) {
        $("dx-recent").innerHTML = '<tr><td colspan="4" class="dx-empty">Cargando pedidos...</td></tr>';
    }
    if (dashboardRole) {
        void load().catch((error) => console.warn("Dashboard:", error?.message || error));
    }
}

window.addEventListener("frygourmett:dashboard-role-change", (event) => {
    updateDashboardRole(event.detail?.role);
});

/* Única fuente Realtime (recibida desde script.js sin duplicar canales) */
window.addEventListener("frygourmett:orders-updated", (event) => {
    const { orders: updatedOrders, eventType, order } = event.detail || {};
    if (eventType === "INSERT" && order?.id) {
        highlightedOrderIds.add(order.id);
        window.setTimeout(() => highlightedOrderIds.delete(order.id), 3000);
        const shortId = String(order.id).slice(0, 8).toUpperCase();
        showDashboardToast(`Nuevo pedido #${shortId} · ${order.cliente_nombre || "Cliente"}`);
    }
    if (Array.isArray(updatedOrders)) {
        applyOrdersToWidgets(updatedOrders);
    }
});

document.querySelectorAll("[data-weekly-range]").forEach((button) => {
    button.addEventListener("click", () => {
        weeklyRangeDays = Number(button.dataset.weeklyRange) === 30 ? 30 : 7;
        document.querySelectorAll("[data-weekly-range]").forEach((option) => {
            const selected = option === button;
            option.classList.toggle("is-active", selected);
            option.setAttribute("aria-pressed", String(selected));
        });
        const subtitle = $("dx-weekly-subtitle");
        if (subtitle) subtitle.textContent = `Comparativa de los últimos ${weeklyRangeDays} días · pasa el cursor sobre la gráfica`;
        applyOrdersToWidgets(cachedOrders);
    });
});

if (dashboardRole) {
    setDashboardLayout(dashboardRole);
    void load().catch((error) => console.warn("Dashboard:", error?.message || error));
}

window.setInterval(() => {
    if (dashboardRole) void load().catch((error) => console.warn("Dashboard:", error?.message || error));
}, 30000);
