import express from 'express';
import { randomUUID } from 'node:crypto';
<<<<<<< HEAD
import { rateLimit } from 'express-rate-limit';
import { authenticate, optionalAuthenticate, requireAdministrator, requireCitizen } from './auth-routes.js';
=======
import { createAdminRouter } from './admin-routes.js';
import { asyncRoute, authenticate, isAdministrator, requireAdministrator } from './auth-routes.js';
import {
  caseListColumns,
  caseVisibilityParameters,
  IMAGE_DATA_URL,
  paginatedBody,
  paginationFromQuery,
  PUBLIC_CASE_FILTER,
  sendStoredPhoto,
  toPublicCase,
  validCoordinates
} from './case-shared.js';
import { createClueRouter } from './clue-routes.js';
>>>>>>> ebd8324ad118c5c0353876d1451c3c8ec9f26afe
import { withTransaction } from './db.js';
import { createNotificationRouter } from './notification-routes.js';
import { createStatsRouter } from './stats-routes.js';
import { ubicacionValida } from './ubicaciones.js';

export { processDueFollowups } from './followups.js';

// Router de /api: define los permisos comunes y las rutas de casos del ciudadano,
// y monta los routers de pistas, notificaciones, estadísticas y administración.
export function createCaseRouter({ db, jwtSecret }) {
  const router = express.Router();
  const requireUser = authenticate(jwtSecret, db);
  const requireAdmin = [requireUser, requireAdministrator];
<<<<<<< HEAD
  const clueSubmissionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Se alcanzó el límite temporal de envíos de pistas. Intente nuevamente más tarde.' }
  });
=======
  // La cuenta de administrador es institucional: no reporta ni sigue casos
  // propios (ROLES_Y_PERMISOS.txt, tabla de permisos).
  const requireCitizen = [requireUser, (req, res, next) => {
    if (isAdministrator(req.auth)) {
      return res.status(403).json({ error: 'La cuenta de administrador no reporta ni sigue casos propios.' });
    }
    next();
  }];
