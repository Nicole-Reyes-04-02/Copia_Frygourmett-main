import { escapeHtml, formatCurrency, isSupabaseConfigured, isVideoAsset, resolveImage, supabase } from "./supabase.js";
import { parseRecipeText, prepareRecipeImport } from "../src/utils/recipe-import.js";
import { createMissingRecipeIngredients, saveImportedRecipe } from "./services/recipe-import.js";
import { CATEGORIAS } from "./constants/categories.js";
import { setupNotifications } from "./services/notifications.js";
import { setupStaffChat } from "./services/staff-chat.js";
import { exportInventoryExcel, exportInventoryPdf } from "./services/inventory-export.js";
import {
    ORDER_STATUSES,
    STATUS_CLASS,
    normalizeOrderStatus,
    getNextOrderStatus,
    canRoleTransitionOrder,
    getAllowedOrderOptions,
    updateOrderStatusInSupabase
} from "./order-status.js";
import {
    canRoleAccessView,
    clockInStaff,
    clockOutStaff,
    createStaffMember,
    deleteStaffMember,
    getDefaultView,
    hasAdminAccess,
    isAdministrator,
    listAttendanceShifts,
    listStaffMembers,
    normalizeRole,
    resolveUserRole,
    ROLE_LABELS,
    toggleStaffStatus,
    updateStaffMember
} from "./auth.js";
const PAYMENT_METHOD_LABELS = {
    yape: "Yape",
    plin: "Plin",
    transferencia_interbank: "Interbank",
    interbank: "Interbank",
    yape_plin: "Yape / Plin (anterior)",
    efectivo: "Efectivo",
    yape_plin: "Yape / Plin",
    tarjeta_pos: "Tarjeta (POS contra entrega)"
};
const INVENTORY_UNITS = new Set(["kg", "g", "lb", "oz", "L", "ml", "gal", "fl_oz", "taza", "cda", "cdta", "pizca", "chorro", "punado", "ud", "docena", "manojo", "diente", "rama", "al_gusto", "und.", "paq."]);
const INVENTORY_CATEGORIES = new Set([
    "Verduras y Tubérculos",
    "Carnes y Aves",
    "Panadería y Lácteos",
    "Salsas y Condimentos",
    "Bebidas",
    "Otros"
]);
const orderForm = document.getElementById("new-order-form");
const loginForm = document.getElementById("admin-login-form");
const productForm = document.getElementById("product-form");
const ingredientForm = document.getElementById("ingredient-form");
const serviceConfigForm = document.getElementById("service-config-form");
const promotionForm = document.getElementById("promotion-form");
const staffForm = document.getElementById("staff-form");
const toastRegion = document.getElementById("toast-region");

function announceDashboardRole() {
    document.body.dataset.dashboardRole = currentRole || "";
    window.dispatchEvent(new CustomEvent("frygourmett:dashboard-role-change", {
        detail: { role: currentRole }
    }));
}

let activeUser = null;
let currentRole = null;
let realAuthenticatedRole = null;
let isRoleSimulated = false;
let currentUserProfile = null;
let staffList = [];
let editingStaffId = null;
let products = [];
let orders = [];
let ingredients = [];
let recipes = [];
let attendanceRows = [];
let promotions = [];
let selectedStatus = "all";
let orderSubscription = null;
let notificationCleanup = null;
let staffChatCleanup = null;

function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " toast-error" : ""}`;
    toast.textContent = message;
    toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 4000);
}

function updateChart() {
    const labels = [12, 14, 16, 18, 20, 22];
    const counts = labels.map(() => 0);
    orders.forEach((order) => {
        const hour = new Date(order.created_at).getHours();
        const index = Math.max(0, Math.min(labels.length - 1, Math.floor((hour - 12) / 2)));
        counts[index] += 1;
    });
    const peak = Math.max(1, ...counts);
    const points = counts.map((count, index) => ({
        x: index * 140,
        y: 160 - count / peak * 140
    }));
    const path = points.slice(1).reduce((result, point, index) => {
        const previous = points[index];
        const offset = (point.x - previous.x) / 3;
        return `${result} C${previous.x + offset} ${previous.y} ${point.x - offset} ${point.y} ${point.x} ${point.y}`;
    }, `M${points[0].x} ${points[0].y}`);
    const chartLine = document.getElementById("chart-line");
    const chartArea = document.getElementById("chart-area-fill");
    if (chartLine) chartLine.setAttribute("d", path);
    if (chartArea) chartArea.setAttribute("d", `${path} L700 190 L0 190 Z`);
    const maxCount = Math.max(...counts);
    const labelsY = document.querySelectorAll(".chart-y-labels span");
    if (labelsY[0]) labelsY[0].textContent = maxCount;
    if (labelsY[1]) labelsY[1].textContent = Math.ceil(maxCount * .66);
    if (labelsY[2]) labelsY[2].textContent = Math.ceil(maxCount * .33);
    if (labelsY[3]) labelsY[3].textContent = "0";
    const peakIndex = counts.indexOf(maxCount);
    const chartPoint = document.getElementById("chart-point");
    if (chartPoint) {
        chartPoint.setAttribute("cx", String(points[peakIndex].x));
        chartPoint.setAttribute("cy", String(points[peakIndex].y));
    }
    const chartXLabels = document.getElementById("chart-x-labels");
    if (chartXLabels) {
        chartXLabels.innerHTML = labels.map((hour) => `<span>${String(hour).padStart(2, "0")}:00</span>`).join("");
    }
}

function showAuthMessage(message, isError = false) {
    const element = document.getElementById("admin-auth-message");
    element.textContent = message;
    element.classList.toggle("is-error", isError);
}

function setBusy(form, busy) {
    const controls = form.matches("button, input, select, textarea")
        ? [form]
        : [...form.querySelectorAll("button[type='submit']")];
    controls.forEach((button) => {
        button.disabled = busy;
        button.setAttribute("aria-busy", String(busy));
    });
}

function getErrorMessage(error) {
    return error?.message || "Ocurrió un error inesperado. Inténtalo de nuevo.";
}

function formatSoles(value) {
    const amount = Number(value);
    return `S/ ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

function formatInventoryQuantity(value) {
    const amount = Number(value);
    return Number.isFinite(amount)
        ? amount.toLocaleString("es-PE", { maximumFractionDigits: 3 })
        : "0";
}

function canManageInventory(role = currentRole) {
    return role === "administrador" || role === "almacenero";
}

function canManageCatalog(role = currentRole) {
    return ["administrador", "recepcionista", "almacenero"].includes(role);
}

function canManagePromotions(role = currentRole) {
    return role === "administrador" || role === "recepcionista";
}

function applyRolePermissions() {
    document.querySelectorAll("[data-administrator-only]").forEach((element) => {
        element.hidden = !isAdministrator(realAuthenticatedRole) || !isAdministrator(currentRole);
    });
    document.querySelectorAll("[data-real-administrator-only]").forEach((element) => {
        element.hidden = !isAdministrator(realAuthenticatedRole);
    });
    document.querySelectorAll("[data-admin-only]").forEach((element) => {
        element.hidden = !hasAdminAccess(currentRole);
    });
    document.querySelectorAll("[data-dashboard-visible]").forEach((element) => {
        element.hidden = !hasAdminAccess(currentRole) && currentRole !== "recepcionista";
    });

    // Ocultar / mostrar pestañas del menú lateral según el rol
    document.querySelectorAll(".side-nav .nav-link").forEach((nav) => {
        const view = nav.dataset.view;
        nav.hidden = !canRoleAccessView(currentRole, view);
    });

    // Ocultar / mostrar botones no permitidos para ciertos roles
    const topNewOrderBtn = document.querySelector(".new-order-button");
    if (topNewOrderBtn) {
        topNewOrderBtn.hidden = !isAdministrator(currentRole) && currentRole !== "recepcionista";
    }
    const exportControls = document.getElementById("export-controls");
    if (exportControls) {
        exportControls.hidden = !hasAdminAccess(currentRole) && currentRole !== "recepcionista";
    }
    const adjustInventoryBtn = document.getElementById("adjust-inventory-button");
    if (adjustInventoryBtn) {
        adjustInventoryBtn.hidden = !canManageInventory();
    }

    document.querySelectorAll("[data-inventory-write]:not(#inventory-modal)").forEach((element) => {
        element.hidden = !canManageInventory();
    });
    document.querySelectorAll("[data-catalog-write]").forEach((element) => {
        element.hidden = !canManageCatalog();
    });
    document.querySelectorAll("[data-promotion-write]").forEach((element) => {
        element.hidden = !canManagePromotions();
    });

    // Gerente consulta las recetas, pero no puede importarlas ni modificarlas.
    const recipeSection = document.querySelector(".recipe-manager");
    if (recipeSection) {
        recipeSection.hidden = !hasAdminAccess(currentRole) && currentRole !== "almacenero";
    }

    // Banner de modo de rol en Pedidos
    const banner = document.getElementById("pedidos-role-banner");
    const adminNewOrderBtn = document.getElementById("admin-new-order-btn");
    if (banner) {
        if (currentRole === "almacenero") {
            banner.hidden = false;
            banner.innerHTML = "<strong>📦 Modo Cocina / Almacén:</strong> Visualización de comandas, insumos y avance de preparación (<code>Pendiente → En preparación → Listo</code>). Despacho final reservado a reparto y admin.";
            if (adminNewOrderBtn) adminNewOrderBtn.hidden = true;
        } else if (currentRole === "repartidor") {
            banner.hidden = false;
            banner.innerHTML = "<strong>🛵 Modo Delivery:</strong> Lista de pedidos para entrega. Coordina telefónicamente con el cliente y actualiza los estados de delivery.";
            if (adminNewOrderBtn) adminNewOrderBtn.hidden = true;
        } else if (currentRole === "gerente") {
            banner.hidden = false;
            banner.innerHTML = "<strong>📊 Modo Gerencia:</strong> Consulta pedidos y métricas; las operaciones y cambios de estado están reservados a los roles autorizados.";
            if (adminNewOrderBtn) adminNewOrderBtn.hidden = true;
        } else {
            banner.hidden = true;
            if (adminNewOrderBtn) adminNewOrderBtn.hidden = !isAdministrator(currentRole) && currentRole !== "recepcionista";
        }
    }

    updateRoleSimulatorUI();
    announceDashboardRole();
}

function updateRoleSimulatorUI() {
    const simulatorSelect = document.getElementById("role-simulator-select");
    const resetBtn = document.getElementById("role-simulator-reset-btn");
    const alertBox = document.getElementById("role-simulator-alert");
    const alertText = document.getElementById("role-simulator-alert-text");
    const realLabel = document.getElementById("role-real-name-display");
    const simulatorBar = document.getElementById("role-simulator-bar");

    if (simulatorBar) {
        simulatorBar.hidden = realAuthenticatedRole !== "administrador";
    }
    if (realLabel && realAuthenticatedRole) {
        realLabel.textContent = ROLE_LABELS[realAuthenticatedRole] || realAuthenticatedRole;
    }

    if (simulatorSelect) {
        simulatorSelect.value = currentRole === realAuthenticatedRole ? "" : currentRole || "";
    }

    const isSimulating = realAuthenticatedRole === "administrador" && currentRole !== realAuthenticatedRole;
    if (resetBtn) {
        resetBtn.hidden = !isSimulating;
    }

    if (alertBox && alertText) {
        if (isSimulating) {
            alertBox.hidden = false;
            let guide = "";
            if (currentRole === "almacenero") {
                guide = "📦 <strong>Modo Simulado: ALMACENERO.</strong> Acceso enfocado a control de stock, cálculo de porciones disponibles, recetas por plato y registro de merma. Paneles de ventas, usuarios y configuración protegidos.";
            } else if (currentRole === "recepcionista") {
                guide = "📋 <strong>Modo Simulado: RECEPCIONISTA.</strong> Acceso enfocado a gestión de comandas, creación de pedidos y estado de carta. Ajustes de inventario y configuración del sistema protegidos.";
            } else if (currentRole === "repartidor") {
                guide = "🛵 <strong>Modo Simulado: REPARTIDOR.</strong> Vista de pedidos asignados a ruta y despacho. Acceso restringido a inventario y carta.";
            } else if (currentRole === "gerente") {
                guide = "📊 <strong>Modo Simulado: GERENTE.</strong> Acceso total irrestricto a todas las funciones y módulos administrativos del panel.";
            } else {
                guide = "👑 <strong>Modo Simulado: ADMINISTRADOR.</strong> Acceso total irrestricto a todas las funciones.";
            }
            alertText.innerHTML = guide;
        } else {
            alertBox.hidden = true;
        }
    }
}

function setSimulatedRole(role) {
    if (realAuthenticatedRole !== "administrador") return;
    const normalizedRole = normalizeRole(role);
    if (normalizedRole !== "administrador" && !["gerente", "recepcionista", "repartidor", "almacenero"].includes(normalizedRole)) return;
    currentRole = normalizedRole;
    isRoleSimulated = currentRole !== realAuthenticatedRole;
    const roleName = ROLE_LABELS[normalizedRole] || normalizedRole;
    const isSimulating = Boolean(realAuthenticatedRole && currentRole !== realAuthenticatedRole);

    const profileRoleEl = document.getElementById("profile-role");
    if (profileRoleEl) {
        profileRoleEl.textContent = isSimulating ? `${roleName} [SIMULADO]` : `${roleName} · Sesión activa`;
    }
    const topbarUserRole = document.getElementById("topbar-user-role");
    if (topbarUserRole) {
        topbarUserRole.textContent = isSimulating ? `${roleName} (Simulado)` : roleName;
    }

    applyRolePermissions();
    if (activeUser && !orderSubscription) void subscribeToOrders();
    if (staffChatCleanup && activeUser) {
        staffChatCleanup();
        staffChatCleanup = setupStaffChat({
            userId: activeUser.id,
            role: currentRole,
            onError: (error) => showToast(`No se pudo sincronizar el chat interno: ${getErrorMessage(error)}`, true)
        });
    }

    const targetView = adminViewFromHash(window.location.hash);
    if (!canRoleAccessView(currentRole, targetView)) {
        activateAdminView(getDefaultView(currentRole));
    } else {
        activateAdminView(targetView, false);
    }

    void loadDashboard();
    showToast(`Previsualizando vista como: ${roleName}`);
}

document.getElementById("role-simulator-select")?.addEventListener("change", (e) => {
    const chosenRole = e.target.value;
    if (chosenRole) setSimulatedRole(chosenRole);
});

document.getElementById("role-simulator-reset-btn")?.addEventListener("click", () => {
    if (realAuthenticatedRole === "administrador") {
        setSimulatedRole(realAuthenticatedRole);
        showToast(`Rol restaurado a tu usuario auténtico: ${ROLE_LABELS[realAuthenticatedRole] || realAuthenticatedRole}.`);
    }
});

async function authorize(session) {
    if (notificationCleanup) {
        notificationCleanup();
        notificationCleanup = null;
    }
    if (staffChatCleanup) {
        staffChatCleanup();
        staffChatCleanup = null;
    }

    if (!session?.user) {
        activeUser = null;
        orders = [];
        currentRole = null;
        realAuthenticatedRole = null;
        isRoleSimulated = false;
        currentUserProfile = null;
        applyRolePermissions();
        document.body.classList.remove("is-authenticated");
        if (orderSubscription) {
            await supabase.removeChannel(orderSubscription);
            orderSubscription = null;
        }
        return;
    }

    const { role, profile, isActive, isStaff } = await resolveUserRole(session.user);

    if (!isActive) {
        await supabase.auth.signOut();
        showAuthMessage("Tu cuenta de trabajador ha sido desactivada. Consulta con el administrador.", true);
        return;
    }

    if (!isStaff || role === "cliente") {
        showAuthMessage("Acceso exclusivo para el personal operativo. Redirigiendo a la web de comensales...", true);
        window.setTimeout(() => {
            window.location.href = "cliente.html";
        }, 600);
        return;
    }

    activeUser = session.user;
    currentRole = role;
    realAuthenticatedRole = role;
    isRoleSimulated = false;
    currentUserProfile = profile;
    const attendanceSessionKey = `frygourmett-attendance-started-${session.user.id}`;
    if (sessionStorage.getItem(attendanceSessionKey) !== "true") {
        const { error: attendanceError } = await supabase.rpc("marcar_entrada_turno", {
            p_personal_id: null,
            p_observacion: "Entrada automática al iniciar sesión"
        });
        if (attendanceError) {
            showToast(`No se pudo registrar la entrada automática: ${getErrorMessage(attendanceError)}`, true);
        } else {
            sessionStorage.setItem(attendanceSessionKey, "true");
        }
    }

    const roleName = ROLE_LABELS[role] || role;
    const displayName = profile?.nombre || (session.user.email ? session.user.email.split("@")[0] : "Administrador");
    const initials = (profile?.nombre || roleName || "AD").slice(0, 2).toLocaleUpperCase("es");

    document.getElementById("sidebar").classList.remove("is-open");
    document.getElementById("profile-name").textContent = profile?.nombre || session.user.email;
    document.getElementById("profile-role").textContent = `${roleName} · Sesión activa`;
    document.querySelectorAll(".avatar-profile").forEach((el) => { el.textContent = initials; });

    const topbarUserName = document.getElementById("topbar-user-name");
    if (topbarUserName) topbarUserName.textContent = displayName;
    const topbarUserRole = document.getElementById("topbar-user-role");
    if (topbarUserRole) topbarUserRole.textContent = roleName;
    const topbarAvatar = document.getElementById("topbar-avatar");
    if (topbarAvatar) topbarAvatar.textContent = initials;

    const welcomeNameEl = document.getElementById("welcome-user-name");
    if (welcomeNameEl) welcomeNameEl.textContent = profile?.nombre ? profile.nombre.split(" ")[0] : (displayName || "Administrador");
    document.body.classList.add("is-authenticated");
    showAuthMessage("");

    applyRolePermissions();
    notificationCleanup = setupNotifications({
        userId: session.user.id,
        role: realAuthenticatedRole,
        onError: (error) => showToast(`No se pudieron sincronizar las notificaciones: ${getErrorMessage(error)}`, true)
    });
    staffChatCleanup = setupStaffChat({
        userId: session.user.id,
        role: realAuthenticatedRole,
        onError: (error) => showToast(`No se pudo sincronizar el chat interno: ${getErrorMessage(error)}`, true)
    });

    const targetView = adminViewFromHash(window.location.hash);
    if (!canRoleAccessView(currentRole, targetView)) {
        activateAdminView(getDefaultView(currentRole));
    } else {
        activateAdminView(targetView);
    }

    await loadDashboard();
    subscribeToOrders();
}

