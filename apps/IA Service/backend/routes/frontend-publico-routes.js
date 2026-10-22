const path = require('path');
const express = require('express');

module.exports = function registrarFrontendPublico(app, { getConfigPorApelido }) {
  const dir = path.join(__dirname, '..', '..', 'frontend', 'j2a');
  // A URL de assets antiga também permanece válida para abas já abertas.
  for (const prefixo of ['/iaservice/assets', '/iaservice/j2a/assets']) {
    app.use(prefixo, express.static(path.join(dir, 'assets'), {
      etag: true,
      lastModified: true,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        res.setHeader('Referrer-Policy', 'no-referrer');
      },
    }));
  }
  function servir(_req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.sendFile(path.join(dir, 'index.html'));
  }
  // Compatibilidade: estes caminhos já eram publicados antes do cadastro dinâmico.
  app.get(['/iaservice', '/iaservice/j2a', '/iaservice/j2a/acesso', '/iaservice/j2a/radar'], servir);
  app.get(['/iaservice/:apelido', '/iaservice/:apelido/:tela(acesso|radar)'], (req, res) => {
    if (!getConfigPorApelido(req.params.apelido)) return res.status(404).send('Link de acesso não encontrado.');
    servir(req, res);
  });
};
