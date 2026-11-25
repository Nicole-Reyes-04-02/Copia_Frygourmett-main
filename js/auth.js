import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabase.js";

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY?.trim();

export const ROLES = {
    ADMINISTRADOR: "administrador",
    GERENTE: "gerente",
    RECEPCIONISTA: "recepcionista",
    ALMACENERO: "almacenero",
    REPARTIDOR: "repartidor",
    CLIENTE: "cliente"
};

export function normalizeRole(raw) {
    if (!raw || typeof raw !== "string") return null;
    const clean = raw.trim().toLowerCase();
    if (clean === "admin" || clean === "administrador") {
        return ROLES.ADMINISTRADOR;
    }
    if (clean === "gerente" || clean === "manager") {
        return ROLES.GERENTE;
    }
    if (clean === "recepcion" || clean === "recepcionista") {
        return ROLES.RECEPCIONISTA;
    }
    if (clean === "almacenero" || clean === "almacen" || clean === "cocinero" || clean === "chef" || clean === "cocina") {
        return ROLES.ALMACENERO;
    }
    if (clean === "mandadero" || clean === "repartidor" || clean === "reparto" || clean === "delivery") {
        return ROLES.REPARTIDOR;
    }
    if (clean === "cliente") {
        return ROLES.CLIENTE;
    }
    return null;
}

export const ROLE_LABELS = {
    administrador: "Administrador",
    gerente: "Gerente",
    recepcionista: "Recepcionista",
    almacenero: "Almacenero",
    repartidor: "Repartidor",
    cliente: "Cliente",
    admin: "Administrador",
    manager: "Gerente",
    almacen: "Almacenero",
    cocinero: "Almacenero",
    chef: "Almacenero",
    cocina: "Almacenero",
    recepcion: "Recepcionista",
    mandadero: "Repartidor",
    reparto: "Repartidor",
    delivery: "Repartidor"
};

export const ROLE_REDIRECTS = {
    administrador: "index.html#resumen",
    gerente: "index.html#resumen",
    recepcionista: "index.html#resumen",
    almacenero: "index.html#inventario",
    repartidor: "index.html#pedidos",
    cliente: "cliente.html#carta",
};

const ALL_ADMIN_VIEWS = ["resumen", "menu", "carta", "pedidos", "inventario", "opiniones", "personal", "mensajes", "politicas", "reclamaciones", "configuracion"];

export const ROLE_ALLOWED_VIEWS = {
    administrador: ALL_ADMIN_VIEWS,
    gerente: ["resumen", "menu", "carta", "pedidos", "inventario", "opiniones", "personal", "mensajes"],
    recepcionista: ["resumen", "pedidos", "menu", "carta", "personal", "mensajes"],
    almacenero: ["inventario", "pedidos", "menu", "carta", "personal", "mensajes"],
    repartidor: ["pedidos", "personal", "mensajes"],
    cliente: []
};

export const ROLE_DEFAULT_VIEWS = {
    administrador: "resumen",
    gerente: "resumen",
    recepcionista: "resumen",
    almacenero: "inventario",
    repartidor: "pedidos",
    cliente: null
};

export function hasAdminAccess(role) {
    if (!role) return false;
    const clean = String(role).trim().toLowerCase();
    const normalized = normalizeRole(clean) || clean;
    return normalized === ROLES.ADMINISTRADOR || normalized === ROLES.GERENTE;
}

export function isAdministrator(role) {
    return normalizeRole(role) === ROLES.ADMINISTRADOR;
}