async function loadDashboard() {
    const loaders = [];
    if (canRoleAccessView(currentRole, "resumen") || canRoleAccessView(currentRole, "menu")) {
        loaders.push(loadProducts());
    }
    if (canRoleAccessView(currentRole, "pedidos") || canRoleAccessView(currentRole, "resumen")) {
        loaders.push(loadOrders());
    }
    if (canRoleAccessView(currentRole, "inventario") || canRoleAccessView(currentRole, "menu")) {
        loaders.push(loadIngredients());
        loaders.push(loadRecipes());
    }
    if (canRoleAccessView(currentRole, "opiniones")) {
        loaders.push(loadReviews());
    }
    if (canRoleAccessView(currentRole, "menu")) {
        if (canManagePromotions()) loaders.push(loadPromotions());
    }
    if (canRoleAccessView(currentRole, "personal")) {
        loaders.push(loadAttendance());
        if (hasAdminAccess(currentRole)) {
            loaders.push(loadStaff());
        }
        if (isAdministrator(currentRole)) {
            loaders.push(loadServiceConfiguration());
        }
    }
    await Promise.all(loaders);
    if (hasAdminAccess(currentRole) || currentRole === "almacenero") {
        renderAttendanceTable();
        populateRecipeOptions();
        renderProductRecipeBuilder(null);
    }
}

async function loadProducts() {
    const { data, error } = await supabase
        .from("productos")
        .select("*")
        .order("categoria")
        .order("nombre");
    if (error) {
        showToast(`No pudimos cargar la carta: ${getErrorMessage(error)}`, true);
        return;
    }
    products = data;
    renderProducts();
    populateOrderProducts();
    populateRecipeOptions();
    renderRecipeManager();
}

async function loadOrders(meta = {}) {
    const { data, error } = await supabase
        .from("pedidos")
        .select("*")
        .order("created_at", { ascending: false });
    if (error) {
        showToast(`No pudimos cargar los pedidos: ${getErrorMessage(error)}`, true);
        return;
    }
    orders = data || [];
    window.__frygourmettOrders = orders;
    renderOrders();
    window.dispatchEvent(new CustomEvent("frygourmett:orders-updated", {
        detail: {
            orders,
            eventType: meta.eventType || "reload",
            order: meta.order || null
        }
    }));
}

async function loadIngredients() {
    const { data, error } = await supabase
        .from("ingredientes")
        .select("*")
        .order("nombre");
    if (error) {
        showToast(`No pudimos cargar el inventario: ${getErrorMessage(error)}`, true);
        return;
    }
    ingredients = data;
    renderIngredients();
    populateRecipeOptions();
    refreshRecipeBuilderIngredientOptions();
    renderRecipeManager();
    renderProducts();
}

document.getElementById("inventory-export-pdf")?.addEventListener("click", () => {
    try {
        exportInventoryPdf(ingredients);
        showToast("Inventario exportado a PDF.");
    } catch (error) {
        showToast(`No se pudo exportar el inventario a PDF: ${getErrorMessage(error)}`, true);
    }
});

document.getElementById("inventory-export-excel")?.addEventListener("click", () => {
    try {
        exportInventoryExcel(ingredients);
        showToast("Inventario exportado a Excel.");
    } catch (error) {
        showToast(`No se pudo exportar el inventario a Excel: ${getErrorMessage(error)}`, true);
    }
});

async function loadRecipes() {
    const { data, error } = await supabase.from("producto_insumos")
        .select("*")
        .order("created_at", { ascending: false });
    if (error) {
        showToast(`No pudimos cargar las recetas: ${getErrorMessage(error)}`, true);
        return;
    }
    recipes = (data || []).map((r) => {
        const net = r.cantidad_neta !== undefined && r.cantidad_neta !== null && Number(r.cantidad_neta) > 0
            ? Number(r.cantidad_neta)
            : Number(r.cantidad_por_porcion || 1);
        const waste = r.porcentaje_merma !== undefined && r.porcentaje_merma !== null
            ? Number(r.porcentaje_merma)
            : 0;
        const gross = Number(r.cantidad_por_porcion || (net * (1 + waste / 100)) || 1);
        return {
            ...r,
            cantidad_neta: net,
            porcentaje_merma: waste,
            cantidad_por_porcion: gross
        };
    });
    renderRecipeManager();
    renderProducts();
}

function populateRecipeOptions() {
    const select = document.getElementById("recipe-product");
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = `<option value="">Todos los platos</option>${products.map((product) =>
        `<option value="${escapeHtml(product.id)}">${escapeHtml(product.nombre)}</option>`
    ).join("")}`;
    if (products.some((product) => product.id === previousValue)) {
        select.value = previousValue;
    }
}

function renderRecipeManager() {
    const tbody = document.getElementById("recipe-body");
    if (!tbody) return;
    const productById = new Map(products.map((product) => [product.id, product]));
    const ingredientById = new Map(ingredients.map((item) => [item.id, item]));
    const recipesByProduct = new Map();
    recipes.forEach((recipe) => {
        const group = recipesByProduct.get(recipe.producto_id) || [];
        group.push(recipe);
        recipesByProduct.set(recipe.producto_id, group);
    });

    const selectedProductId = document.getElementById("recipe-product")?.value || "";
    const visibleProducts = selectedProductId
        ? products.filter((product) => product.id === selectedProductId)
        : products.filter((product) => recipesByProduct.has(product.id));
    const orphanProductIds = [...recipesByProduct.keys()].filter((id) => !productById.has(id));
    const groups = [
        ...visibleProducts.map((product) => ({
            id: product.id,
            name: product.nombre,
            items: recipesByProduct.get(product.id) || []
        })),
        ...(!selectedProductId ? orphanProductIds.map((id) => ({
            id,
            name: "Plato eliminado",
            items: recipesByProduct.get(id) || []
        })) : [])
    ];

    if (!groups.length) {
        tbody.innerHTML = `<tr><td>${selectedProductId
            ? "Este plato todavía no tiene insumos vinculados."
            : "No hay recetas configuradas. Selecciona un plato o añade su receta desde el formulario de Carta."}</td></tr>`;
        return;
    }

    const canDeleteRecipes = currentRole === "administrador" || currentRole === "almacenero";
    const formatRecipeAmount = (value) => Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    tbody.innerHTML = groups.map((group) => {
        const ingredientRows = group.items.map((recipe) => {
            const ingredient = ingredientById.get(recipe.ingrediente_id);
            const net = Number(recipe.cantidad_neta || recipe.cantidad_por_porcion || 0);
            const waste = Number(recipe.porcentaje_merma || 0);
            const real = Number(recipe.cantidad_por_porcion ?? net * (1 + waste / 100));
            const unit = String(ingredient?.unidad || "");
            return `<li>
                <div class="recipe-group-ingredient-info">
                    <strong>${escapeHtml(ingredient?.nombre || "Insumo eliminado")}</strong>
                    <small>Neto: ${escapeHtml(formatRecipeAmount(net))} ${escapeHtml(unit)} · Merma: ${escapeHtml(formatRecipeAmount(waste))}% · Consumo real: ${escapeHtml(formatRecipeAmount(real))} ${escapeHtml(unit)}</small>
                </div>
                ${canDeleteRecipes ? `<button class="inventory-delete" type="button" data-delete-recipe="${escapeHtml(recipe.id)}" aria-label="Eliminar ${escapeHtml(ingredient?.nombre || "insumo")} de ${escapeHtml(group.name)}">Eliminar</button>` : ""}
            </li>`;
        }).join("");

        return `<tr><td>
            <details class="recipe-group-details">
                <summary>
                    <span class="recipe-group-name">${escapeHtml(group.name)}</span>
                    <span class="recipe-group-count">${group.items.length} ${group.items.length === 1 ? "insumo" : "insumos"}</span>
                </summary>
                <ul class="recipe-group-list">${ingredientRows || '<li class="recipe-group-empty">Este plato todavía no tiene insumos vinculados.</li>'}</ul>
            </details>
        </td></tr>`;
    }).join("");
}

async function loadPromotions() {
    const { data, error } = await supabase.from("promociones")
        .select("*")
        .order("orden")
        .order("created_at");
    if (error) {
        showToast(`No pudimos cargar los destacados: ${getErrorMessage(error)}`, true);
        return;
    }
    promotions = data || [];
    renderPromotions();
}

function renderPromotions() {
    const list = document.getElementById("promotion-list");
    list.innerHTML = promotions.length
        ? promotions.map((promotion) => `<article class="promotion-row">
            <div class="promotion-preview">${promotion.tipo_media === "video"
                ? `<video src="${escapeHtml(resolveImage(promotion.media_url))}" muted playsinline preload="metadata"></video>`
                : `<img src="${escapeHtml(resolveImage(promotion.media_url))}" alt="" loading="lazy">`}</div>
            <span class="promotion-row-copy"><strong>${escapeHtml(promotion.titulo)}</strong><small>${escapeHtml(promotion.descripcion || "Sin descripción")}</small></span>
            <span class="promotion-row-status">${promotion.activa ? "Publicado" : "Oculto"}</span>
            <span class="product-row-actions">
                <button type="button" data-edit-promotion="${escapeHtml(promotion.id)}">Editar</button>
                <button type="button" data-delete-promotion="${escapeHtml(promotion.id)}">Eliminar</button>
            </span>
        </article>`).join("")
        : '<p class="product-empty">Todavía no hay destacados. Añade promociones, platos estrella o videos para el carrusel.</p>';
}

async function loadReviews() {
    const { data, error } = await supabase
        .from("opiniones")
        .select("id, puntuacion, comentario, created_at, pedidos(cliente_nombre)")
        .order("created_at", { ascending: false })
        .limit(20);
    if (error) {
        showToast(`No pudimos cargar las opiniones: ${getErrorMessage(error)}`, true);
        return;
    }
    const rating = data.length
        ? (data.reduce((sum, review) => sum + review.puntuacion, 0) / data.length).toFixed(1)
        : "—";
    document.getElementById("review-average").textContent = data.length ? `★ ${rating} / 5` : "Sin calificaciones";
    document.getElementById("review-list").innerHTML = data.length
        ? data.map((review) => `<article class="review-item">
            <span class="review-stars" aria-label="${review.puntuacion} de 5 estrellas">${"★".repeat(review.puntuacion)}${"☆".repeat(5 - review.puntuacion)}</span>
            <strong>${escapeHtml(review.pedidos?.cliente_nombre || "Comensal")}</strong>
            <p>${escapeHtml(review.comentario || "Calificación sin comentario.")}</p>
            ${isAdministrator(currentRole) ? `
                <div style="margin-top:10px;">
                    <button type="button" class="staff-btn btn-danger" data-delete-review="${escapeHtml(review.id)}">Eliminar opinión</button>
                </div>
            ` : ""}
        </article>`).join("")
        : '<p class="empty-reviews">Aún no hay calificaciones enviadas por comensales.</p>';
}

function calculateProductStockPortions(productId) {
    if (!recipes || !recipes.length || !ingredients || !ingredients.length) return null;
    const dishRecipes = recipes.filter((r) => r.producto_id === productId);
    if (!dishRecipes.length) return null;

    let minPortions = Infinity;
    let limitingIngredient = null;

    for (const item of dishRecipes) {
        const ing = ingredients.find((i) => i.id === item.ingrediente_id);
        const stockQty = Number(ing?.cantidad || 0);
        const net = item.cantidad_neta !== undefined && item.cantidad_neta !== null && Number(item.cantidad_neta) > 0
            ? Number(item.cantidad_neta)
            : Number(item.cantidad_por_porcion || 1);
        const waste = Number(item.porcentaje_merma || 0);
        const reqQty = Number(item.cantidad_por_porcion || (net * (1 + waste / 100)) || 1);
        const possible = reqQty > 0 ? Math.floor(stockQty / reqQty) : 0;
        if (possible < minPortions) {
            minPortions = possible;
            limitingIngredient = ing ? ing.nombre : "Insumo faltante";
        }
    }
    const finalPortions = Number.isFinite(minPortions) ? Math.max(0, minPortions) : null;
    return {
        portions: finalPortions,
        limitingIngredient,
        hasRecipe: true,
        recipeCount: dishRecipes.length
    };
}

function renderProducts() {
    const list = document.getElementById("product-list");
    const canEditCatalog = canManageCatalog();
    list.innerHTML = products.length
        ? products.map((product) => {
            const stockInfo = calculateProductStockPortions(product.id);
            let portionBadge = "";
            if (!stockInfo || !stockInfo.hasRecipe) {
                portionBadge = `<span class="badge-stock badge-stock-pending" title="Asocia insumos en Recetas y producción para calcular existencias reales">⚠️ Receta pendiente</span>`;
            } else if (stockInfo.portions === 0) {
                portionBadge = `<span class="badge-stock badge-stock-empty" title="Agotado: falta stock de ${escapeHtml(stockInfo.limitingIngredient)}">❌ 0 porc. (Falta: ${escapeHtml(stockInfo.limitingIngredient)})</span>`;
            } else if (stockInfo.portions <= 5) {
                portionBadge = `<span class="badge-stock badge-stock-low" title="Stock bajo limitado por: ${escapeHtml(stockInfo.limitingIngredient)}">⚠️ ${stockInfo.portions} porc. disp.</span>`;
            } else {
                portionBadge = `<span class="badge-stock badge-stock-ok" title="Receta activa con ${stockInfo.recipeCount} insumos enlazados">✓ ${stockInfo.portions} porc. disp. (Stock)</span>`;
            }

            return `<article class="product-row" data-category="${escapeHtml(product.categoria)}">
                ${isVideoAsset(product.imagen_url)
                    ? `<video src="${escapeHtml(resolveImage(product.imagen_url))}" controls muted playsinline preload="metadata" poster="${escapeHtml(resolveImage("img/delifrygour.webp"))}" aria-label="Video de ${escapeHtml(product.nombre)}"></video>`
                    : `<img src="${escapeHtml(resolveImage(product.imagen_url || "img/delifrygour.webp"))}" alt="" loading="lazy">`}
                <span class="product-row-copy"><strong>${escapeHtml(product.nombre)}</strong><small>${escapeHtml(product.categoria)} · ${escapeHtml(product.descripcion)}</small></span>
                <strong class="product-row-price">${formatCurrency(product.precio)}</strong>
                <small class="product-production">${portionBadge}</small>
                ${canEditCatalog ? `<button class="availability-toggle" type="button" data-toggle-availability="${product.id}" aria-pressed="${product.disponible}">${product.disponible ? "Disponible" : "Agotado"}</button>
                <span class="product-row-actions">
                    <button type="button" data-edit-product="${product.id}">Editar</button>
                    <button type="button" data-delete-product="${product.id}" aria-label="Eliminar ${escapeHtml(product.nombre)}">Eliminar</button>
                </span>` : ""}
            </article>`;
        }).join("")
        : '<p class="product-empty">Todavía no hay platos en la carta. Añade el primer plato para publicarlo.</p>';
    applyProductCategoryFilter();
}

let selectedProductCategory = "";

