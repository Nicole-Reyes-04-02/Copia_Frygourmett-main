# FRYGOURMETT

Panel administrativo y portal de clientes para carta, delivery, inventario y operación diaria. La identidad usa azul noche `#031323`, blanco `#FFFFFF` y Montserrat.

El proyecto usa JavaScript ES modules y Vite; no usa React/JSX. El portal público está en `cliente.html` y el panel autenticado en `index.html`. Supabase es la fuente de verdad y las operaciones protegidas se validan en la base de datos con RLS y funciones RPC.

El inventario registra cantidades con unidades controladas, categoría y precio unitario en soles. El valor del stock y la valorización total se calculan como cantidad × precio unitario; los precios nunca se concatenan con la unidad de medida.

## Requisitos

- Node.js 20.19+ o 22.12+ y npm.
- Un proyecto Supabase.
- VS Code, Antigravity IDE o cualquier editor capaz de abrir esta carpeta.

## Preparar el proyecto en otra PC

1. Copia o clona esta carpeta y ábrela en el editor.
2. En la terminal, cambia a la carpeta del proyecto e instala dependencias:

   ```powershell
   npm install
   ```

3. Crea variables locales a partir del ejemplo:

   ```powershell
   Copy-Item .env.example .env.local
   ```

4. En `.env.local`, configura:

   ```dotenv
   VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
   VITE_SUPABASE_ANON_KEY=TU_CLAVE_PUBLICA_ANON_O_PUBLISHABLE
   VITE_SITE_URL=http://localhost:5173
   ```

   La clave `anon`/`publishable` es pública y está protegida por RLS; nunca pongas `service_role`, contraseñas de base de datos u otros secretos en variables `VITE_*`.

5. Inicia el sitio:

   ```powershell
   npm run dev
   ```

6. Abre `http://localhost:5173/cliente.html` para la carta o `http://localhost:5173/` para el panel del chef.

Antigravity IDE sigue el mismo procedimiento: abre la raíz de la carpeta, usa una terminal integrada y ejecuta los comandos de npm. No hay rutas absolutas locales y no se debe abrir el HTML mediante `file://`.

## Crear y configurar Supabase

1. Crea un proyecto en Supabase y abre **SQL Editor → New query**.
2. Copia y ejecuta [`database/schema.sql`](./database/schema.sql). Es el esquema consolidado v2.0: crea las tablas de la aplicación, funciones, políticas RLS, triggers e integra inventario, notificaciones y chat. El checkout exige teléfono, dirección, distrito/zona y referencia, y guarda el método de pago (`yape_plin`, `efectivo` o `tarjeta_pos`). La tabla heredada `reservas` se conserva por compatibilidad y no se usa en el checkout delivery.
3. En **Project Settings → API** copia la Project URL y la clave pública `anon`/publishable a `.env.local`.
4. En **Authentication → URL Configuration**, configura el **Site URL** local `http://localhost:5173`; si habilitas confirmación de correo para registro, agrega también `http://localhost:5173/cliente.html` a **Redirect URLs**. Para producción, añade las URLs HTTPS publicadas.
5. En **Authentication → Users**, crea la cuenta del chef con una contraseña segura y confirma su correo.
6. Autoriza esa cuenta para el panel. Sustituye el correo por el de la cuenta que acabas de crear y ejecuta en SQL Editor:

   ```sql
   insert into public.usuarios_admin (user_id, nombre, email, rol)
   select id, 'Administrador Frygourmett', email, 'administrador'
   from auth.users
   where email = 'chef@tu-dominio.com'
   on conflict (user_id) do update
   set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol, activo = true;
   ```

   Solo los perfiles activos de `usuarios_admin` pueden entrar al panel; los roles se guardan en la base de datos y RLS impide asignárselos a uno mismo. Los roles internos canónicos son `administrador`, `gerente`, `recepcionista`, `repartidor` y `almacenero`. Desde **Personal**, un administrador puede crear personal con esos roles. El alta usa una instancia temporal de Supabase que no reemplaza la sesión abierta.
7. El acceso del cliente es con correo, teléfono y contraseña. El teléfono se guarda en `user_metadata`; no se usan enlaces mágicos. Si Supabase requiere confirmar el correo durante el registro, configura un proveedor SMTP apropiado.

Para una base ya existente, realiza primero un backup y aplica solo las actualizaciones que aún falten, en este orden: `supabase/schema.sql` (si falta el esquema base o para recoger sus actualizaciones), `supabase/advanced_features.sql`, `supabase/notifications.sql` y `supabase/staff_chat.sql`. Notificaciones y chat dependen de las tablas y helpers previos.

Las imágenes y videos del carrusel se gestionan desde **Carta → Destacados del carrusel**. Los archivos locales deben existir bajo `img/` con la ruta y el uso de mayúsculas/minúsculas exactos; se pueden usar imágenes WebP, PNG, AVIF y videos MP4/WebM locales. Con el carrusel aún vacío, se muestran recursos locales de `img/`. Los medios externos deben usar una URL HTTPS directa al archivo.

