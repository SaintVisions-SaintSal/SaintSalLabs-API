/**
 * CorpNet Business Formation & Tax Registration API
 * SaintSal™ Labs — Powered by HACP™ · US Patent #10,290,222
 *
 * Endpoints:
 *   Business Formation (Business Filing)
 *   GET  /api/corpnet/packages             - Available formation packages by state/entity
 *   POST /api/corpnet/create-order         - Submit new business formation order
 *   GET  /api/corpnet/order/:orderGuid     - Full order details
 *   GET  /api/corpnet/order-summary/:orderId - Order summary + products
 *   PATCH /api/corpnet/update-order/:orderGuid - Update order (RFI response)
 *   POST /api/corpnet/cancel-order/:orderGuid  - Cancel order
 *   GET  /api/corpnet/documents/:orderGuid     - Download order document
 *   POST /api/corpnet/documents/upload         - Upload document
 *
 *   Tax Registration (50-State)
 *   POST /api/corpnet/tax-reg              - Create tax registration order
 *   GET  /api/corpnet/tax-reg/:orderGuid   - Get tax registration status
 */

const express = require('express');
const router = express.Router();

// ─── Environment / Config ──────────────────────────────────────────────────────
const CORPNET_ENV = process.env.CORPNET_ENV || 'staging'; // 'staging' | 'production'

const CORPNET_BASE_URL = CORPNET_ENV === 'production'
  ? 'https://api.corpnet.com'
  : 'https://api.staging24.corpnet.com';

const CORPNET_TAX_BASE_URL = CORPNET_ENV === 'production'
  ? 'https://api.corpnet.com'
  : 'https://staging22api.corpnet.com';

const CORPNET_BEARER_TOKEN = process.env.CORPNET_BEARER_TOKEN
  || '0D3DB6A514DAED0CEF4F97D71DC9292BA84C895FE25A4EB34D09CDF4F2242F95DB554C9C88D3044F5A05F67457B4F82C44F6';

const CORPNET_API_KEY = process.env.CORPNET_API_KEY || '7E90-738C-175F-41BD-886C';

// ─── Helper: Build headers ────────────────────────────────────────────────────
function corpnetHeaders() {
  return {
    'Authorization': `Bearer ${CORPNET_BEARER_TOKEN}`,
    'token': CORPNET_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

// ─── Helper: Proxy request ────────────────────────────────────────────────────
async function corpnetRequest(method, url, body = null) {
  const options = {
    method,
    headers: corpnetHeaders(),
  };
  if (body) options.body = JSON.stringify(body);

  console.log(`[CorpNet] ${method} ${url}`);
  const response = await fetch(url, options);

  // Handle non-JSON (e.g. binary document downloads)
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const buffer = await response.arrayBuffer();
    return { binary: true, buffer, contentType, status: response.status };
  }

  const data = await response.json();
  return { binary: false, data, status: response.status };
}

// ─── Status route ─────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    success: true,
    service: 'CorpNet Business Formation API',
    environment: CORPNET_ENV,
    baseUrl: CORPNET_BASE_URL,
    taxBaseUrl: CORPNET_TAX_BASE_URL,
    endpoints: [
      'GET  /api/corpnet/packages?entityType=LLC&state=CA',
      'POST /api/corpnet/create-order',
      'GET  /api/corpnet/order/:orderGuid',
      'GET  /api/corpnet/order-summary/:orderId',
      'PATCH /api/corpnet/update-order/:orderGuid',
      'POST /api/corpnet/cancel-order/:orderGuid',
      'GET  /api/corpnet/documents/:orderGuid',
      'POST /api/corpnet/documents/upload',
      'POST /api/corpnet/tax-reg',
      'GET  /api/corpnet/tax-reg/:orderGuid',
    ],
  });
});

// ─── Business Formation ────────────────────────────────────────────────────────

/**
 * GET /api/corpnet/packages
 * Query: ?entityType=LLC&state=CA
 * Returns available formation packages with pricing
 */
