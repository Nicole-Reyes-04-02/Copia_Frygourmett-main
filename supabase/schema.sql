create extension if not exists pgcrypto;

-- 1. Tabla de trabajadores y administración
create table if not exists public.usuarios_admin (
    user_id uuid primary key references auth.users (id) on delete cascade,
    nombre text not null,
    email text,
    telefono text not null default '',
    rol text not null default 'administrador'
        check (rol in ('administrador', 'gerente', 'recepcionista', 'repartidor', 'almacenero')),
    activo boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.usuarios_admin
    add column if not exists email text,
    add column if not exists telefono text not null default '',
    add column if not exists activo boolean not null default true,
    add column if not exists updated_at timestamptz not null default now();

alter table public.usuarios_admin
    drop constraint if exists usuarios_admin_rol_check;

update public.usuarios_admin
set rol = case lower(btrim(rol))
    when 'admin' then 'administrador'
    when 'manager' then 'gerente'
    when 'recepcion' then 'recepcionista'
    when 'almacen' then 'almacenero'
    when 'chef' then 'almacenero'
    when 'cocina' then 'almacenero'
    when 'cocinero' then 'almacenero'
    when 'mandadero' then 'repartidor'
    when 'reparto' then 'repartidor'
    when 'delivery' then 'repartidor'
    else lower(btrim(rol))
end
where rol is not null;

alter table public.usuarios_admin
    alter column rol set default 'administrador',
    add constraint usuarios_admin_rol_check
        check (rol in ('administrador', 'gerente', 'recepcionista', 'repartidor', 'almacenero'));

create table if not exists public.personal_roles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references auth.users (id) on delete cascade,
    nombre text not null,
    email text,
    telefono text not null default '',
    rol text not null check (rol in ('administrador', 'gerente', 'recepcionista', 'repartidor', 'almacenero')),
    estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
    registrado_por uuid references auth.users (id) on delete set null,
    actualizado_por uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.personal_roles
    drop constraint if exists personal_roles_rol_check;

update public.personal_roles
set rol = case lower(btrim(rol))
    when 'admin' then 'administrador'
    when 'manager' then 'gerente'
    when 'recepcion' then 'recepcionista'
    when 'almacen' then 'almacenero'
    when 'chef' then 'almacenero'
    when 'cocina' then 'almacenero'
    when 'cocinero' then 'almacenero'
    when 'mandadero' then 'repartidor'
    when 'reparto' then 'repartidor'
    when 'delivery' then 'repartidor'
    else lower(btrim(rol))
end
where rol is not null;

alter table public.personal_roles
    add constraint personal_roles_rol_check
        check (rol in ('administrador', 'gerente', 'recepcionista', 'repartidor', 'almacenero', 'cliente'));

insert into public.personal_roles (user_id, nombre, email, telefono, rol, estado)
select
    ua.user_id,
    ua.nombre,
    ua.email,
    ua.telefono,
    ua.rol,
    case when ua.activo then 'activo' else 'inactivo' end
from public.usuarios_admin ua
where ua.rol in ('administrador', 'gerente', 'recepcionista', 'repartidor', 'almacenero')
on conflict (user_id) do nothing;

create table if not exists public.asistencia_turnos (
    id uuid primary key default gen_random_uuid(),
    personal_id uuid not null references public.personal_roles (id) on delete restrict,
    fecha date not null default current_date,
    hora_entrada timestamptz not null default now(),
    hora_salida timestamptz,
    estado_turno text not null default 'en_turno'
        check (estado_turno in ('en_turno', 'finalizado')),
    registrado_por_admin_id uuid references auth.users (id) on delete set null,
    entrada_registrada_por_admin_id uuid references auth.users (id) on delete set null,
    salida_registrada_por_admin_id uuid references auth.users (id) on delete set null,
    observacion text not null default '',
    check (
        (estado_turno = 'en_turno' and hora_salida is null)
        or (estado_turno = 'finalizado' and hora_salida is not null)
    ),
    check (hora_salida is null or hora_salida >= hora_entrada)
);

create index if not exists idx_asistencia_personal_fecha
    on public.asistencia_turnos (personal_id, fecha desc);
create unique index if not exists idx_asistencia_un_turno_abierto
    on public.asistencia_turnos (personal_id)
    where estado_turno = 'en_turno';

-- 2. Tabla de productos de la carta
create table if not exists public.productos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null unique,
    descripcion text not null default '',
    precio numeric(10, 2) not null check (precio >= 0),
    categoria text not null,
    imagen_url text not null default '',
    disponible boolean not null default true,
    porciones_disponibles integer check (porciones_disponibles is null or porciones_disponibles >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.productos
    add column if not exists porciones_disponibles integer
        check (porciones_disponibles is null or porciones_disponibles >= 0);

-- 3. Tabla de pedidos y delivery
create table if not exists public.pedidos (
    id uuid primary key default gen_random_uuid(),
    cliente_id uuid references auth.users (id) on delete set null,
    cliente_nombre text not null,
    cliente_email text not null,
    telefono_contacto text not null default '',
    direccion_entrega text not null default '',
    distrito_zona text not null default '',
    referencia text not null default '',
    metodo_pago text not null default 'efectivo'
        check (metodo_pago in ('yape', 'plin', 'interbank', 'transferencia_interbank', 'yape_plin', 'efectivo', 'tarjeta_pos')),
    detalles_pago jsonb not null default '{}'::jsonb check (jsonb_typeof(detalles_pago::jsonb) = 'object'),
    items jsonb not null check (jsonb_typeof(items::jsonb) = 'array' and jsonb_array_length(items::jsonb) > 0),
    total numeric(10, 2) not null default 0 check (total >= 0),
    estado text not null default 'Pendiente'
        check (estado in ('Pendiente', 'En preparación', 'Listo', 'En camino', 'Entregado')),
    nota text not null default '',
    insumos_descontados_at timestamptz,
    created_at timestamptz not null default now()
);

alter table public.pedidos
    add column if not exists telefono_contacto text not null default '',
    add column if not exists direccion_entrega text not null default '',
    add column if not exists distrito_zona text not null default '',
    add column if not exists referencia text not null default '',
    add column if not exists metodo_pago text not null default 'efectivo',
    add column if not exists detalles_pago jsonb not null default '{}'::jsonb,
    add column if not exists insumos_descontados_at timestamptz;

alter table public.pedidos
    drop constraint if exists pedidos_metodo_pago_check,
    add constraint pedidos_metodo_pago_check
        check (metodo_pago in ('yape', 'plin', 'interbank', 'transferencia_interbank', 'yape_plin', 'efectivo', 'tarjeta_pos')),
    drop constraint if exists pedidos_detalles_pago_check,
    add constraint pedidos_detalles_pago_check
        check (jsonb_typeof(detalles_pago::jsonb) = 'object'),
    drop constraint if exists pedidos_estado_check,
    add constraint pedidos_estado_check
        check (estado in ('Pendiente', 'En preparación', 'Listo', 'En camino', 'Entregado'));

-- 4. Promociones y carrusel
create table if not exists public.promociones (
    id uuid primary key default gen_random_uuid(),
    titulo text not null,
    descripcion text not null default '',
    tipo_media text not null check (tipo_media in ('imagen', 'video')),
    media_url text not null,
    orden integer not null default 0 check (orden >= 0),
    activa boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.configuracion_servicio (
    id smallint primary key default 1 check (id = 1),
    hora_apertura time,
    hora_cierre time,
    estado_cocina_override boolean,
    tiempo_delivery_min integer not null default 35 check (tiempo_delivery_min > 0),
    tiempo_delivery_max integer not null default 45 check (tiempo_delivery_max >= tiempo_delivery_min),
    updated_at timestamptz not null default now()
);

insert into public.configuracion_servicio (id)
values (1)
on conflict (id) do nothing;

-- 5. Inventario de ingredientes
create table if not exists public.ingredientes (
    id uuid primary key default gen_random_uuid(),
    nombre text not null unique,
    cantidad numeric(12, 3) not null default 0 check (cantidad >= 0),
    minimo numeric(12, 3) not null default 0 check (minimo >= 0),
    unidad text not null default 'ud.',
    precio_unitario numeric(10, 2) not null default 0 check (precio_unitario >= 0),
    categoria text not null default 'General',
    updated_at timestamptz not null default now()
);

drop trigger if exists ingredientes_recalcular_disponibilidad on public.ingredientes;
drop trigger if exists notificaciones_stock_ingredientes on public.ingredientes;

alter table public.ingredientes
    alter column cantidad type numeric(12, 3),
    alter column minimo type numeric(12, 3),
    add column if not exists precio_unitario numeric(10, 2) not null default 0 check (precio_unitario >= 0),
    add column if not exists categoria text not null default 'General';

do $$
begin
    if to_regprocedure('public.notificar_stock_ingrediente()') is not null then
        execute 'create trigger notificaciones_stock_ingredientes
            after insert or update of cantidad, minimo on public.ingredientes
            for each row execute function public.notificar_stock_ingrediente()';
    end if;
end;
$$;

alter table public.ingredientes
    drop constraint if exists ingredientes_precio_unitario_check,
    add constraint ingredientes_precio_unitario_check
        check (precio_unitario >= 0);

create table if not exists public.producto_insumos (
    id uuid primary key default gen_random_uuid(),
    producto_id uuid not null references public.productos (id) on delete cascade,
    ingrediente_id uuid not null references public.ingredientes (id) on delete restrict,
    cantidad_por_porcion numeric(10, 3) not null check (cantidad_por_porcion > 0),
    created_at timestamptz not null default now(),
    unique (producto_id, ingrediente_id)
);

-- 6. Reservas (compatibilidad)
create table if not exists public.reservas (
    id uuid primary key default gen_random_uuid(),
    cliente_id uuid not null references auth.users (id) on delete cascade,
    cliente_nombre text not null,
    cliente_email text not null,
    fecha date not null,
    hora time not null,
    comensales integer not null check (comensales between 1 and 12),
    estado text not null default 'Pendiente' check (estado in ('Pendiente', 'Confirmada', 'Cancelada')),
    nota text not null default '',
    created_at timestamptz not null default now()
);

-- 7. Opiniones y calificaciones
create table if not exists public.opiniones (
    id uuid primary key default gen_random_uuid(),
    pedido_id uuid not null unique references public.pedidos (id) on delete cascade,
    cliente_id uuid not null references auth.users (id) on delete cascade,
    puntuacion integer not null check (puntuacion between 1 and 5),
    comentario text not null default '',
    created_at timestamptz not null default now()
);

-- 8. Pasarela de Pagos (Híbrida: Manual + Directa Bancaria)
create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.pedidos (id) on delete cascade,
    provider text not null check (provider in ('yape_plin_manual', 'culqi_niubiz_temp', 'bank_direct')),
    payment_method text not null,
    amount numeric(10, 2) not null check (amount > 0),
    currency varchar(3) not null default 'PEN' check (currency in ('PEN', 'USD')),
    status text not null default 'pending_verification'
        check (status in ('pending_verification', 'paid', 'failed', 'refunded')),
    transaction_code text,
    proof_url text,
    metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_payments_order_id on public.payments(order_id);
create index if not exists idx_payments_status on public.payments(status);

-- 9. Control de Personal y Roles
create table if not exists public.personal_roles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users (id) on delete cascade,
    nombre text not null,
    email text,
    telefono text not null default '',
    rol text not null check (rol in ('administrador', 'gerente', 'recepcionista', 'repartidor', 'almacenero', 'cliente')),
    estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
    registrado_por uuid references auth.users (id) on delete set null,
    actualizado_por uuid references auth.users (id) on delete set null,
    registrado_por_nombre text not null default '',
    actualizado_por_nombre text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_personal_roles_user_id on public.personal_roles(user_id);
create index if not exists idx_personal_roles_estado on public.personal_roles(estado);
create index if not exists idx_personal_roles_rol on public.personal_roles(rol);

-- 10. Asistencia y Turnos (Auditado por Admin)
create table if not exists public.asistencia_turnos (
    id uuid primary key default gen_random_uuid(),
    personal_id uuid not null references public.personal_roles (id) on delete cascade,
    fecha date not null default current_date,
    hora_entrada timestamptz not null default now(),
    hora_salida timestamptz,
    estado_turno text not null default 'en_turno' check (estado_turno in ('en_turno', 'finalizado')),
    registrado_por_admin_id uuid references auth.users (id) on delete set null,
    registrado_por_admin_nombre text not null default '',
    observacion text not null default '',
    created_at timestamptz not null default now()
);

create index if not exists idx_asistencia_turnos_personal on public.asistencia_turnos(personal_id);
create index if not exists idx_asistencia_turnos_fecha on public.asistencia_turnos(fecha);

-- 11. Conexión Carta e Insumos (Receta para cálculo de porciones y descuento)
create table if not exists public.producto_insumos (
    id uuid primary key default gen_random_uuid(),
    producto_id uuid not null references public.productos (id) on delete cascade,
    ingrediente_id uuid not null references public.ingredientes (id) on delete cascade,
    cantidad_por_porcion numeric(10, 3) not null check (cantidad_por_porcion > 0),
    created_at timestamptz not null default now(),
    unique (producto_id, ingrediente_id)
);

create index if not exists idx_producto_insumos_prod on public.producto_insumos(producto_id);
create index if not exists idx_producto_insumos_ing on public.producto_insumos(ingrediente_id);

-- =========================================================
-- FUNCIONES DE COMPROBACIÓN DE ROLES
-- =========================================================
create or replace function public.es_administrador()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.personal_roles
        where user_id = (select auth.uid())
          and rol = 'administrador'
          and estado = 'activo'
    ) or exists (
        select 1
        from public.usuarios_admin
        where user_id = (select auth.uid())
          and rol = 'administrador'
          and activo
    );
$$;

create or replace function public.es_gerente()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.personal_roles
        where user_id = (select auth.uid())
          and rol = 'gerente'
          and estado = 'activo'
    ) or exists (
        select 1
        from public.usuarios_admin
        where user_id = (select auth.uid())
          and rol = 'gerente'
          and activo
    );
$$;

create or replace function public.es_recepcionista()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.personal_roles
        where user_id = (select auth.uid())
          and rol in ('recepcionista', 'administrador')
          and estado = 'activo'
    ) or exists (
        select 1
        from public.usuarios_admin
        where user_id = (select auth.uid())
          and rol in ('recepcionista', 'administrador')
          and activo
    );
