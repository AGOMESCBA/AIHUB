const express = require('express');
const http = require('http');
const router = express.Router();
const { requireAuth } = require('../../../modules/auth');
const { requireEmpresa } = require('../../../modules/empresa-context');
const { requireSystemAccess } = require('../../../modules/sistemas/access');
const serviceManager = require('./service-manager');

const FASTAPI_BASE_URL = process.env.FASTAPI_BASE_URL || serviceManager.getInternalApiBaseUrl();

function resolveCompanyId(req) {
  return req.system?.company_id
    || req.query?.empresa_id
    || req.body?.empresa_id
    || req.session?.empresa_id
    || req.session?.empresaId
    || '';
}

router.use(requireAuth);
router.use(requireEmpresa);
router.use(requireSystemAccess('master-crypto'));

router.get('/__status', async (_req, res) => {
  const healthy = await serviceManager.healthCheck(1000);
  res.json({
    ...serviceManager.getStatus(),
    healthy,
    publicBaseUrl: '/api/master-crypto',
  });
});

router.all('/*', (req, res) => {
  const targetPath = req.params[0] || '';
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = new URL(`${FASTAPI_BASE_URL}/${targetPath}${queryString}`);

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 8000,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.host,
      'x-iahub-company-id': resolveCompanyId(req),
      'x-iahub-user-id': req.session?.user_id || req.session?.usuarioId || '',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    Object.keys(proxyRes.headers).forEach((key) => {
      res.setHeader(key, proxyRes.headers[key]);
    });
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({
      error: 'Falha na comunicacao com o motor Python do Master Crypto',
      detail: err.message,
    });
  });

  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    const bodyData = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Type', 'application/json');
    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
    proxyReq.write(bodyData);
  }

  proxyReq.end();
});

module.exports = router;