>>>>>>> ebd8324ad118c5c0353876d1451c3c8ec9f26afe

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/casos', requireUser, asyncRoute(async (req, res) => {
    const search = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%%';
    const city = typeof req.query.ciudad === 'string' ? `%${req.query.ciudad.trim()}%` : '%%';
    const department = typeof req.query.departamento === 'string' ? `%${req.query.departamento.trim()}%` : '%%';
    const sex = typeof req.query.sexo === 'string' ? req.query.sexo : '';
    const ageMin = Number.isInteger(Number(req.query.edadMin)) ? Number(req.query.edadMin) : null;
    const ageMax = Number.isInteger(Number(req.query.edadMax)) ? Number(req.query.edadMax) : null;
    const pagination = paginationFromQuery(req.query);
    const { rows } = await db.query(`
      SELECT ${caseListColumns()}, COUNT(*) OVER() AS total_registros FROM casos
      WHERE ${PUBLIC_CASE_FILTER} AND estado <> 'RECHAZADO'
        AND ($2 = '%%' OR nombre_completo ILIKE $2 OR ciudad ILIKE $2
          OR departamento ILIKE $2 OR descripcion_fisica ILIKE $2
          OR vestimenta ILIKE $2 OR senas_particulares ILIKE $2)
        AND ($3 = '%%' OR ciudad ILIKE $3)
        AND ($4 = '%%' OR departamento ILIKE $4)
        AND ($5 = '' OR sexo = $5)
        AND ($6::integer IS NULL OR edad >= $6)
        AND ($7::integer IS NULL OR edad <= $7)
      ORDER BY creado_en DESC
      LIMIT $8::integer OFFSET $9::integer
    `, [...caseVisibilityParameters(), search, city, department, sex, ageMin, ageMax,
      pagination.limit, pagination.offset]);
    res.json(paginatedBody('casos', rows.map(toPublicCase), rows, pagination));
  }));

  router.get('/casos/:id', requireUser, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT * FROM casos
      WHERE id = $2 AND ${PUBLIC_CASE_FILTER} AND estado <> 'RECHAZADO'
    `, [...caseVisibilityParameters(), req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caso no disponible' });
    res.json({ caso: toPublicCase(rows[0]) });
  }));

  router.get('/casos/:id/foto', requireUser, asyncRoute((req, res) => sendStoredPhoto(db, req, res, false)));

  router.get('/mis-casos', ...requireCitizen, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT ${caseListColumns()} FROM casos
      WHERE reportado_por_usr_id = $1
      ORDER BY creado_en DESC
    `, [req.auth.id]);
    res.json({ casos: rows.map(row => ({
      ...toPublicCase(row),
      motivoRechazo: row.motivo_rechazo
    })) });
  }));

  router.post('/casos', ...requireCitizen, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const requiredText = ['nombreCompleto', 'sexo', 'ciudad', 'departamento', 'descripcionFisica', 'vestimenta', 'fechaHoraDesaparicion'];
    if (requiredText.some(key => typeof body[key] !== 'string' || !body[key].trim())
      || !Number.isInteger(body.edad) || body.edad < 0 || body.edad > 120
      || !validCoordinates(Number(body.ubicacion?.lat), Number(body.ubicacion?.lng))
      || Number.isNaN(Date.parse(body.fechaHoraDesaparicion))
      || body.declaraMayorEdad !== true
      || body.avisoPrivacidadAceptado !== true
      || (body.edad < 18 && body.autorizacionParental !== true)) {
      return res.status(400).json({ error: 'Los datos del caso están incompletos o no son válidos.' });
    }
    const barrio = typeof body.barrio === 'string' ? body.barrio.trim() : '';
    if (!ubicacionValida(body.departamento, body.ciudad, barrio)) {
      return res.status(400).json({ error: 'Elegí un departamento, ciudad y barrio de la lista de Paraguay.' });
    }
    if (body.foto && (typeof body.foto !== 'string'
      || !IMAGE_DATA_URL.test(body.foto)
      || Buffer.byteLength(body.foto, 'utf8') > 10 * 1024 * 1024)) {
      return res.status(400).json({ error: 'La fotografía debe ser JPEG, PNG o WEBP y no superar 10 MB.' });
    }
    const denuncia = typeof body.numeroDenuncia === 'string' ? body.numeroDenuncia.trim() : '';
    const id = `cas_${randomUUID()}`;
    const created = await withTransaction(db, async client => {
      const { rows } = await client.query(`
        INSERT INTO casos (
          id, nombre_completo, edad, sexo, ciudad, departamento, barrio, descripcion_fisica, vestimenta,
          senas_particulares, fecha_hora_desaparicion, foto, latitud, longitud, direccion,
          numero_denuncia, estado, reportado_por_usr_id, proximo_seguimiento,
          reportante_mayor_edad, autorizacion_parental, aviso_privacidad_aceptado
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING *
      `, [
        id, body.nombreCompleto.trim(), Number(body.edad), body.sexo.trim(), body.ciudad.trim(),
        body.departamento.trim(), barrio, body.descripcionFisica.trim(), body.vestimenta.trim(), body.senasParticulares || '',
        body.fechaHoraDesaparicion, body.foto || '', Number(body.ubicacion.lat), Number(body.ubicacion.lng),
        body.ubicacion.direccion || body.ciudad, denuncia, 'PENDIENTE',
        req.auth.id, new Date(Date.now() + 48 * 60 * 60 * 1000),
        body.declaraMayorEdad, body.autorizacionParental === true, body.avisoPrivacidadAceptado
      ]);
      await client.query(
        'INSERT INTO suscripciones_caso (caso_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, req.auth.id]
      );
      await client.query(
        'INSERT INTO cambios_estado_caso (caso_id, estado_nuevo, cambiado_por) VALUES ($1, $2, $3)',
        [id, rows[0].estado, req.auth.id]
      );
      await client.query(`
        INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
        SELECT id, $1, 'Nuevo reporte para validar', $2, 'CASO_PENDIENTE'
        FROM usuarios WHERE rol = 'administrador'
      `, [id, `Se recibió un reporte de ${body.nombreCompleto.trim()} y espera validación.`]);
      return rows[0];
    });
    res.status(201).json({ caso: toPublicCase(created) });
  }));