$$;

create or replace function public.es_cocinero()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.personal_roles
        where user_id = (select auth.uid())
          and rol in ('almacenero', 'administrador')
          and estado = 'activo'
    ) or exists (
        select 1
        from public.usuarios_admin
        where user_id = (select auth.uid())
          and rol in ('almacenero', 'administrador')
          and activo
    );
$$;

create or replace function public.es_mandadero()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.personal_roles
        where user_id = (select auth.uid())
          and rol in ('repartidor', 'administrador')
          and estado = 'activo'
    ) or exists (
        select 1
        from public.usuarios_admin
        where user_id = (select auth.uid())
          and rol in ('repartidor', 'administrador')
          and activo
    );
$$;

create or replace function public.es_personal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.personal_roles
        where user_id = (select auth.uid())
          and estado = 'activo'
    ) or exists (
        select 1
        from public.usuarios_admin
        where user_id = (select auth.uid())
          and activo
    );
$$;

create or replace function public.es_chef()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.es_cocinero();
$$;

-- Funciones y Triggers de actualización y cálculo
create or replace function public.actualizar_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create or replace function public.auditar_personal_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if (select auth.uid()) is not null then
        if not public.es_administrador() then
            raise exception 'Solo un administrador activo puede gestionar el personal.';
        end if;
        if tg_op = 'INSERT' then
            new.registrado_por := (select auth.uid());
            new.actualizado_por := null;
        else
            new.registrado_por := old.registrado_por;
            new.actualizado_por := (select auth.uid());
        end if;
    end if;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists personal_roles_audit on public.personal_roles;
