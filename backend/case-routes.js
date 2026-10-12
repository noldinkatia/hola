import express from 'express';
import { randomUUID } from 'node:crypto';
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
  // La cuenta de administrador es institucional: no reporta ni sigue casos
  // propios (ROLES_Y_PERMISOS.txt, tabla de permisos).
  const requireCitizen = [requireUser, (req, res, next) => {
    if (isAdministrator(req.auth)) {
      return res.status(403).json({ error: 'La cuenta de administrador no reporta ni sigue casos propios.' });
    }
    next();
  }];

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
      WHERE id = $2 AND${PUBLIC_CASE_FILTER} AND estado <> 'RECHAZADO'
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
        ) VALUES ($1, $2, $3, $4, $5