export function canRoleAccessView(role, view) {
    const cleanView = (view || "").replace(/^#/, "").trim().toLowerCase();
    const mappedView = cleanView === "carta" ? "menu" : (cleanView === "menu" ? "carta" : cleanView);
    const normalizedRole = normalizeRole(role) || "cliente";
    if (normalizedRole === ROLES.ADMINISTRADOR) return true;
    const allowed = ROLE_ALLOWED_VIEWS[normalizedRole] || [];
    return allowed.includes(mappedView) || allowed.includes(cleanView);
}

export function getDefaultView(role) {
    const normalizedRole = normalizeRole(role) || "cliente";
    return ROLE_DEFAULT_VIEWS[normalizedRole] || "pedidos";
}

export function getRoleRedirect(role) {
    const normalizedRole = normalizeRole(role) || "cliente";
    return ROLE_REDIRECTS[normalizedRole] || "cliente.html#carta";
}

export async function resolveUserRole(user) {
    if (!user) {
        return { role: null, profile: null, isActive: false, isStaff: false };
    }
    const email = (user.email || "").toLowerCase().trim();
    if (!isSupabaseConfigured || !supabase) {
        throw new Error("Supabase debe estar configurado para verificar los permisos de personal.");
    }

    const isDesignatedAdmin = email === "matiasramirez1881@gmail.com" || email === "cristopherfrygourmett@gmail.com";

    // 1. Intentar consultar en tabla principal personal_roles por user_id o email
    try {
        let pData = null;
        const { data: byId, error: errId } = await supabase
            .from("personal_roles")
            .select("id, user_id, nombre, email, telefono, rol, estado, registrado_por, actualizado_por, registrado_por_nombre, actualizado_por_nombre")
            .eq("user_id", user.id)
            .maybeSingle();

        if (!errId && byId) {
            pData = byId;
        } else if (email) {
            const { data: byEmail, error: errEmail } = await supabase
                .from("personal_roles")
                .select("id, user_id, nombre, email, telefono, rol, estado, registrado_por, actualizado_por, registrado_por_nombre, actualizado_por_nombre")
                .eq("email", email)
                .maybeSingle();
            if (!errEmail && byEmail) {
                pData = byEmail;
            }
        }

        if (pData) {
            const normRole = isDesignatedAdmin ? ROLES.ADMINISTRADOR : (normalizeRole(pData.rol) || (isDesignatedAdmin ? ROLES.ADMINISTRADOR : null));
            const isActive = isDesignatedAdmin ? true : (pData.estado !== "inactivo");
            return {
                role: normRole || ROLES.CLIENTE,
                profile: {
                    id: pData.user_id || user.id,
                    personalId: pData.id,
                    user_id: pData.user_id || user.id,
                    nombre: pData.nombre || user.user_metadata?.full_name || (email === "matiasramirez1881@gmail.com" ? "Matias Ramirez" : (email === "cristopherfrygourmett@gmail.com" ? "Cristopher Sifontes" : email)),
                    email: pData.email || user.email,
                    telefono: pData.telefono || user.user_metadata?.phone || "",
                    rol: normRole || ROLES.CLIENTE,
                    estado: isActive ? "activo" : "inactivo",
                    activo: isActive,
                    registrado_por_nombre: pData.registrado_por_nombre || "Sistema Central",
                    actualizado_por_nombre: pData.actualizado_por_nombre || ""
                },
                isActive,
                isStaff: Boolean(normRole && normRole !== ROLES.CLIENTE)
            };
        }
    } catch (e) {
        console.warn("Tabla personal_roles no accesible, recurriendo a usuarios_admin:", e);
    }

    // 2. Fallback a usuarios_admin (por user_id o email)
    try {
        let uData = null;
        const { data, error } = await supabase
            .from("usuarios_admin")
            .select("user_id, nombre, rol, created_at")
            .eq("user_id", user.id)
            .maybeSingle();

        if (!error && data) {
            uData = data;
        } else if (email) {
            const { data: byEmail, error: errEmail } = await supabase
                .from("usuarios_admin")
                .select("user_id, nombre, rol, created_at")
                .eq("email", email)
                .maybeSingle();
            if (!errEmail && byEmail) {
                uData = byEmail;
            }
        }

        if (uData) {
            const normRole = isDesignatedAdmin ? ROLES.ADMINISTRADOR : normalizeRole(uData.rol);
            if (normRole) {
                const isActive = true;
                return {
                    role: normRole,
                    profile: {
                        id: uData.user_id || user.id,
                        user_id: uData.user_id || user.id,
                        nombre: uData.nombre || user.user_metadata?.full_name || (email === "matiasramirez1881@gmail.com" ? "Matias Ramirez" : (email === "cristopherfrygourmett@gmail.com" ? "Cristopher Sifontes" : email)),
                        email: user.email,
                        telefono: user.user_metadata?.phone || "",
                        rol: normRole,
                        estado: "activo",
                        activo: isActive,
                        registrado_por_nombre: "Administrador General",
                        actualizado_por_nombre: ""
                    },
                    isActive,
                    isStaff: true
                };
            }
        }
    } catch (e) {
        console.warn("Error consultando usuarios_admin:", e);
    }

    // 3. Si el usuario es administrador designado existente pero aún no tiene fila en la tabla
    if (isDesignatedAdmin) {
        return {
            role: ROLES.ADMINISTRADOR,
            profile: {
                id: user.id,
                user_id: user.id,
                nombre: user.user_metadata?.full_name || (email === "matiasramirez1881@gmail.com" ? "Matias Ramirez" : "Cristopher Sifontes"),
                email: user.email,
                telefono: user.user_metadata?.phone || "",
                rol: ROLES.ADMINISTRADOR,
                estado: "activo",
                activo: true,
                registrado_por_nombre: "Administrador General",
                actualizado_por_nombre: ""
            },
            isActive: true,
            isStaff: true
        };
    }

    // 4. Si no es personal, es cliente
    return {
        role: ROLES.CLIENTE,
        profile: {
            id: user.id,
            user_id: user.id,
            nombre: user.user_metadata?.full_name || user.user_metadata?.nombre || email.split("@")[0] || "Cliente",
            email: user.email,
            telefono: user.user_metadata?.phone || user.user_metadata?.telefono || "",
            rol: ROLES.CLIENTE,
            estado: "activo",
            activo: true
        },
        isActive: true,
        isStaff: false
    };
}

function requireSupabase() {
    if (!isSupabaseConfigured || !supabase || !supabaseUrl || !supabaseAnonKey) {
        throw new Error("Supabase debe estar configurado para gestionar el personal.");
    }
}

export async function requireAdministrator() {
    requireSupabase();
    const { data: { user }, error: sessionError } = await supabase.auth.getUser();
    if (sessionError) throw sessionError;
    if (!user) throw new Error("Inicia sesión con una cuenta de administrador.");

    const { role, profile, isActive } = await resolveUserRole(user);
    if (!isActive || !isAdministrator(role)) {
        throw new Error("Solo un administrador activo puede realizar esta operación.");
    }
    return { user, profile };
}

async function requireStaffReadAccess() {
    requireSupabase();
    const { data: { user }, error: sessionError } = await supabase.auth.getUser();
    if (sessionError) throw sessionError;
    if (!user) throw new Error("Inicia sesión para consultar el personal.");

    const { role, profile, isActive } = await resolveUserRole(user);
    if (!isActive || ![ROLES.ADMINISTRADOR, ROLES.GERENTE].includes(role)) {
        throw new Error("Solo el administrador o gerente activo puede consultar el personal.");
    }
    return { user, profile };
}

export async function getCurrentAdmin() {
    return requireAdministrator();
}

export async function listStaffMembers() {
    await requireStaffReadAccess();
    const { data: personalData, error: personalError } = await supabase
        .from("personal_roles")
        .select("id, user_id, nombre, email, telefono, rol, estado, registrado_por, actualizado_por, created_at")
        .order("nombre");
    if (personalError && !["42P01", "PGRST205"].includes(personalError.code)) {
        throw personalError;
    }
    if (!personalError && personalData?.length) {
        return personalData.map((d) => ({
            id: d.id,
            user_id: d.user_id,
            nombre: d.nombre,
            email: d.email,
            telefono: d.telefono,
            rol: normalizeRole(d.rol) || d.rol,
            estado: d.estado,
            activo: d.estado === "activo",
            registrado_por: d.registrado_por,
            actualizado_por: d.actualizado_por,
            created_at: d.created_at
        }));
    }

    const { data, error } = await supabase
        .from("usuarios_admin")
        .select("user_id, nombre, rol, created_at")
        .order("nombre");
    if (error) throw error;
    return (data || []).map((d) => ({
        id: d.user_id,
        user_id: d.user_id,
        nombre: d.nombre,
        email: "—",
        telefono: "—",
        rol: normalizeRole(d.rol) || d.rol,
        estado: "activo",
        activo: true,
        registrado_por_nombre: "Administrador General",
        actualizado_por_nombre: "",
        created_at: d.created_at
    }));
}

export async function createStaffMember({ nombre, email, telefono, rol, password }) {
    if (!nombre || !email || !telefono || !rol || !password) {
        throw new Error("Completa todos los campos obligatorios del trabajador.");
    }
    const cleanRole = String(rol).toLowerCase().trim();
    const validRoles = ["administrador", "gerente", "recepcionista", "almacenero", "repartidor"];
    if (!validRoles.includes(cleanRole)) {
        throw new Error("El rol seleccionado no es válido.");
    }
    if (String(password).length < 8) {
        throw new Error("La contraseña temporal debe tener al menos 8 caracteres.");
    }

    const { user: adminUser, profile: adminProfile } = await getCurrentAdmin();
    const adminName = adminProfile?.nombre || adminUser.email || "Administrador";

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = telefono.trim();
    const cleanNombre = nombre.trim();
    const canonicalRole = normalizeRole(cleanRole);

    const unpersistedClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });

    const { data: authData, error: authError } = await unpersistedClient.auth.signUp({
        email: cleanEmail,
        password,
        options: {
            data: {
                full_name: cleanNombre,
                phone: cleanPhone,
                role: canonicalRole
            }
        }
    });
    if (authError) throw authError;
    if (!authData.user?.id) {
        throw new Error("El correo ya está registrado o Supabase no devolvió un identificador de cuenta.");
    }

    const { data: createdRecord, error: personalError } = await supabase.from("personal_roles")
        .insert({
            user_id: authData.user.id,
            nombre: cleanNombre,
            email: cleanEmail,
            telefono: cleanPhone,
            rol: canonicalRole,
            estado: "activo",
            registrado_por: adminUser.id,
            registrado_por_nombre: adminName,
            actualizado_por: adminUser.id,
            actualizado_por_nombre: adminName
        })
        .select()
        .single();
    if (personalError) {
        throw new Error(`La cuenta de acceso se creó, pero no se pudo guardar el perfil del trabajador. ID de Auth: ${authData.user.id}. ${personalError.message}`);
    }

    const { error: mirrorError } = await supabase.from("usuarios_admin")
        .upsert({
            user_id: authData.user.id,
            nombre: cleanNombre,
            rol: canonicalRole
        });
    if (mirrorError) {
        throw new Error(`El perfil principal se guardó, pero no se pudo sincronizar usuarios_admin para ${authData.user.id}. ${mirrorError.message}`);
    }
    return createdRecord;
}