create trigger personal_roles_audit
before insert or update on public.personal_roles
for each row execute function public.auditar_personal_role();

alter table public.productos
    add column if not exists preparacion_interna text not null default '',
    add column if not exists presentacion_interna text not null default '';

alter table public.producto_insumos
    add column if not exists cantidad_por_porcion numeric(10, 3),
    add column if not exists cantidad_neta numeric(10, 3) not null default 0,
    add column if not exists porcentaje_merma numeric(5, 2) not null default 0 check (porcentaje_merma >= 0 and porcentaje_merma < 100);

update public.producto_insumos
set cantidad_neta = cantidad_por_porcion
where cantidad_neta = 0 and cantidad_por_porcion > 0;

create or replace function public.reemplazar_receta_producto(
    p_producto_id uuid,
    p_receta jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
    saved_count integer;
begin
    if (select auth.uid()) is null then
        raise exception 'Inicia sesión para guardar una receta.';
    end if;
    if p_producto_id is null or p_receta is null then
        raise exception 'El plato y la lista de insumos son obligatorios.';
    end if;
    if jsonb_typeof(p_receta) is distinct from 'array' then
        raise exception 'La lista de insumos debe ser un arreglo.';
    end if;
    if exists (
        select 1
        from jsonb_to_recordset(p_receta) as item(
            ingrediente_id uuid,
            cantidad_neta numeric,
            porcentaje_merma numeric,
            cantidad_por_porcion numeric
        )
        where item.ingrediente_id is null
            or item.cantidad_neta is null or item.cantidad_neta <= 0
            or item.porcentaje_merma is null or item.porcentaje_merma < 0 or item.porcentaje_merma >= 100
            or item.cantidad_por_porcion is null or item.cantidad_por_porcion <= 0
            or abs(item.cantidad_por_porcion - round(item.cantidad_neta * (1 + item.porcentaje_merma / 100), 3)) > 0.001
    ) then
        raise exception 'La receta contiene cantidades o porcentajes de merma no válidos.';
    end if;
    if exists (
        select item.ingrediente_id
        from jsonb_to_recordset(p_receta) as item(ingrediente_id uuid)
        group by item.ingrediente_id
        having count(*) > 1
    ) then
        raise exception 'Cada ingrediente debe aparecer una sola vez en la receta.';
    end if;
    if not exists (select 1 from public.productos where id = p_producto_id) then
        raise exception 'El plato seleccionado no existe.';
    end if;

    delete from public.producto_insumos where producto_id = p_producto_id;
    insert into public.producto_insumos (
        producto_id, ingrediente_id, cantidad_neta, porcentaje_merma, cantidad_por_porcion
    )
    select p_producto_id, item.ingrediente_id, item.cantidad_neta,
        item.porcentaje_merma, item.cantidad_por_porcion
    from jsonb_to_recordset(p_receta) as item(
        ingrediente_id uuid,
        cantidad_neta numeric,
        porcentaje_merma numeric,
        cantidad_por_porcion numeric
    );

    get diagnostics saved_count = row_count;
    return saved_count;
end;
$$;

revoke all on function public.reemplazar_receta_producto(uuid, jsonb) from public, anon;
grant execute on function public.reemplazar_receta_producto(uuid, jsonb) to authenticated;

create or replace function public.recalcular_disponibilidad_producto(p_producto_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    portions integer;
begin
    select case
        when count(*) = 0 then null
        else min(floor(i.cantidad / nullif(pi.cantidad_por_porcion, 0)))::integer
    end
    into portions
    from public.producto_insumos pi
    join public.ingredientes i on i.id = pi.ingrediente_id
    where pi.producto_id = p_producto_id;

    update public.productos
    set porciones_disponibles = portions
    where id = p_producto_id;
end;
$$;

create or replace function public.actualizar_disponibilidad_por_receta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform public.recalcular_disponibilidad_producto(old.producto_id);
        return old;
    end if;

    if tg_op = 'UPDATE' then
        if old.producto_id is distinct from new.producto_id then
            perform public.recalcular_disponibilidad_producto(old.producto_id);
        end if;
    end if;
    perform public.recalcular_disponibilidad_producto(new.producto_id);
    return new;
end;
$$;

drop trigger if exists producto_insumos_recalcular on public.producto_insumos;
create trigger producto_insumos_recalcular
after insert or update or delete on public.producto_insumos
for each row execute function public.actualizar_disponibilidad_por_receta();

create or replace function public.actualizar_disponibilidad_por_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    product_id uuid;
begin
    for product_id in
        select distinct pi.producto_id
        from public.producto_insumos pi
        where pi.ingrediente_id = new.id
    loop
        perform public.recalcular_disponibilidad_producto(product_id);
    end loop;
    return new;
end;
$$;

drop trigger if exists ingredientes_recalcular_disponibilidad on public.ingredientes;
create trigger ingredientes_recalcular_disponibilidad
after update of cantidad on public.ingredientes
for each row execute function public.actualizar_disponibilidad_por_stock();

create or replace function public.inicializar_disponibilidad_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.recalcular_disponibilidad_producto(new.id);
    return new;
end;
$$;

drop trigger if exists productos_inicializar_disponibilidad on public.productos;
create trigger productos_inicializar_disponibilidad
after insert on public.productos
for each row execute function public.inicializar_disponibilidad_producto();

do $$
declare
    product_id uuid;
begin
    for product_id in select id from public.productos
    loop
        perform public.recalcular_disponibilidad_producto(product_id);
    end loop;
end;
$$;

drop trigger if exists pedidos_descontar_insumos on public.pedidos;
drop trigger if exists trg_descontar_insumos_pedido on public.pedidos;
drop function if exists public.descontar_insumos_pedido();

create or replace function public.marcar_entrada_turno(
    p_personal_id uuid default null,
    p_observacion text default ''
)
returns public.asistencia_turnos
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor_id uuid := (select auth.uid());
    own_personal_id uuid;
    target_id uuid;
    target_owner uuid;
    attendance public.asistencia_turnos%rowtype;
begin
    if actor_id is null then
        raise exception 'Inicia sesión para marcar asistencia.';
    end if;

    select pr.id into own_personal_id
    from public.personal_roles pr
    where pr.user_id = actor_id and pr.estado = 'activo';
    if own_personal_id is null then
        raise exception 'Solo el personal activo puede marcar asistencia.';
    end if;

    target_id := coalesce(p_personal_id, own_personal_id);
    if target_id <> own_personal_id and not public.es_administrador() then
        raise exception 'Solo un administrador puede marcar asistencia en nombre de otra persona.';
    end if;

    select pr.user_id into target_owner
    from public.personal_roles pr
    where pr.id = target_id and pr.estado = 'activo';
    if target_owner is null then
        raise exception 'El trabajador no existe o está inactivo.';
    end if;

    select at.* into attendance
    from public.asistencia_turnos at
    where at.personal_id = target_id and at.estado_turno = 'en_turno'
    order by at.hora_entrada desc
    limit 1
    for update;
    if found then
        return attendance;
    end if;

    insert into public.asistencia_turnos (
        personal_id,
        fecha,
        hora_entrada,
        estado_turno,
        registrado_por_admin_id,
        entrada_registrada_por_admin_id,
        observacion
    )
    values (
        target_id,
        current_date,
        now(),
        'en_turno',
        case when target_id <> own_personal_id then actor_id else null end,
        case when target_id <> own_personal_id then actor_id else null end,
        coalesce(p_observacion, '')
    )
    on conflict (personal_id) where estado_turno = 'en_turno' do nothing
    returning * into attendance;
    if not found then
        select at.* into attendance
        from public.asistencia_turnos at
        where at.personal_id = target_id and at.estado_turno = 'en_turno'
        order by at.hora_entrada desc
        limit 1;
    end if;
    if not found then
        raise exception 'No se pudo registrar la entrada del turno.';
    end if;
    return attendance;
end;
$$;

create or replace function public.marcar_salida_turno(
    p_personal_id uuid default null,
    p_observacion text default ''
)
returns public.asistencia_turnos
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor_id uuid := (select auth.uid());
    own_personal_id uuid;
    target_id uuid;
    attendance public.asistencia_turnos%rowtype;
begin
    if actor_id is null then
        raise exception 'Inicia sesión para marcar asistencia.';
    end if;

    select pr.id into own_personal_id
    from public.personal_roles pr
    where pr.user_id = actor_id and pr.estado = 'activo';
    if own_personal_id is null then
        raise exception 'Solo el personal activo puede marcar asistencia.';
    end if;

    target_id := coalesce(p_personal_id, own_personal_id);
    if target_id <> own_personal_id and not public.es_administrador() then
        raise exception 'Solo un administrador puede marcar asistencia en nombre de otra persona.';
    end if;

    select at.* into attendance
    from public.asistencia_turnos at
    where at.personal_id = target_id and at.estado_turno = 'en_turno'
    order by at.hora_entrada desc
    limit 1
    for update;
    if not found then
        raise exception 'No hay una entrada activa para este trabajador.';
    end if;

    update public.asistencia_turnos
    set hora_salida = now(),
        estado_turno = 'finalizado',
        salida_registrada_por_admin_id =
            case when target_id <> own_personal_id then actor_id else null end,
        observacion = case
            when nullif(btrim(coalesce(p_observacion, '')), '') is null then observacion
            when nullif(btrim(observacion), '') is null then btrim(p_observacion)
            else observacion || E'\n' || btrim(p_observacion)
        end
    where id = attendance.id
    returning * into attendance;
    return attendance;
end;
$$;

create or replace function public.obtener_estado_servicio()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'hora_apertura', case when c.hora_apertura is null then null else to_char(c.hora_apertura, 'HH24:MI') end,
        'hora_cierre', case when c.hora_cierre is null then null else to_char(c.hora_cierre, 'HH24:MI') end,
        'cocina_abierta', coalesce(c.estado_cocina_override, exists (
            select 1
            from public.personal_roles pr
            where pr.rol = 'almacenero'
              and pr.estado = 'activo'
        )),
        'tiempo_delivery_min', c.tiempo_delivery_min,
        'tiempo_delivery_max', c.tiempo_delivery_max
    )
    from public.configuracion_servicio c
    where c.id = 1;
$$;

create or replace function public.notificar_actualizacion_servicio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.configuracion_servicio
    set updated_at = now()
    where id = 1;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

drop trigger if exists personal_roles_notificar_servicio on public.personal_roles;
create trigger personal_roles_notificar_servicio
after insert or update or delete on public.personal_roles
for each row execute function public.notificar_actualizacion_servicio();

drop trigger if exists productos_updated_at on public.productos;
create trigger productos_updated_at
before update on public.productos
for each row execute function public.actualizar_producto();

drop trigger if exists promociones_updated_at on public.promociones;
create trigger promociones_updated_at
before update on public.promociones
for each row execute function public.actualizar_producto();

create or replace function public.calcular_pedido()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    item jsonb;
    product_row public.productos%rowtype;
    quantity integer;
    normalized_items jsonb := '[]'::jsonb;
    calculated_total numeric(10, 2) := 0;
begin
    if tg_op = 'INSERT' and (
        nullif(btrim(coalesce(new.telefono_contacto, '')), '') is null
        or length(regexp_replace(coalesce(new.telefono_contacto, ''), '[^0-9]', '', 'g')) not between 7 and 20
        or nullif(btrim(coalesce(new.direccion_entrega, '')), '') is null
        or nullif(btrim(coalesce(new.distrito_zona, '')), '') is null
        or nullif(btrim(coalesce(new.referencia, '')), '') is null
    ) then
        raise exception 'Completa teléfono, dirección, distrito/zona y referencia para la entrega.';
    end if;

    if (select auth.uid()) is not null and not public.es_personal() then
        if new.cliente_id is distinct from (select auth.uid()) then
            raise exception 'El pedido debe pertenecer a la sesión actual.';
        end if;
        if lower(new.cliente_email) <> lower(coalesce((select auth.jwt() ->> 'email'), '')) then
            raise exception 'El correo del pedido debe corresponder a la sesión.';
        end if;
        new.estado := 'Pendiente';
    end if;

    for item in select value from jsonb_array_elements(new.items)
    loop
        quantity := (item ->> 'cantidad')::integer;
        if quantity is null or quantity < 1 or quantity > 99 then
            raise exception 'La cantidad debe estar entre 1 y 99.';
        end if;

        select * into product_row
        from public.productos
        where id = (item ->> 'producto_id')::uuid
          and disponible = true;

        if not found then
            raise exception 'Uno de los productos ya no está disponible.';
        end if;
        if product_row.porciones_disponibles is not null and product_row.porciones_disponibles < quantity then
            raise exception 'No hay suficientes porciones disponibles para uno o más platos.';
        end if;

        normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
            'producto_id', product_row.id,
            'nombre', product_row.nombre,
            'precio', product_row.precio,
            'cantidad', quantity
        ));
        calculated_total := calculated_total + (product_row.precio * quantity);
    end loop;

    new.items := normalized_items;
    new.total := calculated_total;
    return new;
