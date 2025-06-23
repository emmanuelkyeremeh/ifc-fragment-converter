import express from 'express';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as WEBIFC from 'web-ifc';
import * as OBC from '@thatopen/components';

// Define constants for file paths and server configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRAGMENTS_DIR = path.join(__dirname, 'public', 'fragments');
const PORT = 3000;
const WASM_PATH = path.resolve(__dirname, 'web-ifc');

// Initialize Express app
const app = express();

// Apply middleware for CORS, file uploads, and JSON parsing
app.use(cors());
app.use(fileUpload());
app.use(express.json());

// Serve static fragment files with correct Content-Type for .frag files
app.use('/fragments', (req, res, next) => {
  if (req.path.endsWith('.frag')) {
    res.set('Content-Type', 'application/octet-stream');
  }
  next();
}, express.static(FRAGMENTS_DIR));

/**
 * Ensures the fragments directory exists, creating it if necessary.
 * @returns {Promise<void>}
 */
async function ensureFragmentsDir() {
  await fs.mkdir(FRAGMENTS_DIR, { recursive: true });
}

/**
 * Initializes the IFC loader with predefined settings.
 * @returns {Promise<{fragmentIfcLoader: OBC.IfcLoader, components: OBC.Components}>}
 */
async function initIfcLoader() {
  const components = new OBC.Components();
  const fragmentIfcLoader = components.get(OBC.IfcLoader);
  fragmentIfcLoader.settings.wasm = {
    path: `${WASM_PATH}/`,
    absolute: true,
  };
  fragmentIfcLoader.settings.webIfc.COORDINATE_TO_ORIGIN = true;
  fragmentIfcLoader.settings.webIfc.OPTIMIZE_PROFILES = true;
  fragmentIfcLoader.settings.webIfc.CIRCLE_SEGMENTS = 12;
  fragmentIfcLoader.settings.webIfc.SPATIAL_INDEX = true;

  // Exclude specific IFC categories
  const excludedCats = [
    WEBIFC.IFCTENDONANCHOR,
    WEBIFC.IFCREINFORCINGBAR,
    WEBIFC.IFCREINFORCINGELEMENT,
  ];
  for (const cat of excludedCats) {
    fragmentIfcLoader.settings.excludedCategories.add(cat);
  }

  return { fragmentIfcLoader, components };
}

/**
 * Constructs file paths for fragment and JSON files based on the filename.
 * @param {string} filename - The original filename.
 * @returns {{fragPath: string, jsonPath: string, fragUrl: string, jsonUrl: string}}
 */
function getFilePaths(filename) {
  return {
    fragPath: path.join(FRAGMENTS_DIR, `${filename}.frag`),
    jsonPath: path.join(FRAGMENTS_DIR, `${filename}.json`),
    fragUrl: `/fragments/${filename}.frag`,
    jsonUrl: `/fragments/${filename}.json`,
  };
}

/**
 * Checks if fragment and JSON files exist for a given filename.
 * @param {string} fragPath - Path to the .frag file.
 * @param {string} jsonPath - Path to the .json file.
 * @returns {Promise<{fragExists: boolean, jsonExists: boolean}>}
 */
async function checkFilesExist(fragPath, jsonPath) {
  const [fragStats, jsonStats] = await Promise.all([
    fs.stat(fragPath).catch(() => null),
    fs.stat(jsonPath).catch(() => null),
  ]);
  return {
    fragExists: !!fragStats,
    jsonExists: !!jsonStats,
  };
}

/**
 * Fetches an IFC file from a given URL.
 * @param {string} url - The URL to the IFC file.
 * @returns {Promise<Uint8Array>} The file data as a Uint8Array.
 * @throws {Error} If the fetch fails or the response is not OK.
 */
async function fetchIfcFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch IFC file: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// GET endpoint to check and retrieve .frag and .json files
app.get('/api/fragments/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const { fragPath, jsonPath, fragUrl, jsonUrl } = getFilePaths(filename);
    const { fragExists, jsonExists } = await checkFilesExist(fragPath, jsonPath);

    if (fragExists && jsonExists) {
      res.json({ success: true, fragUrl, jsonUrl });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST endpoint to save .frag and .json files
app.post('/api/fragments/:filename', async (req, res) => {
  try {
    if (!req.files?.fragFile || !req.files?.jsonFile) {
      return res.status(400).json({ success: false, error: 'Missing files' });
    }

    const { filename } = req.params;
    const { fragPath, jsonPath, fragUrl, jsonUrl } = getFilePaths(filename);

    await ensureFragmentsDir();
    await Promise.all([
      fs.writeFile(fragPath, req.files.fragFile.data),
      fs.writeFile(jsonPath, req.files.jsonFile.data),
    ]);

    res.json({ success: true, fragUrl, jsonUrl });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST endpoint to convert IFC to .frag and .json using a URL
app.post('/api/convert-ifc', async (req, res) => {
  try {
    const { filename, ifcUrl } = req.body;
    if (!filename || !ifcUrl) {
      return res.status(400).json({ success: false, error: 'Missing filename or IFC URL' });
    }

    const { fragPath, jsonPath, fragUrl, jsonUrl } = getFilePaths(filename);

    // Check if files already exist
    const { fragExists, jsonExists } = await checkFilesExist(fragPath, jsonPath);
    if (fragExists && jsonExists) {
      return res.json({ success: true, fragUrl, jsonUrl });
    }

    // Fetch IFC file from S3 URL
    console.log("Downloading file from S3")
    const ifcData = await fetchIfcFile(ifcUrl);
    console.log("File Download from S3 complete")

    // Process IFC file
    const { fragmentIfcLoader, components } = await initIfcLoader();
    const model = await fragmentIfcLoader.load(ifcData);
    model.name = "ifc_bim";

    // Export fragments and properties
    const fragments = components.get(OBC.FragmentsManager);
    const fragData = fragments.export(model);
    const properties = model.getLocalProperties();

    // Save files
    await ensureFragmentsDir();
    await Promise.all([
      fs.writeFile(fragPath, fragData),
      fs.writeFile(jsonPath, JSON.stringify(properties)),
    ]);

    // Clean up resources
    fragments.dispose();
    components.dispose();

    res.json({ success: true, fragUrl, jsonUrl });
  } catch (error) {
    res.status(500).json({ success: false, error: `Server error during IFC conversion: ${error.message}` });
  }
});

// Start the server
app.listen(PORT, async () => {
  await ensureFragmentsDir();
});