<<<<<<< HEAD
  router.post('/casos/:id/pistas', clueSubmissionLimiter, requireUser, requireCitizen, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const photos = body.fotos === undefined ? [] : body.fotos;
    if (typeof body.descripcion !== 'string' || !body.descripcion.trim()
      || Number.isNaN(Date.parse(body.fechaHoraAvistamiento))
      || !validCoordinates(Number(body.ubicacion?.lat), Number(body.ubicacion?.lng))
      || !Array.isArray(photos)
      || photos.length > 3
      || photos.some(photo => typeof photo !== 'string'
        || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)
        || Buffer.byteLength(photo, 'utf8') > 4 * 1024 * 1024)
      || Buffer.byteLength(photos.join(''), 'utf8') > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Los datos de la pista están incompletos o no son válidos.' });
    }
    const result = await withTransaction(db, async client => {
      const { rows: cases } = await client.query(`
        SELECT * FROM casos WHERE id = $2 AND ${PUBLIC_CASE_FILTER}
          AND estado NOT IN ('CERRADO', 'RECHAZADO', 'LOCALIZADO') FOR UPDATE
      `, [...caseVisibilityParameters(), req.params.id]);
      if (!cases[0]) return null;
      const id = `pst_${randomUUID()}`;
      await client.query(`
        INSERT INTO pistas (
          id, caso_id, usuario_id, descripcion, fecha_hora_avistamiento, latitud, longitud, direccion, fotos
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [id, req.params.id, req.auth?.id || null, body.descripcion.trim(), body.fechaHoraAvistamiento,
        Number(body.ubicacion.lat), Number(body.ubicacion.lng), body.ubicacion.direccion || '', photos]);
      if (req.auth?.id) {
        await client.query(
          'INSERT INTO suscripciones_caso (caso_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.params.id, req.auth.id]
        );
      }
      await client.query(`
        INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
        SELECT id, $1, 'Nueva pista recibida', $2, 'PISTA_RECIBIDA'
        FROM usuarios WHERE rol IN ('administrador', 'ADMINISTRADOR')
      `, [req.params.id, 'Se recibió una nueva pista vinculada al caso.']);
      return id;
    });
    if (!result) return res.status(404).json({ error: 'Caso no disponible' });
    res.status(201).json({ id: result, mensaje: 'Pista ingresada correctamente.' });
  }));

  router.post('/admin/pistas/:id/estado', ...requireAdmin, asyncRoute(async (req, res) => {
    const state = req.body?.estado;
    const reason = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!['VALIDADA', 'RECHAZADA'].includes(state)) {
      return res.status(400).json({ error: 'El estado de moderación no es válido.' });
    }
    if (state === 'RECHAZADA' && !reason) {
      return res.status(400).json({ error: 'Debe indicar el motivo del rechazo de la pista.' });
    }
    const moderated = await withTransaction(db, async client => {
      const { rows } = await client.query('SELECT * FROM pistas WHERE id = $1 FOR UPDATE', [req.params.id]);
      const current = rows[0];
      if (!current) return null;
      const { rows: updatedRows } = await client.query(
        'UPDATE pistas SET estado = $2 WHERE id = $1 RETURNING *',
        [req.params.id, state]
      );
      if (current.estado !== state) {
        await client.query(`
          INSERT INTO cambios_estado_pista (pista_id, estado_anterior, estado_nuevo, motivo, cambiado_por)
          VALUES ($1, $2, $3, $4, $5)
        `, [req.params.id, current.estado, state, reason || null, req.auth.id]);
      }
      if (state === 'VALIDADA') {
        await client.query(`
          INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
          SELECT usuario_id, $1, 'Pista validada', 'Una pista ciudadana fue revisada y agregada al caso.', 'PISTA_VALIDADA'
          FROM suscripciones_caso WHERE caso_id = $1
        `, [current.caso_id]);
      }
      return updatedRows[0];
    });
    if (!moderated) return res.status(404).json({ error: 'La pista ya no está disponible.' });
    res.json({ id: moderated.id, estado: moderated.estado });
  }));

  router.post('/casos/:id/seguimiento', requireUser, asyncRoute(async (req, res) => {
=======
  router.post('/casos/:id/seguimiento', ...requireCitizen, asyncRoute(async (req, res) => {
>>>>>>> ebd8324ad118c5c0353876d1451c3c8ec9f26afe
    const action = req.body?.accion;
    const reason = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!['SIGUE_ACTIVA', 'LOCALIZADO', 'PRORROGA', 'CERRAR'].includes(action)) {
      return res.status(400).json({ error: 'La respuesta de seguimiento no es válida.' });
    }
    if (action === 'CERRAR' && !reason) {
      return res.status(400).json({ error: 'Debe justificar el cierre del caso.' });
    }

    const updated = await withTransaction(db, async client => {
      const { rows } = await client.query(`
        SELECT * FROM casos
        WHERE id = $1 AND reportado_por_usr_id = $2
        FOR UPDATE
      `, [req.params.id, req.auth.id]);
      const current = rows[0];
      if (!current || !['VALIDADO', 'EN_SEGUIMIENTO'].includes(current.estado)) return null;

      const state = action === 'LOCALIZADO' ? 'LOCALIZADO'
        : action === 'CERRAR' ? 'CERRADO' : 'VALIDADO';
      const { rows: updatedRows } = await client.query(`
        UPDATE casos SET estado = $2,
          localizado_en = CASE WHEN $2 = 'LOCALIZADO' THEN CURRENT_TIMESTAMP ELSE NULL END,
          motivo_cierre = CASE WHEN $2 = 'CERRADO' THEN $3 ELSE motivo_cierre END,
          seguimiento_etapa = CASE WHEN $2 IN ('LOCALIZADO', 'CERRADO') THEN 2 ELSE 0 END,
          proximo_seguimiento = CASE
            WHEN $2 IN ('LOCALIZADO', 'CERRADO') THEN NULL
            WHEN $4 = 'PRORROGA' THEN CURRENT_TIMESTAMP + INTERVAL '24 hours'
            ELSE CURRENT_TIMESTAMP + INTERVAL '48 hours'
          END
        WHERE id = $1 RETURNING *
      `, [req.params.id, state, reason || null, action]);

      if (current.estado !== state) {
        await client.query(`
          INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo, cambiado_por)
          VALUES ($1, $2, $3, $4)
        `, [req.params.id, current.estado, state, req.auth.id]);
      }
      if (state === 'LOCALIZADO') {
        await client.query(`
          INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
          SELECT usuario_id, $1, 'Caso resuelto', $2, 'CASO_LOCALIZADO'
          FROM suscripciones_caso WHERE caso_id = $1
        `, [req.params.id, `El familiar informó que ${current.nombre_completo} fue localizado.`]);
      }
      return updatedRows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Caso no disponible para seguimiento.' });
    res.json({ caso: toPublicCase(updated) });
  }));

<<<<<<< HEAD
  router.get('/notificaciones', requireUser, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT id, caso_id, titulo, mensaje, tipo, leida, creada_en
      FROM notificaciones WHERE usuario_id = $1 ORDER BY creada_en DESC LIMIT 100
    `, [req.auth.id]);
    res.json({ notificaciones: rows.map(row => ({
      id: row.id,
      casoId: row.caso_id,
      titulo: row.titulo,
      mensaje: row.mensaje,
      tipo: row.tipo,
      leida: row.leida,
      fecha: row.creada_en
    })) });
  }));

  router.post('/notificaciones/leidas', requireUser, asyncRoute(async (req, res) => {
    await db.query(
      'UPDATE notificaciones SET leida = TRUE WHERE usuario_id = $1',
      [req.auth.id]
    );
    res.json({ mensaje: 'Notificaciones marcadas como leídas.' });
  }));

  router.get('/estadisticas', asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO')) AS total,
        COUNT(*) FILTER (WHERE estado IN ('LOCALIZADO', 'CERRADO')) AS encontrados,
        COUNT(*) FILTER (WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO')) AS activos,
        COUNT(*) FILTER (WHERE estado = 'LOCALIZADO') AS localizados,
        COUNT(*) FILTER (WHERE estado = 'CERRADO') AS cerrados
      FROM casos
    `);
    const [porMes, porCiudad, porSexo, porEdad, casosPorCiudad, casosPorEdad, casosPorEstado, casosPorDepartamento] = await Promise.all([
      db.query(`SELECT TO_CHAR(DATE_TRUNC('month', localizado_en), 'YYYY-MM') AS periodo, COUNT(*) AS total
        FROM casos WHERE estado = 'LOCALIZADO' GROUP BY 1 ORDER BY 1`),
      db.query(`SELECT ciudad AS categoria, COUNT(*) AS total FROM casos
        WHERE estado = 'LOCALIZADO' GROUP BY ciudad ORDER BY total DESC`),
      db.query(`SELECT sexo AS categoria, COUNT(*) AS total FROM casos
        WHERE estado = 'LOCALIZADO' GROUP BY sexo ORDER BY sexo`),
      db.query(`SELECT CASE WHEN edad < 18 THEN '0-17' WHEN edad < 30 THEN '18-29'
        WHEN edad < 60 THEN '30-59' ELSE '60+' END AS categoria, COUNT(*) AS total
        FROM casos WHERE estado = 'LOCALIZADO' GROUP BY 1 ORDER BY 1`),
      db.query(`SELECT ciudad AS categoria, departamento, COUNT(*) AS total
        FROM casos
        WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO')
        GROUP BY ciudad, departamento ORDER BY total DESC, ciudad`),
      db.query(`SELECT CASE
          WHEN edad BETWEEN 0 AND 11 THEN 'Niñez (0–11)'
          WHEN edad BETWEEN 12 AND 17 THEN 'Adolescentes (12–17)'
          WHEN edad BETWEEN 18 AND 64 THEN 'Adultos (18–64)'
          ELSE 'Mayores (65+)'
        END AS categoria, COUNT(*) AS total
        FROM casos
        WHERE edad >= 0 AND estado IN ('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO')
        GROUP BY 1
        ORDER BY MIN(edad)`),
      db.query(`SELECT CASE estado
          WHEN 'VALIDADO' THEN 'Búsqueda activa'
          WHEN 'LOCALIZADO' THEN 'Localizada'
          WHEN 'EN_SEGUIMIENTO' THEN 'En seguimiento'
          WHEN 'CERRADO' THEN 'Cerrado'
        END AS categoria, COUNT(*) AS total
        FROM casos
        WHERE estado IN ('VALIDADO', 'LOCALIZADO', 'EN_SEGUIMIENTO', 'CERRADO')
        GROUP BY estado
        ORDER BY CASE estado
          WHEN 'VALIDADO' THEN 1
          WHEN 'LOCALIZADO' THEN 2
          WHEN 'EN_SEGUIMIENTO' THEN 3
          WHEN 'CERRADO' THEN 4
        END`),
      db.query(`SELECT departamento AS categoria, COUNT(*) AS total
        FROM casos
        WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO')
        GROUP BY departamento ORDER BY total DESC, departamento`)
    ]);
    res.json({
      ...rows[0],
      porcentajeResueltos: Number(rows[0].total) ? Math.round(Number(rows[0].encontrados) / Number(rows[0].total) * 100) : 0,
      porMes: porMes.rows, porCiudad: porCiudad.rows, porSexo: porSexo.rows, porEdad: porEdad.rows,
      casosPorCiudad: casosPorCiudad.rows, casosPorEdad: casosPorEdad.rows,
      casosPorEstado: casosPorEstado.rows, casosPorDepartamento: casosPorDepartamento.rows
    });
  }));

  router.get('/admin/casos', ...requireAdmin, asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT c.*, u.correo AS contacto_reportante
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      ORDER BY c.creado_en DESC
    `);
    res.json({ casos: rows.map(toAdminCase) });
  }));

  router.get('/admin/auditoria', ...requireAdmin, asyncRoute(async (_req, res) => {
    const { rows } = await db.query(`
      SELECT h.cambiado_en AS fecha, 'Caso' AS tipo_registro,
        c.nombre_completo AS persona, h.estado_anterior, h.estado_nuevo,
        a.nombre_completo AS administrador, h.cambiado_por AS administrador_id, h.motivo
      FROM cambios_estado_caso h
      JOIN casos c ON c.id = h.caso_id
      LEFT JOIN usuarios a ON a.id = h.cambiado_por
      UNION ALL
      SELECT h.cambiado_en AS fecha, 'Pista' AS tipo_registro,
        c.nombre_completo AS persona, h.estado_anterior, h.estado_nuevo,
        a.nombre_completo AS administrador, h.cambiado_por AS administrador_id, h.motivo
      FROM cambios_estado_pista h
      JOIN pistas p ON p.id = h.pista_id
      JOIN casos c ON c.id = p.caso_id
      LEFT JOIN usuarios a ON a.id = h.cambiado_por
      ORDER BY fecha DESC
      LIMIT 100
    `);
    res.json({ eventos: rows.map(row => ({
      fecha: row.fecha,
      tipoRegistro: row.tipo_registro,
      persona: row.persona,
      estadoAnterior: row.estado_anterior,
      estadoNuevo: row.estado_nuevo,
      administrador: row.administrador,
      administradorId: row.administrador_id,
      motivo: row.motivo
    })) });
  }));

  router.get('/admin/casos/:id/foto', ...requireAdmin, asyncRoute((req, res) => sendStoredPhoto(db, req, res, true)));

  router.get('/admin/historial-localizados', ...requireAdmin, asyncRoute(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const search = typeof req.query.q === 'string' ? `%${req.query.q.trim()}%` : '%%';
    const from = typeof req.query.desde === 'string' ? req.query.desde : null;
    const to = typeof req.query.hasta === 'string' ? req.query.hasta : null;
    if (!validDateFilter(from) || !validDateFilter(to)
      || (from && to && from > to)) {
      return res.status(400).json({ error: 'El rango de fechas no es válido.' });
    }
    const values = [search, from, to, limit, offset];
    const result = await db.query(`
      SELECT c.*, u.correo AS contacto_reportante,
        (SELECT COALESCE(json_agg(json_build_object(
          'id', p.id, 'descripcion', p.descripcion, 'usuarioId', p.usuario_id,
          'nombreUsuario', pu.nombre_completo, 'correoUsuario', pu.correo,
          'fechaHoraAvistamiento', p.fecha_hora_avistamiento,
          'ubicacion', json_build_object('lat', p.latitud, 'lng', p.longitud, 'direccion', p.direccion),
          'fechaEnvio', p.fecha_envio
        ) ORDER BY p.fecha_envio DESC), '[]'::json) FROM pistas p
          LEFT JOIN usuarios pu ON pu.id = p.usuario_id WHERE p.caso_id = c.id) AS pistas,
        (SELECT COALESCE(json_agg(json_build_object(
          'estadoAnterior', h.estado_anterior, 'estadoNuevo', h.estado_nuevo,
          'cambiadoPor', h.cambiado_por, 'cambiadoEn', h.cambiado_en,
          'nombreAdministrador', a.nombre_completo
        ) ORDER BY h.cambiado_en), '[]'::json) FROM cambios_estado_caso h
          LEFT JOIN usuarios a ON a.id = h.cambiado_por WHERE h.caso_id = c.id) AS cambios_estado,
        COUNT(*) OVER() AS total_registros
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      WHERE c.estado = 'LOCALIZADO'
        AND ($1 = '%%' OR c.nombre_completo ILIKE $1 OR c.ciudad ILIKE $1)
        AND ($2::date IS NULL OR c.localizado_en >= $2::date)
        AND ($3::date IS NULL OR c.localizado_en < $3::date + INTERVAL '1 day')
      ORDER BY c.localizado_en DESC LIMIT $4 OFFSET $5
    `, values);
    res.json({
      casos: result.rows.map(toAdminCase),
      pagina: page,
      limite: limit,
      total: Number(result.rows[0]?.total_registros || 0)
    });
  }));

  router.get('/admin/historial-localizados/:id', ...requireAdmin, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`
      SELECT c.*, u.correo AS contacto_reportante,
        (SELECT COALESCE(json_agg(json_build_object(
          'id', p.id, 'descripcion', p.descripcion, 'usuarioId', p.usuario_id,
          'nombreUsuario', pu.nombre_completo, 'correoUsuario', pu.correo,
          'fechaHoraAvistamiento', p.fecha_hora_avistamiento,
          'ubicacion', json_build_object('lat', p.latitud, 'lng', p.longitud, 'direccion', p.direccion),
          'fechaEnvio', p.fecha_envio
        ) ORDER BY p.fecha_envio DESC), '[]'::json) FROM pistas p
          LEFT JOIN usuarios pu ON pu.id = p.usuario_id WHERE p.caso_id = c.id) AS pistas,
        (SELECT COALESCE(json_agg(json_build_object(
          'estadoAnterior', h.estado_anterior, 'estadoNuevo', h.estado_nuevo,
          'cambiadoPor', h.cambiado_por, 'cambiadoEn', h.cambiado_en,
          'nombreAdministrador', a.nombre_completo
        ) ORDER BY h.cambiado_en), '[]'::json) FROM cambios_estado_caso h
          LEFT JOIN usuarios a ON a.id = h.cambiado_por WHERE h.caso_id = c.id) AS cambios_estado
      FROM casos c LEFT JOIN usuarios u ON u.id = c.reportado_por_usr_id
      WHERE c.id = $1 AND c.estado = 'LOCALIZADO'
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caso no disponible' });
    res.json({ caso: toAdminCase(rows[0]) });
  }));

  router.post('/admin/casos/:id/estado', ...requireAdmin, asyncRoute(async (req, res) => {
    const state = req.body?.estado;
    if (!['PENDIENTE', 'VALIDADO', 'EN_SEGUIMIENTO', 'LOCALIZADO', 'CERRADO', 'RECHAZADO'].includes(state)) {
      return res.status(400).json({ error: 'El estado solicitado no es válido.' });
    }
    if (state === 'RECHAZADO' && (typeof req.body?.motivo !== 'string' || !req.body.motivo.trim())) {
      return res.status(400).json({ error: 'Debe indicar el motivo del rechazo.' });
    }
    if (state === 'VALIDADO'
      && (typeof req.body?.numeroDenuncia !== 'string' || !req.body.numeroDenuncia.trim())) {
      return res.status(400).json({ error: 'Debe registrar el número oficial de denuncia.' });
    }
    if (state === 'VALIDADO' && [
      'verificoDenuncia',
      'datosCoherentes',
      'duplicadosVerificados',
      'menorValidado'
    ].some(key => req.body?.[key] !== true)) {
      return res.status(400).json({ error: 'Debe completar toda la lista de validación antes de publicar el caso.' });
    }
    if (state === 'CERRADO' && (typeof req.body?.motivo !== 'string' || !req.body.motivo.trim())) {
      return res.status(400).json({ error: 'Debe indicar la justificación para cerrar el caso.' });
    }
    const updated = await withTransaction(db, async client => {
      const { rows } = await client.query('SELECT * FROM casos WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) return null;
      const current = rows[0];
      if (current.estado === state) return current;
      const { rows: updatedRows } = await client.query(`
        UPDATE casos SET estado = $2,
          localizado_en = CASE WHEN $2 = 'LOCALIZADO' THEN CURRENT_TIMESTAMP ELSE NULL END,
          motivo_rechazo = CASE WHEN $2 = 'RECHAZADO' THEN $3 ELSE motivo_rechazo END,
          motivo_cierre = CASE WHEN $2 = 'CERRADO' THEN $3 ELSE motivo_cierre END,
          numero_denuncia = CASE WHEN $2 = 'VALIDADO' AND $4 <> '' THEN $4 ELSE numero_denuncia END,
          checklist_denuncia = CASE WHEN $2 = 'VALIDADO' THEN $5 ELSE checklist_denuncia END,
          checklist_coherencia = CASE WHEN $2 = 'VALIDADO' THEN $6 ELSE checklist_coherencia END,
          checklist_duplicados = CASE WHEN $2 = 'VALIDADO' THEN $7 ELSE checklist_duplicados END,
          checklist_menores = CASE WHEN $2 = 'VALIDADO' THEN $8 ELSE checklist_menores END,
          proximo_seguimiento = CASE
            WHEN $2 IN ('VALIDADO', 'EN_SEGUIMIENTO')
              AND $9 NOT IN ('VALIDADO', 'EN_SEGUIMIENTO')
              THEN CURRENT_TIMESTAMP + INTERVAL '48 hours'
            WHEN $2 IN ('LOCALIZADO', 'CERRADO', 'RECHAZADO', 'PENDIENTE') THEN NULL
            ELSE proximo_seguimiento
          END,
          seguimiento_etapa = CASE
            WHEN $2 IN ('VALIDADO', 'EN_SEGUIMIENTO')
              AND $9 NOT IN ('VALIDADO', 'EN_SEGUIMIENTO') THEN 0
            WHEN $2 IN ('LOCALIZADO', 'CERRADO', 'RECHAZADO', 'PENDIENTE') THEN 2
            ELSE seguimiento_etapa
          END
        WHERE id = $1 RETURNING *
      `, [
        req.params.id, state, req.body?.motivo || null, req.body?.numeroDenuncia || '',
        req.body?.verificoDenuncia === true, req.body?.datosCoherentes === true,
        req.body?.duplicadosVerificados === true, req.body?.menorValidado === true,
        current.estado
      ]);
      await client.query(`
        INSERT INTO cambios_estado_caso (caso_id, estado_anterior, estado_nuevo, cambiado_por, motivo)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        req.params.id, current.estado, state, req.auth.id,
        typeof req.body?.motivo === 'string' && req.body.motivo.trim()
          ? req.body.motivo.trim()
          : null
      ]);
      if (current.reportado_por_usr_id) {
        const caseName = current.nombre_completo;
        const reason = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
        const transition = state === 'VALIDADO'
          ? ['Reporte aprobado', `El reporte de ${caseName} fue aprobado y publicado.`, 'CASO_VALIDADO']
          : state === 'PENDIENTE'
            ? ['Reporte devuelto a revisión', `El reporte de ${caseName} volvió a revisión.${reason ? ` Observación: ${reason}` : ''}`, 'CASO_REVISION']
            : state === 'RECHAZADO'
              ? ['Reporte rechazado', `El reporte de ${caseName} fue rechazado: ${reason}`, 'CASO_RECHAZADO']
              : state === 'EN_SEGUIMIENTO'
                ? ['Seguimiento actualizado', `El caso de ${caseName} pasó a seguimiento.`, 'CASO_SEGUIMIENTO']
                : state === 'CERRADO'
                  ? ['Caso cerrado', `El caso de ${caseName} fue cerrado: ${reason}`, 'CASO_CERRADO']
                  : null;
        if (transition) {
          await client.query(`
            INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
            VALUES ($1, $2, $3, $4, $5)
          `, [current.reportado_por_usr_id, req.params.id, ...transition]);
        }
      }
      if (state === 'LOCALIZADO') {
        await client.query(`
          INSERT INTO notificaciones (usuario_id, caso_id, titulo, mensaje, tipo)
          SELECT usuario_id, $1, 'Caso resuelto', $2, 'CASO_LOCALIZADO'
          FROM suscripciones_caso WHERE caso_id = $1
        `, [req.params.id, `El caso de ${current.nombre_completo} fue resuelto: la persona fue localizada.`]);
      }
      return updatedRows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Caso no disponible' });
    res.json({ caso: toPublicCase(updated) });
  }));

  router.post('/admin/simulador/avanzar-48h', ...requireAdmin, asyncRoute(async (_req, res) => {
    await db.query(`
      UPDATE casos SET proximo_seguimiento = CURRENT_TIMESTAMP - INTERVAL '1 second'
      WHERE estado IN ('VALIDADO', 'EN_SEGUIMIENTO')
        AND seguimiento_etapa IN (0, 1)
        AND proximo_seguimiento IS NOT NULL
    `);
    const result = { consultasEnviadas: 0, casosEnSeguimiento: 0 };
    let batch;
    do {
      batch = await processDueFollowups(db);
      result.consultasEnviadas += batch.consultasEnviadas;
      result.casosEnSeguimiento += batch.casosEnSeguimiento;
    } while (batch.consultasEnviadas + batch.casosEnSeguimiento === 50);
    res.json({ mensaje: 'Simulación completada.', ...result });
  }));
=======
  const shared = { db, requireUser, requireAdmin, requireCitizen };
  router.use(createClueRouter(shared));
  router.use(createNotificationRouter(shared));
  router.use(createStatsRouter(shared));
  router.use(createAdminRouter(shared));
>>>>>>> ebd8324ad118c5c0353876d1451c3c8ec9f26afe

  return router;
}