end;
$$;

drop trigger if exists pedidos_calcular_total on public.pedidos;
create trigger pedidos_calcular_total
before insert on public.pedidos
for each row execute function public.calcular_pedido();

-- =========================================================
-- SEGURIDAD A NIVEL DE FILA (RLS)
-- =========================================================
alter table public.usuarios_admin enable row level security;
alter table public.personal_roles enable row level security;
alter table public.asistencia_turnos enable row level security;
alter table public.productos enable row level security;
alter table public.pedidos enable row level security;
alter table public.promociones enable row level security;
alter table public.configuracion_servicio enable row level security;
alter table public.ingredientes enable row level security;
alter table public.producto_insumos enable row level security;
alter table public.reservas enable row level security;
alter table public.opiniones enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.productos, public.promociones to anon, authenticated;
grant select on public.configuracion_servicio to anon, authenticated;
grant select on public.opiniones to anon, authenticated;
grant select, insert, update, delete on public.usuarios_admin, public.productos,
    public.pedidos, public.ingredientes, public.reservas, public.opiniones,
    public.promociones to authenticated;
grant select, insert, update, delete on public.personal_roles,
    public.producto_insumos, public.configuracion_servicio to authenticated;
grant select on public.asistencia_turnos to authenticated;
grant execute on function public.marcar_entrada_turno(uuid, text),
    public.marcar_salida_turno(uuid, text) to authenticated;