function normalizeCategoryFilter(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function applyProductCategoryFilter() {
    const selected = normalizeCategoryFilter(selectedProductCategory);
    document.querySelectorAll("#product-list .product-row").forEach((row) => {
        row.hidden = selected !== "" && normalizeCategoryFilter(row.dataset.category) !== selected;
    });
}

function setupProductCategoryFilter() {
    const container = document.getElementById("carousel-category-selector");
    if (!container) return;

    container.innerHTML = [
        `<button type="button" class="carousel-cat-pill is-active" data-category-filter="" aria-pressed="true">Todos los platos</button>`,
        ...CATEGORIAS.map((category) =>
            `<button type="button" class="carousel-cat-pill" data-category-filter="${escapeHtml(category)}" aria-pressed="false">${escapeHtml(category)}</button>`
        )
    ].join("");

    container.addEventListener("click", (event) => {
        const button = event.target.closest("[data-category-filter]");
        if (!button || !container.contains(button)) return;
        selectedProductCategory = button.dataset.categoryFilter || "";
        container.querySelectorAll("[data-category-filter]").forEach((option) => {
            const isSelected = option === button;
            option.classList.toggle("is-active", isSelected);
            option.setAttribute("aria-pressed", String(isSelected));
        });
        applyProductCategoryFilter();
    });
}

setupProductCategoryFilter();

function populateOrderProducts() {
    const select = orderForm.elements.dish;
    const availableProducts = products.filter((product) =>
        product.disponible && Number(product.porciones_disponibles) > 0
    );
    select.innerHTML = `<option value="">Selecciona un plato</option>${availableProducts.map((product) =>
        `<option value="${product.id}">${escapeHtml(product.nombre)} · ${formatCurrency(product.precio)}</option>`
    ).join("")}`;
}

function formatOrderDate(value) {
    return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function getPaymentDetails(order) {
    const details = order.detalles_pago && typeof order.detalles_pago === "object"
        ? order.detalles_pago
        : {};
    if (["yape", "plin", "transferencia_interbank", "yape_plin"].includes(order.metodo_pago)) {
        if (order.metodo_pago !== "yape_plin") {
            return "Pago digital pendiente de comprobante o verificación.";
        }
        const reference = String(details.referencia_transferencia || "").trim();
        return reference
            ? `Referencia de transferencia: ${reference}`
            : "Sin referencia informada; coordinar el número oficial con el cliente.";
    }
    if (order.metodo_pago === "efectivo") {
        if (details.monto_entregado === null || details.monto_entregado === undefined || details.monto_entregado === "") {
            return "Vuelto no indicado.";
        }
        const amount = Number(details.monto_entregado);
        if (!Number.isFinite(amount)) return "Importe de efectivo no válido.";
        return `Paga con ${formatCurrency(amount)} · Vuelto: ${formatCurrency(Math.max(0, amount - Number(order.total || 0)))}.`;
    }
    if (order.metodo_pago === "tarjeta_pos") return "Cobrar con POS al momento de la entrega.";
    return "Método de pago no especificado (pedido anterior).";
}

function showOrderDetail(order) {
    const methodLabel = PAYMENT_METHOD_LABELS[order.metodo_pago] || "No especificado";
    document.getElementById("order-detail-title").textContent = `Pedido #${order.id.slice(0, 8).toLocaleUpperCase("es")}`;
    document.getElementById("order-detail-customer").innerHTML = `<strong>${escapeHtml(order.cliente_nombre)}</strong><br><a href="tel:${escapeHtml(order.telefono_contacto)}" class="delivery-phone-highlight" style="font-size:12px;">📞 ${escapeHtml(order.telefono_contacto || "Sin teléfono")}</a>`;
    document.getElementById("order-detail-address").innerHTML = `<strong>${escapeHtml(order.distrito_zona)}</strong><br>${escapeHtml(order.direccion_entrega)}${order.referencia ? `<br><small style="color:var(--muted);">Ref. ${escapeHtml(order.referencia)}</small>` : ""}`;
    document.getElementById("order-detail-items").textContent = order.items
        .map((item) => `${item.cantidad} × ${item.nombre}`)
        .join(", ");
    document.getElementById("order-detail-total").textContent = formatCurrency(order.total);
    document.getElementById("order-detail-payment-method").textContent = methodLabel;
    document.getElementById("order-detail-payment-details").textContent = getPaymentDetails(order);
    document.getElementById("order-detail-modal").hidden = false;
    document.body.classList.add("modal-open");
}

function closeOrderDetail() {
    document.getElementById("order-detail-modal").hidden = true;
    document.body.classList.remove("modal-open");
}

function renderOrderStatusCell(order) {
    const current = normalizeOrderStatus(order.estado);
    const next = getNextOrderStatus(current);
    const idLabel = String(order.id || "").slice(0, 8).toLocaleUpperCase("es");
    const allowedOptions = getAllowedOrderOptions(currentRole, current);
    const canAdvance = Boolean(next && canRoleTransitionOrder(currentRole, current, next));
    const canSelect = allowedOptions.length > 1;

    if (current === "Entregado") {
        if (canSelect) {
            const options = allowedOptions.map((status) =>
                `<option value="${escapeHtml(status)}"${status === current ? " selected" : ""}>${escapeHtml(status)}</option>`
            ).join("");
            return `<div class="order-status-controls">
                <label class="visually-hidden" for="status-${escapeHtml(order.id)}">Estado del pedido ${escapeHtml(idLabel)}</label>
                <select class="status-select" id="status-${escapeHtml(order.id)}" data-order-id="${escapeHtml(order.id)}">${options}</select>
                <span class="order-read-badge is-final" title="Pedido finalizado">Finalizado</span>
            </div>`;
        }
        return `<span class="order-read-badge is-final" title="Pedido finalizado">Entregado · Finalizado</span>`;
    }

    if (canAdvance || canSelect) {
        const options = allowedOptions.map((status) =>
            `<option value="${escapeHtml(status)}"${status === current ? " selected" : ""}>${escapeHtml(status)}</option>`
        ).join("");
        const btnClass = STATUS_CLASS[current] || "st-pend";
        const advanceButtonHtml = canAdvance
            ? `<button type="button" class="pm-status-btn ${btnClass}" data-advance-order="${escapeHtml(order.id)}" data-current-status="${escapeHtml(current)}" title="Avanzar a «${escapeHtml(next)}»">
                <span>→ ${escapeHtml(next)}</span>
            </button>`
            : "";
        return `<div class="order-status-controls">
            <label class="visually-hidden" for="status-${escapeHtml(order.id)}">Estado del pedido ${escapeHtml(idLabel)}</label>
            <select class="status-select" id="status-${escapeHtml(order.id)}" data-order-id="${escapeHtml(order.id)}">${options}</select>
            ${advanceButtonHtml}
        </div>`;
    }

    return `<span class="order-read-badge">${escapeHtml(current || order.estado)}</span>`;
}

function renderOrders() {
    const searchInput = document.getElementById("order-search");
    const ordersBody = document.getElementById("orders-body");
    if (!ordersBody) return;

    const query = (searchInput?.value || "").trim().toLocaleLowerCase("es");
    const visibleOrders = orders.filter((order) => {
        const matchesStatus = selectedStatus === "all" || normalizeOrderStatus(order.estado) === selectedStatus;
        const itemsList = Array.isArray(order.items) ? order.items : [];
        const text = `${order.id} ${order.cliente_nombre} ${order.cliente_email} ${order.telefono_contacto} ${order.direccion_entrega} ${order.distrito_zona} ${order.referencia} ${itemsList.map((item) => item.nombre).join(" ")}`.toLocaleLowerCase("es");
        return matchesStatus && text.includes(query);
    });

    const thead = document.querySelector(".orders-table thead");

    if (currentRole === "almacenero") {
        if (thead) {
            thead.innerHTML = `<tr><th>Pedido</th><th>Comanda y platos</th><th>Cant. total</th><th>Observaciones / Nota</th><th>Hora</th><th>Estado</th></tr>`;
        }
        ordersBody.innerHTML = visibleOrders.map((order) => {
            const itemsArr = Array.isArray(order.items) ? order.items : [];
            const itemsList = itemsArr.map((item) => `<strong>${item.cantidad} ×</strong> ${escapeHtml(item.nombre)}`).join("<br>");
            const totalQty = itemsArr.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
            const idLabel = String(order.id || "").slice(0, 8).toLocaleUpperCase("es");
            const noteContent = order.nota
                ? `<div class="kitchen-notes-highlight">📝 ${escapeHtml(order.nota)}</div>`
                : '<span style="color:var(--muted);">Sin notas especiales</span>';

            return `<tr>
                <td><span class="order-number">#${escapeHtml(idLabel)}</span></td>
                <td><div style="line-height:1.5;">${itemsList}</div></td>
                <td><strong style="font-size:12px;">${totalQty} uds.</strong></td>
                <td>${noteContent}</td>
                <td>${escapeHtml(formatOrderDate(order.created_at))}</td>
                <td>${renderOrderStatusCell(order)}</td>
            </tr>`;
        }).join("");
    } else if (currentRole === "repartidor") {
        if (thead) {
            thead.innerHTML = `<tr><th>Pedido</th><th>Cliente y Teléfono</th><th>Dirección de entrega</th><th>Platos</th><th>Total</th><th>Estado de entrega</th></tr>`;
        }
        ordersBody.innerHTML = visibleOrders.map((order) => {
            const itemsArr = Array.isArray(order.items) ? order.items : [];
            const itemSummary = itemsArr.map((item) => `${item.cantidad} × ${item.nombre}`).join(", ");
            const idLabel = String(order.id || "").slice(0, 8).toLocaleUpperCase("es");

            return `<tr>
                <td><span class="order-number">#${escapeHtml(idLabel)}</span><br><small style="color:var(--muted);">${escapeHtml(formatOrderDate(order.created_at))}</small></td>
                <td>
                    <strong>${escapeHtml(order.cliente_nombre)}</strong><br>
                    <a href="tel:${escapeHtml(order.telefono_contacto)}" class="delivery-phone-highlight">📞 ${escapeHtml(order.telefono_contacto || "Sin teléfono")}</a>
                </td>
                <td>
                    <div style="line-height:1.4;">
                        <strong>${escapeHtml(order.distrito_zona)}</strong><br>
                        ${escapeHtml(order.direccion_entrega)}
                        ${order.referencia ? `<br><small style="color:var(--muted);">Ref: ${escapeHtml(order.referencia)}</small>` : ""}
                    </div>
                </td>
                <td><span class="dish-cell">${escapeHtml(itemSummary)}</span></td>
                <td>
                    <strong class="order-total">${formatCurrency(order.total)}</strong><br>
                    <small style="color:var(--muted);">${escapeHtml(PAYMENT_METHOD_LABELS[order.metodo_pago] || "Efectivo")}</small>
                </td>
                <td>${renderOrderStatusCell(order)}</td>
            </tr>`;
        }).join("");
    } else if (currentRole === "gerente") {
        if (thead) {
            thead.innerHTML = `<tr><th>Pedido</th><th>Cliente / entrega</th><th>Platos</th><th>Hora</th><th>Total</th><th>Estado</th></tr>`;
        }
        ordersBody.innerHTML = visibleOrders.map((order) => {
            const itemsArr = Array.isArray(order.items) ? order.items : [];
            const itemSummary = itemsArr.map((item) => `${item.cantidad} × ${item.nombre}`).join(", ");
            const idLabel = String(order.id || "").slice(0, 8).toLocaleUpperCase("es");
            return `<tr>
                <td><span class="order-number">#${escapeHtml(idLabel)}</span></td>
                <td><div class="customer-cell"><span class="avatar">${escapeHtml((order.cliente_nombre || "C").slice(0, 2).toLocaleUpperCase("es"))}</span><span><span class="customer-name">${escapeHtml(order.cliente_nombre)}</span><small class="delivery-details">${escapeHtml(order.distrito_zona)} · ${escapeHtml(order.direccion_entrega)}</small></span></div></td>
                <td><span class="dish-cell">${escapeHtml(itemSummary || "Pedido")}</span></td>
                <td>${escapeHtml(formatOrderDate(order.created_at))}</td>
                <td class="order-total">${formatCurrency(order.total)}</td>
                <td><span class="order-read-badge">${escapeHtml(normalizeOrderStatus(order.estado))}</span></td>
            </tr>`;
        }).join("");
    } else {
        // Administrador o Recepcionista
        if (thead) {
            thead.innerHTML = `<tr><th>Pedido</th><th>Cliente / entrega</th><th>Platos</th><th>Hora</th><th>Total</th><th>Estado</th><th><span class="visually-hidden">Acciones</span></th></tr>`;
        }
        ordersBody.innerHTML = visibleOrders.map((order) => {
            const itemsArr = Array.isArray(order.items) ? order.items : [];
            const firstItem = itemsArr[0];
            const itemSummary = itemsArr.map((item) => `${item.cantidad} × ${item.nombre}`).join(", ");
            const idLabel = String(order.id || "").slice(0, 8).toLocaleUpperCase("es");
            return `<tr>
                <td><span class="order-number">#${escapeHtml(idLabel)}</span></td>
                <td><div class="customer-cell"><span class="avatar">${escapeHtml((order.cliente_nombre || "C").slice(0, 2).toLocaleUpperCase("es"))}</span><span><span class="customer-name">${escapeHtml(order.cliente_nombre)}</span><small class="delivery-details"><strong>Tel: ${escapeHtml(order.telefono_contacto)}</strong> · ${escapeHtml(order.distrito_zona)}</small><small class="delivery-details">${escapeHtml(order.direccion_entrega)}</small>${order.referencia ? `<small class="delivery-details">Ref. ${escapeHtml(order.referencia)}</small>` : ""}<small class="delivery-details">Pago: ${escapeHtml(PAYMENT_METHOD_LABELS[order.metodo_pago] || "No especificado")}</small>${order.nota ? `<small class="customer-note">${escapeHtml(order.nota)}</small>` : ""}</span></div></td>
                <td><span class="dish-cell">${escapeHtml(itemSummary || firstItem?.nombre || "Pedido")}</span></td>
                <td>${escapeHtml(formatOrderDate(order.created_at))}</td>
                <td class="order-total">${formatCurrency(order.total)}</td>
                <td>${renderOrderStatusCell(order)}</td>
                <td><button class="row-menu" type="button" data-order-detail="${escapeHtml(order.id)}" aria-label="Ver detalle del pedido ${escapeHtml(idLabel)}">···</button></td>
            </tr>`;
        }).join("");
    }

    const emptyState = document.getElementById("empty-state");
    if (emptyState) emptyState.hidden = visibleOrders.length > 0;
    const resultsLabel = document.getElementById("results-label");
    if (resultsLabel) resultsLabel.textContent = `Mostrando ${visibleOrders.length} de ${orders.length} pedidos`;
    renderMetrics();
}

function renderMetrics() {
    const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [
        status,
        orders.filter((order) => normalizeOrderStatus(order.estado) === status).length
    ]));
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setText("metric-orders", orders.length);
    setText("metric-revenue", formatCurrency(
        orders.reduce((sum, order) => sum + Number(order.total), 0)
    ));
    setText("metric-preparing", counts["En preparación"] || 0);
    setText("metric-completed", counts.Entregado || 0);
    setText("nav-order-count", orders.length);
    setText("count-all", orders.length);
    setText("count-pending", counts.Pendiente || 0);
    setText("count-preparing", counts["En preparación"] || 0);
    setText("count-ready", counts.Listo || 0);
    setText("count-delivering", counts["En camino"] || 0);
    setText("count-delivered", counts.Entregado || 0);
    setText("chart-total", orders.length);

    const prepProgress = document.getElementById("preparing-progress");
    if (prepProgress) prepProgress.style.width = `${orders.length ? (counts["En preparación"] || 0) / orders.length * 100 : 0}%`;
    const compProgress = document.getElementById("completed-progress");
    if (compProgress) compProgress.style.width = `${orders.length ? (counts.Entregado || 0) / orders.length * 100 : 0}%`;

    updateChart();
    const popularList = document.getElementById("popular-list");
    if (popularList) {
        popularList.innerHTML = getPopularProducts().map(({ name, quantity }) => `
            <div class="popular-item"><span class="popular-thumb" aria-hidden="true">✦</span>
            <span class="popular-copy"><strong>${escapeHtml(name)}</strong><small>${quantity} unidades solicitadas</small></span></div>`
        ).join("") || '<p class="empty-reviews">Los platos más pedidos aparecerán aquí.</p>';
    }
}

