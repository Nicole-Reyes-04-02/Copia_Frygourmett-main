-- Ejecutar después de schema.sql y advanced_features.sql en Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.notificaciones (
    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references auth.users (id) on delete cascade,
    rol_destino text not null,
    titulo text not null,
    mensaje text not null,
    leida boolean not null default false,
    pedido_id uuid references public.pedidos (id) on delete set null,
    ingrediente_id uuid references public.ingredientes (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint notificaciones_rol_destino_check
        check (rol_destino in ('administrador', 'gerente', 'recepcionista', 'almacenero', 'repartidor', 'cliente'))
);

alter table public.notificaciones
    drop constraint if exists notificaciones_rol_destino_check;

update public.notificaciones
set rol_destino = 'repartidor'
where rol_destino in ('mandadero', 'reparto', 'delivery');

alter table public.notificaciones
    add constraint notificaciones_rol_destino_check
        check (rol_destino in ('administrador', 'gerente', 'recepcionista', 'almacenero', 'repartidor', 'cliente'));

create index if not exists idx_notificaciones_usuario_no_leidas
    on public.notificaciones (usuario_id, rol_destino, leida, created_at desc);
create index if not exists idx_notificaciones_pedido
    on public.notificaciones (pedido_id)
    where pedido_id is not null;
create index if not exists idx_notificaciones_ingrediente
    on public.notificaciones (ingrediente_id)
    where ingrediente_id is not null;

create or replace function public.canonizar_rol_notificacion(p_rol text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case lower(btrim(coalesce(p_rol, '')))
        when 'admin' then 'administrador'
        when 'manager' then 'gerente'
        when 'recepcion' then 'recepcionista'
        when 'almacen' then 'almacenero'
        when 'chef' then 'almacenero'
        when 'cocina' then 'almacenero'
        when 'cocinero' then 'almacenero'
        when 'repartidor' then 'repartidor'
        when 'reparto' then 'repartidor'
        when 'delivery' then 'repartidor'
        when 'administrador' then 'administrador'
        when 'gerente' then 'gerente'
        when 'recepcionista' then 'recepcionista'
        when 'almacenero' then 'almacenero'
        when 'mandadero' then 'repartidor'
        when 'cliente' then 'cliente'
        else null
    end;
$$;

create or replace function public.rol_actual_notificacion()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_rol text;
    v_estado text;
    v_activo boolean;
begin
    if (select auth.uid()) is null then
        return null;
    end if;

    select pr.rol, pr.estado
    into v_rol, v_estado
    from public.personal_roles pr
    where pr.user_id = (select auth.uid());

    if found then
        if v_estado <> 'activo' then
            return null;
        end if;
        return public.canonizar_rol_notificacion(v_rol);
    end if;

    select ua.rol, ua.activo
    into v_rol, v_activo
    from public.usuarios_admin ua
    where ua.user_id = (select auth.uid());

    if found then
        if not v_activo then
            return null;
        end if;
        return public.canonizar_rol_notificacion(v_rol);
    end if;

    return 'cliente';
end;
$$;

create or replace function public.crear_notificacion_por_rol(
    p_rol text,
    p_titulo text,
    p_mensaje text,
    p_pedido_id uuid default null,
    p_ingrediente_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rol text := public.canonizar_rol_notificacion(p_rol);
begin
    if v_rol is null
        or v_rol not in ('administrador', 'gerente', 'recepcionista', 'almacenero', 'repartidor') then
        raise exception 'Rol de notificación no permitido.';
    end if;

    insert into public.notificaciones (
        usuario_id, rol_destino, titulo, mensaje, pedido_id, ingrediente_id
    )
    select recipients.user_id, v_rol, p_titulo, p_mensaje, p_pedido_id, p_ingrediente_id
    from (
        select pr.user_id
        from public.personal_roles pr
        where pr.estado = 'activo'
          and public.canonizar_rol_notificacion(pr.rol) = v_rol
        union
        select ua.user_id
        from public.usuarios_admin ua
        where ua.activo
          and public.canonizar_rol_notificacion(ua.rol) = v_rol
    ) as recipients;
end;
$$;

create or replace function public.notificar_cambio_estado_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_order_label text := upper(left(new.id::text, 8));
    v_platos text;
    v_direccion text;
    v_estado_cambio boolean := true;
begin
    if tg_op = 'UPDATE' then
        v_estado_cambio := old.estado is distinct from new.estado;
    end if;
    if not v_estado_cambio then
        return new;
    end if;

    if new.estado = 'Listo' then
        select string_agg(
            coalesce(nullif(item.value ->> 'nombre', ''), 'Plato')
                || ' x ' || coalesce(nullif(item.value ->> 'cantidad', ''), '1'),
            ', '
        )
        into v_platos
        from jsonb_array_elements(new.items) as item(value);

        v_direccion := concat_ws(', ',
            nullif(btrim(new.direccion_entrega), ''),
            nullif(btrim(new.distrito_zona), ''),
            nullif(btrim(new.referencia), '')
        );

        perform public.crear_notificacion_por_rol(
            'repartidor',
            'Pedido listo para reparto',
            'Nuevo pedido asignado #' || v_order_label
                || ' - Incluye: ' || coalesce(v_platos, 'Platos no especificados')
                || ' - Dirección: ' || coalesce(nullif(v_direccion, ''), 'Sin dirección registrada'),
            new.id,
            null
        );
    elsif tg_op = 'UPDATE' and new.cliente_id is not null and new.estado = 'En camino' then
        insert into public.notificaciones (usuario_id, rol_destino, titulo, mensaje, pedido_id)
        values (
            new.cliente_id,
            'cliente',
            'Tu pedido está en camino',
            'Tu pedido #' || v_order_label || ' está en camino',
            new.id
        );
    elsif tg_op = 'UPDATE' and new.cliente_id is not null and new.estado = 'Entregado' then
        insert into public.notificaciones (usuario_id, rol_destino, titulo, mensaje, pedido_id)
        values (
            new.cliente_id,
            'cliente',
            'Tu pedido fue entregado',
            'Tu pedido ha sido entregado',
            new.id
        );
    end if;

    return new;
end;
$$;

create or replace function public.notificar_pago_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_order_label text;
begin
    if new.status <> 'paid' then
        return new;
    end if;
    if tg_op = 'UPDATE' then
        if old.status = 'paid' then
            return new;
        end if;
    end if;

    select upper(left(p.id::text, 8))
    into v_order_label
    from public.pedidos p
    where p.id = new.order_id;

    if v_order_label is not null then
        perform public.crear_notificacion_por_rol(
            'recepcionista',
            'Pago confirmado',
            'Pedido #' || v_order_label || ' ha sido pagado',
            new.order_id,
            null
        );
    end if;

    return new;
end;
$$;

create or replace function public.notificar_stock_ingrediente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_stock_agotado boolean := false;
    v_stock_bajo boolean := false;
begin
    if tg_op = 'INSERT' then
        v_stock_agotado := new.cantidad <= 0;
        v_stock_bajo := not v_stock_agotado
            and new.minimo > 0
            and new.cantidad <= new.minimo;
    else
        v_stock_agotado := old.cantidad > 0 and new.cantidad <= 0;
        v_stock_bajo := not v_stock_agotado
            and old.cantidad > old.minimo
            and new.cantidad <= new.minimo
            and new.cantidad > 0;
    end if;

    if v_stock_agotado then
        perform public.crear_notificacion_por_rol(
            'almacenero',
            'Insumo agotado',
            'Insumo agotado: ' || new.nombre,
            null,
            new.id
        );
        perform public.crear_notificacion_por_rol(
            'recepcionista',
            'Alerta de almacén',
            'Alerta de almacén: ' || new.nombre || ' agotado',
            null,
            new.id
        );
    elsif v_stock_bajo then
        perform public.crear_notificacion_por_rol(
            'almacenero',
            'Stock bajo',
            'Stock bajo: ' || new.nombre || ' queda menos de '
                || new.minimo::text || ' ' || new.unidad,
            null,
            new.id
        );
    end if;

    return new;
end;
$$;

drop trigger if exists notificaciones_pedidos_estado on public.pedidos;
create trigger notificaciones_pedidos_estado
after insert or update of estado on public.pedidos
for each row execute function public.notificar_cambio_estado_pedido();

drop trigger if exists notificaciones_pagos_confirmados on public.payments;
create trigger notificaciones_pagos_confirmados
after insert or update of status on public.payments
for each row execute function public.notificar_pago_pedido();

drop trigger if exists notificaciones_stock_ingredientes on public.ingredientes;
create trigger notificaciones_stock_ingredientes
after insert or update of cantidad, minimo on public.ingredientes
for each row execute function public.notificar_stock_ingrediente();

alter table public.notificaciones enable row level security;
revoke all on table public.notificaciones from anon, authenticated;
grant select on table public.notificaciones to authenticated;
grant update (leida) on table public.notificaciones to authenticated;
revoke all on function public.rol_actual_notificacion() from public, anon, authenticated;
grant execute on function public.rol_actual_notificacion() to authenticated;
revoke all on function public.canonizar_rol_notificacion(text) from public, anon, authenticated;
revoke all on function public.crear_notificacion_por_rol(text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.notificar_cambio_estado_pedido() from public, anon, authenticated;
revoke all on function public.notificar_pago_pedido() from public, anon, authenticated;
revoke all on function public.notificar_stock_ingrediente() from public, anon, authenticated;

drop policy if exists "Usuarios leen sus notificaciones" on public.notificaciones;
create policy "Usuarios leen sus notificaciones"
on public.notificaciones for select to authenticated
using (
    usuario_id = (select auth.uid())
    and rol_destino = (select public.rol_actual_notificacion())
);

drop policy if exists "Usuarios marcan sus notificaciones" on public.notificaciones;
create policy "Usuarios marcan sus notificaciones"
on public.notificaciones for update to authenticated
using (
    usuario_id = (select auth.uid())
    and rol_destino = (select public.rol_actual_notificacion())
)
with check (
    usuario_id = (select auth.uid())
    and rol_destino = (select public.rol_actual_notificacion())
);

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'notificaciones'
    ) then
        alter publication supabase_realtime add table public.notificaciones;
    end if;
end;
$$;