grant execute on function public.obtener_estado_servicio() to anon, authenticated;

revoke all on function public.recalcular_disponibilidad_producto(uuid) from public, anon, authenticated;
revoke all on function public.actualizar_disponibilidad_por_receta() from public, anon, authenticated;
revoke all on function public.actualizar_disponibilidad_por_stock() from public, anon, authenticated;
revoke all on function public.inicializar_disponibilidad_producto() from public, anon, authenticated;
revoke all on function public.auditar_personal_role() from public, anon, authenticated;
revoke all on function public.notificar_actualizacion_servicio() from public, anon, authenticated;

-- Políticas usuarios_admin
drop policy if exists "Usuarios consultan su propio perfil" on public.usuarios_admin;
drop policy if exists "Administrador crea perfiles de personal" on public.usuarios_admin;
drop policy if exists "Administrador actualiza perfiles de personal" on public.usuarios_admin;
drop policy if exists "Administrador elimina perfiles de personal" on public.usuarios_admin;

create policy "Usuarios consultan su propio perfil"
on public.usuarios_admin for select to authenticated
using (user_id = (select auth.uid()) or public.es_administrador() or public.es_gerente());

create policy "Administrador crea perfiles de personal"
on public.usuarios_admin for insert to authenticated
with check (public.es_administrador());