export async function updateStaffMember(userIdOrId, { nombre, telefono, rol, estado, activo }) {
    await requireAdministrator();
    const cleanId = String(userIdOrId || "").trim();
    if (!cleanId || cleanId === "undefined" || cleanId === "null") {
        throw new Error("El identificador del trabajador no es válido o está indefinido.");
    }

    const { user: adminUser } = await getCurrentAdmin();

    const isActivo = activo !== undefined
        ? Boolean(activo)
        : (estado !== undefined ? (estado === "activo" || estado === true) : undefined);

    const resolvedStatus = isActivo !== undefined
        ? (isActivo ? "activo" : "inactivo")
        : undefined;

    // Campos válidos para personal_roles
    const personalUpdates = {
        updated_at: new Date().toISOString(),
        actualizado_por: adminUser.id,
        ...(nombre !== undefined ? { nombre: String(nombre).trim() } : {}),
        ...(telefono !== undefined ? { telefono: String(telefono).trim() } : {}),
        ...(rol !== undefined ? { rol: normalizeRole(String(rol).toLowerCase().trim()) || "almacenero" } : {}),
        ...(resolvedStatus !== undefined ? { estado: resolvedStatus } : {})
    };

    // Campos válidos para usuarios_admin
    const adminUpdates = {
        updated_at: new Date().toISOString(),
        ...(nombre !== undefined ? { nombre: String(nombre).trim() } : {}),
        ...(telefono !== undefined ? { telefono: String(telefono).trim() } : {}),
        ...(rol !== undefined ? { rol: normalizeRole(String(rol).toLowerCase().trim()) || "almacenero" } : {}),
        ...(isActivo !== undefined ? { activo: isActivo } : {})
    };

    const { data: personalRecord, error: personalError } = await supabase.from("personal_roles")
        .update(personalUpdates)
        .or(`user_id.eq.${cleanId},id.eq.${cleanId}`)
        .select()
        .maybeSingle();
    if (personalError && !["42P01", "PGRST205"].includes(personalError.code)) {
        throw personalError;
    }

    const targetUserId = personalRecord?.user_id || cleanId;
    const { data: legacyRecord, error: legacyError } = await supabase.from("usuarios_admin")
        .update(adminUpdates)
        .eq("user_id", targetUserId)
        .select()
        .maybeSingle();
    if (legacyError) throw legacyError;

    if (personalRecord) return personalRecord;
    if (legacyRecord) return legacyRecord;
    throw new Error("No se encontró el trabajador en personal_roles ni en usuarios_admin.");
}

