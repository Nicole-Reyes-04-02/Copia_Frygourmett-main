import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(
    supabaseUrl
    && supabaseAnonKey
    && !supabaseUrl.includes("YOUR_PROJECT_ID")
    && !supabaseAnonKey.includes("YOUR_SUPABASE")
);

export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            autoRefreshToken: true,
            detectSessionInUrl: true,
            persistSession: true
        }
    })
    : null;

const imageAssets = typeof import.meta.glob === "function" ? import.meta.glob(["../img/*", "../img/**/*"], {
    eager: true,
    import: "default",
    query: "?url"
}) : {};

export function resolveImage(path) {
    if (!path) return "";
    const source = String(path).trim();
    if (/^https:\/\//i.test(source)) return source;
    const normalized = source.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
    const assetPath = normalized.startsWith("img/") ? normalized : `img/${normalized}`;
    return imageAssets[`../${assetPath}`] || source;
}

export function isVideoAsset(path) {
    return /\.(?:mp4|webm|ogg)(?:$|[?#])/i.test(String(path || "").trim());
}

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character]);
}

export function formatCurrency(amount) {
    const value = Number(amount);
    return `S/ ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
}