create policy "Administrador actualiza perfiles de personal"
on public.usuarios_admin for update to authenticated
using (public.es_administrador())
with check (public.es_administrador());

create policy "Administrador elimina perfiles de personal"
on public.usuarios_admin for delete to authenticated
using (public.es_administrador());

-- Políticas de roles y asistencia
drop policy if exists "Personal consulta su rol y admin consulta el equipo" on public.personal_roles;
create policy "Personal consulta su rol y admin consulta el equipo"
on public.personal_roles for select to authenticated
using (user_id = (select auth.uid()) or public.es_administrador() or public.es_gerente());

drop policy if exists "Administrador crea roles de personal" on public.personal_roles;
create policy "Administrador crea roles de personal"
on public.personal_roles for insert to authenticated
with check (public.es_administrador());

drop policy if exists "Administrador actualiza roles de personal" on public.personal_roles;
create policy "Administrador actualiza roles de personal"
on public.personal_roles for update to authenticated
using (public.es_administrador())
with check (public.es_administrador());

drop policy if exists "Administrador elimina roles de personal" on public.personal_roles;
create policy "Administrador elimina roles de personal"
on public.personal_roles for delete to authenticated
using (public.es_administrador());

drop policy if exists "Personal consulta su asistencia y admin consulta todos" on public.asistencia_turnos;
create policy "Personal consulta su asistencia y admin consulta todos"
on public.asistencia_turnos for select to authenticated
using (
    public.es_administrador()
    or public.es_gerente()
    or exists (
        select 1
        from public.personal_roles pr
        where pr.id = personal_id and pr.user_id = (select auth.uid())
    )
);