router.get('/packages', async (req, res) => {
  const { entityType = 'LLC', state = 'CA', filingOption } = req.query;
  if (!entityType || !state) {
    return res.status(400).json({ success: false, error: 'entityType and state are required' });
  }

  try {
    let url = `${CORPNET_BASE_URL}/api/business-formation-v2/package?entityType=${encodeURIComponent(entityType)}&state=${encodeURIComponent(state)}`;
    if (filingOption) url += `&filingOption=${encodeURIComponent(filingOption)}`;

    const result = await corpnetRequest('GET', url);
    if (result.binary) return res.status(result.status).json({ success: false, error: 'Unexpected binary response' });

    res.status(result.status).json({ success: result.status === 200, ...result.data });
  } catch (err) {
    console.error('[CorpNet packages]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/corpnet/create-order
 * Body: { partnerOrder: { ... } }
 * Creates a new business formation order
 */
router.post('/create-order', async (req, res) => {
  const { partnerOrder } = req.body;
  if (!partnerOrder) {
    return res.status(400).json({ success: false, error: 'partnerOrder object is required' });
  }

  try {
    const result = await corpnetRequest(
      'POST',
      `${CORPNET_BASE_URL}/api/business-formation-v2/create-order`,
      { partnerOrder }
    );

    if (result.binary) return res.status(result.status).json({ success: false, error: 'Unexpected binary response' });
    res.status(result.status).json({ success: result.status === 201 || result.status === 200, ...result.data });
  } catch (err) {
    console.error('[CorpNet create-order]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/corpnet/order/:orderGuid
 * Full order details including status, contacts, tasks
 */
router.get('/order/:orderGuid', async (req, res) => {
  const { orderGuid } = req.params;
  try {
    const result = await corpnetRequest(
      'GET',
      `${CORPNET_BASE_URL}/api/business-formation-v2/get-order/${orderGuid}`
    );

    if (result.binary) return res.status(result.status).json({ success: false, error: 'Unexpected binary response' });
    res.status(result.status).json({ success: result.status === 200, ...result.data });
  } catch (err) {
    console.error('[CorpNet get-order]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/corpnet/order-summary/:orderId
 * Order summary with total and products list
 */
router.get('/order-summary/:orderId', async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await corpnetRequest(
      'GET',
      `${CORPNET_BASE_URL}/api/business-formation-v2/order-summary/${orderId}`
    );

    if (result.binary) return res.status(result.status).json({ success: false, error: 'Unexpected binary response' });
    res.status(result.status).json({ success: result.status === 200, ...result.data });
  } catch (err) {
    console.error('[CorpNet order-summary]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/corpnet/update-order/:orderGuid
 * Body: { taskId, apiUserPid, business: { ... } }
 * Update order in response to an RFI
 */
router.patch('/update-order/:orderGuid', async (req, res) => {
  const { orderGuid } = req.params;
  const { taskId, apiUserPid, business } = req.body;

  if (!taskId || !apiUserPid || !business) {
    return res.status(400).json({ success: false, error: 'taskId, apiUserPid, and business are required' });
  }

  try {
    const result = await corpnetRequest(
      'PATCH',
      `${CORPNET_BASE_URL}/api/business-formation/update-order-v1/${orderGuid}`,
      { taskId, apiUserPid, business }
    );

    if (result.binary) return res.status(result.status).json({ success: false, error: 'Unexpected binary response' });
    res.status(result.status).json({ success: result.status === 200, ...result.data });
  } catch (err) {
    console.error('[CorpNet update-order]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/corpnet/cancel-order/:orderGuid
 * Cancels a business formation order (irreversible)
 */
router.post('/cancel-order/:orderGuid', async (req, res) => {
  const { orderGuid } = req.params;
  try {
    const result = await corpnetRequest(
      'POST',
      `${CORPNET_BASE_URL}/api/business-formation/order-cancellation-v1/${orderGuid}`
    );

    if (result.binary) return res.status(result.status).json({ success: false, error: 'Unexpected binary response' });
    res.status(result.status).json({ success: result.status === 200, ...result.data });
  } catch (err) {
    console.error('[CorpNet cancel-order]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/corpnet/documents/:orderGuid
 * Downloads the document for an order (returns binary/PDF)
 */
router.get('/documents/:orderGuid', async (req, res) => {
  const { orderGuid } = req.params;
  try {
    const result = await corpnetRequest(
      'GET',
      `${CORPNET_BASE_URL}/api/business-formation/download-order-document-v1?orderGuid=${orderGuid}`
    );

    if (result.binary) {
      res.setHeader('Content-Type', result.contentType || 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="order-${orderGuid}.pdf"`);
      return res.send(Buffer.from(result.buffer));
    }
    res.status(result.status).json({ success: result.status === 200, ...result.data });
  } catch (err) {
    console.error('[CorpNet documents]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/corpnet/documents/upload
 * Multipart upload of a document for an order
 * Body (form-data): orderId, file
 */
router.post('/documents/upload', async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ success: false, error: 'orderId is required' });

  try {
    // Forward raw multipart — note: requires multer or raw body passthrough
    // For now return instructions — full multipart proxy requires multer middleware
    res.json({
      success: false,
      error: 'Document upload requires multipart/form-data. Use the /documents/upload endpoint with orderId + file fields.',
      uploadUrl: `${CORPNET_BASE_URL}/api/business-formation/send-order-document-v1`,
      orderId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Tax Registration (50 States) ─────────────────────────────────────────────

/**
 * POST /api/corpnet/tax-reg
 * Body: { partnerOrder: { ... } }
 * Creates a 50-state tax registration order
 */
router.post('/tax-reg', async (req, res) => {
  const { partnerOrder } = req.body;
  if (!partnerOrder) {
    return res.status(400).json({ success: false, error: 'partnerOrder object is required' });
  }

  try {
    const result = await corpnetRequest(
      'POST',
      `${CORPNET_TAX_BASE_URL}/api/api-partners-v10/tax-reg-50states/`,
      { partnerOrder }
    );

    if (result.binary) return res.status(result.status).json({ success: false, error: 'Unexpected binary response' });
    res.status(result.status).json({ success: result.status === 201 || result.status === 200, ...result.data });
  } catch (err) {
    console.error('[CorpNet tax-reg]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/corpnet/tax-reg/:orderGuid
 * Retrieve tax registration order status, account numbers, tax rates
 */
router.get('/tax-reg/:orderGuid', async (req, res) => {
  const { orderGuid } = req.params;
  try {
    const result = await corpnetRequest(
      'GET',
      `${CORPNET_TAX_BASE_URL}/api/api-partners-v10/tax-reg-50states/${orderGuid}`
    );

    if (result.binary) return res.status(result.status).json({ success: false, error: 'Unexpected binary response' });
    res.status(result.status).json({ success: result.status === 200, ...result.data });
  } catch (err) {
    console.error('[CorpNet tax-reg get]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