function getPopularProducts() {
    const popularity = new Map();
    orders.forEach((order) => order.items.forEach((item) => {
        popularity.set(item.nombre, (popularity.get(item.nombre) || 0) + item.cantidad);
    }));
    return [...popularity].map(([name, quantity]) => ({ name, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 3);
}

function renderIngredients() {
    document.getElementById("inventory-body").innerHTML = ingredients.length ? ingredients.map((item) => {
        const quantity = Number(item.cantidad) || 0;
        const minimum = Number(item.minimo) || 0;
        const unitPrice = Number(item.precio_unitario) || 0;
        const stockValue = quantity * unitPrice;
        const status = quantity <= 0
            ? { label: "Agotado", className: "stock-out" }
            : quantity <= minimum
                ? { label: "Stock bajo", className: "stock-low" }
                : { label: "Disponible", className: "stock-ok" };
        return `<tr>
            <td><strong>${escapeHtml(item.nombre)}</strong></td>
            <td>${escapeHtml(item.categoria || "General")}</td>
            <td>${escapeHtml(formatInventoryQuantity(quantity))} ${escapeHtml(String(item.unidad || "").trim())}</td>
            <td>${escapeHtml(formatInventoryQuantity(minimum))} ${escapeHtml(String(item.unidad || "").trim())}</td>
            <td>${formatSoles(unitPrice)}</td>
            <td>${formatSoles(stockValue)}</td>
            <td><span class="stock-status ${status.className}">${status.label}</span></td>
            <td><div class="inventory-actions">
                ${canManageInventory() ? `<button class="inventory-edit" type="button" data-edit-inventory="${escapeHtml(item.id)}">Ajustar</button>` : ""}
                ${isAdministrator(currentRole) ? `<button class="inventory-delete" type="button" data-delete-inventory="${escapeHtml(item.id)}">Eliminar</button>` : ""}
            </div></td>
        </tr>`;
    }).join("") : '<tr><td colspan="8">Añade ingredientes para registrar el inventario real.</td></tr>';
    const lowCount = ingredients.filter((item) => Number(item.cantidad) > 0
        && Number(item.cantidad) <= Number(item.minimo)).length;
    const outCount = ingredients.filter((item) => Number(item.cantidad) <= 0).length;
    const inventoryValue = ingredients.reduce((sum, item) =>
        sum + Number(item.cantidad || 0) * Number(item.precio_unitario || 0), 0);
    document.getElementById("inventory-total-value").textContent = formatSoles(inventoryValue);
    document.getElementById("inventory-footnote").textContent = outCount || lowCount
        ? `${outCount} agotado${outCount === 1 ? "" : "s"} · ${lowCount} con stock bajo.`
        : "Existencias sincronizadas con la base de datos.";
    document.getElementById("inventory-item-select").innerHTML = ingredients.map((item) =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nombre)} · ${escapeHtml(String(item.unidad || "").trim())}</option>`
    ).join("");
}

function openOrderModal() {
    if (!isAdministrator(currentRole) && currentRole !== "recepcionista") {
        showToast("Solo administradores y recepcionistas pueden crear pedidos operativos.", true);
        return;
    }
    activateAdminView("pedidos");
    populateOrderProducts();
    document.getElementById("order-modal").hidden = false;
    document.body.classList.add("modal-open");
    orderForm.elements.customer.focus();
}

function closeOrderModal() {
    document.getElementById("order-modal").hidden = true;
    document.body.classList.remove("modal-open");
}

// ========================================================
// RECETA DEL PLATO Y CONTROL DE MERMA (USO INTERNO)
// Relaciona insumos del Inventario, calcula consumo real y merma
// ========================================================
function createRecipeRow(initialIngId = "", initialNetQty = "", initialWastePct = 0) {
    const row = document.createElement("div");
    row.className = "recipe-ingredient-row";

    const optionsHtml = [
        '<option value="">Selecciona un insumo de Inventario...</option>',
        ...ingredients.map((item) => {
            const stockQty = Number(item.cantidad || 0);
            const unit = item.unidad || "und.";
            return `<option value="${escapeHtml(item.id)}" data-unit="${escapeHtml(unit)}" data-stock="${stockQty}" ${item.id === initialIngId ? "selected" : ""}>${escapeHtml(item.nombre)} — Stock: ${formatInventoryQuantity(stockQty)} ${escapeHtml(unit)}</option>`;
        })
    ].join("");

    const initialIng = ingredients.find((i) => i.id === initialIngId);
    const unitText = initialIng ? (initialIng.unidad || "und.") : "und.";
    const netFormatted = initialNetQty ? Number(initialNetQty).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : '';
    const wasteFormatted = Number.isFinite(Number(initialWastePct)) && Number(initialWastePct) > 0 ? Number(initialWastePct) : '0';

    row.innerHTML = `
        <select class="recipe-ing-select" required aria-label="Insumo de inventario">
            ${optionsHtml}
        </select>
        <div class="recipe-ing-net-wrap" title="Cantidad neta que va en el plato">
            <input type="number" class="recipe-ing-net" min="0.001" step="0.001" max="99999" value="${netFormatted}" placeholder="Neta" required aria-label="Cantidad neta">
            <span class="recipe-ing-unit">${escapeHtml(unitText)}</span>
        </div>
        <div class="recipe-ing-waste-wrap" title="Factor / Porcentaje de merma por corte o cocción">
            <input type="number" class="recipe-ing-waste" min="0" max="99.9" step="0.1" value="${wasteFormatted}" placeholder="0" aria-label="Porcentaje de merma">
            <span class="recipe-ing-waste-pct">%</span>
        </div>
        <span class="recipe-ing-gross" title="Consumo real de stock por porción (Cantidad neta + merma)">0 ${escapeHtml(unitText)}</span>
        <span class="recipe-ing-possible" title="Porciones posibles con este ingrediente">—</span>
        <button type="button" class="recipe-remove-ing-btn" title="Quitar insumo de la receta" aria-label="Eliminar insumo">×</button>
    `;

    const selectEl = row.querySelector(".recipe-ing-select");
    const netEl = row.querySelector(".recipe-ing-net");
    const wasteEl = row.querySelector(".recipe-ing-waste");
    const unitEl = row.querySelector(".recipe-ing-unit");
    const removeBtn = row.querySelector(".recipe-remove-ing-btn");

    selectEl.addEventListener("change", () => {
        const selectedId = selectEl.value;
        const ing = ingredients.find((i) => i.id === selectedId);
        unitEl.textContent = ing?.unidad || "und.";
        updateRecipeLiveSummary();
    });

    netEl.addEventListener("input", updateRecipeLiveSummary);
    wasteEl.addEventListener("input", updateRecipeLiveSummary);

    removeBtn.addEventListener("click", () => {
        row.remove();
        updateRecipeLiveSummary();
        const list = document.getElementById("recipe-ingredients-list");
        if (list && list.children.length === 0) {
            renderRecipeEmptyHint();
        }
    });

    return row;
}

function renderRecipeEmptyHint() {
    const list = document.getElementById("recipe-ingredients-list");
    if (!list) return;
    list.innerHTML = `
        <div class="recipe-empty-hint" id="recipe-empty-hint">
            <i class="fa-solid fa-circle-info mr-1 text-amber-400"></i>
            No hay insumos añadidos. Pulsa <strong>«+ Añadir ingrediente a la receta»</strong> para vincular ingredientes del Inventario existente y calcular merma/producción.
        </div>
    `;
}

function renderProductRecipeBuilder(dishId = null) {
    const list = document.getElementById("recipe-ingredients-list");
    if (!list) return;
    list.innerHTML = "";

    const dishRecipes = dishId ? recipes.filter((r) => r.producto_id === dishId) : [];

    if (dishRecipes.length > 0) {
        dishRecipes.forEach((r) => {
            const net = r.cantidad_neta !== undefined && r.cantidad_neta !== null && Number(r.cantidad_neta) > 0
                ? r.cantidad_neta
                : r.cantidad_por_porcion;
            const waste = r.porcentaje_merma || 0;
            const row = createRecipeRow(r.ingrediente_id, net, waste);
            list.appendChild(row);
        });
    } else {
        const row = createRecipeRow();
        list.appendChild(row);
    }

    updateRecipeLiveSummary();
}

function refreshRecipeBuilderIngredientOptions() {
    const list = document.getElementById("recipe-ingredients-list");
    if (!list) return;
    const rows = list.querySelectorAll(".recipe-ingredient-row");
    rows.forEach((row) => {
        const select = row.querySelector(".recipe-ing-select");
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = [
            '<option value="">Selecciona un insumo de Inventario...</option>',
            ...ingredients.map((item) => {
                const stockQty = Number(item.cantidad || 0);
                const unit = item.unidad || "und.";
                return `<option value="${escapeHtml(item.id)}" data-unit="${escapeHtml(unit)}" data-stock="${stockQty}" ${item.id === currentVal ? "selected" : ""}>${escapeHtml(item.nombre)} — Stock: ${formatInventoryQuantity(stockQty)} ${escapeHtml(unit)}</option>`;
            })
        ].join("");
    });
    updateRecipeLiveSummary();
}

function updateRecipeLiveSummary() {
    const list = document.getElementById("recipe-ingredients-list");
    const portionsEl = document.getElementById("recipe-live-portions");
    const limitEl = document.getElementById("recipe-live-limiting-text");
    if (!list || !portionsEl || !limitEl) return;

    const rows = [...list.querySelectorAll(".recipe-ingredient-row")];
    if (rows.length === 0) {
        portionsEl.textContent = "—";
        portionsEl.className = "recipe-metric-value";
        limitEl.textContent = "Añade insumos existentes de la tabla Inventario para calcular la producción.";
        return;
    }

    let minPortions = Infinity;
    let limitingIngName = null;
    let limitingStock = null;
    let limitingUnit = null;
    let hasValidRow = false;

    rows.forEach((row) => {
        const select = row.querySelector(".recipe-ing-select");
        const netInput = row.querySelector(".recipe-ing-net");
        const wasteInput = row.querySelector(".recipe-ing-waste");
        const grossBadge = row.querySelector(".recipe-ing-gross");
        const possibleBadge = row.querySelector(".recipe-ing-possible");

        const ingId = select?.value;
        const netQty = Number(netInput?.value || 0);
        const wastePct = Math.max(0, Math.min(99.9, Number(wasteInput?.value || 0)));
        const grossQty = netQty > 0 ? Number((netQty * (1 + wastePct / 100)).toFixed(3)) : 0;
        const ing = ingredients.find((i) => i.id === ingId);
        const unit = ing?.unidad || "und.";

        if (grossBadge) {
            grossBadge.textContent = grossQty > 0
                ? `${grossQty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} ${unit}`
                : `0 ${unit}`;
        }

        if (!ing || !netQty || netQty <= 0) {
            if (possibleBadge) {
                possibleBadge.textContent = "—";
                possibleBadge.className = "recipe-ing-possible";
            }
            return;
        }

        hasValidRow = true;
        const stock = Number(ing.cantidad || 0);
        const possible = grossQty > 0 ? Math.floor(stock / grossQty) : 0;

        if (possibleBadge) {
            possibleBadge.textContent = `${possible} porc.`;
            if (possible === 0) {
                possibleBadge.className = "recipe-ing-possible is-empty";
                possibleBadge.textContent = "❌ 0 porc. (Agotado)";
            } else if (possible <= 5) {
                possibleBadge.className = "recipe-ing-possible is-limiting";
                possibleBadge.textContent = `⚠️ ${possible} porc.`;
            } else {
                possibleBadge.className = "recipe-ing-possible";
            }
        }

        if (possible < minPortions) {
            minPortions = possible;
            limitingIngName = ing.nombre;
            limitingStock = stock;
            limitingUnit = unit;
        }
    });

    if (!hasValidRow) {
        portionsEl.textContent = "—";
        portionsEl.className = "recipe-metric-value";
        limitEl.textContent = "Selecciona un insumo e indica la cantidad neta por porción.";
        return;
    }

    const finalPortions = Number.isFinite(minPortions) ? Math.max(0, minPortions) : 0;
    portionsEl.textContent = `${finalPortions} porciones`;

    if (finalPortions === 0) {
        portionsEl.className = "recipe-metric-value is-empty";
        limitEl.innerHTML = `<span style="color:#f87171;">⚠️ Producción agotada: falta stock de <strong>${escapeHtml(limitingIngName || 'un insumo')}</strong> en Inventario.</span>`;
    } else if (finalPortions <= 5) {
        portionsEl.className = "recipe-metric-value is-low";
        limitEl.innerHTML = `<span style="color:#fbbf24;">⚠️ Producción baja: limitada por <strong>${escapeHtml(limitingIngName || 'un insumo')}</strong> (Stock: ${formatInventoryQuantity(limitingStock || 0)} ${escapeHtml(limitingUnit || 'und.')}).</span>`;
    } else {
        portionsEl.className = "recipe-metric-value";
        limitEl.innerHTML = `<span style="color:#34d399;">✓ Producción disponible:</span> limitada por <strong>${escapeHtml(limitingIngName || 'un insumo')}</strong> (Stock: ${formatInventoryQuantity(limitingStock || 0)} ${escapeHtml(limitingUnit || 'und.')}).`;
    }

    // Resaltar visualmente la fila limitante
    rows.forEach((row) => {
        const select = row.querySelector(".recipe-ing-select");
        const possibleBadge = row.querySelector(".recipe-ing-possible");
        const ing = ingredients.find((i) => i.id === select?.value);
        if (ing && ing.nombre === limitingIngName && finalPortions <= 5) {
            possibleBadge?.classList.add("is-limiting");
        }
    });
}

document.getElementById("btn-add-recipe-ingredient")?.addEventListener("click", () => {
    const list = document.getElementById("recipe-ingredients-list");
    if (!list) return;
    const emptyHint = document.getElementById("recipe-empty-hint");
    if (emptyHint) emptyHint.remove();
    const row = createRecipeRow();
    list.appendChild(row);
    row.querySelector(".recipe-ing-select")?.focus();
});

function renderRecipeImportLog(issues, createdIngredients, saveMessage, errorMessage = "") {
    const alert = document.getElementById("recipe-unmatched-alert");
    if (!alert) return;

    const createdList = createdIngredients.map((ingredient) =>
        `<li>${escapeHtml(ingredient.nombre)}: creado con stock 0 ${escapeHtml(ingredient.unidad)}.</li>`
    ).join("");
    const issueList = issues.length
        ? `<ul>${issues.map((issue) => `<li>Línea ${issue.lineNumber || "—"}${issue.line ? ` (${escapeHtml(issue.line)})` : ""}: ${escapeHtml(issue.reason)}</li>`).join("")}</ul>`
        : "<p>Sin líneas omitidas.</p>";

    alert.innerHTML = `<p><strong>Receta leída.</strong> ${escapeHtml(saveMessage)}</p>
        <p>La importación no descuenta stock. El consumo se registrará al confirmar el pago del pedido.</p>
        ${createdList ? `<p><strong>Insumos nuevos</strong></p><ul>${createdList}</ul>` : ""}
        ${errorMessage ? `<p class="is-error"><strong>No se completó el guardado:</strong> ${escapeHtml(errorMessage)}</p>` : ""}
        <p><strong>Registro de lectura</strong></p>${issueList}`;
    alert.hidden = false;
}

function setupRecipeFileDropzone() {
    const dropzone = document.getElementById("recipe-dropzone");
    const fileInput = document.getElementById("recipe-file-input");
    const previewBox = document.getElementById("recipe-preview-box");
    const previewName = document.getElementById("recipe-preview-name");
    const previewBadge = document.getElementById("recipe-preview-badge");
    const promptEl = document.getElementById("recipe-dropzone-prompt");
    const removeBtn = document.getElementById("recipe-preview-remove");
    const unmatchedAlert = document.getElementById("recipe-unmatched-alert");

    if (!dropzone || !fileInput) return;

    const openPicker = () => fileInput.click();
    dropzone.addEventListener("click", (e) => {
        if (e.target.closest(".media-preview-remove")) return;
        openPicker();
    });
    dropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
        }
    });

    ["dragenter", "dragover"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add("is-dragover");
        });
    });
    ["dragleave", "drop"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove("is-dragover");
        });
    });

    dropzone.addEventListener("drop", (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) handleRecipeFile(file);
    });

    fileInput.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) handleRecipeFile(file);
    });

    removeBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput.value = "";
        if (previewBox) previewBox.hidden = true;
        if (promptEl) promptEl.hidden = false;
        if (unmatchedAlert) {
            unmatchedAlert.hidden = true;
            unmatchedAlert.innerHTML = "";
        }
        const rawInput = document.getElementById("product-raw-recipe-text");
        if (rawInput) rawInput.value = "";
    });

    function handleRecipeFile(file) {
        if (fileInput.disabled) return;
        if (currentRole !== "administrador" && currentRole !== "almacenero") {
            showToast("Solo Administrador y Almacenero pueden importar o modificar recetas.", true);
            fileInput.value = "";
            return;
        }
        if (!file.name.match(/\.(txt|md|text|markdown)$/i) && !file.type.includes("text")) {
            showToast("Sube un archivo de receta en formato de texto (.txt o .md).", true);
            return;
        }

        const reader = new FileReader();
        fileInput.disabled = true;
        dropzone.setAttribute("aria-busy", "true");

        const finishLoading = () => {
            fileInput.disabled = false;
            dropzone.removeAttribute("aria-busy");
        };

        reader.onload = async (event) => {
            try {
                const text = event.target.result;
                if (!text || !text.trim()) {
                    showToast("El archivo de receta está vacío.", true);
                    return;
                }

                const parsed = parseRecipeText(text);
                const initialPlan = prepareRecipeImport(parsed, ingredients);
                const ingredientResult = await createMissingRecipeIngredients(
                    initialPlan.missingIngredients,
                    ingredients
                );
                ingredients = ingredientResult.inventory;
                if (ingredientResult.created.length) {
                    renderIngredients();
                    renderProducts();
                }
                const plan = prepareRecipeImport(parsed, ingredients);
                const issues = [...plan.issues, ...ingredientResult.notices];

                if (previewName) previewName.textContent = file.name;
                if (previewBadge) previewBadge.textContent = `${plan.rows.length} insumos asociados`;
                if (previewBox) previewBox.hidden = false;
                if (promptEl) promptEl.hidden = true;

                const rawInput = document.getElementById("product-raw-recipe-text");
                if (rawInput) rawInput.value = text;

                const prepTextarea = document.getElementById("product-preparacion-interna");
                if (prepTextarea && parsed.preparacion) {
                    prepTextarea.value = parsed.preparacion;
                }

                const termTextarea = document.getElementById("product-presentacion-interna");
                if (termTextarea && parsed.presentacion) {
                    termTextarea.value = parsed.presentacion;
                }

                const list = document.getElementById("recipe-ingredients-list");
                if (list) {
                    list.innerHTML = "";
                    plan.rows.forEach(({ ingredient, netQty, wastePct }) => {
                        list.appendChild(createRecipeRow(ingredient.id, netQty, wastePct));
                    });
                    if (!plan.rows.length) renderRecipeEmptyHint();
                    updateRecipeLiveSummary();
                }

                let saveMessage = "La receta quedó vinculada al formulario; guarda el plato para persistir la composición.";
                let saveError = "";
                const editingProductId = productForm.elements.id.value;
                productForm.dataset.recipeImportIncomplete = String(issues.length > 0);
                if (editingProductId && plan.rows.length && !issues.length) {
                    try {
                        const savedCount = await saveImportedRecipe(editingProductId, plan.rows);
                        await Promise.all([loadRecipes(), loadProducts()]);
                        saveMessage = `Receta guardada automáticamente: ${savedCount} insumo(s) vinculados al plato.`;
                    } catch (error) {
                        saveError = getErrorMessage(error);
                    }
                } else if (editingProductId && issues.length) {
                    saveMessage = "No se reemplazó la receta guardada porque hay líneas sin resolver; corrige el TXT antes de guardarlo.";
                }

                renderRecipeImportLog(issues, ingredientResult.created, saveMessage, saveError);
                if (saveError) {
                    showToast(saveError, true);
                } else if (issues.length) {
                    showToast(`Receta procesada con ${issues.length} aviso(s). Revisa el registro de lectura.`, true);
                } else {
                    showToast(`Receta «${file.name}» procesada: ${plan.rows.length} insumo(s) asociados. No se descontó stock.`);
                }
            } catch (err) {
                console.error("Error al procesar archivo de receta:", err);
                showToast(`Error al interpretar receta: ${getErrorMessage(err)}`, true);
            } finally {
                finishLoading();
            }
        };
        reader.onerror = () => {
            showToast("No se pudo leer el archivo seleccionado.", true);
            finishLoading();
        };
        reader.readAsText(file, "UTF-8");
    }
}

function resetProductForm() {
    productForm.reset();
    delete productForm.dataset.recipeImportIncomplete;
    productForm.elements.categoria.selectedIndex = -1;
    productForm.elements.id.value = "";
    document.getElementById("cancel-product-edit").hidden = true;
    productForm.querySelector("button[type='submit']").textContent = "Guardar plato";
    const previewBox = document.getElementById("product-preview-box");
    if (previewBox) previewBox.hidden = true;
    const promptEl = document.querySelector("#product-dropzone .dropzone-prompt");
    if (promptEl) promptEl.hidden = false;

    // Reset dropzone y alerta de importación de receta
    const recipeFileInput = document.getElementById("recipe-file-input");
    if (recipeFileInput) recipeFileInput.value = "";
    const recipePreviewBox = document.getElementById("recipe-preview-box");
    if (recipePreviewBox) recipePreviewBox.hidden = true;
    const recipePromptEl = document.getElementById("recipe-dropzone-prompt");
    if (recipePromptEl) recipePromptEl.hidden = false;
    const unmatchedAlert = document.getElementById("recipe-unmatched-alert");
    if (unmatchedAlert) {
        unmatchedAlert.hidden = true;
        unmatchedAlert.innerHTML = "";
    }
    const rawInput = document.getElementById("product-raw-recipe-text");
    if (rawInput) rawInput.value = "";

    renderProductRecipeBuilder(null);
}

function resetPromotionForm() {
    promotionForm.reset();
    promotionForm.elements.id.value = "";
    promotionForm.elements.orden.value = "0";
    promotionForm.elements.activa.checked = true;
    document.getElementById("cancel-promotion-edit").hidden = true;
    promotionForm.querySelector("button[type='submit']").textContent = "Guardar destacado";
}

async function withBusy(form, action) {
    setBusy(form, true);
    try {
        await action();
    } catch (error) {
        showToast(getErrorMessage(error), true);
    } finally {
        setBusy(form, false);
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isSupabaseConfigured) {
        showAuthMessage("Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local.", true);
        return;
    }
    setBusy(loginForm, true);
    try {
        const { error } = await supabase.auth.signInWithPassword({
            email: loginForm.elements.email.value.trim(),
            password: loginForm.elements.password.value
        });
        if (error) throw error;
        loginForm.reset();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        await authorize(sessionData.session);
    } catch (error) {
        showAuthMessage(`No se pudo iniciar sesión: ${getErrorMessage(error)}`, true);
    } finally {
        setBusy(loginForm, false);
    }
});

document.getElementById("role-switch-button").addEventListener("click", async () => {
    if (currentUserProfile?.personalId) {
        const { data: activeTurns, error: attendanceError } = await supabase.from("asistencia_turnos")
            .select("id")
            .eq("personal_id", currentUserProfile.personalId)
            .eq("estado_turno", "en_turno")
            .limit(1);
        if (attendanceError) {
            showToast(`No se pudo verificar el turno antes de cerrar sesión: ${getErrorMessage(attendanceError)}`, true);
            return;
        }
        if (activeTurns?.length) {
            const { error: exitError } = await supabase.rpc("marcar_salida_turno", {
                p_personal_id: null,
                p_observacion: "Salida automática al cerrar sesión"
            });
            if (exitError) {
                showToast(`No se pudo registrar la salida: ${getErrorMessage(exitError)}`, true);
                return;
            }
        }
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
        showToast(`No pudimos cerrar la sesión: ${getErrorMessage(error)}`, true);
        return;
    }
    if (activeUser?.id) sessionStorage.removeItem(`frygourmett-attendance-started-${activeUser.id}`);
});

document.getElementById("mark-self-entry").addEventListener("click", (event) => {
    void recordAttendance("entrada", null, event.currentTarget);
});
document.getElementById("mark-self-exit").addEventListener("click", (event) => {
    void recordAttendance("salida", null, event.currentTarget);
});
document.getElementById("mark-person-entry").addEventListener("click", (event) => {
    if (!isAdministrator(currentRole)) {
        showToast("Solo el administrador puede registrar turnos de otros trabajadores.", true);
        return;
    }
    const workerId = document.getElementById("attendance-person-select").value;
    if (!workerId) {
        showToast("Selecciona un trabajador para registrar la entrada.", true);
        return;
    }
    void recordAttendance("entrada", workerId, event.currentTarget);
});
document.getElementById("mark-person-exit").addEventListener("click", (event) => {
    if (!isAdministrator(currentRole)) {
        showToast("Solo el administrador puede registrar turnos de otros trabajadores.", true);
        return;
    }
    const workerId = document.getElementById("attendance-person-select").value;
    if (!workerId) {
        showToast("Selecciona un trabajador para registrar la salida.", true);
        return;
    }
    void recordAttendance("salida", workerId, event.currentTarget);
});

document.querySelectorAll("[data-open-order]").forEach((button) => button.addEventListener("click", openOrderModal));
document.querySelectorAll("[data-close-order]").forEach((button) => button.addEventListener("click", closeOrderModal));
document.getElementById("order-modal").addEventListener("click", (event) => {
    if (event.target.id === "order-modal") closeOrderModal();
});

document.querySelectorAll(".status-tab").forEach((tab) => tab.addEventListener("click", () => {
    selectedStatus = tab.dataset.filter;
    document.querySelectorAll(".status-tab").forEach((button) => {
        const isSelected = button === tab;
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-selected", String(isSelected));
    });
    renderOrders();
}));
document.getElementById("order-search").addEventListener("input", renderOrders);
async function handleOrderStatusTransition(controlEl, orderId, requestedStatus) {
    const currentOrder = orders.find((item) => item.id === orderId);
    if (!currentOrder) {
        showToast("No encontramos el pedido seleccionado.", true);
        renderOrders();
        return;
    }

    const prevStatus = normalizeOrderStatus(currentOrder.estado);
    const nextStatus = normalizeOrderStatus(requestedStatus);

    if (prevStatus === nextStatus) return;

    if (currentRole === "gerente") {
        showToast("El gerente puede consultar pedidos, pero no modificar su estado.", true);
        renderOrders();
        return;
    }

    if (!canRoleTransitionOrder(currentRole, prevStatus, nextStatus)) {
        const expected = getNextOrderStatus(prevStatus);
        const message = prevStatus === "Entregado"
            ? "Este pedido ya fue entregado y está finalizado."
            : currentRole === "almacenero"
                ? "Cocina/Almacén solo puede avanzar de Pendiente → En preparación → Listo."
                : currentRole === "repartidor"
                    ? "Reparto solo puede avanzar pedidos de Listo → En camino → Entregado."
                    : expected
                        ? `Debes respetar el flujo secuencial: «${prevStatus}» solo puede pasar a «${expected}».`
                        : "No tienes permisos para realizar este cambio de estado.";
        showToast(message, true);
        renderOrders();
        return;
    }

    await withBusy(controlEl, async () => {
        const updatedRow = await updateOrderStatusInSupabase(orderId, nextStatus);
        if (nextStatus === "En preparación" && prevStatus !== "En preparación" && canManageInventory()) {
            await loadIngredients();
        }
        await loadOrders({ eventType: "UPDATE", order: updatedRow });
        showToast(`Estado actualizado a «${updatedRow.estado || nextStatus}».`);
    });
}

document.getElementById("orders-body")?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-order-id]");
    if (!select) return;
    void handleOrderStatusTransition(select, select.dataset.orderId, select.value);
});
document.getElementById("orders-body")?.addEventListener("click", (event) => {
    const advanceBtn = event.target.closest("[data-advance-order]");
    if (advanceBtn) {
        const orderId = advanceBtn.dataset.advanceOrder;
        const currentOrder = orders.find((item) => item.id === orderId);
        const currentStatus = normalizeOrderStatus(currentOrder?.estado || advanceBtn.dataset.currentStatus);
        const nextStatus = getNextOrderStatus(currentStatus);
        if (!nextStatus) {
            showToast("Este pedido ya fue entregado y está finalizado.", true);
            return;
        }
        void handleOrderStatusTransition(advanceBtn, orderId, nextStatus);
        return;
    }

    const button = event.target.closest("[data-order-detail]");
    if (!button) return;
    if (currentRole === "almacenero") return;
    const order = orders.find((item) => item.id === button.dataset.orderDetail);
    if (order) showOrderDetail(order);
});
document.querySelectorAll("[data-close-order-detail]").forEach((button) => {
    button.addEventListener("click", closeOrderDetail);
});
document.getElementById("order-detail-modal").addEventListener("click", (event) => {
    if (event.target.id === "order-detail-modal") closeOrderDetail();
});

orderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isAdministrator(currentRole) && currentRole !== "recepcionista") {
        showToast("Solo administradores y recepcionistas pueden crear pedidos operativos.", true);
        return;
    }
    if (!orderForm.reportValidity()) return;
    withBusy(orderForm, async () => {
        const formData = new FormData(orderForm);
        const product = products.find((item) => item.id === formData.get("dish") && item.disponible);
        const quantity = Number(formData.get("quantity"));
        if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
            throw new Error("Selecciona un plato disponible y una cantidad válida (1–99).");
        }
        const { error } = await supabase.from("pedidos").insert({
            cliente_nombre: String(formData.get("customer")).trim(),
            cliente_email: String(formData.get("customerEmail")).trim(),
            telefono_contacto: String(formData.get("telefono_contacto")).trim(),
            direccion_entrega: String(formData.get("direccion_entrega")).trim(),
            distrito_zona: String(formData.get("distrito_zona")).trim(),
            referencia: String(formData.get("referencia")).trim(),
            items: [{ producto_id: product.id, cantidad: quantity }],
            nota: String(formData.get("note") || "").trim()
        });
        if (error) throw error;
        orderForm.reset();
        closeOrderModal();
        await loadOrders();
        showToast("Pedido enviado a cocina y guardado en Supabase.");
    });
});

productForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canManageCatalog()) {
        showToast("No tienes permisos para modificar la carta.", true);
        return;
    }
    if (!productForm.reportValidity()) return;
    withBusy(productForm, async () => {
        const data = new FormData(productForm);
        const product = {
            nombre: String(data.get("nombre")).trim(),
            categoria: String(data.get("categoria")).trim(),
            precio: Number(data.get("precio")),
            imagen_url: String(data.get("imagen_url") || "").trim(),
            descripcion: String(data.get("descripcion")).trim(),
            preparacion_interna: String(data.get("preparacion_interna") || "").trim(),
            presentacion_interna: String(data.get("presentacion_interna") || "").trim(),
            raw_recipe_text: String(data.get("raw_recipe_text") || "").trim()
        };
        if (!product.nombre || !product.categoria || !Number.isFinite(product.precio) || product.precio < 0) {
            throw new Error("Revisa el nombre, la categoría y el precio del plato.");
        }
        if (product.imagen_url.startsWith("data:image/webp") || product.imagen_url.startsWith("data:image/")) {
            // Imagen optimizada a WebP en formato data URL
        } else if (product.imagen_url.startsWith("img/")) {
            if (resolveImage(product.imagen_url) === product.imagen_url) {
                throw new Error("No encontramos esa imagen en img/. Verifica mayúsculas, minúsculas y acentos.");
            }
        } else if (product.imagen_url) {
            let imageUrl;
            try {
                imageUrl = new URL(product.imagen_url);
            } catch {
                throw new Error("Usa una ruta exacta bajo img/, un archivo WebP o una URL HTTPS.");
            }
            if (imageUrl.protocol !== "https:") {
                throw new Error("La imagen externa debe servirse por HTTPS.");
            }
        }

        const productId = String(data.get("id") || "");
        let savedProductId = productId;

        // Validar y recopilar los insumos de la receta vinculados a la tabla Inventario
        const recipeRows = [...document.querySelectorAll("#recipe-ingredients-list .recipe-ingredient-row")];
        const recipeItems = [];
        const seenIngIds = new Set();

        for (const row of recipeRows) {
            const ingSelect = row.querySelector(".recipe-ing-select");
            const netInput = row.querySelector(".recipe-ing-net");
            const wasteInput = row.querySelector(".recipe-ing-waste");
            const ingId = ingSelect?.value;
            const netQty = Number(netInput?.value);
            const wastePct = Number(wasteInput?.value || 0);

            if (!ingId && !netInput?.value) continue;
            if (!ingId) {
                throw new Error("Selecciona un insumo de Inventario para cada fila de la receta.");
            }
            if (!Number.isFinite(netQty) || netQty <= 0) {
                const ingObj = ingredients.find((i) => i.id === ingId);
                throw new Error(`Ingresa una cantidad neta válida para «${ingObj?.nombre || 'el insumo'}».`);
            }
            if (!Number.isFinite(wastePct) || wastePct < 0 || wastePct >= 100) {
                throw new Error("El porcentaje de merma debe estar entre 0% y 99.9%.");
            }
            if (seenIngIds.has(ingId)) {
                const ingObj = ingredients.find((i) => i.id === ingId);
                throw new Error(`El insumo «${ingObj?.nombre || 'seleccionado'}» está repetido en la receta. Agrupa la cantidad en una sola fila.`);
            }
            seenIngIds.add(ingId);
            const grossQty = Number((netQty * (1 + wastePct / 100)).toFixed(3));
            recipeItems.push({
                ingrediente_id: ingId,
                cantidad_neta: netQty,
                porcentaje_merma: wastePct,
                cantidad_por_porcion: grossQty
            });
        }

        const recipeImportIncomplete = productForm.dataset.recipeImportIncomplete === "true";

        // Calcular porciones disponibles a partir del consumo real (bruto con merma) y el stock de inventario
        let calculatedPortions = null;
        if (recipeItems.length > 0 && !recipeImportIncomplete) {
            let minP = Infinity;
            for (const item of recipeItems) {
                const ing = ingredients.find((i) => i.id === item.ingrediente_id);
                const stock = Number(ing?.cantidad || 0);
                const possible = Math.floor(stock / item.cantidad_por_porcion);
                if (possible < minP) minP = possible;
            }
            calculatedPortions = Number.isFinite(minP) ? Math.max(0, minP) : 0;
        }
        product.porciones_disponibles = calculatedPortions;

        // Guardar o actualizar plato (tolerante si columnas internas aún no existen en la BD)
        try {
            if (productId) {
                const { error } = await supabase.from("productos").update(product).eq("id", productId);
                if (error) throw error;
            } else {
                const { data: inserted, error } = await supabase.from("productos").insert(product).select("id").single();
                if (error) throw error;
                savedProductId = inserted.id;
            }
        } catch (prodErr) {
            if (prodErr && String(prodErr.message || "").includes("column")) {
                const fallbackProduct = { ...product };
                delete fallbackProduct.preparacion_interna;
                delete fallbackProduct.presentacion_interna;
                delete fallbackProduct.raw_recipe_text;
                if (productId) {
                    const { error } = await supabase.from("productos").update(fallbackProduct).eq("id", productId);
                    if (error) throw error;
                } else {
                    const { data: inserted, error } = await supabase.from("productos").insert(fallbackProduct).select("id").single();
                    if (error) throw error;
                    savedProductId = inserted.id;
                }
            } else {
                throw prodErr;
            }
        }

        // Replace the recipe atomically so a failed insert cannot leave a partial recipe.
        const canManageRecipe = currentRole === "administrador" || currentRole === "almacenero";
        let recipeSaved = false;
        if (savedProductId && canManageRecipe) {
            if (recipeImportIncomplete) {
                showToast("El plato se guardó, pero la receta anterior se conservó porque el TXT tiene líneas sin resolver.", true);
            } else {
                const recipeToSave = recipeItems.map((item) => ({
                    ingredient: ingredients.find((ingredient) => ingredient.id === item.ingrediente_id),
                    netQty: item.cantidad_neta,
                    wastePct: item.porcentaje_merma,
                    consumption: item.cantidad_por_porcion
                }));
                await saveImportedRecipe(savedProductId, recipeToSave);
                recipeSaved = true;
            }
        }

        resetProductForm();
        await Promise.all([loadRecipes(), loadProducts()]);
        const portionsMsg = calculatedPortions !== null
            ? ` · ${calculatedPortions} porciones disponibles según Inventario.`
            : " · Sin receta vinculada.";
        if (!recipeImportIncomplete) {
            const productMessage = productId ? "Plato actualizado" : "Plato añadido a la carta";
            showToast(`${productMessage}${recipeSaved ? " y receta guardada" : ""} con éxito${recipeSaved ? portionsMsg : "."}`);
        }
    });
});

document.getElementById("product-list").addEventListener("click", (event) => {
    if (!canManageCatalog()) {
        showToast("No tienes permisos para editar platos de la carta.", true);
        return;
    }
    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) {
        const product = products.find((item) => item.id === editButton.dataset.editProduct);
        if (!product) return;
        Object.entries(product).forEach(([key, value]) => {
            if (!productForm.elements[key]) return;
            productForm.elements[key].value = key === "categoria"
                ? resolveProductCategory(value)
                : value ?? "";
        });
        if (!productForm.elements.categoria.value) {
            showToast("La categoría anterior no coincide con las categorías disponibles. Selecciona una categoría válida.", true);
        }
        document.getElementById("cancel-product-edit").hidden = false;
        productForm.querySelector("button[type='submit']").textContent = "Guardar cambios";

        // Limpiar estado previo del dropzone de archivo de receta
        const recipeFileInput = document.getElementById("recipe-file-input");
        if (recipeFileInput) recipeFileInput.value = "";
        const recipePreviewBox = document.getElementById("recipe-preview-box");
        if (recipePreviewBox) recipePreviewBox.hidden = true;
        const recipePromptEl = document.getElementById("recipe-dropzone-prompt");
        if (recipePromptEl) recipePromptEl.hidden = false;
        const unmatchedAlert = document.getElementById("recipe-unmatched-alert");
        if (unmatchedAlert) {
            unmatchedAlert.hidden = true;
            unmatchedAlert.innerHTML = "";
        }

        renderProductRecipeBuilder(product.id);
        productForm.elements.nombre.focus();
        return;
    }

    const toggleButton = event.target.closest("[data-toggle-availability]");
    if (toggleButton) {
        withBusy(toggleButton, async () => {
            const product = products.find((item) => item.id === toggleButton.dataset.toggleAvailability);
            if (!product) return;
            const { error } = await supabase.from("productos")
                .update({ disponible: !product.disponible })
                .eq("id", product.id);
            if (error) throw error;
            await loadProducts();
            showToast(`${product.nombre}: ${product.disponible ? "marcado como agotado" : "disponible"}.`);
        });
        return;
    }

    const deleteButton = event.target.closest("[data-delete-product]");
    if (deleteButton) {
        const product = products.find((item) => item.id === deleteButton.dataset.deleteProduct);
        if (!product || !window.confirm(`¿Eliminar «${product.nombre}» de la carta?`)) return;
        withBusy(deleteButton, async () => {
            const { error } = await supabase.from("productos").delete().eq("id", product.id);
            if (error) throw error;
            await loadProducts();
            if (hasAdminAccess(currentRole)) await loadRecipes();
            showToast("Plato eliminado de la carta.");
        });
    }
});

document.getElementById("reset-product-form").addEventListener("click", () => {
    resetProductForm();
    productForm.elements.nombre.focus();
});
document.getElementById("cancel-product-edit").addEventListener("click", resetProductForm);

promotionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canManagePromotions()) {
        showToast("No tienes permisos para modificar destacados.", true);
        return;
    }
    if (!promotionForm.reportValidity()) return;
    withBusy(promotionForm, async () => {
        const data = new FormData(promotionForm);
        const mediaUrl = String(data.get("media_url")).trim();
        if (mediaUrl.startsWith("data:image/")) {
            // Archivo WebP convertido
        } else if (mediaUrl.startsWith("img/")) {
            if (resolveImage(mediaUrl) === mediaUrl) {
                throw new Error("No encontramos ese archivo en img/. Verifica mayúsculas, minúsculas y acentos.");
            }
        } else {
            let parsedUrl;
            try {
                parsedUrl = new URL(mediaUrl);
            } catch {
                throw new Error("Usa una ruta exacta bajo img/ o una URL HTTPS directa al archivo.");
            }
            if (parsedUrl.protocol !== "https:") {
                throw new Error("El medio externo debe servirse por HTTPS.");
            }
        }
        const promotion = {
            titulo: String(data.get("titulo")).trim(),
            descripcion: String(data.get("descripcion") || "").trim(),
            tipo_media: String(data.get("tipo_media")),
            media_url: mediaUrl,
            orden: Number(data.get("orden")),
            activa: data.has("activa")
        };
        if (!promotion.titulo || !Number.isInteger(promotion.orden) || promotion.orden < 0) {
            throw new Error("Revisa el título y el orden del destacado.");
        }
        const promotionId = String(data.get("id") || "");
        const result = promotionId
            ? await supabase.from("promociones").update(promotion).eq("id", promotionId)
            : await supabase.from("promociones").insert(promotion);
        if (result.error) throw result.error;
        resetPromotionForm();
        await loadPromotions();
        showToast(promotionId ? "Destacado actualizado." : "Destacado añadido al carrusel.");
    });
});

document.getElementById("promotion-list").addEventListener("click", (event) => {
    if (!canManagePromotions()) return;
    const editButton = event.target.closest("[data-edit-promotion]");
    if (editButton) {
        const promotion = promotions.find((item) => item.id === editButton.dataset.editPromotion);
        if (!promotion) return;
        for (const [key, value] of Object.entries(promotion)) {
            const field = promotionForm.elements[key];
            if (field) {
                if (field.type === "checkbox") field.checked = Boolean(value);
                else field.value = value ?? "";
            }
        }
        document.getElementById("cancel-promotion-edit").hidden = false;
        promotionForm.querySelector("button[type='submit']").textContent = "Guardar cambios";
        promotionForm.elements.titulo.focus();
        return;
    }

    const deleteButton = event.target.closest("[data-delete-promotion]");
    if (!deleteButton) return;
    const promotion = promotions.find((item) => item.id === deleteButton.dataset.deletePromotion);
    if (!promotion || !window.confirm(`¿Eliminar «${promotion.titulo}» del carrusel?`)) return;
    withBusy(deleteButton, async () => {
        const { error } = await supabase.from("promociones").delete().eq("id", promotion.id);
        if (error) throw error;
        await loadPromotions();
        showToast("Destacado eliminado.");
    });
});
document.getElementById("reset-promotion-form").addEventListener("click", () => {
    resetPromotionForm();
    promotionForm.elements.titulo.focus();
});
document.getElementById("cancel-promotion-edit").addEventListener("click", resetPromotionForm);

ingredientForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canManageInventory()) {
        showToast("Solo administradores y almaceneros pueden agregar ingredientes al inventario.", true);
        return;
    }
    if (!ingredientForm.reportValidity()) return;
    withBusy(ingredientForm, async () => {
        const data = new FormData(ingredientForm);
        const ingredient = {
            nombre: String(data.get("nombre")).trim(),
            cantidad: Number(data.get("cantidad")),
            minimo: Number(data.get("minimo")),
            unidad: String(data.get("unidad")),
            precio_unitario: data.get("precio_unitario") === "" ? 0 : Number(data.get("precio_unitario")),
            categoria: String(data.get("categoria"))
        };
        if (!ingredient.nombre || !INVENTORY_UNITS.has(ingredient.unidad)
            || !INVENTORY_CATEGORIES.has(ingredient.categoria)
            || !Number.isFinite(ingredient.cantidad) || ingredient.cantidad < 0
            || !Number.isFinite(ingredient.minimo) || ingredient.minimo < 0
            || !Number.isFinite(ingredient.precio_unitario) || ingredient.precio_unitario < 0) {
            throw new Error("Revisa el nombre, la unidad seleccionada, la categoría y los valores numéricos.");
        }
        const { error } = await supabase.from("ingredientes").insert(ingredient);
        if (error) throw error;
        ingredientForm.reset();
        ingredientForm.elements.precio_unitario.value = "0";
        await loadIngredients();
        showToast("Ingrediente guardado en el inventario.");
    });
});

document.getElementById("recipe-product")?.addEventListener("change", renderRecipeManager);

document.getElementById("recipe-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-recipe]");
    if (!button || (currentRole !== "administrador" && currentRole !== "almacenero")) return;
    withBusy(button, async () => {
        const { error } = await supabase.from("producto_insumos")
            .delete()
            .eq("id", button.dataset.deleteRecipe);
        if (error) throw error;
        await Promise.all([loadRecipes(), loadProducts()]);
        showToast("Insumo eliminado de la receta.");
    });
});

const STORE_CONFIG_STORAGE_KEY = "frygourmett-service-config";
const STORE_SYNC_CHANNEL_NAME = "frygourmett-store-sync";

function broadcastStoreStatus(config) {
    try {
        localStorage.setItem(STORE_CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
        console.warn("No se pudo guardar estado en localStorage:", e);
    }
    if (typeof BroadcastChannel !== "undefined") {
        try {
            const bc = new BroadcastChannel(STORE_SYNC_CHANNEL_NAME);
            bc.postMessage({ type: "STORE_STATUS_CHANGED", config });
            bc.close();
        } catch {}
    }
}

function updateAdminStoreBadge(override, opening, closing) {
    const badge = document.getElementById("admin-store-quick-toggle");
    const dot = document.getElementById("admin-store-dot");
    const text = document.getElementById("admin-store-text");
    if (!badge || !dot || !text) return;

    let isOpen = false;
    let label = "Cerrada";
    if (override === true || override === "open") {
        isOpen = true;
        label = "Abierta";
    } else if (override === false || override === "closed") {
        isOpen = false;
        label = "Cerrada";
    } else {
        label = "Auto";
        const now = new Date();
        const utcHours = now.getUTCHours();
        const limaHours = (utcHours - 5 + 24) % 24;
        isOpen = limaHours >= 15 || limaHours < 3;
    }

    dot.className = `store-dot ${isOpen ? "is-open" : "is-closed"}`;
    text.textContent = `Tienda: ${label}`;
    badge.setAttribute("aria-label", `Tienda ${label}. Clic para alternar.`);
    badge.dataset.state = override === true ? "open" : override === false ? "closed" : "auto";
}

document.getElementById("admin-store-quick-toggle")?.addEventListener("click", async () => {
    if (!isAdministrator(currentRole)) {
        showToast("Solo el administrador puede alternar el estado de la tienda.", true);
        return;
    }
    const badge = document.getElementById("admin-store-quick-toggle");
    const currentSelect = serviceConfigForm?.elements?.estado_cocina_override?.value || badge?.dataset.state || "open";
    const nextState = currentSelect === "open" ? "closed" : "open";
    const nextOverride = nextState === "open";

    if (serviceConfigForm?.elements?.estado_cocina_override) {
        serviceConfigForm.elements.estado_cocina_override.value = nextState;
    }

    try {
        const { error } = await supabase.from("configuracion_servicio")
            .update({
                estado_cocina_override: nextOverride,
                updated_at: new Date().toISOString()
            })
            .eq("id", 1);
        if (error) throw error;

        const syncPayload = {
            cocina_abierta: nextOverride,
            estado_cocina_override: nextOverride,
            hora_apertura: serviceConfigForm?.elements?.hora_apertura?.value || null,
            hora_cierre: serviceConfigForm?.elements?.hora_cierre?.value || null,
            updated_at: new Date().toISOString()
        };
        broadcastStoreStatus(syncPayload);
        updateAdminStoreBadge(nextOverride);
        showToast(`Tienda cambiada a: ${nextState === "open" ? "ABIERTA" : "CERRADA"}.`);
    } catch (error) {
        showToast(`No se pudo actualizar el estado: ${getErrorMessage(error)}`, true);
    }
});

window.addEventListener("storage", (event) => {
    if (event.key === STORE_CONFIG_STORAGE_KEY && event.newValue) {
        try {
            const incoming = JSON.parse(event.newValue);
            if (incoming) {
                updateAdminStoreBadge(incoming.estado_cocina_override, incoming.hora_apertura, incoming.hora_cierre);
                if (serviceConfigForm?.elements?.estado_cocina_override) {
                    serviceConfigForm.elements.estado_cocina_override.value = incoming.estado_cocina_override === null
                        ? "auto"
                        : incoming.estado_cocina_override ? "open" : "closed";
                }
            }
        } catch {}
    }
});

const initialSavedConfig = (() => {
    try {
        const raw = localStorage.getItem(STORE_CONFIG_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
})();
if (initialSavedConfig) {
    updateAdminStoreBadge(initialSavedConfig.estado_cocina_override, initialSavedConfig.hora_apertura, initialSavedConfig.hora_cierre);
}

serviceConfigForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isAdministrator(currentRole)) {
        showToast("Solo el administrador puede cambiar el horario de atención.", true);
        return;
    }
    if (!serviceConfigForm.reportValidity()) return;
    withBusy(serviceConfigForm, async () => {
        const formData = new FormData(serviceConfigForm);
        const opening = String(formData.get("hora_apertura") || "");
        const closing = String(formData.get("hora_cierre") || "");
        if (Boolean(opening) !== Boolean(closing)) {
            throw new Error("Completa ambas horas o deja las dos vacías.");
        }
        const override = String(formData.get("estado_cocina_override"));
        const overrideVal = override === "auto" ? null : override === "open";
        const { error } = await supabase.from("configuracion_servicio")
            .update({
                hora_apertura: opening || null,
                hora_cierre: closing || null,
                estado_cocina_override: overrideVal,
                updated_at: new Date().toISOString()
            })
            .eq("id", 1);
        if (error) throw error;

        const isOpen = overrideVal === null ? true : overrideVal;
        const syncPayload = {
            cocina_abierta: isOpen,
            estado_cocina_override: overrideVal,
            hora_apertura: opening || null,
            hora_cierre: closing || null,
            updated_at: new Date().toISOString()
        };
        broadcastStoreStatus(syncPayload);
        updateAdminStoreBadge(overrideVal, opening, closing);
        showToast("Horario y estado de cocina guardados.");
    });
});

document.getElementById("inventory-body").addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-inventory]");
    if (deleteButton) {
        if (!isAdministrator(currentRole)) {
            showToast("Solo el administrador puede eliminar ingredientes.", true);
            return;
        }
        const ingredient = ingredients.find((item) => item.id === deleteButton.dataset.deleteInventory);
        if (!ingredient || !window.confirm(`¿Eliminar «${ingredient.nombre}» del inventario?`)) return;
        withBusy(deleteButton, async () => {
            const { error } = await supabase.from("ingredientes").delete().eq("id", ingredient.id);
            if (error) throw error;
            await loadIngredients();
            showToast("Ingrediente eliminado del inventario.");
        });
        return;
    }

    const button = event.target.closest("[data-edit-inventory]");
    if (!button) return;
    if (!canManageInventory()) {
        showToast("Tu rol puede consultar el inventario, pero no ajustar existencias.", true);
        return;
    }
    const ingredient = ingredients.find((item) => item.id === button.dataset.editInventory);
    if (!ingredient) return;
    document.getElementById("inventory-item-select").value = ingredient.id;
    document.getElementById("inventory-quantity").value = ingredient.cantidad;
    document.getElementById("inventory-unit-price").value = Number(ingredient.precio_unitario || 0).toFixed(2);
    document.getElementById("inventory-modal").hidden = false;
});
document.getElementById("adjust-inventory-button").addEventListener("click", () => {
    if (!canManageInventory()) {
        showToast("Tu rol puede consultar el inventario, pero no ajustar existencias.", true);
        return;
    }
    if (!ingredients.length) {
        showToast("No hay ingredientes disponibles para ajustar.", true);
        return;
    }
    document.getElementById("inventory-item-select").value = ingredients[0].id;
    document.getElementById("inventory-quantity").value = ingredients[0].cantidad;
    document.getElementById("inventory-unit-price").value = Number(ingredients[0].precio_unitario || 0).toFixed(2);
    document.getElementById("inventory-modal").hidden = false;
});
document.querySelectorAll("[data-close-inventory]").forEach((button) => button.addEventListener("click", () => {
    document.getElementById("inventory-modal").hidden = true;
}));
document.getElementById("inventory-item-select").addEventListener("change", (event) => {
    const item = ingredients.find((ingredient) => ingredient.id === event.target.value);
    if (item) {
        document.getElementById("inventory-quantity").value = item.cantidad;
        document.getElementById("inventory-unit-price").value = Number(item.precio_unitario || 0).toFixed(2);
    }
});
document.getElementById("inventory-movement-type")?.addEventListener("change", (event) => {
    const type = event.target.value;
    const wasteRow = document.getElementById("inventory-waste-reason-row");
    const qtyTitle = document.getElementById("inventory-qty-title");
    const qtyInput = document.getElementById("inventory-quantity");
    const helperNote = document.getElementById("inventory-helper-note");

    if (wasteRow) wasteRow.hidden = type !== "waste";

    if (type === "waste") {
        if (qtyTitle) qtyTitle.textContent = "Cantidad a dar de baja (Merma)";
        if (qtyInput) qtyInput.value = "";
        if (helperNote) helperNote.textContent = "La cantidad registrada se descontará de las existencias actuales.";
    } else if (type === "entry") {
        if (qtyTitle) qtyTitle.textContent = "Cantidad a ingresar (+ Compra)";
        if (qtyInput) qtyInput.value = "";
        if (helperNote) helperNote.textContent = "La cantidad registrada se sumará a las existencias actuales.";
    } else {
        if (qtyTitle) qtyTitle.textContent = "Nueva existencia total";
        const currentItem = ingredients.find((i) => i.id === document.getElementById("inventory-item-select").value);
        if (qtyInput && currentItem) qtyInput.value = currentItem.cantidad;
        if (helperNote) helperNote.textContent = "El valor ingresado reemplazará directamente la existencia física.";
    }
});

document.getElementById("inventory-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canManageInventory()) {
        showToast("Tu rol puede consultar el inventario, pero no modificar existencias.", true);
        return;
    }
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    withBusy(form, async () => {
        const itemId = form.elements.itemId.value;
        const movementType = form.elements.movement_type?.value || "set";
        const enteredQty = Number(form.elements.quantity.value);
        const unitPrice = Number(form.elements.precio_unitario.value);
        const currentItem = ingredients.find((item) => item.id === itemId);

        if (!currentItem || !Number.isFinite(enteredQty) || (enteredQty <= 0 && movementType !== "set") || enteredQty < 0
            || !Number.isFinite(unitPrice) || unitPrice < 0) {
            throw new Error("Ingresa una cantidad y un precio unitario válidos.");
        }

        let newTotalQty = 0;
        let actionMessage = "";

        if (movementType === "waste") {
            const reason = form.elements.waste_reason?.value || "Merma operativa";
            newTotalQty = Math.max(0, Number(currentItem.cantidad || 0) - enteredQty);
            actionMessage = `Merma registrada: -${enteredQty} ${currentItem.unidad || "ud."} (${reason}). Nuevo stock: ${newTotalQty} ${currentItem.unidad || "ud."}`;
        } else if (movementType === "entry") {
            newTotalQty = Number(currentItem.cantidad || 0) + enteredQty;
            actionMessage = `Entrada registrada: +${enteredQty} ${currentItem.unidad || "ud."}. Nuevo stock: ${newTotalQty} ${currentItem.unidad || "ud."}`;
        } else {
            newTotalQty = enteredQty;
            actionMessage = `Existencias de «${currentItem.nombre}» actualizadas a ${newTotalQty} ${currentItem.unidad || "ud."}`;
        }

        const { error } = await supabase.from("ingredientes")
            .update({
                cantidad: newTotalQty,
                precio_unitario: unitPrice,
                updated_at: new Date().toISOString()
            })
            .eq("id", itemId);
        if (error) throw error;
        document.getElementById("inventory-modal").hidden = true;
        await loadIngredients();
        renderProducts();
        showToast(actionMessage);
    });
});

const exportButton = document.getElementById("export-button");
const exportMenu = document.getElementById("export-menu");

function closeExportMenu() {
    exportMenu.hidden = true;
    exportButton.setAttribute("aria-expanded", "false");
}

async function runOrderExport(format) {
    closeExportMenu();
    if (!orders.length) {
        showToast("No hay pedidos para exportar.", true);
        return;
    }

    try {
        const exporter = format === "pdf"
            ? (await import("./services/report-export.js")).exportOrdersPdf
            : format === "excel"
                ? (await import("./services/report-export.js")).exportOrdersExcel
                : (await import("./services/report-export.js")).exportOrdersCsv;
        exporter(orders);
        showToast("Reporte descargado correctamente.");
    } catch (error) {
        showToast(`No se pudo exportar el reporte: ${getErrorMessage(error)}`, true);
    }
}

exportButton.addEventListener("click", () => {
    const isExpanded = exportButton.getAttribute("aria-expanded") === "true";
    exportMenu.hidden = isExpanded;
    exportButton.setAttribute("aria-expanded", String(!isExpanded));
});

document.getElementById("export-pdf-button").addEventListener("click", () => runOrderExport("pdf"));
document.getElementById("export-excel-button").addEventListener("click", () => runOrderExport("excel"));
document.getElementById("export-csv-button").addEventListener("click", () => runOrderExport("csv"));

document.addEventListener("click", (event) => {
    if (!document.getElementById("export-controls").contains(event.target)) closeExportMenu();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !exportMenu.hidden) {
        closeExportMenu();
        exportButton.focus();
    }
});

const adminViewLabels = {
    resumen: "Dashboard",
    menu: "Carta",
    carta: "Carta",
    pedidos: "Pedidos",
    inventario: "Inventario",
    opiniones: "Opiniones",
    personal: "Personal",
    mensajes: "Mensajes",
    politicas: "Políticas y Términos",
    reclamaciones: "Libro de Reclamaciones",
    configuracion: "Configuración"
};

function adminViewFromHash(hash) {
    const raw = (hash || "").replace(/^#/, "").toLocaleLowerCase("es");
    const view = raw === "carta" ? "menu" : raw;
    return Object.hasOwn(adminViewLabels, view) ? view : "resumen";
}

function activateAdminView(view, updateHash = true) {
    if (view === "carta") view = "menu";
    if (!Object.hasOwn(adminViewLabels, view)) {
        view = currentRole ? getDefaultView(currentRole) : "resumen";
    }

    // Verificación estricta de permisos según rol
    if (currentRole && !canRoleAccessView(currentRole, view)) {
        const fallback = getDefaultView(currentRole);
        showToast(`Acceso no autorizado a «${adminViewLabels[view] || view}». Redirigiendo a tu panel.`, true);
        if (view !== fallback) {
            activateAdminView(fallback, true);
            return;
        }
    }

    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.adminPanel !== view;
    });
    document.querySelectorAll(".nav-link").forEach((tab) => {
        const active = tab.dataset.view === view;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
    });
    document.getElementById("breadcrumb-page").textContent = adminViewLabels[view] || "Panel";
    document.getElementById("sidebar").classList.remove("is-open");
    document.getElementById("sidebar-backdrop")?.classList.remove("is-active");
    document.getElementById("mobile-menu-button").setAttribute("aria-expanded", "false");
    document.dispatchEvent(new CustomEvent("admin:view-activated", { detail: { view } }));
    if (updateHash && window.location.hash !== `#${view}`) {
        window.history.replaceState(null, "", `#${view}`);
    }

    if (view === "personal" && canRoleAccessView(currentRole, "personal")) {
        void loadPersonalData();
    }
}