export async function toggleStaffStatus(userIdOrId, activo) {
    return updateStaffMember(userIdOrId, { estado: activo ? "activo" : "inactivo", activo });
}

export async function deleteStaffMember(userIdOrId) {
    await requireAdministrator();
    const cleanId = String(userIdOrId || "").trim();
    if (!cleanId || cleanId === "undefined" || cleanId === "null") {
        throw new Error("El identificador del trabajador no es válido o está indefinido.");
    }

    const { data: personalRecords, error: personalError } = await supabase.from("personal_roles")
        .delete()
        .or(`user_id.eq.${cleanId},id.eq.${cleanId}`)
        .select("id");
    if (personalError && !["42P01", "PGRST205"].includes(personalError.code)) {
        throw personalError;
    }

    const { data: legacyRecords, error: legacyError } = await supabase.from("usuarios_admin")
        .delete()
        .eq("user_id", cleanId)
        .select("user_id");
    if (legacyError) throw legacyError;
    if (!personalRecords?.length && !legacyRecords?.length) {
        throw new Error("No se encontró el trabajador para eliminarlo.");
    }
    return true;
}

// =========================================================
// GESTIÓN DE TURNOS Y ASISTENCIA (ENTRADA / SALIDA)
// =========================================================

export async function listAttendanceShifts({ fecha = null, personalId = null } = {}) {
    requireSupabase();
    let query = supabase.from("asistencia_turnos")
        .select(`
            id,
            personal_id,
            fecha,
            hora_entrada,
            hora_salida,
            estado_turno,
            registrado_por_admin_id,
            registrado_por_admin_nombre,
            observacion,
            created_at,
            personal_roles (
                id,
                user_id,
                nombre,
                rol
            )
        `)
        .order("created_at", { ascending: false });

    if (fecha) query = query.eq("fecha", fecha);
    if (personalId) query = query.eq("personal_id", personalId);

    const { data, error } = await query.limit(50);
    if (error) {
        console.warn("No se pudieron cargar turnos de asistencia:", error);
        return [];
    }
    return data || [];
}