drop policy if exists "Administrador gestiona configuración del servicio" on public.configuracion_servicio;
drop policy if exists "Estado de servicio público" on public.configuracion_servicio;
create policy "Estado de servicio público"
on public.configuracion_servicio for select to anon, authenticated
using (id = 1);

create policy "Administrador gestiona configuración del servicio"
on public.configuracion_servicio for all to authenticated
using (public.es_administrador())
with check (public.es_administrador());

drop policy if exists "Administrador gestiona recetas" on public.producto_insumos;
create policy "Administrador gestiona recetas"
on public.producto_insumos for all to authenticated
using (public.es_administrador())
with check (public.es_administrador());

-- Políticas productos
drop policy if exists "La carta disponible es pública" on public.productos;
create policy "La carta disponible es pública"
on public.productos for select to anon, authenticated
using (disponible = true or public.es_personal());

drop policy if exists "Admin o recepcionista crea productos" on public.productos;
create policy "Admin o recepcionista crea productos"
on public.productos for insert to authenticated
with check (public.es_administrador() or public.es_recepcionista());

drop policy if exists "Admin o recepcionista edita productos" on public.productos;
create policy "Admin o recepcionista edita productos"
on public.productos for update to authenticated
using (public.es_administrador() or public.es_recepcionista())
with check (public.es_administrador() or public.es_recepcionista());

drop policy if exists "Admin elimina productos" on public.productos;
create policy "Admin elimina productos"
on public.productos for delete to authenticated
using (public.es_administrador());

-- Políticas promociones
drop policy if exists "Los destacados activos son públicos" on public.promociones;
create policy "Los destacados activos son públicos"
on public.promociones for select to anon, authenticated
using (activa or public.es_personal());

drop policy if exists "Admin crea destacados" on public.promociones;
create policy "Admin crea destacados"
on public.promociones for insert to authenticated
with check (public.es_administrador() or public.es_recepcionista());

drop policy if exists "Admin edita destacados" on public.promociones;
create policy "Admin edita destacados"
on public.promociones for update to authenticated
using (public.es_administrador() or public.es_recepcionista())
with check (public.es_administrador() or public.es_recepcionista());

drop policy if exists "Admin elimina destacados" on public.promociones;
create policy "Admin elimina destacados"
on public.promociones for delete to authenticated
using (public.es_administrador());

-- Políticas pedidos
drop policy if exists "Consulta de pedidos autorizados por rol" on public.pedidos;
create policy "Consulta de pedidos autorizados por rol"
on public.pedidos for select to authenticated
using (cliente_id = (select auth.uid()) or public.es_personal());

drop policy if exists "Un cliente crea su propio pedido" on public.pedidos;
create policy "Un cliente crea su propio pedido"
on public.pedidos for insert to authenticated
with check (
    (cliente_id = (select auth.uid()) and estado = 'Pendiente')
    or public.es_administrador()
    or public.es_recepcionista()
);

drop policy if exists "Actualización de pedidos autorizada por rol" on public.pedidos;
create policy "Actualización de pedidos autorizada por rol"
on public.pedidos for update to authenticated
using (
    public.es_administrador()
    or public.es_recepcionista()
    or (public.es_cocinero() and estado in ('Pendiente', 'En preparación'))
    or (public.es_mandadero() and estado in ('Listo', 'En camino', 'Entregado'))
)
with check (
    public.es_administrador()
    or public.es_recepcionista()
    or (public.es_cocinero() and estado in ('Pendiente', 'En preparación', 'Listo'))
    or (public.es_mandadero() and estado in ('Listo', 'En camino', 'Entregado'))
);

-- Políticas ingredientes
drop policy if exists "Personal consulta ingredientes" on public.ingredientes;
create policy "Personal consulta ingredientes"
on public.ingredientes for select to authenticated
using (public.es_administrador() or public.es_gerente() or public.es_cocinero());

drop policy if exists "Admin gestiona ingredientes" on public.ingredientes;
create policy "Admin gestiona ingredientes"
on public.ingredientes for all to authenticated
using (public.es_administrador())
with check (public.es_administrador());

drop policy if exists "Almacenero crea insumos sin existencias" on public.ingredientes;
create policy "Almacenero crea insumos sin existencias"
on public.ingredientes for insert to authenticated
with check (
    public.es_cocinero()
    and cantidad = 0
    and minimo = 0
    and precio_unitario = 0
);

drop policy if exists "Cocinero ajusta existencias" on public.ingredientes;
create policy "Cocinero ajusta existencias"
on public.ingredientes for update to authenticated
using (public.es_cocinero())
with check (public.es_cocinero());

-- Políticas opiniones
drop policy if exists "Opiniones son públicas" on public.opiniones;
create policy "Opiniones son públicas"
on public.opiniones for select to anon, authenticated
using (true);