## Arquitectura, roles y permisos

La aplicación está organizada por responsabilidad y comparte módulos ES entre el panel y el portal:

| Rol | Acceso principal |
| --- | --- |
| Administrador | Todo el panel, finanzas, personal, configuración y los tres canales del chat. |
| Gerente | Dashboard financiero, reportes y consulta de pedidos, personal e inventario; sin permisos para administrar cuentas, modificar la carta, recetas ni existencias. También puede usar `#inventario`. |
| Recepcionista | Pedidos recientes, estado del día, carta y atención. Las consultas del dashboard no solicitan importes; se actualizan cada 30 segundos y no se suscriben a cambios de pedidos por Realtime, ya que el evento puede incluir campos financieros. En el chat solo usa `#general` y `#pedidos`. |
| Almacenero | Ingredientes, recetas, unidades, mermas y ajustes autorizados. Puede usar los tres canales del chat. |
| Repartidor | Vista de pedidos para despacho y actualización de entrega. En el chat solo usa `#general` y `#pedidos`. |
| Cliente | Carta, su cuenta, pedidos propios, calificaciones y notificaciones de sus pedidos. No puede abrir el panel de staff ni el chat. |

Solo el Administrador tiene acceso completo y puede previsualizar otros roles. El Gerente tiene acceso a los reportes y a vistas de consulta de pedidos, personal e inventario, pero no puede administrar trabajadores, cambiar configuraciones, modificar productos, recetas o existencias. Recepcionista, Repartidor y Almacenero conservan permisos operativos limitados a sus funciones. La navegación y las consultas del cliente se restringen por rol, y Supabase vuelve a validar el acceso mediante RLS. El personal puede leer y escribir en `#general` y `#pedidos`; `#inventario` está limitado en la interfaz y en RLS a Administrador, Gerente y Almacenero. El acceso de clientes al chat no se concede.

## Módulos y uso

- **Carta y categorías:** `js/constants/categories.js` exporta `CATEGORIAS`, compartida por el panel y los carruseles del cliente.
- **Personal y autorización:** `js/auth.js` normaliza roles, resuelve el perfil desde Supabase y define qué vistas puede abrir cada rol.
- **Portal y pedidos:** `js/customer.js` gestiona registro/inicio de sesión, carta, carrito, checkout y seguimiento del pedido.
- **Recetas e inventario:** `src/utils/units.js` normaliza unidades y convierte cantidades a la unidad del ingrediente. En **Carta**, importa un `.txt` con sección `[INGREDIENTES]`; el parser acepta cantidad/unidad/ingrediente, normaliza sinónimos y calcula `consumo real = cantidad neta × (1 + merma / 100)`. Crea automáticamente con stock cero los insumos faltantes; las líneas no interpretables quedan en el log y, si hay errores, no reemplazan una receta existente. En platos existentes la receta se guarda al importar; al crear un plato nuevo queda vinculada al formulario y se guarda junto con este, sin una confirmación adicional para la receta. Ninguna importación descuenta existencias. El stock se descuenta una sola vez cuando el pago pasa a `paid`, dentro de una transacción que valida existencias, marca el pedido y registra movimientos auditables. `revertir_movimiento_inventario_receta` permite revertir un movimiento autorizado.
- **Exportación:** desde pedidos se pueden generar PDF, Excel o CSV; desde inventario, PDF o Excel con valorización del stock. PDF y Excel incluyen cabecera oscura, filas alternadas, cifras alineadas, totales y fecha de exportación; se avisa si no hay datos.
- **Notificaciones:** la campanita del panel y el portal del cliente muestran no leídas y permiten marcarlas como leídas. Triggers de Postgres generan avisos de pedidos, pagos y stock; Realtime los entrega a usuarios autorizados. El aviso de reparto se distribuye al rol cuando un pedido pasa a «Listo», porque no existe asignación individual de repartidor.
- **Chat interno:** la vista **Mensajes** ofrece canales en tiempo real, historial paginado y contadores de no leídos. Nombre y rol del remitente se obtienen del perfil autenticado; el navegador no puede suplantar su identidad.
- **Servicios:** `js/services/inventory.js`, `notifications.js`, `staff-chat.js` y `report-export.js` aíslan las operaciones de inventario, notificaciones, chat y exportación.

## Base de datos v2.0

[`database/schema.sql`](./database/schema.sql) es el esquema consolidado para una instalación Supabase nueva. Incluye las tablas base de personal, productos, pedidos, pagos, ingredientes y recetas, además de:

- `inventario_movimientos` y `auditoria_merma`, con índices, guardado transaccional de recetas, descuento idempotente al confirmar el pago y reversión auditable.
- `notificaciones`, con RLS por usuario y rol, triggers de pedidos/pagos/stock y publicación en `supabase_realtime`.
- `chat_mensajes` y `chat_lecturas`, con RLS por rol/canal y por usuario, índices y publicación Realtime.
- Políticas RLS para las tablas operativas y funciones protegidas para operaciones privilegiadas.
- El Gerente cuenta con permisos de lectura para el dashboard, pedidos, inventario, perfiles y asistencia; las políticas de escritura siguen reservadas al Administrador o al rol operativo correspondiente.

