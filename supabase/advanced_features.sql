-- Ejecutar manualmente en Supabase SQL Editor.
-- Este script añade solo estructuras auxiliares; no reemplaza triggers existentes.

alter table public.ingredientes
  add column if not exists densidad numeric(12,6),
  add column if not exists peso_por_taza numeric(12,6),
  add column if not exists unidad_base text;

alter table public.ingredientes
  drop constraint if exists ingredientes_densidad_check,
  add constraint ingredientes_densidad_check check (densidad is null or densidad > 0);
alter table public.ingredientes
  drop constraint if exists ingredientes_peso_por_taza_check,
  add constraint ingredientes_peso_por_taza_check check (peso_por_taza is null or peso_por_taza > 0);

create table if not exists public.inventario_movimientos (
  id uuid primary key default gen_random_uuid(),
  ingrediente_id uuid references public.ingredientes(id) on delete set null,
  tipo text not null,
  cantidad numeric(12,3) not null,
  cantidad_anterior numeric(12,3),
  cantidad_nueva numeric(12,3),
  motivo text,
  registrado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.inventario_movimientos
  add column if not exists lote_id uuid,
  add column if not exists reversion_de uuid references public.inventario_movimientos(id) on delete restrict;

drop index if exists public.idx_inventario_movimientos_lote_ingrediente;
create unique index idx_inventario_movimientos_lote_ingrediente
  on public.inventario_movimientos(lote_id, ingrediente_id)
  where lote_id is not null and ingrediente_id is not null and tipo = 'Consumo receta';
create unique index if not exists idx_inventario_movimientos_reversion
  on public.inventario_movimientos(reversion_de)
  where reversion_de is not null;

create unique index if not exists idx_inventario_movimientos_pedido_ingrediente
  on public.inventario_movimientos(lote_id, ingrediente_id)
  where lote_id is not null and ingrediente_id is not null and tipo = 'Consumo pedido';

alter table public.producto_insumos
  add column if not exists cantidad_neta numeric(10,3) not null default 0,
  add column if not exists porcentaje_merma numeric(5,2) not null default 0;

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

revoke all on function public.reemplazar_receta_producto(uuid,jsonb) from public, anon;
grant execute on function public.reemplazar_receta_producto(uuid,jsonb) to authenticated;

create or replace function public.descontar_insumos_pago()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_consumo record;
  v_stock numeric(12,3);
  v_nueva_cantidad numeric(12,3);
begin
  if new.status is distinct from 'paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'paid' then
      return new;
    end if;
  end if;

  select p.* into v_pedido
  from public.pedidos p
  where p.id = new.order_id
  for update;
  if not found then
    raise exception 'No se encontró el pedido asociado al pago.';
  end if;
  if v_pedido.insumos_descontados_at is not null then
    return new;
  end if;

  for v_consumo in
    select pi.ingrediente_id,
      sum(pi.cantidad_por_porcion * coalesce(nullif(item.value ->> 'cantidad', '')::numeric, 1)) as cantidad
    from jsonb_array_elements(v_pedido.items) as item(value)
    join public.producto_insumos pi
      on pi.producto_id = (item.value ->> 'producto_id')::uuid
    group by pi.ingrediente_id
    order by pi.ingrediente_id
  loop
    if v_consumo.cantidad <= 0 then
      raise exception 'La cantidad de consumo del pedido no es válida.';
    end if;

    select i.cantidad into v_stock
    from public.ingredientes i
    where i.id = v_consumo.ingrediente_id
    for update;
    if not found then
      raise exception 'No se encontró un ingrediente requerido por el pedido.';
    end if;
    if v_stock < v_consumo.cantidad then
      raise exception 'Stock insuficiente para el ingrediente %: disponible %, requerido %.',
        v_consumo.ingrediente_id, v_stock, v_consumo.cantidad;
    end if;

    v_nueva_cantidad := round(v_stock - v_consumo.cantidad, 3);
    update public.ingredientes
    set cantidad = v_nueva_cantidad, updated_at = now()
    where id = v_consumo.ingrediente_id;

    insert into public.inventario_movimientos (
      ingrediente_id, tipo, cantidad, cantidad_anterior, cantidad_nueva,
      motivo, registrado_por, lote_id
    ) values (
      v_consumo.ingrediente_id, 'Consumo pedido', -v_consumo.cantidad,
      v_stock, v_nueva_cantidad,
      'Consumo por pedido ' || left(v_pedido.id::text, 8),
      (select auth.uid()), v_pedido.id
    );
  end loop;

  update public.pedidos
  set insumos_descontados_at = now()
  where id = v_pedido.id and insumos_descontados_at is null;

  return new;
end;
$$;

drop trigger if exists pedidos_descontar_insumos on public.pedidos;
drop trigger if exists trg_descontar_insumos_pedido on public.pedidos;
drop function if exists public.descontar_insumos_pedido();
drop trigger if exists pagos_descontar_insumos on public.payments;
create trigger pagos_descontar_insumos
after insert or update of status on public.payments
for each row execute function public.descontar_insumos_pago();

revoke all on function public.descontar_insumos_pago() from public, anon, authenticated;

create table if not exists public.auditoria_merma (
  id uuid primary key default gen_random_uuid(),
  ingrediente_id uuid references public.ingredientes(id) on delete set null,
  fecha date not null default current_date,
  stock_teorico numeric(12,3) not null default 0,
  stock_real numeric(12,3) not null default 0,
  diferencia numeric(12,3) generated always as (stock_real - stock_teorico) stored,
  motivo text,
  registrado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.reclamaciones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  documento text,
  email text,
  telefono text,
  direccion text,
  tipo text not null check (tipo in ('Queja','Reclamo')),
  bien_servicio text,
  pedido_id uuid references public.pedidos(id) on delete set null,
  detalle text not null,
  estado text not null default 'Pendiente' check (estado in ('Pendiente','En revision','Resuelto','Cerrado')),
  created_at timestamptz not null default now()
);

create sequence if not exists public.reclamaciones_correlativo_seq;

create or replace function public.generar_codigo_reclamacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'REC-' || to_char(current_date, 'YYYY') || '-' ||
      lpad(nextval('public.reclamaciones_correlativo_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists reclamaciones_codigo on public.reclamaciones;
create trigger reclamaciones_codigo
before insert on public.reclamaciones
for each row execute function public.generar_codigo_reclamacion();

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
  check (rol in ('administrador','gerente','recepcionista','repartidor','almacenero','cliente'));

alter table public.inventario_movimientos enable row level security;
alter table public.auditoria_merma enable row level security;
alter table public.reclamaciones enable row level security;

revoke all on table public.inventario_movimientos, public.auditoria_merma, public.reclamaciones
  from anon, authenticated;
grant select on table public.inventario_movimientos, public.auditoria_merma, public.reclamaciones
  to authenticated;

drop policy if exists "Personal autorizado lee movimientos" on public.inventario_movimientos;
create policy "Personal autorizado lee movimientos"
on public.inventario_movimientos for select to authenticated
using (public.es_administrador() or public.es_gerente() or public.es_cocinero());
drop policy if exists "Administrador y almacenero registran movimientos" on public.inventario_movimientos;
create policy "Administrador y almacenero registran movimientos"
on public.inventario_movimientos for insert to authenticated
with check (public.es_administrador() or public.es_cocinero());
drop policy if exists "Personal autorizado gestiona auditoria" on public.auditoria_merma;
drop policy if exists "Personal consulta auditoria de merma" on public.auditoria_merma;
create policy "Personal consulta auditoria de merma"
on public.auditoria_merma for select to authenticated
using (public.es_administrador() or public.es_gerente() or public.es_cocinero());
drop policy if exists "Administrador y almacenero gestionan auditoria de merma" on public.auditoria_merma;
create policy "Administrador y almacenero gestionan auditoria de merma"
on public.auditoria_merma for all to authenticated
using (public.es_administrador() or public.es_cocinero())
with check (public.es_administrador() or public.es_cocinero());
drop policy if exists "Cualquier visitante crea reclamacion" on public.reclamaciones;
create policy "Cualquier visitante crea reclamacion"
on public.reclamaciones for insert to anon, authenticated
with check (true);
drop policy if exists "Propietario o administrador lee reclamacion" on public.reclamaciones;
create policy "Propietario o administrador lee reclamacion"
on public.reclamaciones for select to authenticated
using (
  exists (select 1 from public.personal_roles p
          where p.user_id = auth.uid() and p.estado = 'activo'
            and p.rol in ('administrador','gerente'))
);

create or replace function public.crear_reclamacion_publica(
  p_nombre text,
  p_documento text,
  p_email text,
  p_telefono text,
  p_tipo text,
  p_bien_servicio text,
  p_detalle text
)
returns table(codigo text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_tipo not in ('Queja','Reclamo') then
    raise exception 'Tipo de registro no valido';
  end if;
  insert into public.reclamaciones
    (nombre, documento, email, telefono, tipo, bien_servicio, detalle)
  values
    (btrim(p_nombre), nullif(btrim(p_documento), ''), nullif(btrim(p_email), ''),
     btrim(p_telefono), p_tipo, btrim(p_bien_servicio), btrim(p_detalle))
  returning id into v_id;

  return query
  select r.codigo, r.created_at
  from public.reclamaciones r
  where r.id = v_id;
end;
$$;

revoke all on function public.crear_reclamacion_publica(text,text,text,text,text,text,text) from public;
grant execute on function public.crear_reclamacion_publica(text,text,text,text,text,text,text) to anon, authenticated;

create or replace function public.registrar_reposicion_inventario(
  p_ingrediente_id uuid,
  p_cantidad numeric,
  p_motivo text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ingrediente public.ingredientes%rowtype;
  v_cantidad numeric(12,3);
  v_nueva_cantidad numeric(12,3);
  v_movimiento_id uuid;
begin
  if (select auth.uid()) is null or not public.es_cocinero() then
    raise exception 'Solo el Administrador o Almacenero puede registrar reposiciones.';
  end if;
  if p_ingrediente_id is null or p_cantidad is null or p_cantidad <= 0
     or p_cantidad::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'El ingrediente y una cantidad positiva son obligatorios.';
  end if;

  v_cantidad := round(p_cantidad, 3);
  if v_cantidad <= 0 then
    raise exception 'La cantidad es menor a la precisión admitida por inventario.';
  end if;

  select i.* into v_ingrediente
  from public.ingredientes i
  where i.id = p_ingrediente_id
  for update;
  if not found then
    raise exception 'El ingrediente de la reposición no existe.';
  end if;

  v_nueva_cantidad := round(v_ingrediente.cantidad + v_cantidad, 3);
  update public.ingredientes
  set cantidad = v_nueva_cantidad, updated_at = now()
  where id = v_ingrediente.id;

  insert into public.inventario_movimientos (
    ingrediente_id, tipo, cantidad, cantidad_anterior, cantidad_nueva,
    motivo, registrado_por
  ) values (
    v_ingrediente.id, 'Reposición', v_cantidad,
    v_ingrediente.cantidad, v_nueva_cantidad,
    left(coalesce(nullif(btrim(p_motivo), ''), 'Reposición de inventario'), 250),
    (select auth.uid())
  )
  returning id into v_movimiento_id;

  return v_movimiento_id;
end;
$$;

revoke all on function public.registrar_reposicion_inventario(uuid,numeric,text) from public, anon;
grant execute on function public.registrar_reposicion_inventario(uuid,numeric,text) to authenticated;

create or replace function public.descontar_inventario_receta(
  p_lote_id uuid,
  p_consumos jsonb,
  p_motivo text default ''
)
returns table(
  movimiento_id uuid,
  ingrediente_id uuid,
  cantidad numeric,
  cantidad_anterior numeric,
  cantidad_nueva numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_consumo record;
  v_ingrediente public.ingredientes%rowtype;
  v_nueva_cantidad numeric(12,3);
begin
  if auth.uid() is null or not (
    exists (
      select 1 from public.personal_roles pr
      where pr.user_id = auth.uid()
        and pr.estado = 'activo'
        and pr.rol in ('administrador','almacenero')
    )
    or exists (
      select 1 from public.usuarios_admin ua
      where ua.user_id = auth.uid()
        and ua.activo
        and ua.rol in ('administrador','almacenero')
    )
  ) then
    raise exception 'Solo personal autorizado puede descontar inventario.';
  end if;

  if p_lote_id is null or p_consumos is null then
    raise exception 'El lote y la lista de consumos son obligatorios.';
  end if;
  if jsonb_typeof(p_consumos) is distinct from 'array' then
    raise exception 'La lista de consumos debe ser un arreglo.';
  end if;
  if jsonb_array_length(p_consumos) = 0 then
    raise exception 'El lote y la lista de consumos son obligatorios.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_consumos) as x(ingrediente_id uuid, cantidad numeric)
    where x.ingrediente_id is null or x.cantidad is null or x.cantidad <= 0
  ) then
    raise exception 'Cada consumo debe incluir ingrediente y cantidad positiva.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_lote_id::text, 0));
  if exists (
    select 1 from public.inventario_movimientos m where m.lote_id = p_lote_id
  ) then
    return query
      select m.id, m.ingrediente_id, abs(m.cantidad), m.cantidad_anterior, m.cantidad_nueva
      from public.inventario_movimientos m
      where m.lote_id = p_lote_id and m.tipo = 'Consumo receta'
      order by m.ingrediente_id;
    return;
  end if;

  for v_consumo in
    select x.ingrediente_id, sum(x.cantidad)::numeric(12,3) as cantidad
    from jsonb_to_recordset(p_consumos) as x(ingrediente_id uuid, cantidad numeric)
    group by x.ingrediente_id
    order by x.ingrediente_id
  loop
    select i.* into v_ingrediente
    from public.ingredientes i
    where i.id = v_consumo.ingrediente_id
    for update;

    if not found then
      raise exception 'El ingrediente % ya no existe.', v_consumo.ingrediente_id;
    end if;
    if v_ingrediente.cantidad < v_consumo.cantidad then
      raise exception 'Stock insuficiente para %: disponible %, requerido % %.',
        v_ingrediente.nombre, v_ingrediente.cantidad, v_consumo.cantidad, v_ingrediente.unidad;
    end if;

    v_nueva_cantidad := round(v_ingrediente.cantidad - v_consumo.cantidad, 3);
    update public.ingredientes
    set cantidad = v_nueva_cantidad, updated_at = now()
    where id = v_ingrediente.id;

    insert into public.inventario_movimientos (
      ingrediente_id, tipo, cantidad, cantidad_anterior, cantidad_nueva,
      motivo, registrado_por, lote_id
    ) values (
      v_ingrediente.id, 'Consumo receta', -v_consumo.cantidad,
      v_ingrediente.cantidad, v_nueva_cantidad,
      left(coalesce(nullif(btrim(p_motivo), ''), 'Importación automática de receta'), 250),
      auth.uid(), p_lote_id
    );
  end loop;

  return query
    select m.id, m.ingrediente_id, abs(m.cantidad), m.cantidad_anterior, m.cantidad_nueva
    from public.inventario_movimientos m
    where m.lote_id = p_lote_id and m.tipo = 'Consumo receta'
    order by m.ingrediente_id;
end;
$$;

create or replace function public.revertir_movimiento_inventario_receta(p_movimiento_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original public.inventario_movimientos%rowtype;
  v_ingrediente public.ingredientes%rowtype;
  v_nueva_cantidad numeric(12,3);
  v_reversion_id uuid;
begin
  if auth.uid() is null or not (
    exists (
      select 1 from public.personal_roles pr
      where pr.user_id = auth.uid()
        and pr.estado = 'activo'
        and pr.rol in ('administrador','almacenero')
    )
    or exists (
      select 1 from public.usuarios_admin ua
      where ua.user_id = auth.uid()
        and ua.activo
        and ua.rol in ('administrador','almacenero')
    )
  ) then
    raise exception 'Solo personal autorizado puede revertir movimientos.';
  end if;

  select m.* into v_original
  from public.inventario_movimientos m
  where m.id = p_movimiento_id
    and m.tipo in ('Consumo receta', 'Consumo pedido')
  for update;
  if not found then
    raise exception 'El movimiento de consumo no existe o no se puede revertir.';
  end if;
  if exists (
    select 1 from public.inventario_movimientos m where m.reversion_de = v_original.id
  ) then
    raise exception 'Este movimiento ya fue revertido.';
  end if;

  select i.* into v_ingrediente
  from public.ingredientes i
  where i.id = v_original.ingrediente_id
  for update;
  if not found then
    raise exception 'El ingrediente original ya no existe.';
  end if;

  v_nueva_cantidad := round(v_ingrediente.cantidad + abs(v_original.cantidad), 3);
  update public.ingredientes
  set cantidad = v_nueva_cantidad, updated_at = now()
  where id = v_ingrediente.id;

  insert into public.inventario_movimientos (
    ingrediente_id, tipo, cantidad, cantidad_anterior, cantidad_nueva,
    motivo, registrado_por, lote_id, reversion_de
  ) values (
    v_ingrediente.id,
    case when v_original.tipo = 'Consumo pedido' then 'Reversión pedido' else 'Reversión receta' end,
    abs(v_original.cantidad),
    v_ingrediente.cantidad, v_nueva_cantidad,
    'Reversión del movimiento ' || v_original.id::text,
    auth.uid(), v_original.lote_id, v_original.id
  )
  returning id into v_reversion_id;

  return v_reversion_id;
end;
$$;

revoke all on function public.descontar_inventario_receta(uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.revertir_movimiento_inventario_receta(uuid) from public, anon;
grant execute on function public.revertir_movimiento_inventario_receta(uuid) to authenticated;
