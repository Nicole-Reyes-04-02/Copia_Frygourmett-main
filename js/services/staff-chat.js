import { escapeHtml, isSupabaseConfigured, supabase } from "../supabase.js";
import { hasAdminAccess, ROLE_LABELS } from "../auth.js";

const CHANNELS = [
    { id: "general", label: "#general" },
    { id: "pedidos", label: "#pedidos" },
    { id: "inventario", label: "#inventario" }
];
const PAGE_SIZE = 40;
const MESSAGE_COLUMNS = "id, canal, usuario_id, remitente_nombre, remitente_rol, contenido, created_at";

function compareMessageIds(left, right) {
    const leftId = BigInt(left.id);
    const rightId = BigInt(right.id);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function formatMessageTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Hora no disponible";
    return new Intl.DateTimeFormat("es-PE", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

export function setupStaffChat({ userId, role, onError = console.error }) {
    const panel = document.getElementById("mensajes");
    const tabList = document.getElementById("staff-chat-channels");
    const channelPanel = document.getElementById("staff-chat-channel-panel");
    const feed = document.getElementById("staff-chat-log");
    const status = document.getElementById("staff-chat-status");
    const form = document.getElementById("staff-chat-form");
    const olderButton = document.getElementById("staff-chat-load-older");
    if (!panel || !tabList || !channelPanel || !feed || !status || !form || !olderButton || !userId || !role) {
        return () => {};
    }

    const canAccessInventory = hasAdminAccess(role) || role === "almacenero";
    const allowedChannels = CHANNELS
        .filter((channel) => channel.id !== "inventario" || canAccessInventory)
        .map((channel) => channel.id);
    const channelTabs = [...tabList.querySelectorAll("[data-chat-channel]")];
    const unreadBadges = new Map(CHANNELS.map((channel) => [
        channel.id,
        document.getElementById(`chat-unread-${channel.id}`)
    ]));
    const readMarkers = new Map();
    const readMarkerWrites = new Map();
    let activeChannel = "general";
    let messages = [];
    let hasOlderMessages = false;
    let loadRequestId = 0;
    let unreadRequestId = 0;
    let chatChannel = null;
    let disposed = false;
    let countErrorReported = false;

    function reportError(error, message) {
        if (disposed) return;
        status.textContent = message;
        onError(error);
    }

    function isChatVisible() {
        return !panel.hidden;
    }

    function updateTabState() {
        channelPanel.setAttribute("aria-labelledby", `chat-channel-${activeChannel}`);
        channelTabs.forEach((tab) => {
            const active = tab.dataset.chatChannel === activeChannel;
            tab.hidden = !allowedChannels.includes(tab.dataset.chatChannel);
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        });
    }

    function renderUnreadCounts(counts) {
        for (const [channelId, badge] of unreadBadges) {
            if (!badge) continue;
            const unreadCount = counts[channelId] || 0;
            badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
            badge.hidden = unreadCount === 0;
            const tab = channelTabs.find((item) => item.dataset.chatChannel === channelId);
            if (tab) {
                const channelLabel = CHANNELS.find((item) => item.id === channelId).label;
                tab.setAttribute("aria-label", unreadCount
                    ? `${channelLabel}, ${unreadCount} mensajes sin leer`
                    : channelLabel);
            }
        }
    }

    function renderMessages() {
        if (messages.length === 0) {
            feed.textContent = `Aún no hay mensajes en #${activeChannel}.`;
            olderButton.hidden = true;
            return;
        }

        feed.innerHTML = messages.map((message) => {
            const senderRole = ROLE_LABELS[message.remitente_rol] || message.remitente_rol;
            return `<article class="staff-chat-message${message.usuario_id === userId ? " is-own-message" : ""}">
                <header>
                    <strong>${escapeHtml(message.remitente_nombre)}</strong>
                    <span>${escapeHtml(senderRole)}</span>
                    <time datetime="${escapeHtml(message.created_at)}">${escapeHtml(formatMessageTime(message.created_at))}</time>
                </header>
                <p>${escapeHtml(message.contenido)}</p>
            </article>`;
        }).join("");
        olderButton.hidden = !hasOlderMessages;
    }

    async function refreshUnreadCounts() {
        const requestId = ++unreadRequestId;
        const { data: readRows, error: readError } = await supabase
            .from("chat_lecturas")
            .select("canal, ultimo_leido_id")
            .eq("usuario_id", userId);
        if (readError) throw readError;

        const markers = new Map((readRows || []).map((row) => [
            row.canal,
            String(row.ultimo_leido_id)
        ]));
        const entries = await Promise.all(allowedChannels.map(async (channelId) => {
            const { count, error } = await supabase
                .from("chat_mensajes")
                .select("id", { count: "exact", head: true })
                .eq("canal", channelId)
                .neq("usuario_id", userId)
                .gt("id", markers.get(channelId) || "0");
            if (error) throw error;
            return [channelId, count || 0];
        }));

        if (disposed || requestId !== unreadRequestId) return;
        for (const [channelId, marker] of markers) {
            const currentMarker = readMarkers.get(channelId) || "0";
            if (BigInt(marker) > BigInt(currentMarker)) readMarkers.set(channelId, marker);
        }
        renderUnreadCounts(Object.fromEntries(entries));
        countErrorReported = false;
    }

    async function markChannelRead(channelId, messageId) {
        if (!messageId) return false;
        const pendingWrite = readMarkerWrites.get(channelId);
        if (pendingWrite) await pendingWrite;

        const currentMarker = BigInt(readMarkers.get(channelId) || "0");
        const nextMarker = BigInt(messageId);
        if (nextMarker <= currentMarker) return false;

        const write = (async () => {
            const { error } = await supabase
                .from("chat_lecturas")
                .upsert({
                    usuario_id: userId,
                    canal: channelId,
                    ultimo_leido_id: String(messageId),
                    updated_at: new Date().toISOString()
                }, { onConflict: "usuario_id,canal" });
            if (error) throw error;
            readMarkers.set(channelId, String(messageId));
        })();
        readMarkerWrites.set(channelId, write);
        try {
            await write;
        } finally {
            if (readMarkerWrites.get(channelId) === write) readMarkerWrites.delete(channelId);
        }
        return true;
    }

    async function loadChannel(channelId) {
        if (!allowedChannels.includes(channelId)) return;
        activeChannel = channelId;
        const requestId = ++loadRequestId;
        messages = [];
        hasOlderMessages = false;
        updateTabState();
        renderMessages();
        status.textContent = "Cargando mensajes...";

        let data;
        try {
            const result = await supabase
                .from("chat_mensajes")
                .select(MESSAGE_COLUMNS)
                .eq("canal", channelId)
                .order("id", { ascending: false })
                .limit(PAGE_SIZE);
            if (result.error) throw result.error;
            data = result.data || [];
        } catch (error) {
            if (requestId !== loadRequestId) return;
            feed.textContent = "No se pudieron cargar los mensajes.";
            olderButton.hidden = true;
            reportError(error, "Error al cargar este canal.");
            return;
        }

        if (disposed || requestId !== loadRequestId) return;
        const messagesReceivedDuringLoad = messages;
        const loadedMessages = [...data].reverse();
        const loadedIds = new Set(loadedMessages.map((message) => String(message.id)));
        messages = [
            ...loadedMessages,
            ...messagesReceivedDuringLoad.filter((message) => !loadedIds.has(String(message.id)))
        ].sort(compareMessageIds);
        hasOlderMessages = data.length === PAGE_SIZE;
        renderMessages();
        feed.scrollTop = feed.scrollHeight;
        status.textContent = "";

        const latestId = data[0]?.id;
        if (latestId && isChatVisible()) {
            try {
                await markChannelRead(channelId, latestId);
                await refreshUnreadCounts();
            } catch (error) {
                reportError(error, "No se pudo actualizar el estado de lectura.");
            }
        }
    }

    async function loadOlderMessages() {
        const oldestId = messages[0]?.id;
        if (!hasOlderMessages || !oldestId) return;
        const previousHeight = feed.scrollHeight;
        const previousScrollTop = feed.scrollTop;
        olderButton.disabled = true;

        try {
            const { data, error } = await supabase
                .from("chat_mensajes")
                .select(MESSAGE_COLUMNS)
                .eq("canal", activeChannel)
                .lt("id", String(oldestId))
                .order("id", { ascending: false })
                .limit(PAGE_SIZE);
            if (error) throw error;
            if (disposed) return;

            const olderMessages = [...(data || [])].reverse();
            const existingIds = new Set(messages.map((message) => String(message.id)));
            messages = [
                ...olderMessages.filter((message) => !existingIds.has(String(message.id))),
                ...messages
            ];
            hasOlderMessages = (data || []).length === PAGE_SIZE;
            renderMessages();
            feed.scrollTop = previousScrollTop + feed.scrollHeight - previousHeight;
        } catch (error) {
            reportError(error, "No se pudo cargar el historial anterior.");
        } finally {
            olderButton.disabled = false;
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        const input = form.elements.contenido;
        const content = String(input.value || "").trim();
        if (!content) {
            status.textContent = "Escribe un mensaje antes de enviarlo.";
            return;
        }

        const channelId = activeChannel;
        const submitButton = form.querySelector("button[type='submit']");
        submitButton.disabled = true;
        status.textContent = "Enviando mensaje...";
        try {
            const { data, error } = await supabase
                .from("chat_mensajes")
                .insert({ canal: channelId, contenido: content })
                .select(MESSAGE_COLUMNS)
                .single();
            if (error) throw error;
            if (disposed) return;
            if (channelId === activeChannel && !messages.some((message) => String(message.id) === String(data.id))) {
                messages = [...messages, data].sort(compareMessageIds);
                renderMessages();
                feed.scrollTop = feed.scrollHeight;
            }
            input.value = "";
            status.textContent = "Mensaje enviado.";
            await markChannelRead(channelId, data.id);
            await refreshUnreadCounts();
        } catch (error) {
            reportError(error, "No se pudo enviar el mensaje.");
        } finally {
            submitButton.disabled = false;
        }
    }

    function handleIncomingMessage(message) {
        if (disposed || !message || !allowedChannels.includes(message.canal)) return;
        const isCurrentChannel = message.canal === activeChannel;
        const chatVisible = isChatVisible();
        const wasNearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
        if (isCurrentChannel && !messages.some((item) => String(item.id) === String(message.id))) {
            messages = [...messages, message].sort(compareMessageIds);
            renderMessages();
            if (chatVisible && (wasNearBottom || message.usuario_id === userId)) {
                feed.scrollTop = feed.scrollHeight;
                void markChannelRead(message.canal, message.id)
                    .then((changed) => changed ? refreshUnreadCounts() : undefined)
                    .catch((error) => reportError(error, "No se pudo actualizar el contador de mensajes."));
            } else {
                void refreshUnreadCounts().catch((error) => reportError(error, "No se pudieron actualizar los mensajes sin leer."));
            }
            return;
        }
        void refreshUnreadCounts().catch((error) => reportError(error, "No se pudieron actualizar los mensajes sin leer."));
    }

    function handleFeedScroll() {
        if (!isChatVisible()) return;
        if (feed.scrollHeight - feed.scrollTop - feed.clientHeight >= 80) return;
        const latestMessage = messages[messages.length - 1];
        if (!latestMessage) return;
        void markChannelRead(activeChannel, latestMessage.id)
            .then((changed) => changed ? refreshUnreadCounts() : undefined)
            .catch((error) => reportError(error, "No se pudo actualizar el canal como leído."));
    }

    function handleTabClick(event) {
        const tab = event.target.closest("[data-chat-channel]");
        if (!tab || !tabList.contains(tab) || !allowedChannels.includes(tab.dataset.chatChannel)) return;
        if (tab.dataset.chatChannel !== activeChannel) void loadChannel(tab.dataset.chatChannel);
    }

    function handleTabKeydown(event) {
        const currentTab = event.target.closest("[data-chat-channel]");
        if (!currentTab || !tabList.contains(currentTab)) return;
        const visibleTabs = channelTabs.filter((tab) => !tab.hidden);
        const currentIndex = visibleTabs.indexOf(currentTab);
        if (currentIndex < 0) return;

        let nextIndex;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % visibleTabs.length;
        else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = visibleTabs.length - 1;
        else return;

        event.preventDefault();
        visibleTabs[nextIndex].focus();
        void loadChannel(visibleTabs[nextIndex].dataset.chatChannel);
    }

    function handleViewActivated(event) {
        if (event.detail?.view !== "mensajes") return;
        feed.scrollTop = feed.scrollHeight;
        const latestMessage = messages[messages.length - 1];
        if (!latestMessage) {
            void refreshUnreadCounts().catch((error) => reportError(error, "No se pudieron actualizar los mensajes sin leer."));
            return;
        }

        void markChannelRead(activeChannel, latestMessage.id)
            .then((changed) => changed ? refreshUnreadCounts() : undefined)
            .catch((error) => reportError(error, "No se pudo actualizar el canal como leído."));
    }

    function handleRealtimeStatus(statusValue) {
        if (statusValue === "CHANNEL_ERROR" || statusValue === "TIMED_OUT") {
            reportError(new Error(`Suscripción del chat: ${statusValue}`), "Se perdió la conexión en tiempo real del chat.");
        }
    }

    function cleanup() {
        disposed = true;
        tabList.removeEventListener("click", handleTabClick);
        tabList.removeEventListener("keydown", handleTabKeydown);
        olderButton.removeEventListener("click", loadOlderMessages);
        feed.removeEventListener("scroll", handleFeedScroll);
        form.removeEventListener("submit", handleSubmit);
        document.removeEventListener("admin:view-activated", handleViewActivated);
        panel.hidden = true;
        feed.textContent = "Inicia sesión con una cuenta del personal para cargar los mensajes.";
        status.textContent = "";
        olderButton.hidden = true;
        olderButton.disabled = false;
        const submitButton = form.querySelector("button[type='submit']");
        if (submitButton) submitButton.disabled = false;
        form.reset();
        unreadBadges.forEach((badge) => {
            if (!badge) return;
            badge.textContent = "";
            badge.hidden = true;
        });
        if (chatChannel && supabase) {
            void supabase.removeChannel(chatChannel).then((statusValue) => {
                if (statusValue !== "ok") onError(new Error(`No se pudo cerrar el canal de chat: ${statusValue}`));
            }).catch(onError);
        }
    }

    if (!isSupabaseConfigured || !supabase) {
        reportError(new Error("Supabase no está configurado."), "El chat requiere conexión con Supabase.");
        return cleanup;
    }

    tabList.addEventListener("click", handleTabClick);
    tabList.addEventListener("keydown", handleTabKeydown);
    olderButton.addEventListener("click", loadOlderMessages);
    feed.addEventListener("scroll", handleFeedScroll);
    form.addEventListener("submit", handleSubmit);
    document.addEventListener("admin:view-activated", handleViewActivated);
    updateTabState();
    status.textContent = "Cargando canales...";

    chatChannel = supabase.channel(`staff-chat-${userId}`);
    for (const channelId of allowedChannels) {
        chatChannel = chatChannel.on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "chat_mensajes",
            filter: `canal=eq.${channelId}`
        }, (payload) => handleIncomingMessage(payload.new));
    }
    chatChannel.subscribe(handleRealtimeStatus);

    void (async () => {
        try {
            await refreshUnreadCounts();
        } catch (error) {
            if (!countErrorReported) {
                countErrorReported = true;
                reportError(error, "No se pudieron actualizar los contadores por canal.");
            }
        }
        await loadChannel(activeChannel);
    })();

    return cleanup;
}