document.addEventListener("admin:view-activated", (event) => {
    if (currentRole === "recepcionista") {
        if (event.detail?.view === "pedidos") {
            void loadOrders();
        } else {
            orders = [];
        }
    }
});

let attendanceList = [];

async function loadStaff() {
    try {
        staffList = await listStaffMembers();
        renderStaffTable();
        populateAttendanceStaff();
        populateAttendanceWorkers();
        renderAttendanceTable();
    } catch (err) {
        showToast(`No se pudo cargar el personal: ${getErrorMessage(err)}`, true);
    }
}

function populateAttendanceWorkers() {
    const select = document.getElementById("attendance-worker-select");
    if (!select) return;
    select.innerHTML = '<option value="">Selecciona integrante del equipo ▼</option>' +
        staffList.map((w) => `<option value="${escapeHtml(w.id || w.user_id)}">${escapeHtml(w.nombre)} (${escapeHtml(ROLE_LABELS[w.rol] || w.rol)})</option>`).join("");
}
async function loadPersonalData() {
    const tasks = [loadAttendance()];
    if (hasAdminAccess(currentRole)) {
        tasks.push(loadStaff());
    }
    if (isAdministrator(currentRole)) {
        tasks.push(loadServiceConfiguration());
    }
    await Promise.all(tasks);
    renderAttendanceTable();
}