Las fuentes incrementales permanecen bajo `supabase/` para instalaciones existentes. Ejecuta las migraciones según sus comentarios de dependencia; no concedas `service_role` al navegador. El esquema se ejecuta desde **SQL Editor** de Supabase con una cuenta administradora del proyecto.

## Comprobación y publicación

Ejecuta las pruebas y valida que el proyecto compile:

```powershell
npm test
npm run build
```

Las pruebas no necesitan credenciales Supabase. `npm run build` requiere `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_SITE_URL` con una URL HTTPS de producción; `http://localhost` se reserva para desarrollo con `npm run dev`. El resultado queda en `dist/`. Para probar el build localmente:

```powershell
npm run preview
```

### Netlify

1. Importa el repositorio en Netlify y selecciona Node.js 20.19+ o 22.12+.
2. Usa `npm run build` como **Build command** y `dist` como **Publish directory**.
3. En **Site configuration → Environment variables**, configura `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_SITE_URL=https://tu-dominio-publico`.
4. Agrega la URL HTTPS pública del portal y del panel a **Authentication → URL Configuration → Redirect URLs** en Supabase si está habilitada la confirmación de correo.
5. Despliega y vuelve a compilar cuando cambien el dominio o las variables. Vite fija la URL canónica y los metadatos Open Graph/Twitter durante el build.

Vercel y otros hosts estáticos también pueden servir `dist/` con el mismo comando y variables. No se requiere backend propio para las funciones incluidas: la autorización de pedidos, productos, destacados e información de personal se aplica con Supabase Auth y RLS.


## Seguridad y operación

- No elimines las políticas RLS ni publiques una clave `service_role`.
- La tabla `usuarios_admin` se administra desde Supabase, no desde el formulario público.
- El total del pedido lo calcula un trigger de Postgres usando el precio vigente; no se confía en el precio enviado por el navegador.
- El cliente solo puede consultar pedidos asociados a su sesión verificada. El correo por sí solo no concede acceso.
- Los pedidos, cambios de estado y destacados se actualizan en tiempo real cuando la publicación `supabase_realtime` está habilitada.
- El panel tiene `noindex,nofollow`; esto complementa, pero no sustituye, el inicio de sesión.
- Usa HTTPS y revisa las reglas de retención/privacidad antes de almacenar información real de clientes.

## Estructura principal

```text
index.html                       Panel administrativo
cliente.html                     Portal de clientes y delivery
css/                             Estilos separados por experiencia y módulos
js/auth.js                       Sesión, roles y permisos de vistas
js/constants/categories.js       Categorías compartidas de la carta
js/services/                     Inventario, notificaciones, chat y exportación
js/customer.js                   Auth de clientes, carta, carrusel y checkout
js/script.js                     Orquestación del panel administrativo
src/utils/                       Conversión de unidades e importación de recetas
database/schema.sql              Esquema consolidado Supabase v2.0
supabase/                        Fuentes SQL incrementales por módulo
vite.config.js                   Build multipágina y metadatos sociales
package.json                     Scripts y dependencias
.env.example                     Variables de desarrollo y despliegue
```

El manual menciona Hussar Bold para algunas aplicaciones de marca, pero el archivo tipográfico no está incluido. No se redistribuye una fuente sin licencia; la web usa Montserrat y conserva el logotipo existente.

Antes de publicar, sustituye los enlaces genéricos de Instagram/TikTok por los perfiles oficiales del negocio.

## Changelog

### v2.0

- Corregidos el estado visual del personal y los permisos del dashboard para Recepcionista.
- Compartida la constante `CATEGORIAS` entre el panel y el portal del cliente.
- Añadidos conversión de unidades, importación automática de recetas `.txt`, cálculo de merma, creación de insumos faltantes con stock cero y guardado transaccional de recetas.
- El descuento de inventario se ejecuta al confirmar el pago, una sola vez por pedido, con comprobación atómica de stock y movimientos reversibles.
- Añadidas exportaciones contables PDF/Excel con totales y validación de datos vacíos; se conserva CSV.
- Añadidas notificaciones por rol con triggers, RLS y Supabase Realtime.
- Añadido chat del personal con `#general`, `#pedidos` y `#inventario`, historial paginado, contadores no leídos y políticas RLS por rol.
- Consolidado el esquema inicial de Supabase en `database/schema.sql` y documentados módulos, roles, permisos e instalación.
- Unificados los roles canónicos y restringida la previsualización de roles a Administrador; corregidas las migraciones de triggers de inventario y reclamaciones.
- Diferenciados los permisos de Gerente y Administrador: reportes y consultas de solo lectura para Gerencia; administración de personal, configuración y acceso total exclusivos del Administrador.
