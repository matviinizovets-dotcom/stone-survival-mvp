const rootDir = path.join(__dirname);

app.use(express.static(rootDir, { index: 'index.html' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
});