async function loadServiceConfiguration() {
    const { data, error } = await supabase.from("configuracion_servicio")
        .select("hora_apertura, hora_cierre, estado_cocina_override, tiempo_delivery_min, tiempo_delivery_max")
        .eq("id", 1)
        .single();
    if (error) {
        showToast(`No se pudo cargar el horario del servicio: ${getErrorMessage(error)}`, true);
        return;
    }
    serviceConfigForm.elements.hora_apertura.value = data.hora_apertura?.slice(0, 5) || "";
    serviceConfigForm.elements.hora_cierre.value = data.hora_cierre?.slice(0, 5) || "";
    serviceConfigForm.elements.estado_cocina_override.value = data.estado_cocina_override === null
        ? "auto"
        : data.estado_cocina_override ? "open" : "closed";

    updateAdminStoreBadge(data.estado_cocina_override, data.hora_apertura, data.hora_cierre);
    const isOpen = data.estado_cocina_override === null ? true : Boolean(data.estado_cocina_override);
    broadcastStoreStatus({
        cocina_abierta: isOpen,
        estado_cocina_override: data.estado_cocina_override,
        hora_apertura: data.hora_apertura,
        hora_cierre: data.hora_cierre,
        tiempo_delivery_min: data.tiempo_delivery_min,
        tiempo_delivery_max: data.tiempo_delivery_max
    });
}

