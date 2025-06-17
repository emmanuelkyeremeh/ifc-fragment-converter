import express from 'express';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const FRAGMENTS_DIR = path.join(__dirname, 'public', 'fragments');

// Middleware
app.use(cors());
app.use(fileUpload());
app.use(express.json());

// Log static file requests
app.use('/fragments', (req, res, next) => {
  console.log(`[STATIC] Request for: ${req.path}`);
  res.on('finish', () => {
    console.log(`[STATIC] Response for ${req.path}: Status ${res.statusCode}, Content-Type: ${res.get('Content-Type') || 'not set'}`);
  });
  if (req.path.endsWith('.frag')) {
    res.set('Content-Type', 'application/octet-stream');
  }
  next();
}, express.static(path.join(__dirname, 'public', 'fragments')));

// Ensure fragments directory exists
const ensureFragmentsDir = async () => {
  try {
    await fs.mkdir(FRAGMENTS_DIR, { recursive: true });
    console.log('[SERVER] Fragments directory ensured:', FRAGMENTS_DIR);
  } catch (error) {
    console.error('[SERVER] Error creating fragments directory:', error);
  }
};

// Generate SHA-256 hash from filename
const getFileHash = (filename) => {
  return createHash('sha256').update(filename).digest('hex');
};

// GET endpoint to check and retrieve .frag and .json files
app.get('/api/fragments/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const hash = getFileHash(filename);
    const fragPath = path.join(FRAGMENTS_DIR, `${hash}.frag`);
    const jsonPath = path.join(FRAGMENTS_DIR, `${hash}.json`);

    console.log(`[GET /api/fragments] Filename: ${filename}, Hash: ${hash}`);
    console.log(`[GET /api/fragments] Checking frag path: ${fragPath}`);
    console.log(`[GET /api/fragments] Checking json path: ${jsonPath}`);

    const fragStats = await fs.stat(fragPath).catch(() => null);
    const jsonStats = await fs.stat(jsonPath).catch(() => null);

    const fragExists = !!fragStats;
    const jsonExists = !!jsonStats;

    console.log(`[GET /api/fragments] Frag exists: ${fragExists}${fragExists ? `, Size: ${fragStats.size} bytes` : ''}`);
    console.log(`[GET /api/fragments] JSON exists: ${jsonExists}${jsonExists ? `, Size: ${jsonStats.size} bytes` : ''}`);

    if (fragExists && jsonExists) {
      const fragUrl = `/fragments/${hash}.frag`;
      const jsonUrl = `/fragments/${hash}.json`;
      console.log(`[GET /api/fragments] Returning: fragUrl=${fragUrl}, jsonUrl=${jsonUrl}`);
      res.json({
        success: true,
        fragUrl,
        jsonUrl,
      });
    } else {
      console.log('[GET /api/fragments] Files not found, returning success: false');
      res.json({ success: false });
    }
  } catch (error) {
    console.error('[GET /api/fragments] Error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST endpoint to save .frag and .json files
app.post('/api/fragments/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const hash = getFileHash(filename);
    const fragPath = path.join(FRAGMENTS_DIR, `${hash}.frag`);
    const jsonPath = path.join(FRAGMENTS_DIR, `${hash}.json`);

    console.log(`[POST /api/fragments] Filename: ${filename}, Hash: ${hash}`);
    console.log(`[POST /api/fragments] Saving to frag path: ${fragPath}`);
    console.log(`[POST /api/fragments] Saving to json path: ${jsonPath}`);

    if (!req.files || !req.files.fragFile || !req.files.jsonFile) {
      console.log('[POST /api/fragments] Missing files');
      return res.status(400).json({ success: false, error: 'Missing files' });
    }

    await ensureFragmentsDir();
    await fs.writeFile(fragPath, req.files.fragFile.data);
    await fs.writeFile(jsonPath, req.files.jsonFile.data);

    console.log(`[POST /api/fragments] Saved .frag: ${fragPath}, Size: ${req.files.fragFile.data.length} bytes`);
    console.log(`[POST /api/fragments] Saved .json: ${jsonPath}, Size: ${req.files.jsonFile.data.length} bytes`);

    res.json({
      success: true,
      fragUrl: `/fragments/${hash}.frag`,
      jsonUrl: `/fragments/${hash}.json`,
    });
  } catch (error) {
    console.error('[POST /api/fragments] Error saving fragments:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.listen(PORT, async () => {
  await ensureFragmentsDir();
  console.log(`[SERVER] Running on http://localhost:${PORT}`);
});