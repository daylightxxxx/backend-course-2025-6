const express = require('express');
const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');

// --- 1. CLI Options ---
const program = new Command();
program
    .requiredOption('-h, --host <host>', 'Server host')
    .requiredOption('-p, --port <port>', 'Server port')
    .requiredOption('-c, --cache <path>', 'Cache directory path');

program.parse(process.argv);
const options = program.opts();

// --- 2. Prepare Cache Folder ---
const cacheDir = path.resolve(options.cache);
const dbFile = path.join(cacheDir, 'inventory.json');

if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify([]));

// --- 3. Express ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Upload storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, cacheDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- 4. Swagger ---
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Inventory API',
            version: '1.0.0'
        }
    },
    apis: ['main.js']
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// --- Helper functions ---
const readInv = () => {
    try { return JSON.parse(fs.readFileSync(dbFile)); }
    catch { return []; }
};

const writeInv = (data) => {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
};

// --- Routes ---

/**
 * @openapi
 * /inventory:
 *   get:
 *     summary: Get all items
 *     responses:
 *       200:
 *         description: Success
 */
app.get('/inventory', (req, res) => {
    res.json(readInv());
});

/**
 * @openapi
 * /inventory/{id}:
 *   get:
 *     summary: Get item by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Found
 *       404:
 *         description: Not found
 */
app.get('/inventory/:id', (req, res) => {
    const item = readInv().find(i => i.id == req.params.id);
    item ? res.json(item) : res.status(404).json({ error: 'Not found' });
});

// Get photo
app.get('/inventory/:id/photo', (req, res) => {
    const item = readInv().find(i => i.id == req.params.id);
    if (!item || !item.photo) return res.status(404).json({ error: 'No photo' });
    if (!fs.existsSync(item.photo)) return res.status(404).json({ error: 'File missing' });

    res.sendFile(path.resolve(item.photo));
});

// HTML Forms
app.get('/RegisterForm.html', (req, res) => res.sendFile(path.join(__dirname, 'RegisterForm.html')));
app.get('/SearchForm.html', (req, res) => res.sendFile(path.join(__dirname, 'SearchForm.html')));

/**
 * @openapi
 * /register:
 *   post:
 *     summary: Add item
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Name required
 */
app.post('/register', upload.single('photo'), (req, res) => {
    if (!req.body.inventory_name)
        return res.status(400).json({ error: 'Name required' });

    const inv = readInv();
    const id = inv.length ? Math.max(...inv.map(i => i.id)) + 1 : 1;

    const photoUrl = req.file
        ? `http://${options.host}:${options.port}/inventory/${id}/photo`
        : null;

    const newItem = {
        id,
        name: req.body.inventory_name,
        description: req.body.description,
        photo: req.file ? req.file.path : null,
        photoUrl
    };

    inv.push(newItem);
    writeInv(inv);

    res.status(201).json({ message: 'Created', item: newItem });
});

/**
 * @openapi
 * /search:
 *   post:
 *     summary: Search item
 *     requestBody:
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               has_photo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Found
 *       404:
 *         description: Not found
 */
const doSearch = (req, res, id, withPhoto) => {
    const item = readInv().find(i => i.id == id);
    if (!item) return res.status(404).json({ error: 'Not found' });

    const resp = { ...item };

    if (withPhoto === 'on' || withPhoto === 'true' || withPhoto === true) {
        if (resp.photoUrl) {
            resp.description += ` (Photo: ${resp.photoUrl})`;
        }
    }

    res.json(resp);
};

app.get('/search', (req, res) =>
    doSearch(req, res, req.query.id, req.query.includePhoto)
);

app.post('/search', (req, res) =>
    doSearch(req, res, req.body.id, req.body.has_photo || req.body.includePhoto)
);

/**
 * @openapi
 * /inventory/{id}:
 *   put:
 *     summary: Update item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated
 */
app.put('/inventory/:id', (req, res) => {
    const inv = readInv();

    const idx = inv.findIndex(i => i.id == req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    if (req.body.name !== undefined) inv[idx].name = req.body.name;
    if (req.body.description !== undefined) inv[idx].description = req.body.description;

    writeInv(inv);
    res.json({ message: 'Updated', item: inv[idx] });
});

/**
 * @openapi
 * /inventory/{id}:
 *   delete:
 *     summary: Delete item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 */
app.delete('/inventory/:id', (req, res) => {
    let inv = readInv();
    const idx = inv.findIndex(i => i.id == req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    if (inv[idx].photo && fs.existsSync(inv[idx].photo)) {
        try { fs.unlinkSync(inv[idx].photo); } catch { }
    }

    inv.splice(idx, 1);
    writeInv(inv);

    res.json({ message: 'Deleted' });
});

// --- Start server ---
app.listen(options.port, options.host, () => {
    console.log(`Server running at http://${options.host}:${options.port}`);
    console.log(`Docs: http://${options.host}:${options.port}/docs`);
});
