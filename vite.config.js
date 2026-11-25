import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const siteUrl = (env.VITE_SITE_URL || "https://frygourmett.netlify.app").replace(/\/+$/, "");

    if (command === "build") {
        let parsedSiteUrl;
        try {
            parsedSiteUrl = new URL(siteUrl);
        } catch {
            throw new Error("VITE_SITE_URL debe ser una URL HTTPS absoluta para producción.");
        }
        if (parsedSiteUrl.protocol !== "https:" || /localhost|example\.com/i.test(siteUrl)) {
            throw new Error("VITE_SITE_URL debe ser una URL HTTPS absoluta para producción.");
        }
        if (!env.VITE_SUPABASE_URL || /YOUR_PROJECT_ID/.test(env.VITE_SUPABASE_URL)
            || !env.VITE_SUPABASE_ANON_KEY || /YOUR_SUPABASE/.test(env.VITE_SUPABASE_ANON_KEY)) {
            throw new Error("Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY antes de compilar para producción.");
        }
    }

    return {
        base: "./",
        server: {
            host: "0.0.0.0",
            port: 5173,
            strictPort: true
        },
        plugins: [{
            name: "frygourmett-og-image",
            generateBundle() {
                const socialImage = resolve(process.cwd(), "img", "sala de star.webp");
                const deliveryImage = resolve(process.cwd(), "img", "delifrygour.webp");
                const image = readFileSync(existsSync(socialImage) ? socialImage : deliveryImage);
                this.emitFile({ type: "asset", fileName: "og-image.webp", source: image });
            }
        }],
        build: {
            rollupOptions: {
                input: {
                    index: resolve(process.cwd(), "index.html"),
                    cliente: resolve(process.cwd(), "cliente.html"),
                    usuario: resolve(process.cwd(), "usuario.html"),
                    reclamaciones: resolve(process.cwd(), "reclamaciones.html")
                }
            }
        }
    };
});