drop policy if exists "El cliente califica pedidos entregados propios" on public.opiniones;
create policy "El cliente califica pedidos entregados propios"
on public.opiniones for insert to authenticated
with check (
    cliente_id = (select auth.uid())
    and exists (
        select 1 from public.pedidos
        where pedidos.id = pedido_id
          and pedidos.cliente_id = (select auth.uid())
          and pedidos.estado = 'Entregado'
    )
);

drop policy if exists "Admin modera opiniones" on public.opiniones;
create policy "Admin modera opiniones"
on public.opiniones for delete to authenticated
using (public.es_administrador());

-- Políticas payments
alter table public.payments enable row level security;

drop policy if exists "Cliente consulta pagos de sus pedidos" on public.payments;
create policy "Cliente consulta pagos de sus pedidos"
on public.payments for select to authenticated
using (
    exists (
        select 1 from public.pedidos
        where pedidos.id = payments.order_id
          and pedidos.cliente_id = (select auth.uid())
    )
    or public.es_personal()
);

drop policy if exists "Cliente o personal crea registro de pago" on public.payments;
create policy "Cliente o personal crea registro de pago"
on public.payments for insert to authenticated
with check (
    (
        status = 'pending_verification'
        and exists (
            select 1 from public.pedidos
            where pedidos.id = payments.order_id
              and pedidos.cliente_id = (select auth.uid())
        )
    )
    or public.es_administrador()
    or public.es_gerente()
    or public.es_recepcionista()
);

drop policy if exists "Personal actualiza estado de pago" on public.payments;
create policy "Personal actualiza estado de pago"
on public.payments for update to authenticated
using (public.es_administrador() or public.es_gerente() or public.es_recepcionista())
with check (public.es_administrador() or public.es_gerente() or public.es_recepcionista());

-- RLS y Políticas para personal_roles, asistencia_turnos, producto_insumos
alter table public.personal_roles enable row level security;
alter table public.asistencia_turnos enable row level security;
alter table public.producto_insumos enable row level security;

grant select on public.producto_insumos to anon, authenticated;
grant select, insert, update, delete on public.personal_roles, public.asistencia_turnos, public.producto_insumos to authenticated;

-- Políticas personal_roles
drop policy if exists "Personal consulta su perfil o admin consulta todos" on public.personal_roles;
create policy "Personal consulta su perfil o admin consulta todos"
on public.personal_roles for select to authenticated
using (user_id = (select auth.uid()) or public.es_administrador() or public.es_gerente());

drop policy if exists "Admin gestiona perfiles de personal_roles" on public.personal_roles;
create policy "Admin gestiona perfiles de personal_roles"
on public.personal_roles for all to authenticated
using (public.es_administrador())
with check (public.es_administrador());

-- Políticas asistencia_turnos
drop policy if exists "Personal consulta asistencia o admin consulta todos" on public.asistencia_turnos;
create policy "Personal consulta asistencia o admin consulta todos"
on public.asistencia_turnos for select to authenticated
using (
    exists (
        select 1 from public.personal_roles
        where personal_roles.id = asistencia_turnos.personal_id
          and personal_roles.user_id = (select auth.uid())
    )
    or public.es_administrador()
    or public.es_gerente()
);

drop policy if exists "Personal o admin registra asistencia" on public.asistencia_turnos;
create policy "Personal o admin registra asistencia"
on public.asistencia_turnos for insert to authenticated
with check (
    exists (
        select 1 from public.personal_roles
        where personal_roles.id = asistencia_turnos.personal_id
          and personal_roles.user_id = (select auth.uid())
    )
    or public.es_administrador()
);

drop policy if exists "Personal o admin actualiza su turno" on public.asistencia_turnos;
create policy "Personal o admin actualiza su turno"
on public.asistencia_turnos for update to authenticated
using (
    exists (
        select 1 from public.personal_roles
        where personal_roles.id = asistencia_turnos.personal_id
          and personal_roles.user_id = (select auth.uid())
    )
    or public.es_administrador()
)
with check (
    exists (
        select 1 from public.personal_roles
        where personal_roles.id = asistencia_turnos.personal_id
          and personal_roles.user_id = (select auth.uid())
    )
    or public.es_administrador()
);

-- Políticas producto_insumos
drop policy if exists "Insumos de productos son de lectura general" on public.producto_insumos;
create policy "Insumos de productos son de lectura general"
on public.producto_insumos for select to anon, authenticated
using (true);

drop policy if exists "Admin o chef gestiona insumos de productos" on public.producto_insumos;
create policy "Admin o chef gestiona insumos de productos"
on public.producto_insumos for all to authenticated
using (public.es_administrador() or public.es_cocinero())
with check (public.es_administrador() or public.es_cocinero());

-- Publicación realtime
do $$
begin
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos') then
        alter publication supabase_realtime add table public.pedidos;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'productos') then
        alter publication supabase_realtime add table public.productos;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'promociones') then
        alter publication supabase_realtime add table public.promociones;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'opiniones') then
        alter publication supabase_realtime add table public.opiniones;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'usuarios_admin') then
        alter publication supabase_realtime add table public.usuarios_admin;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments') then
        alter publication supabase_realtime add table public.payments;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal_roles') then
        alter publication supabase_realtime add table public.personal_roles;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'asistencia_turnos') then
        alter publication supabase_realtime add table public.asistencia_turnos;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'producto_insumos') then
        alter publication supabase_realtime add table public.producto_insumos;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'configuracion_servicio') then
        alter publication supabase_realtime add table public.configuracion_servicio;
    end if;
end;
$$;