const express = require('express');
const path = require('path');

const app = express();

// Раздаём статику (включая styles.css, иконки и т.п.)
app.use(express.static(__dirname));

// Корень → главная страница приложения
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'app.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ready on http://localhost:${PORT}`));