async function loadAttendance() {
    const { data, error } = await supabase.from("asistencia_turnos")
        .select("id, personal_id, fecha, hora_entrada, hora_salida, estado_turno, registrado_por_admin_id, entrada_registrada_por_admin_id, salida_registrada_por_admin_id, observacion")
        .order("hora_entrada", { ascending: false })
        .limit(100);
    if (error) {
        showToast(`No se pudo cargar la asistencia: ${getErrorMessage(error)}`, true);
        return;
    }
    attendanceRows = data || [];
    attendanceList = attendanceRows;
    renderAttendanceTable();
}

function populateAttendanceStaff() {
    const select = document.getElementById("attendance-person-select");
    if (!select) return;
    select.innerHTML = staffList.length ? staffList.map((worker) =>
        `<option value="${escapeHtml(worker.id)}">${escapeHtml(worker.nombre)} · ${worker.estado === "activo" ? "Activo" : "Inactivo"}</option>`
    ).join("") : '<option value="">No hay personal registrado</option>';
}

function formatAttendanceTime(value) {
    return value
        ? new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
        : "—";
}

function formatWorkedTime(entry, exit) {
    if (!entry) return "—";
    const minutes = Math.max(0, Math.floor(((exit ? new Date(exit) : new Date()) - new Date(entry)) / 60000));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours} h ${String(remainder).padStart(2, "0")} min`;
}

function administratorName(userId) {
    if (!userId) return "Auto-marcación";
    return staffList.find((worker) => worker.user_id === userId)?.nombre || "Administrador";
}

function renderAttendanceTable() {
    const tbody = document.getElementById("attendance-body");
    if (!tbody) return;
    const openTurn = attendanceRows.find((row) =>
        row.personal_id === currentUserProfile?.personalId && row.estado_turno === "en_turno"
    );
    const selfStatus = document.getElementById("self-attendance-status");
    if (selfStatus) {
        selfStatus.textContent = openTurn
            ? `En turno desde ${formatAttendanceTime(openTurn.hora_entrada)}.`
            : "No tienes un turno activo.";
    }
    const entryButton = document.getElementById("mark-self-entry");
    const exitButton = document.getElementById("mark-self-exit");
    if (entryButton) entryButton.disabled = Boolean(openTurn);
    if (exitButton) exitButton.disabled = !openTurn;

    tbody.innerHTML = attendanceRows.length ? attendanceRows.map((row) => {
        const worker = staffList.find((item) => item.id === row.personal_id);
        const name = worker?.nombre
            || (row.personal_id === currentUserProfile?.personalId ? currentUserProfile.nombre : "Personal");
        const date = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" })
            .format(new Date(`${row.fecha}T00:00:00`));
        return `<tr>
            <td>${escapeHtml(name)}</td>
            <td>${escapeHtml(date)}</td>
            <td>${escapeHtml(formatAttendanceTime(row.hora_entrada))}</td>
            <td>${escapeHtml(formatAttendanceTime(row.hora_salida))}</td>
            <td>${escapeHtml(formatWorkedTime(row.hora_entrada, row.hora_salida))}</td>
            <td>${escapeHtml(administratorName(row.entrada_registrada_por_admin_id))}</td>
            <td>${escapeHtml(row.hora_salida ? administratorName(row.salida_registrada_por_admin_id) : "—")}</td>
        </tr>`;
    }).join("") : '<tr><td colspan="7">Todavía no hay marcaciones registradas.</td></tr>';
}

async function recordAttendance(action, personalId = null, button) {
    await withBusy(button, async () => {
        const { error } = await supabase.rpc(
            action === "entrada" ? "marcar_entrada_turno" : "marcar_salida_turno",
            { p_personal_id: personalId, p_observacion: "" }
        );
        if (error) throw error;
        await loadAttendance();
        renderAttendanceTable();
        showToast(action === "entrada" ? "Entrada marcada correctamente." : "Salida marcada correctamente.");
    });
}

function renderStaffTable() {
    const tbody = document.getElementById("staff-body");
    if (!tbody) return;
    const canManageStaff = isAdministrator(currentRole);

    if (!staffList.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px;">No hay trabajadores registrados.</td></tr>`;
        return;
    }

    tbody.innerHTML = staffList.map((worker) => {
        const isSelf = worker.user_id === activeUser?.id;
        const roleLabel = ROLE_LABELS[worker.rol] || worker.rol;
        const roleClass = `role-${worker.rol}`;
        const normalizedStatus = String(worker.estado || "").trim().toLowerCase();
        const activeStatus = ["activo", "active", "true", "1"].includes(normalizedStatus)
            || (!["inactivo", "inactive", "false", "0"].includes(normalizedStatus)
                && (worker.activo === true || worker.activo === "true"));
        const registeredBy = staffList.find((item) => item.user_id === worker.registrado_por)?.nombre || worker.registrado_por_nombre || "Registro inicial";
        const updatedBy = staffList.find((item) => item.user_id === worker.actualizado_por)?.nombre || worker.actualizado_por_nombre || "Sin modificaciones";

        return `<tr>
            <td><strong>${escapeHtml(worker.nombre)}</strong>${isSelf ? ' <small style="color:var(--muted); font-size:9px;">(Tu cuenta)</small>' : ""}</td>
            <td>${escapeHtml(worker.email)}</td>
            <td>${escapeHtml(worker.telefono || "—")}</td>
            <td><span class="role-badge ${roleClass}">${escapeHtml(roleLabel)}</span></td>
            <td><span class="status-tag ${activeStatus ? "is-active" : "is-inactive"}"><i></i>${activeStatus ? "Activo" : "Inactivo"}</span>
                ${canManageStaff && !isSelf ? `<button type="button" class="staff-status-switch ${activeStatus ? "is-on" : ""}"
                    data-toggle-staff="${escapeHtml(worker.user_id || worker.id)}" data-active="${activeStatus}"
                    role="switch" aria-checked="${activeStatus}" aria-label="${activeStatus ? "Desactivar" : "Activar"} a ${escapeHtml(worker.nombre)}">
                    <span></span></button>` : ""}
            </td>
            <td><small>Registró: ${escapeHtml(registeredBy)}<br>Modificó: ${escapeHtml(updatedBy)}</small></td>
            <td>
                <div class="staff-actions">
                    ${canManageStaff ? `<button type="button" class="staff-btn" data-edit-staff="${escapeHtml(worker.user_id || worker.id)}" title="Editar datos y rol">Editar</button>` : ""}
                    ${canManageStaff && !isSelf ? `
                        <button type="button" class="staff-btn" data-toggle-staff="${escapeHtml(worker.user_id || worker.id)}" data-active="${activeStatus}" title="${activeStatus ? "Desactivar acceso" : "Activar acceso"}">
                            ${activeStatus ? "Desactivar" : "Activar"}
                        </button>
                        <button type="button" class="staff-btn btn-danger" data-delete-staff="${escapeHtml(worker.user_id || worker.id)}" title="Eliminar trabajador">
                            Eliminar
                        </button>
                    ` : ""}
                </div>
            </td>
        </tr>`;
    }).join("");
}

function resolveProductCategory(value) {
    const normalized = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const matches = [
        ["Para Compartir", ["compartir"]],
        ["Grandes", ["grande", "principal"]],
        ["Familiares", ["familiar"]],
        ["Alitas", ["alita"]],
        ["Extras", ["extra", "guarnicion", "porcion"]],
        ["Bebidas", ["bebida", "refresco", "gaseosa"]],
        ["Promo Gourmett", ["promo", "combo"]],
        ["Hamburguesas", ["hamburguesa", "burger"]],
        ["Kid Gourmett", ["kid", "infantil", "nino"]],
        ["Especiales", ["especial"]]
    ];
    return CATEGORIAS.find((category) => category.toLowerCase() === normalized)
        || matches.find(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)))?.[0]
        || "";
}

