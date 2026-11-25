import { escapeHtml, isSupabaseConfigured, supabase } from "../supabase.js";

function formatNotificationDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Fecha no disponible";
    return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "short",
        timeStyle: "short"
    }).format(date);
}

export function setupNotifications({
    userId,
    role,
    buttonId = "notification-button",
    panelId = "role-notifications",
    listId = "role-notification-list",
    countId = "notification-count",
    onError = console.error
}) {
    const button = document.getElementById(buttonId);
    const panel = document.getElementById(panelId);
    const list = document.getElementById(listId);
    const count = document.getElementById(countId);
    if (!button || !panel || !list || !count || !userId || !role) return () => {};

    let channel = null;
    let notifications = [];
    let unreadCount = 0;
    let disposed = false;
    let hasReportedLoadError = false;

    function updateCount() {
        count.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        count.hidden = unreadCount === 0;
        button.setAttribute("aria-label", unreadCount
            ? `Ver notificaciones, ${unreadCount} sin leer`
            : "Ver notificaciones");
    }

    function renderNotifications() {
        updateCount();
        if (notifications.length === 0) {
            list.textContent = "No tienes notificaciones.";
            return;
        }

        list.innerHTML = notifications.map((notification) => `
            <article class="notification-item${notification.leida ? " is-read" : ""}" role="listitem">
                <strong>${escapeHtml(notification.titulo)}</strong>
                <p>${escapeHtml(notification.mensaje)}</p>
                <time datetime="${escapeHtml(notification.created_at)}">${escapeHtml(formatNotificationDate(notification.created_at))}</time>
                ${notification.leida
                    ? '<span class="notification-read-label">Leída</span>'
                    : `<button type="button" data-mark-notification="${escapeHtml(notification.id)}">Marcar como leída</button>`}
            </article>
        `).join("");
    }

    function reportError(error, fallbackMessage) {
        if (disposed) return;
        if (fallbackMessage) list.textContent = fallbackMessage;
        if (!hasReportedLoadError) {
            hasReportedLoadError = true;
            onError(error);
        }
    }

    async function refreshNotifications() {
        const [notificationResult, unreadResult] = await Promise.all([
            supabase
                .from("notificaciones")
                .select("id, rol_destino, titulo, mensaje, leida, created_at")
                .eq("usuario_id", userId)
                .eq("rol_destino", role)
                .order("created_at", { ascending: false })
                .limit(30),
            supabase
                .from("notificaciones")
                .select("id", { count: "exact", head: true })
                .eq("usuario_id", userId)
                .eq("rol_destino", role)
                .eq("leida", false)
        ]);
        if (notificationResult.error) throw notificationResult.error;
        if (unreadResult.error) throw unreadResult.error;
        if (disposed) return;
        notifications = notificationResult.data || [];
        unreadCount = unreadResult.count || 0;
        hasReportedLoadError = false;
        renderNotifications();
    }

    function refreshSafely() {
        void refreshNotifications().catch((error) => {
            reportError(error, "No se pudieron cargar las notificaciones.");
        });
    }

    function setPanelOpen(isOpen) {
        panel.hidden = !isOpen;
        button.setAttribute("aria-expanded", String(isOpen));
        if (isOpen) refreshSafely();
    }

    function handleButtonClick() {
        setPanelOpen(panel.hidden);
    }

    function handleDocumentClick(event) {
        if (!panel.contains(event.target) && !button.contains(event.target)) {
            setPanelOpen(false);
        }
    }

    function handleKeydown(event) {
        if (event.key === "Escape" && !panel.hidden) {
            setPanelOpen(false);
            button.focus();
        }
    }

    async function handleListClick(event) {
        const markButton = event.target.closest("[data-mark-notification]");
        if (!markButton || !list.contains(markButton)) return;
        markButton.disabled = true;

        try {
            const { error } = await supabase
                .from("notificaciones")
                .update({ leida: true })
                .eq("id", markButton.dataset.markNotification)
                .eq("usuario_id", userId)
                .eq("rol_destino", role);
            if (error) throw error;
            await refreshNotifications();
        } catch (error) {
            markButton.disabled = false;
            reportError(error, "No se pudo marcar la notificación como leída.");
        }
    }

    button.addEventListener("click", handleButtonClick);
    list.addEventListener("click", handleListClick);
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeydown);

    if (!isSupabaseConfigured || !supabase) {
        reportError(new Error("Supabase no está configurado."), "Las notificaciones requieren conexión con Supabase.");
    } else {
        list.textContent = "Cargando notificaciones...";
        refreshSafely();
        channel = supabase
            .channel(`notificaciones-${userId}-${role}`)
            .on("postgres_changes", {
                event: "INSERT",
                schema: "public",
                table: "notificaciones",
                filter: `rol_destino=eq.${role}`
            }, refreshSafely)
            .on("postgres_changes", {
                event: "UPDATE",
                schema: "public",
                table: "notificaciones",
                filter: `rol_destino=eq.${role}`
            }, refreshSafely)
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    reportError(new Error(`Suscripción de notificaciones: ${status}`), "Se perdió la conexión en tiempo real de las notificaciones.");
                }
            });
    }

    return () => {
        disposed = true;
        button.removeEventListener("click", handleButtonClick);
        list.removeEventListener("click", handleListClick);
        document.removeEventListener("click", handleDocumentClick);
        document.removeEventListener("keydown", handleKeydown);
        if (channel && supabase) {
            void supabase.removeChannel(channel).then((status) => {
                if (status !== "ok") onError(new Error(`No se pudo cerrar el canal de notificaciones: ${status}`));
            }).catch(onError);
        }
    };
}
