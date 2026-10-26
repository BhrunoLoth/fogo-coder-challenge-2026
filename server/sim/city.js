'use strict';
/**
 * Carrega a geografia de Marília (data/marilia.json, dados públicos) e acrescenta
 * o "perfil oculto" de cada bairro, usado só pelo simulador (nunca pelo motor).
 */
const fs = require('fs');
const path = require('path');

// Perfil oculto por bairro. Ajustado à realidade aproximada da cidade, mas é simulação.
const PERFIL_OCULTO = {
  'Centro': { perfil: 'comercial', peso: 1.8 },
  'Fragata': { perfil: 'comercial', peso: 1.3 },
  'Jardim Tangará': { perfil: 'comercial', peso: 1.0 },
  'Palmital': { perfil: 'residencial', peso: 1.1 },
  'Castelo Branco': { perfil: 'periferico', peso: 1.1, tendencia: { tipo: 'roubo_furto', fator: 2.6 } },
  'Jardim Santa Antonieta': { perfil: 'residencial', peso: 0.9 },
  'Distrito Industrial': { perfil: 'industrial', peso: 0.8 },
  'Parque das Nações': { perfil: 'periferico', peso: 0.9 },
  'Somenzari': { perfil: 'universitario', peso: 1.0 },
  'Alto Cafezal': { perfil: 'residencial', peso: 1.0, baixada: true },
  'Jardim Bandeirantes': { perfil: 'residencial', peso: 0.9 },
  'Jardim Califórnia': { perfil: 'residencial', peso: 0.9 },
  'Jardim Cavallari': { perfil: 'universitario', peso: 1.0, tendencia: { tipo: 'acidente', fator: 0.5 } },
  'Banzato': { perfil: 'residencial', peso: 0.9 },
  'Cascata': { perfil: 'residencial', peso: 1.0, baixada: true },
  'Jardim Maria Izabel': { perfil: 'residencial', peso: 1.0 },
  'Jardim Itamarati': { perfil: 'rodovia', peso: 0.8 },
  'Parque São Jorge': { perfil: 'residencial', peso: 1.0 },
  'Nova Marília': { perfil: 'periferico', peso: 1.3, baixada: true },
  'Jardim Teotônio Vilela': { perfil: 'periferico', peso: 0.9 },
  'Jardim Marajó': { perfil: 'periferico', peso: 0.9 },
};

function carregarCidade() {
  const city = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'marilia.json'), 'utf8'));
  city.bairros = city.bairros.map((b) => {
    const oculto = PERFIL_OCULTO[b.nome] || {};
    return { perfil: 'residencial', peso: 1, baixada: false, ...b, ...oculto };
  });
  city.bairros.forEach((b, i) => { b.id = i + 1; });
  return city;
}

module.exports = { carregarCidade };
