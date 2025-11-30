const express = require('express');
const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');

// --- Налаштування Commander (Звіт, Частина 1) ---
const program = new Command();
program
    .requiredOption('-h, --host <host>', 'Server host')
    .requiredOption('-p, --port <port>', 'Server port')
    .requiredOption('-c, --cache <path>', 'Cache directory path');

program.parse(process.argv);
const options = program.opts();

// --- Підготовка папок ---
const cacheDir = path.resolve(options.cache);
const dbFile = path.join(cacheDir, 'inventory.json');

if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}
if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify([]));
}

// --- Налаштування Express та Multer ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, cacheDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- Swagger Конфігурація (Звіт, Частина 3) ---
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Inventory Service API',
            version: '1.0.0',
            description: 'API documentation for the inventory service'
        }
    },
    apis: ['./index.js'] // Вказуємо поточний файл для пошуку коментарів
};
const swaggerSpec = swaggerJsDoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- Допоміжні функції ---
const readInventory = () => {
    try {
        return JSON.parse(fs.readFileSync(dbFile));
    } catch { return []; }
};
const writeInventory = (data) => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));

// --- Маршрути (API) ---

/**
 * @openapi
 * /inventory:
 * get:
 * summary: Get all inventory items
 * responses:
 * 200:
 * description: Success
 */
app.get('/inventory', (req, res) => {
    res.json(readInventory());
});

/**
 * @openapi
 * /inventory/{id}:
 * get:
 * summary: Get item by ID
 * parameters:
 * - in: path
 * name: id
 * required: true
 * schema:
 * type: string
 * responses:
 * 200:
 * description: Success
 * 404:
 * description: Not found
 */
app.get('/inventory/:id', (req, res) => {
    const item = readInventory().find(i => i.id == req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
});

// Отримання фото
app.get('/inventory/:id/photo', (req, res) => {
    const item = readInventory().find(i => i.id == req.params.id);
    if (!item || !item.photo) return res.status(404).json({ error: "Photo not found" });
    res.sendFile(path.resolve(item.photo));
});

// Форми HTML
app.get('/RegisterForm.html', (req, res) => res.sendFile(path.join(__dirname, 'RegisterForm.html')));
app.get('/SearchForm.html', (req, res) => res.sendFile(path.join(__dirname, 'SearchForm.html')));

/**
 * @openapi
 * /register:
 * post:
 * summary: Register a new inventory item
 * consumes:
 * - multipart/form-data
 * parameters:
 * - in: formData
 * name: inventory_name
 * required: true
 * type: string
 * - in: formData
 * name: description
 * type: string
 * - in: formData
 * name: photo
 * type: file
 * responses:
 * 201:
 * description: Created
 * 400:
 * description: Name is required
 */
app.post('/register', upload.single('photo'), (req, res) => {
    if (!req.body.inventory_name) return res.status(400).json({ error: "Name is required" });

    const inventory = readInventory();
    const newItem = {
        id: inventory.length > 0 ? Math.max(...inventory.map(i => i.id)) + 1 : 1, // Простий інкремент ID як у звіті
        name: req.body.inventory_name,
        description: req.body.description,
        photo: req.file ? req.file.path : null,
        photoUrl: req.file ? `http://${options.host}:${options.port}/inventory/${inventory.length + 1}/photo` : null
    };

    inventory.push(newItem);
    writeInventory(inventory);
    res.status(201).json({ message: "Created", item: newItem });
});

// Пошук (Адаптовано для обох методів: GET для HTML форми, POST для Postman/PDF)
const handleSearch = (req, res, id, includePhoto) => {
    const item = readInventory().find(i => i.id == id);
    if (!item) return res.status(404).json({ error: "Not found" });

    const responseItem = { ...item };
    // Логіка додавання посилання на фото (як у звіті)
    if (includePhoto === 'on' || includePhoto === 'true' || includePhoto === true) {
        if (responseItem.photo) responseItem.description += ` (Photo link: ${responseItem.photoUrl})`;
    }
    res.json(responseItem);
};

app.get('/search', (req, res) => handleSearch(req, res, req.query.id, req.query.includePhoto));
app.post('/search', (req, res) => handleSearch(req, res, req.body.id, req.body.has_photo || req.body.includePhoto));

// Оновлення (PUT)
app.put('/inventory/:id', (req, res) => {
    const inventory = readInventory();
    const index = inventory.findIndex(i => i.id == req.params.id);
    if (index === -1) return res.status(404).json({ error: "Not found" });

    if (req.body.name) inventory[index].name = req.body.name;
    if (req.body.description) inventory[index].description = req.body.description;

    writeInventory(inventory);
    res.json({ message: "Updated", item: inventory[index] });
});

// Видалення (DELETE)
app.delete('/inventory/:id', (req, res) => {
    let inventory = readInventory();
    const index = inventory.findIndex(i => i.id == req.params.id);
    if (index === -1) return res.status(404).json({ error: "Not found" });

    const item = inventory[index];
    if (item.photo && fs.existsSync(item.photo)) fs.unlinkSync(item.photo);

    inventory.splice(index, 1);
    writeInventory(inventory);
    res.json({ message: "Deleted" });
});

// --- Запуск ---
app.listen(options.port, options.host, () => {
    console.log(`Server running at http://${options.host}:${options.port}`);
});