productForm.elements.categoria.innerHTML = CATEGORIAS.map((category) =>
    `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
).join("");
productForm.elements.categoria.selectedIndex = -1;


function resetStaffForm() {
    if (!staffForm) return;
    staffForm.reset();
    editingStaffId = null;
    staffForm.elements.userId.value = "";
    staffForm.elements.email.disabled = false;
    const passLabel = document.getElementById("staff-password-label");
    if (passLabel) passLabel.hidden = false;
    staffForm.elements.password.required = true;
    document.getElementById("cancel-staff-edit").hidden = true;
    staffForm.querySelector("button[type='submit']").textContent = "Crear usuario";
}

if (staffForm) {
    staffForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isAdministrator(currentRole)) {
            showToast("Solo el administrador puede gestionar trabajadores.", true);
            return;
        }
        if (!staffForm.reportValidity()) return;

        setBusy(staffForm, true);
        try {
            const formData = new FormData(staffForm);
            const nombre = String(formData.get("nombre") || "").trim();
            const email = String(formData.get("email") || "").trim();
            const telefono = String(formData.get("telefono") || "").trim();
            const rol = String(formData.get("rol") || "").trim();
            const password = String(formData.get("password") || "");

            if (editingStaffId) {
                await updateStaffMember(editingStaffId, {
                    nombre,
                    telefono,
                    rol
                });
                showToast("Datos y rol del trabajador actualizados.");
                resetStaffForm();
            } else {
                await createStaffMember({
                    nombre,
                    email,
                    telefono,
                    rol,
                    password
                });
                showToast("Trabajador creado exitosamente con credenciales de acceso.");
                resetStaffForm();
            }
            await loadStaff();
        } catch (err) {
            showToast(getErrorMessage(err), true);
        } finally {
            setBusy(staffForm, false);
        }
    });
}

const resetStaffBtn = document.getElementById("reset-staff-form");
if (resetStaffBtn) resetStaffBtn.addEventListener("click", resetStaffForm);

const cancelStaffBtn = document.getElementById("cancel-staff-edit");
if (cancelStaffBtn) cancelStaffBtn.addEventListener("click", resetStaffForm);

const staffBody = document.getElementById("staff-body");
if (staffBody) {
    staffBody.addEventListener("click", async (event) => {
        if (!isAdministrator(currentRole)) return;
        const editBtn = event.target.closest("[data-edit-staff]");
        if (editBtn) {
            const id = editBtn.dataset.editStaff;
            const worker = staffList.find((w) => w.user_id === id);
            if (!worker) return;

            editingStaffId = worker.user_id;
            staffForm.elements.userId.value = worker.user_id;
            staffForm.elements.nombre.value = worker.nombre || "";
            staffForm.elements.email.value = worker.email || "";
            staffForm.elements.email.disabled = true;
            staffForm.elements.telefono.value = worker.telefono || "";
            staffForm.elements.rol.value = worker.rol;

            const passLabel = document.getElementById("staff-password-label");
            if (passLabel) passLabel.hidden = true;
            staffForm.elements.password.required = false;

            document.getElementById("cancel-staff-edit").hidden = false;
            staffForm.querySelector("button[type='submit']").textContent = "Guardar cambios";
            staffForm.elements.nombre.focus();
            return;
        }

        const toggleBtn = event.target.closest("[data-toggle-staff]");
        if (toggleBtn) {
            const id = toggleBtn.dataset.toggleStaff;
            if (!id || id === "undefined" || id === "null") {
                showToast("No se pudo identificar al trabajador para actualizar su estado.", true);
                return;
            }
            const currentActive = toggleBtn.matches('[role="switch"]')
                ? toggleBtn.getAttribute("aria-checked") === "true"
                : toggleBtn.dataset.active === "true";
            toggleBtn.disabled = true;
            try {
                await toggleStaffStatus(id, !currentActive);
                showToast(`Trabajador marcado como ${!currentActive ? "Activo" : "Inactivo"}.`);
                await loadStaff();
            } catch (err) {
                showToast(getErrorMessage(err), true);
            } finally {
                toggleBtn.disabled = false;
            }
            return;
        }

        const deleteBtn = event.target.closest("[data-delete-staff]");
        if (deleteBtn) {
            const id = deleteBtn.dataset.deleteStaff;
            const worker = staffList.find((w) => w.user_id === id);
            if (!worker) return;
            if (!window.confirm(`¿Estás seguro de eliminar al trabajador «${worker.nombre}»?`)) return;

            try {
                await deleteStaffMember(id);
                showToast("Trabajador eliminado.");
                await loadStaff();
            } catch (err) {
                showToast(getErrorMessage(err), true);
            }
        }
    });
}

// Eventos de Gestión de Asistencia y Turnos
const selfClockInBtn = document.getElementById("btn-self-clock-in");
if (selfClockInBtn) {
    selfClockInBtn.addEventListener("click", async () => {
        try {
            await clockInStaff({ observacion: "Marcación propia de entrada" });
            showToast("¡Entrada registrada con éxito! Buen servicio.");
            await loadAttendance();
        } catch (err) {
            showToast(`Error al marcar entrada: ${getErrorMessage(err)}`, true);
        }
    });
}

const selfClockOutBtn = document.getElementById("btn-self-clock-out");
if (selfClockOutBtn) {
    selfClockOutBtn.addEventListener("click", async () => {
        try {
            // Buscar turno activo del usuario actual
            const myActiveShift = attendanceList.find((s) =>
                s.estado_turno === "en_turno" &&
                (s.personal_roles?.user_id === activeUser?.id || s.personal_id === activeUser?.id)
            );
            if (!myActiveShift) {
                showToast("No tienes un turno activo pendiente de cierre.", true);
                return;
            }
            await clockOutStaff({ turnoId: myActiveShift.id, observacion: "Marcación propia de salida" });
            showToast("¡Salida registrada con éxito! Turno finalizado.");
            await loadAttendance();
        } catch (err) {
            showToast(`Error al marcar salida: ${getErrorMessage(err)}`, true);
        }
    });
}

const adminAttendanceForm = document.getElementById("admin-attendance-form");
if (adminAttendanceForm) {
    adminAttendanceForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!isAdministrator(currentRole)) {
            showToast("Solo el administrador puede registrar turnos de otros trabajadores.", true);
            return;
        }
        const personalId = adminAttendanceForm.elements.personalId.value;
        const observacion = adminAttendanceForm.elements.observacion.value;
        if (!personalId) {
            showToast("Selecciona un colaborador para registrar el turno.", true);
            return;
        }

        try {
            await clockInStaff({ personalId, observacion });
            showToast("Entrada registrada y auditada correctamente.");
            adminAttendanceForm.reset();
            await loadAttendance();
        } catch (err) {
            showToast(`No se pudo registrar la entrada: ${getErrorMessage(err)}`, true);
        }
    });
}

const attendanceBody = document.getElementById("attendance-body");
if (attendanceBody) {
    attendanceBody.addEventListener("click", async (e) => {
        const outBtn = e.target.closest("[data-clock-out-shift]");
        if (outBtn) {
            if (!isAdministrator(currentRole)) return;
            const shiftId = outBtn.dataset.clockOutShift;
            try {
                await clockOutStaff({ turnoId: shiftId, observacion: "Cierre de turno por administrador" });
                showToast("Turno finalizado y hora de salida registrada.");
                await loadAttendance();
            } catch (err) {
                showToast(`Error al cerrar turno: ${getErrorMessage(err)}`, true);
            }
        }
    });
}

const reviewListEl = document.getElementById("review-list");
if (reviewListEl) {
    reviewListEl.addEventListener("click", async (event) => {
        const deleteReviewBtn = event.target.closest("[data-delete-review]");
        if (!deleteReviewBtn) return;
        if (!isAdministrator(currentRole)) {
            showToast("Solo el administrador puede eliminar opiniones.", true);
            return;
        }
        const reviewId = deleteReviewBtn.dataset.deleteReview;
        if (!window.confirm("¿Seguro que deseas eliminar esta opinión?")) return;

        try {
            const { error } = await supabase.from("opiniones").delete().eq("id", reviewId);
            if (error) throw error;
            showToast("Opinión eliminada.");
            await loadReviews();
        } catch (err) {
            showToast(`No se pudo eliminar la opinión: ${getErrorMessage(err)}`, true);
        }
    });
}

document.querySelectorAll(".nav-link").forEach((tab, index, tabs) => {
    tab.addEventListener("click", () => activateAdminView(tab.dataset.view));
    tab.addEventListener("keydown", (event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home" ? 0
            : event.key === "End" ? tabs.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[nextIndex].focus();
        activateAdminView(tabs[nextIndex].dataset.view);
    });
});
window.addEventListener("hashchange", () => activateAdminView(adminViewFromHash(window.location.hash), false));
activateAdminView(adminViewFromHash(window.location.hash), false);

const closeSidebarMobile = () => {
    const sidebar = document.getElementById("sidebar");
    sidebar?.classList.remove("is-open");
    document.getElementById("sidebar-backdrop")?.classList.remove("is-active");
    document.getElementById("mobile-menu-button")?.setAttribute("aria-expanded", "false");
};

document.getElementById("mobile-menu-button")?.addEventListener("click", (event) => {
    const sidebar = document.getElementById("sidebar");
    const isOpen = sidebar?.classList.toggle("is-open");
    document.getElementById("sidebar-backdrop")?.classList.toggle("is-active", Boolean(isOpen));
    event.currentTarget.setAttribute("aria-expanded", String(Boolean(isOpen)));
});

document.getElementById("sidebar-backdrop")?.addEventListener("click", closeSidebarMobile);
document.getElementById("sidebar-close-mobile-btn")?.addEventListener("click", closeSidebarMobile);
const sidebarCollapseBtn = document.getElementById("sidebar-collapse-btn");
if (sidebarCollapseBtn) {
    sidebarCollapseBtn.addEventListener("click", () => {
        const sidebar = document.getElementById("sidebar");
        const isCollapsed = sidebar.classList.toggle("is-collapsed");
        document.querySelector(".app-shell")?.classList.toggle("sidebar-collapsed", isCollapsed);
        sidebarCollapseBtn.setAttribute("aria-expanded", String(!isCollapsed));
    });
}
const topbarSearchInput = document.getElementById("topbar-search-input");
if (topbarSearchInput) {
    topbarSearchInput.addEventListener("input", (e) => {
        const query = e.target.value.trim().toLowerCase();
        const orderSearch = document.getElementById("order-search");
        if (orderSearch) {
            orderSearch.value = query;
            orderSearch.dispatchEvent(new Event("input"));
        }
    });
    topbarSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const query = topbarSearchInput.value.trim();
            if (query && window.location.hash !== "#pedidos") {
                activateAdminView("pedidos");
                const orderSearch = document.getElementById("order-search");
                if (orderSearch) {
                    orderSearch.value = query;
                    orderSearch.dispatchEvent(new Event("input"));
                }
            }
        }
    });
}
document.getElementById("inventory-modal").addEventListener("click", (event) => {
    if (event.target.id === "inventory-modal") event.currentTarget.hidden = true;
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeOrderModal();
        document.getElementById("inventory-modal").hidden = true;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        const topSearch = document.getElementById("topbar-search-input");
        if (topSearch) topSearch.focus();
        else document.getElementById("order-search")?.focus();
    }
});

// Acciones Rápidas en el Dashboard
document.querySelectorAll("[data-quick-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
        const view = btn.dataset.quickNav;
        if (view) activateAdminView(view);
    });
});

// Pestañas y Guardado de Políticas
document.querySelectorAll("[data-policy-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
        const target = tab.dataset.policyTab;
        document.querySelectorAll("[data-policy-tab]").forEach((t) => t.classList.toggle("is-active", t === tab));
        const priv = document.getElementById("policy-card-privacy");
        const terms = document.getElementById("policy-card-terms");
        const cookies = document.getElementById("policy-card-cookies");
        if (priv) priv.hidden = target !== "privacy";
        if (terms) terms.hidden = target !== "terms";
        if (cookies) cookies.hidden = target !== "cookies";
    });
});
document.getElementById("save-policies-btn")?.addEventListener("click", () => {
    const privacy = document.getElementById("policy-privacy-text")?.value || "";
    const terms = document.getElementById("policy-terms-text")?.value || "";
    const cookies = document.getElementById("policy-cookies-text")?.value || "";
    try {
        localStorage.setItem("frygourmett-policy-privacy", privacy);
        localStorage.setItem("frygourmett-policy-terms", terms);
        localStorage.setItem("frygourmett-policy-cookies", cookies);
        showToast("Políticas y términos guardados correctamente.");
    } catch {
        showToast("No se pudo guardar localmente.", true);
    }
});

// Modo Claro / Modo Oscuro
function setAdminTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("frygourmett-theme", theme);
    const toggleBtn = document.getElementById("admin-theme-toggle");
    if (toggleBtn) {
        toggleBtn.setAttribute("aria-label", theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
        toggleBtn.innerHTML = theme === "dark"
            ? `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
            : `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
    const sidebarThemeLabel = document.getElementById("sidebar-theme-label");
    if (sidebarThemeLabel) {
        sidebarThemeLabel.textContent = theme === "dark" ? "🌙 Modo Oscuro" : "☀️ Modo Claro";
    }
    const darkBtn = document.getElementById("set-theme-dark-btn");
    const lightBtn = document.getElementById("set-theme-light-btn");
    if (darkBtn && lightBtn) {
        darkBtn.classList.toggle("is-active", theme === "dark");
        lightBtn.classList.toggle("is-active", theme === "light");
    }
}

const savedTheme = localStorage.getItem("frygourmett-theme") || "dark";
setAdminTheme(savedTheme);

document.getElementById("admin-theme-toggle")?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    setAdminTheme(current === "dark" ? "light" : "dark");
    showToast(`Modo ${current === "dark" ? "claro" : "oscuro"} activado.`);
});
document.getElementById("sidebar-theme-toggle")?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    setAdminTheme(current === "dark" ? "light" : "dark");
    showToast(`Modo ${current === "dark" ? "claro" : "oscuro"} activado.`);
});
document.getElementById("set-theme-dark-btn")?.addEventListener("click", () => {
    setAdminTheme("dark");
    showToast("Modo oscuro activado.");
});
document.getElementById("set-theme-light-btn")?.addEventListener("click", () => {
    setAdminTheme("light");
    showToast("Modo claro activado.");
});

document.getElementById("current-year").textContent = new Date().getFullYear();
document.getElementById("today-label").textContent = new Intl.DateTimeFormat("es-ES", {
    weekday: "short", day: "numeric", month: "short", year: "numeric"
}).format(new Date());
const serviceLabelEl = document.getElementById("service-label");
if (serviceLabelEl) {
    serviceLabelEl.textContent = `${new Intl.DateTimeFormat("es-ES", { weekday: "long" }).format(new Date()).toLocaleUpperCase("es")} · SERVICIO`;
}
document.getElementById("role-switch-button").setAttribute("aria-label", "Cerrar sesión");

let isSubscribingOrders = false;
async function subscribeToOrders() {
    if (isSubscribingOrders) return;
    isSubscribingOrders = true;
    try {
        if (orderSubscription) {
            await supabase.removeChannel(orderSubscription);
            orderSubscription = null;
        }
        orderSubscription = supabase.channel("chef-operational-data")
            .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, (payload) => {
                void loadOrders({
                    eventType: payload?.eventType || "UPDATE",
                    order: payload?.new || payload?.old || null
                }).catch((error) => showToast(`No se pudieron actualizar los pedidos: ${getErrorMessage(error)}`, true));
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "promociones" }, () => {
                void loadPromotions().catch((error) => showToast(`No se pudieron actualizar los destacados: ${getErrorMessage(error)}`, true));
            })
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    showToast("Se perdió la actualización en tiempo real; recarga el panel para sincronizar.", true);
                }
            });
    } finally {
        isSubscribingOrders = false;
    }
}

window.addEventListener("frygourmett:order-status-changed", async (event) => {
    const { nextStatus, prevStatus, order } = event.detail || {};
    if (nextStatus === "En preparación" && prevStatus !== "En preparación" && canManageInventory()) {
        await loadIngredients();
    }
    await loadOrders({ eventType: "UPDATE", order: order || null });
});

function setupMediaDropzone(dropzoneId, inputId, previewBoxId, imgId, videoId, badgeId, nameId, removeId, targetUrlInputId) {
    const dropzone = document.getElementById(dropzoneId);
    const fileInput = document.getElementById(inputId);
    const previewBox = document.getElementById(previewBoxId);
    const previewImg = document.getElementById(imgId);
    const previewVideo = document.getElementById(videoId);
    const previewBadge = document.getElementById(badgeId);
    const previewName = document.getElementById(nameId);
    const removeBtn = document.getElementById(removeId);
    const targetUrlInput = document.getElementById(targetUrlInputId);

    if (!dropzone || !fileInput) return;

    const openPicker = () => fileInput.click();
    dropzone.addEventListener("click", (e) => {
        if (e.target.closest(".media-preview-remove")) return;
        openPicker();
    });
    dropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
        }
    });

    ["dragenter", "dragover"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add("is-dragover");
        });
    });
    ["dragleave", "drop"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove("is-dragover");
        });
    });

    dropzone.addEventListener("drop", (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFile(file);
    });

    fileInput.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    });

    removeBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput.value = "";
        if (previewBox) previewBox.hidden = true;
        if (previewImg) { previewImg.hidden = true; previewImg.src = ""; }
        if (previewVideo) { previewVideo.hidden = true; previewVideo.src = ""; }
        const promptEl = dropzone.querySelector(".dropzone-prompt");
        if (promptEl) promptEl.hidden = false;
        if (targetUrlInput) targetUrlInput.value = "";
    });

    function handleFile(file) {
        const promptEl = dropzone.querySelector(".dropzone-prompt");
        if (file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = (re) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    let width = img.width;
                    let height = img.height;
                    const maxDim = 1400;
                    if (width > maxDim || height > maxDim) {
                        if (width > height) {
                            height = Math.round((height * maxDim) / width);
                            width = maxDim;
                        } else {
                            width = Math.round((width * maxDim) / height);
                            height = maxDim;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0, width, height);
                    const webpDataUrl = canvas.toDataURL("image/webp", 0.85);
                    const approxKb = (Math.round((webpDataUrl.length * 3) / 4) / 1024).toFixed(1);

                    if (previewImg) {
                        previewImg.src = webpDataUrl;
                        previewImg.hidden = false;
                    }
                    if (previewVideo) previewVideo.hidden = true;
                    if (previewBadge) previewBadge.textContent = `✓ WebP (${approxKb} KB)`;
                    if (previewName) previewName.textContent = file.name;
                    if (previewBox) previewBox.hidden = false;
                    if (promptEl) promptEl.hidden = true;
                    if (targetUrlInput) targetUrlInput.value = webpDataUrl;
                    showToast(`Imagen ${file.name} convertida y optimizada a formato .webp`);
                };
                img.src = re.target.result;
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith("video/")) {
            const videoUrl = URL.createObjectURL(file);
            if (previewVideo) {
                previewVideo.src = videoUrl;
                previewVideo.hidden = false;
            }
            if (previewImg) previewImg.hidden = true;
            if (previewBadge) previewBadge.textContent = "Video MP4";
            if (previewName) previewName.textContent = file.name;
            if (previewBox) previewBox.hidden = false;
            if (promptEl) promptEl.hidden = true;
            if (targetUrlInput) targetUrlInput.value = `img/${file.name}`;
            showToast(`Video ${file.name} seleccionado.`);
        }
    }
}

setupMediaDropzone(
    "product-dropzone",
    "product-file-input",
    "product-preview-box",
    "product-preview-img",
    "product-preview-video",
    "product-preview-badge",
    "product-preview-name",
    "product-preview-remove",
    "product-imagen-url"
);

setupMediaDropzone(
    "promotion-dropzone",
    "promotion-file-input",
    "promotion-preview-box",
    "promotion-preview-img",
    "promotion-preview-video",
    "promotion-preview-badge",
    "promotion-preview-name",
    "promotion-preview-remove",
    "promotion-media-url"
);

setupRecipeFileDropzone();

if (!isSupabaseConfigured) {
    showAuthMessage("Falta la configuración de Supabase. Copia .env.example a .env.local, completa las variables y vuelve a iniciar Vite.", true);
} else {
    supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
            activeUser = null;
            currentRole = null;
            realAuthenticatedRole = null;
            isRoleSimulated = false;
            applyRolePermissions();
            document.body.classList.remove("is-authenticated");
            if (orderSubscription) {
                void supabase.removeChannel(orderSubscription);
                orderSubscription = null;
            }
            if (notificationCleanup) {
                notificationCleanup();
                notificationCleanup = null;
            }
            if (staffChatCleanup) {
                staffChatCleanup();
                staffChatCleanup = null;
            }
        }
    });
    supabase.auth.getSession().then(({ data, error }) => {
        if (error) showAuthMessage(`No pudimos restaurar la sesión: ${getErrorMessage(error)}`, true);
        else authorize(data.session);
    }).catch((error) => showAuthMessage(`No pudimos conectar con Supabase: ${getErrorMessage(error)}`, true));
}