export async function clockInStaff({ personalId, observacion = "" }) {
    requireSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Debes tener una sesión activa para marcar entrada.");

    const { role, profile } = await resolveUserRole(user);
    const adminName = profile?.nombre || user.email || "Admin";

    let targetPersonalId = personalId;
    if (!targetPersonalId) {
        const { data: pRec } = await supabase.from("personal_roles").select("id").eq("user_id", user.id).maybeSingle();
        targetPersonalId = pRec?.id;
    }
    if (!targetPersonalId) {
        throw new Error("No se encontró el registro de personal correspondiente para marcar turno.");
    }

    const { data, error } = await supabase.from("asistencia_turnos")
        .insert({
            personal_id: targetPersonalId,
            fecha: new Date().toISOString().slice(0, 10),
            hora_entrada: new Date().toISOString(),
            estado_turno: "en_turno",
            registrado_por_admin_id: hasAdminAccess(role) ? user.id : null,
            registrado_por_admin_nombre: hasAdminAccess(role) ? adminName : "Marcación Propia",
            observacion: String(observacion || "").trim()
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function clockOutStaff({ turnoId, observacion = "" }) {
    requireSupabase();
    const updates = {
        hora_salida: new Date().toISOString(),
        estado_turno: "finalizado"
    };
    if (observacion) {
        updates.observacion = String(observacion).trim();
    }
    const { data, error } = await supabase.from("asistencia_turnos")
        .update(updates)
        .eq("id", turnoId)
        .select()
        .single();
    if (error) throw error;
    return data;
}
